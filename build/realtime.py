#!/usr/bin/env python3
"""Cut the gtfs.de GTFS-Realtime stream down to the delays Chain Traveler shows. Standard library only.

The stream (https://realtime.gtfs.de/realtime-free.pb, beta, CC BY-SA 4.0) is one protobuf of about 13 MB, replaced every
10 seconds, with no CORS header: a browser cannot read it. This turns it into data/delays.json, a few tens of KB the
app fetches from its own origin. Per run (a trip on one service day) it keeps

  delay      the latest known delay, in whole minutes (negative: early). "Latest known" is the last stop whose time is not
             after the stream's own timestamp; for a run that has not started, its first stop.
  cancelled  the run is CANCELED, or every one of its stops is SKIPPED (this is how the stream cancels a run in practice)
  skipped    how many stops of a run that still runs are SKIPPED

Matching: the stream names a run by the feed's trip_id and its service day. The CHT1 binary only has trip numbers, so
the daily build writes trip-ids.txt.gz (trip number -> trip_id, see build_timetable.py) and delays.json is keyed by
service day and trip number, which the app has. It names the timetable build it was made for (date and sha256 of
timetable.bin.gz); an app on another build ignores the file. Runs the stream lists that the build does not hold (buses,
trams and everything else in the all-Germany stream, about 86%) are dropped.

A run is only trusted when it checks out: if the stream's first stop of a run is in it, its scheduled time (time minus
delay) must be the minute the build has for that first stop. A few failures drop those runs; many mean the stream and
the build come from different versions of the static feed, and nothing is published.

delays.json:
  {"format": 1, "built": "2026-11-01T11:25:03Z", "feedTime": "2026-11-01T11:24:55Z",
   "source": {"publisher": ..., "license": ..., "changes": ...},
   "timetable": {"date": "2026-10-31", "sha256": "<timetable.bin.gz of that build>"},
   "trips": {"2026-11-01": {"delay": {"<trip number>": 2, ...}, "cancelled": [<trip number>, ...], "skipped": {"<trip number>": 1}}}}

Usage:
  realtime.py make <stream.pb> <build-dir> <out.json> [--now UNIX]   <build-dir> holds latest.json and trip-ids.txt.gz as published
  realtime.py check <delays.json> [--now UNIX]                       verify a file before it is published (same rules as the app)
Exit status of make: 0 written; 3 nothing to publish (stale or unusable stream, build without trip ids, stream of another
feed version), with the reason on stdout; 1 any other error.
"""
import collections
import datetime as dt
import gzip
import json
import os
import re
import sys
import time
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manifest as manifest_py  # noqa: E402

FORMAT = 1
MAX_STREAM_BYTES = 64 * 1024 * 1024    # refuse a stream larger than this (the real one is about 13 MB)
MAX_FILE_BYTES = 1024 * 1024           # a delays.json larger than this is refused (the real one is far below)
MAX_AGE_S = 15 * 60                    # older than this, the data is stale: the app shows nothing, publish refuses it
MAX_AHEAD_S = 5 * 60                   # a timestamp this far in the future is a clock gone wrong
MAX_DELAY_MIN = 24 * 60                # a delay beyond a day either way is not a delay
CHECK_MIN = 20                         # first-stop checks needed before a mismatch can stop the publish ...
CHECK_MAX_BAD = 0.05                   # ... and the share of them that may fail

SOURCE = {
    'publisher': 'gtfs.de, realtime stream (GTFS-Realtime, beta)',
    'license': 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
    'changes': 'Reduced to the latest known delay per run in whole minutes, cancelled runs and skipped stops, and matched to '
               'the trips of one timetable build. This file is offered under the same licence.',
}

# GTFS-Realtime enums that matter here (https://gtfs.org/documentation/realtime/reference/).
TRIP_SCHEDULED = 0      # TripDescriptor.schedule_relationship
TRIP_CANCELED = 3
STOP_SKIPPED = 1        # StopTimeUpdate.schedule_relationship

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
STAMP_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
NUM_RE = re.compile(r'^\d{1,9}$')
BERLIN = ZoneInfo('Europe/Berlin')


class NothingToPublish(Exception):
    """The input is fine as far as it goes, but no file worth publishing can be made from it (exit status 3)."""


# ---- protobuf wire format: just enough to read a FeedMessage. Unknown fields are skipped, never an error.

def _varint(b, i, end):
    """The unsigned varint at b[i:end] and the index after it."""
    r = s = 0
    while True:
        if i >= end:
            raise ValueError('truncated varint')
        c = b[i]
        i += 1
        r |= (c & 0x7f) << s
        if c < 0x80:
            return r, i
        s += 7
        if s > 63:
            raise ValueError('varint longer than 10 bytes')


def _fields(b, i, end):
    """Yield (field number, wire type, value) for each field of the message b[i:end]. A varint (wire 0) is an int; a
    length-delimited field (wire 2) is the (start, end) of its bytes; fixed-width fields are skipped."""
    while i < end:
        key, i = _varint(b, i, end)
        num, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _varint(b, i, end)
            yield num, 0, v
        elif wire == 2:
            n, i = _varint(b, i, end)
            if i + n > end:
                raise ValueError('a field runs past the end of its message')
            yield num, 2, (i, i + n)
            i += n
        elif wire == 1 or wire == 5:
            i += 8 if wire == 1 else 4
            if i > end:
                raise ValueError('truncated fixed-width field')
        else:
            raise ValueError('unsupported wire type %d' % wire)


def _int32(v):
    v &= 0xffffffff        # a negative int32 is sent as ten bytes: sign-extended to 64 bits
    return v - (1 << 32) if v >= 1 << 31 else v


def _int64(v):
    return v - (1 << 64) if v >= 1 << 63 else v


def _text(b, span):
    return bytes(b[span[0]:span[1]]).decode('utf-8', 'replace')


# ---- the messages we read: TripUpdate, TripDescriptor, StopTimeUpdate and StopTimeEvent. ServiceAlerts are only counted.

def _event(b, span):
    """StopTimeEvent -> (delay in seconds or None, absolute time in unix seconds or None)."""
    delay = time_ = None
    for num, wire, v in _fields(b, span[0], span[1]):
        if num == 1 and wire == 0:
            delay = _int32(v)
        elif num == 2 and wire == 0:
            time_ = _int64(v)
    return delay, time_


def _stop_update(b, span):
    """StopTimeUpdate -> (stop_sequence, schedule_relationship, arrival (delay, time), departure (delay, time))."""
    seq = None
    rel = 0
    arr = dep = (None, None)
    for num, wire, v in _fields(b, span[0], span[1]):
        if num == 1 and wire == 0:
            seq = v
        elif num == 2 and wire == 2:
            arr = _event(b, v)
        elif num == 3 and wire == 2:
            dep = _event(b, v)
        elif num == 5 and wire == 0:
            rel = v
    return seq, rel, arr, dep


def _trip_update(b, span, keep):
    """TripUpdate -> (trip_id, start_date, schedule_relationship, [stop updates]), or None when keep(trip_id) is false."""
    trip_id = start_date = None
    rel = 0
    spans = []
    for num, wire, v in _fields(b, span[0], span[1]):
        if num == 1 and wire == 2:                       # TripDescriptor
            for n2, w2, v2 in _fields(b, v[0], v[1]):
                if n2 == 1 and w2 == 2:
                    trip_id = _text(b, v2)
                elif n2 == 3 and w2 == 2:
                    start_date = _text(b, v2)
                elif n2 == 4 and w2 == 0:
                    rel = v2
        elif num == 2 and wire == 2:
            spans.append(v)
    if keep is not None and not keep(trip_id):
        return None
    return trip_id, start_date, rel, [_stop_update(b, s) for s in spans]


def decode(data, keep=None):
    """Decode a FeedMessage. Returns {'time': header timestamp (unix seconds), 'trips': [...], 'updates': n, 'alerts': n}.
    keep(trip_id) says which trips to read in full (default all); the others are counted in 'updates' and skipped.
    Raises ValueError on bytes that are not a well-formed message."""
    if len(data) > MAX_STREAM_BYTES:
        raise ValueError('stream is larger than %d bytes' % MAX_STREAM_BYTES)
    b = memoryview(data)
    stamp = None
    trips, updates, alerts = [], 0, 0
    for num, wire, v in _fields(b, 0, len(b)):
        if num == 1 and wire == 2:                       # FeedHeader
            for n2, w2, v2 in _fields(b, v[0], v[1]):
                if n2 == 3 and w2 == 0:
                    stamp = v2
        elif num == 2 and wire == 2:                     # FeedEntity
            deleted, update = False, None
            for n2, w2, v2 in _fields(b, v[0], v[1]):
                if n2 == 2 and w2 == 0:
                    deleted = bool(v2)
                elif n2 == 3 and w2 == 2:
                    update = v2
                elif n2 == 5 and w2 == 2:
                    alerts += 1
            if update is not None and not deleted:
                updates += 1
                trip = _trip_update(b, update, keep)
                if trip is not None:
                    trips.append(trip)
    if stamp is None:
        raise ValueError('the stream has no header timestamp')
    return {'time': stamp, 'trips': trips, 'updates': updates, 'alerts': alerts}


# ---- matching and cutting

def load_trip_ids(path, manifest):
    """{trip_id: (trip number, minute the first stop is left or None)} from trip-ids.txt.gz, after checking the file
    against the manifest of the build. Raises ValueError."""
    if 'tripIdsSha256' not in manifest:
        raise NothingToPublish('the published build has no trip id file (it was made before the file existed)')
    if os.path.getsize(path) != manifest['tripIdsBytes'] or manifest_py.sha256_file(path) != manifest['tripIdsSha256']:
        raise ValueError('trip-ids.txt.gz does not match the manifest')
    ids = {}
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for n, line in enumerate(f):
            tid, tab, minute = line.rstrip('\n').partition('\t')
            if not tab or tid in ids or (minute and not minute.isdigit()):
                raise ValueError('trip-ids.txt.gz line %d is malformed' % (n + 1))
            ids[tid] = (n, int(minute) if minute else None)
    return ids


def day_start(iso):
    """Unix seconds of time zero of a service day: GTFS times count from noon minus 12 hours, local time."""
    y, m, d = (int(x) for x in iso.split('-'))
    return int(dt.datetime(y, m, d, 12, tzinfo=BERLIN).timestamp()) - 12 * 3600


def iso_day(start_date):
    """'20261101' -> '2026-11-01', or None when it is not a date."""
    if not isinstance(start_date, str) or not re.fullmatch(r'\d{8}', start_date):
        return None
    try:
        return dt.date(int(start_date[:4]), int(start_date[4:6]), int(start_date[6:])).isoformat()
    except ValueError:
        return None


def stamp(unix):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(unix))


def _parse_stamp(s):
    return dt.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp()


def _minutes(seconds):
    return (seconds + 30) // 60     # whole minutes, half up (-90 s is -1 min)


def _state(stops, feed_time):
    """(cancelled, skipped count, latest known delay in minutes or None) from one run's stop updates."""
    stops = sorted(stops, key=lambda s: (s[0] is None, s[0] or 0))
    skipped = sum(1 for s in stops if s[1] == STOP_SKIPPED)
    if stops and skipped == len(stops):
        return True, skipped, None
    first = latest = None
    for _, rel, arr, dep in stops:
        if rel == STOP_SKIPPED:
            continue
        for delay, at in (arr, dep):
            if delay is None:
                continue
            if first is None:
                first = delay
            if at is not None and at <= feed_time:
                latest = delay
    chosen = latest if latest is not None else first
    return False, skipped, None if chosen is None else _minutes(chosen)


def _first_stop_fits(stops, day, minute):
    """True/False when the first stop of the run is in the stream and its scheduled time can be compared with the build's
    minute for it; None when it cannot be checked (the stream starts later, or has no departure there)."""
    stops = sorted((s for s in stops if s[0] is not None), key=lambda s: s[0])
    if not stops or stops[0][0] != 0 or minute is None or stops[0][1] == STOP_SKIPPED:
        return None
    delay, at = stops[0][3]
    if delay is None or at is None:
        return None
    return (at - delay - day_start(day)) // 60 == minute


def cut(feed, ids, manifest, built_at):
    """The delays of one stream for one timetable build: (delays.json as a dict, counts). Raises NothingToPublish when the
    stream is stale or comes from another version of the static feed."""
    age = built_at - feed['time']
    if age > MAX_AGE_S:
        raise NothingToPublish('the stream is %d minutes old (limit %d)' % (age // 60, MAX_AGE_S // 60))
    if -age > MAX_AHEAD_S:
        raise NothingToPublish('the stream is dated %d minutes in the future' % (-age // 60))
    first = dt.date.fromisoformat(manifest['firstDate'])
    days = {}
    n = collections.Counter(updates=feed['updates'], alerts=feed['alerts'])
    for trip_id, start_date, rel, stops in feed['trips']:
        if trip_id not in ids:
            continue
        number, minute = ids[trip_id]
        iso = iso_day(start_date)
        if iso is None or not 0 <= (dt.date.fromisoformat(iso) - first).days < manifest['nDays']:
            n['outside the timetable window'] += 1
            continue
        if rel not in (TRIP_SCHEDULED, TRIP_CANCELED):
            n['added or replaced runs'] += 1
            continue
        n['matched'] += 1
        fits = _first_stop_fits(stops, iso, minute)
        if fits is not None:
            n['checked'] += 1
            if not fits:
                n['mismatch'] += 1
                continue
        cancelled, skipped, delay = (True, 0, None) if rel == TRIP_CANCELED else _state(stops, feed['time'])
        if delay is not None and abs(delay) > MAX_DELAY_MIN:
            n['implausible'] += 1
            continue
        if not cancelled and delay is None and not skipped:
            continue
        day = days.setdefault(iso, {'delay': {}, 'cancelled': [], 'skipped': {}})
        key = str(number)
        if cancelled:
            day['cancelled'].append(number)
            n['cancelled'] += 1
        else:
            if delay is not None:
                day['delay'][key] = delay
                n['with a delay'] += 1
            if skipped:
                day['skipped'][key] = skipped
                n['with skipped stops'] += 1
    if n['checked'] >= CHECK_MIN and n['mismatch'] > CHECK_MAX_BAD * n['checked']:
        raise NothingToPublish('%d of %d first stops disagree with the trip ids of build %s: the stream belongs to another '
                               'version of the static feed' % (n['mismatch'], n['checked'], manifest['date']))
    for day in days.values():
        day['cancelled'].sort()
        day['delay'] = dict(sorted(day['delay'].items(), key=lambda kv: int(kv[0])))
        day['skipped'] = dict(sorted(day['skipped'].items(), key=lambda kv: int(kv[0])))
    out = {
        'format': FORMAT,
        'built': stamp(built_at),
        'feedTime': stamp(feed['time']),
        'source': dict(SOURCE),
        'timetable': {'date': manifest['date'], 'sha256': manifest['sha256']},
        'trips': dict(sorted(days.items())),
    }
    return out, n


# ---- the file as the app will read it

def validate(d, now=None):
    """Raise ValueError unless d is a well-formed delays.json. The same rules the app applies. With `now` (unix seconds) a
    file older than MAX_AGE_S, or dated in the future, is refused too."""
    def bad(why):
        raise ValueError('bad delays file: ' + why)
    if not isinstance(d, dict) or d.get('format') != FORMAT:
        bad('unsupported format')
    for k in ('built', 'feedTime'):
        if not isinstance(d.get(k), str) or not STAMP_RE.match(d[k]):
            bad(k + ' must be a UTC timestamp')
    try:
        feed_time = _parse_stamp(d['feedTime'])
    except ValueError:
        bad('feedTime is not a time')
    src = d.get('source')
    if not isinstance(src, dict) or any(not isinstance(src.get(k), str) or not 0 < len(src[k]) <= 400 for k in ('publisher', 'license')):
        bad('source needs a publisher and a license')
    tt = d.get('timetable')
    if not isinstance(tt, dict) or not isinstance(tt.get('date'), str) or not DATE_RE.match(tt['date']) \
            or not isinstance(tt.get('sha256'), str) or not SHA_RE.match(tt['sha256']):
        bad('timetable must name a build (date and sha256)')
    trips = d.get('trips')
    if not isinstance(trips, dict):
        bad('trips must be an object')
    def is_int(v):
        return isinstance(v, int) and not isinstance(v, bool)
    for iso, day in trips.items():
        if not isinstance(iso, str) or iso_day(iso.replace('-', '')) is None or not DATE_RE.match(iso):
            bad('day %r is not a date' % iso)
        if not isinstance(day, dict) or not isinstance(day.get('delay'), dict) or not isinstance(day.get('cancelled'), list) \
                or not isinstance(day.get('skipped'), dict):
            bad('day %s needs delay, cancelled and skipped' % iso)
        for k, v in day['delay'].items():
            if not NUM_RE.match(k) or not is_int(v) or abs(v) > MAX_DELAY_MIN:
                bad('delay %r: %r' % (k, v))
        for v in day['cancelled']:
            if not is_int(v) or v < 0:
                bad('cancelled %r' % (v,))
        for k, v in day['skipped'].items():
            if not NUM_RE.match(k) or not is_int(v) or v < 1:
                bad('skipped %r: %r' % (k, v))
    if now is not None:
        if now - feed_time > MAX_AGE_S:
            bad('feedTime is %d minutes old' % ((now - feed_time) // 60))
        if feed_time - now > MAX_AHEAD_S:
            bad('feedTime is in the future')


def dumps(d):
    return json.dumps(d, separators=(',', ':'), ensure_ascii=False) + '\n'


# ---- command line

def cmd_make(args):
    now = None
    if len(args) == 5 and args[3] == '--now':
        now, args = int(args[4]), args[:3]
    if len(args) != 3:
        raise SystemExit(__doc__)
    stream_path, build_dir, out_path = args
    try:
        with open(os.path.join(build_dir, 'latest.json'), encoding='utf-8') as f:
            manifest = json.load(f)
        manifest_py.validate_manifest(manifest)
        ids = load_trip_ids(os.path.join(build_dir, manifest_py.TRIP_IDS_FILE), manifest)
        with open(stream_path, 'rb') as f:
            data = f.read()
        try:
            feed = decode(data, keep=lambda tid: tid in ids)
        except ValueError as e:
            raise NothingToPublish('the stream is not a readable FeedMessage: %s' % e)
        out, n = cut(feed, ids, manifest, int(time.time()) if now is None else now)
        validate(out)
        text = dumps(out)
        if len(text.encode('utf-8')) > MAX_FILE_BYTES:
            raise ValueError('delays.json would be %d bytes (limit %d)' % (len(text.encode('utf-8')), MAX_FILE_BYTES))
    except NothingToPublish as e:
        print('nothing to publish: %s' % e)
        return 3
    except (ValueError, KeyError, OSError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('stream of %s: %d trip updates, %d on trips of build %s (%d trips), %d alerts' % (out['feedTime'], n['updates'], n['matched'], manifest['date'], len(ids), n['alerts']))
    print('delays.json: %d bytes, %d runs with a delay, %d cancelled, %d with skipped stops; first stops checked %d, disagreeing %d, other days or kinds dropped %d' % (
        len(text.encode('utf-8')), n['with a delay'], n['cancelled'], n['with skipped stops'], n['checked'], n['mismatch'],
        n['outside the timetable window'] + n['added or replaced runs'] + n['implausible']))
    return 0


def cmd_check(args):
    now = None
    if len(args) == 3 and args[1] == '--now':
        now, args = int(args[2]), args[:1]
    if len(args) != 1:
        raise SystemExit(__doc__)
    try:
        if os.path.getsize(args[0]) > MAX_FILE_BYTES:
            raise ValueError('larger than %d bytes' % MAX_FILE_BYTES)
        with open(args[0], encoding='utf-8') as f:
            d = json.load(f)
        validate(d, int(time.time()) if now is None else now)
    except (ValueError, OSError) as e:
        print('error: %s' % e, file=sys.stderr)
        return 1
    print('ok')
    return 0


def main(argv):
    if len(argv) < 2 or argv[1] not in ('make', 'check'):
        raise SystemExit(__doc__)
    return {'make': cmd_make, 'check': cmd_check}[argv[1]](argv[2:])


if __name__ == '__main__':
    sys.exit(main(sys.argv))
