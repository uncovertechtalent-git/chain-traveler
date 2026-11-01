"""Tests of build/realtime.py: the protobuf reader, the matching to trip numbers, what is kept per run, the checks that
refuse a stream, the file the app reads, and the command line. The stream is made here by a small protobuf encoder."""
import datetime as dt
import gzip
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'build'))
sys.path.insert(0, HERE)
import realtime  # noqa: E402
import manifest  # noqa: E402
from test_build_timetable import FEED, read_cht1  # noqa: E402
import build_timetable  # noqa: E402

UTC = dt.timezone.utc
NOW = 1793532000                         # 2026-11-01 11:20:00 UTC, 12:20 in Berlin
FEED_TIME = NOW - 30
DAY = '2026-11-01'
DAY_START = int(dt.datetime(2026, 10, 31, 23, 0, tzinfo=UTC).timestamp())    # midnight of 2026-11-01 in Berlin (UTC+1)


# ---- a protobuf encoder, just enough to make a FeedMessage

def varint(n):
    n &= (1 << 64) - 1                   # a negative number is ten bytes, as protobuf does for int32 and int64
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def vi(num, n):
    return varint(num << 3) + varint(n)


def ld(num, payload):
    if isinstance(payload, str):
        payload = payload.encode()
    return varint(num << 3 | 2) + varint(len(payload)) + payload


def event(delay=None, at=None):
    return (vi(1, delay) if delay is not None else b'') + (vi(2, at) if at is not None else b'')


def stop(seq, arr=None, dep=None, rel=None, stop_id='1'):
    """arr and dep are (delay seconds, absolute time) or None."""
    return (vi(1, seq) + (ld(2, event(*arr)) if arr else b'') + (ld(3, event(*dep)) if dep else b'') + ld(4, stop_id)
            + (vi(5, rel) if rel is not None else b''))


def trip(trip_id, date='20261101', stops=(), rel=None, extra=b''):
    desc = ld(1, trip_id) + ld(3, date) + (vi(4, rel) if rel is not None else b'')
    return ld(1, desc) + b''.join(ld(2, s) for s in stops) + extra


def entity(eid, update=None, alert=False, deleted=False, extra=b''):
    return ld(1, str(eid)) + (vi(2, 1) if deleted else b'') + (ld(3, update) if update is not None else b'') + (ld(5, b'\x0a\x00') if alert else b'') + extra


def feed(entities, at=FEED_TIME, header_extra=b''):
    header = ld(1, '2.0') + vi(2, 0) + (vi(3, at) if at is not None else b'') + header_extra
    return ld(1, header) + b''.join(ld(2, e) for e in entities)


def sched(minute, delay_s=0):
    """(delay, absolute time) of a stop whose planned time is `minute` after midnight of DAY, running delay_s late."""
    return (delay_s, DAY_START + minute * 60 + delay_s)


# ---- a build to match against: trip numbers 0..4 are the feed ids t0..t4

def write_map(d, ids, first='2026-10-31', n_days=31, date='2026-11-01'):
    """latest.json and trip-ids.txt.gz as the job downloads them. ids: list of (trip_id, first-stop minute or None)."""
    os.makedirs(d, exist_ok=True)
    raw = gzip.compress(''.join('%s\t%s\n' % (i, '' if m is None else m) for i, m in ids).encode(), 9, mtime=0)
    with open(os.path.join(d, 'trip-ids.txt.gz'), 'wb') as f:
        f.write(raw)
    m = {'format': 1, 'date': date, 'sha256': 'ab' * 32, 'bytes': 5000, 'metaSha256': 'cd' * 32, 'metaBytes': 300, 'firstDate': first,
         'nDays': n_days, 'built': date + 'T11:30:00Z', 'feedSha256': 'ef' * 32, 'tripIdsSha256': hashlib.sha256(raw).hexdigest(), 'tripIdsBytes': len(raw)}
    with open(os.path.join(d, 'latest.json'), 'w') as f:
        json.dump(m, f)
    return m


IDS = [('t0', 360), ('t1', 400), ('t2', 1510), ('t3', None), ('t4', 500)]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.map = os.path.join(self.tmp, 'map')
        self.manifest = write_map(self.map, IDS)
        self.ids = realtime.load_trip_ids(os.path.join(self.map, 'trip-ids.txt.gz'), self.manifest)

    def delays(self, entities, at=FEED_TIME, now=NOW, ids=None, m=None):
        data = feed(entities, at)
        decoded = realtime.decode(data, keep=lambda t: t in (ids or self.ids))
        return realtime.cut(decoded, ids or self.ids, m or self.manifest, now)


class DecodeTest(unittest.TestCase):
    def test_reads_the_timestamp_trips_stops_and_events(self):
        data = feed([entity(1, trip('t0', stops=[stop(0, dep=(0, 1000), stop_id='A'), stop(1, arr=(120, 1500), dep=(180, 1560), stop_id='B')], rel=0))])
        d = realtime.decode(data)
        self.assertEqual((d['time'], d['updates'], d['alerts']), (FEED_TIME, 1, 0))
        tid, date, rel, stops = d['trips'][0]
        self.assertEqual((tid, date, rel), ('t0', '20261101', 0))
        self.assertEqual(stops, [(0, 0, (None, None), (0, 1000)), (1, 0, (120, 1500), (180, 1560))])

    def test_a_negative_delay_is_ten_bytes_and_comes_back_negative(self):
        self.assertEqual(len(varint(-90)), 10)
        d = realtime.decode(feed([entity(1, trip('t0', stops=[stop(0, dep=(-90, 1000))]))]))
        self.assertEqual(d['trips'][0][3][0][3], (-90, 1000))

    def test_fields_in_any_order_and_unknown_fields_are_skipped(self):
        junk = vi(15, 7) + ld(14, 'xx') + varint(13 << 3 | 5) + b'\0\0\0\0' + varint(12 << 3 | 1) + b'\0' * 8
        upd = junk + ld(2, vi(5, 1) + ld(4, 'S') + junk + vi(1, 3)) + ld(1, vi(4, 3) + ld(3, '20261102') + junk + ld(1, 'zz'))
        d = realtime.decode(feed([entity(9, upd, extra=junk)], header_extra=junk))
        self.assertEqual(d['trips'], [('zz', '20261102', 3, [(3, 1, (None, None), (None, None))])])

    def test_alerts_are_counted_deleted_entities_and_non_trip_entities_are_not_trips(self):
        d = realtime.decode(feed([entity(1, alert=True), entity(2, trip('t0'), deleted=True), entity(3), entity(4, trip('t1'))]))
        self.assertEqual((d['alerts'], d['updates'], [t[0] for t in d['trips']]), (1, 1, ['t1']))

    def test_keep_reads_only_the_trips_asked_for_but_counts_all(self):
        d = realtime.decode(feed([entity(1, trip('t0', stops=[stop(0)])), entity(2, trip('bus', stops=[stop(0)]))]), keep=lambda t: t == 't0')
        self.assertEqual(([t[0] for t in d['trips']], d['updates']), (['t0'], 2))

    def test_malformed_input_is_a_value_error_not_a_crash(self):
        good = feed([entity(1, trip('t0', stops=[stop(0, dep=(0, 1000))]))])
        cases = {
            'empty': b'',
            'no timestamp': feed([entity(1, trip('t0'))], at=None),
            'truncated': good[:len(good) - 5],
            'cut in a varint': good[:2] + b'\x80',
            'field longer than the message': ld(1, 'x')[:-1] + b'',
            'varint of eleven bytes': varint(1 << 3) + b'\xff' * 10 + b'\x01',
            'group wire type after a good message': good + varint(7 << 3 | 3),
            'length past the end': varint(2 << 3 | 2) + varint(500) + b'abc',
            'fixed32 cut short': good + varint(9 << 3 | 5) + b'\0\0',
        }
        for name, data in cases.items():
            with self.assertRaises(ValueError, msg=name):
                realtime.decode(data)

    def test_garbage_bytes_never_raise_anything_but_value_error(self):
        import random
        rng = random.Random(7)
        base = feed([entity(1, trip('t0', stops=[stop(0, dep=(5, 1000)), stop(1, arr=(-5, 2000))]))])
        for _ in range(300):
            b = bytearray(base)
            for _ in range(rng.randint(1, 4)):
                b[rng.randrange(len(b))] = rng.randrange(256)
            try:
                realtime.decode(bytes(b))
            except ValueError:
                pass

    def test_a_stream_above_the_size_limit_is_refused(self):
        old = realtime.MAX_STREAM_BYTES
        realtime.MAX_STREAM_BYTES = 10
        self.addCleanup(setattr, realtime, 'MAX_STREAM_BYTES', old)
        with self.assertRaisesRegex(ValueError, 'larger'):
            realtime.decode(feed([]))


class CutTest(Base):
    def run_of(self, trip_id, stops, rel=None, date='20261101'):
        return entity(trip_id, trip(trip_id, date, stops, rel))

    def test_a_run_is_keyed_by_service_day_and_trip_number_and_other_trips_are_dropped(self):
        out, n = self.delays([self.run_of('t2', [stop(0, dep=sched(1510, 240))]), self.run_of('bus', [stop(0, dep=sched(5, 600))])])
        self.assertEqual(out['trips'], {DAY: {'delay': {'2': 4}, 'cancelled': [], 'skipped': {}}})
        self.assertEqual((n['updates'], n['matched']), (2, 1))

    def test_the_file_names_the_build_the_numbers_belong_to_and_the_stream_time(self):
        out, _ = self.delays([self.run_of('t0', [stop(0, dep=sched(360))])])
        self.assertEqual(out['timetable'], {'date': '2026-11-01', 'sha256': 'ab' * 32})
        self.assertEqual((out['format'], out['feedTime'], out['built']), (1, '2026-11-01T11:19:30Z', '2026-11-01T11:20:00Z'))
        self.assertIn('CC BY-SA 4.0', out['source']['license'])
        self.assertIn('gtfs.de', out['source']['publisher'])

    def test_latest_known_delay_is_the_last_stop_not_after_the_stream_time(self):
        stops = [stop(0, dep=(60, FEED_TIME - 3000)), stop(1, arr=(300, FEED_TIME - 100), dep=(300, FEED_TIME + 60)),
                 stop(2, arr=(900, FEED_TIME + 900), dep=(900, FEED_TIME + 960))]
        out, _ = self.delays([self.run_of('t3', stops)])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 5})             # arrived at stop 1, 5 minutes late; stop 2 is a prediction

    def test_a_run_that_has_not_started_gets_its_first_predicted_delay(self):
        stops = [stop(0, dep=(120, FEED_TIME + 600)), stop(1, arr=(600, FEED_TIME + 3000))]
        out, _ = self.delays([self.run_of('t3', stops)])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 2})

    def test_with_no_stop_behind_it_the_run_gets_the_delay_of_the_departure_it_is_about_to_make(self):
        # the train is predicted 10 minutes late into the stop and 8 late out of it: a leg that boards there leaves 8 late
        stops = [stop(18, arr=(600, FEED_TIME + 600), dep=(480, FEED_TIME + 800)), stop(19, arr=(360, FEED_TIME + 1800))]
        out, _ = self.delays([self.run_of('t3', stops)])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 8})

    def test_a_first_stop_with_an_arrival_only_gives_the_arrival_delay(self):
        out, _ = self.delays([self.run_of('t3', [stop(9, arr=(180, FEED_TIME + 600))])])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 3})

    def test_minutes_are_whole_and_rounded_half_up(self):
        for seconds, minutes in ((29, 0), (30, 1), (89, 1), (90, 2), (-29, 0), (-30, 0), (-31, -1), (-90, -1), (-91, -2), (0, 0), (3600, 60)):
            out, _ = self.delays([self.run_of('t3', [stop(0, dep=(seconds, FEED_TIME - 10))])])
            self.assertEqual(out['trips'][DAY]['delay'], {'3': minutes}, seconds)

    def test_zero_is_kept_because_on_time_is_data(self):
        out, _ = self.delays([self.run_of('t3', [stop(0, dep=(0, FEED_TIME - 10))])])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 0})

    def test_a_canceled_run_is_listed_and_has_no_delay(self):
        out, _ = self.delays([self.run_of('t1', [stop(0, dep=sched(400))], rel=3)])
        self.assertEqual(out['trips'][DAY], {'delay': {}, 'cancelled': [1], 'skipped': {}})

    def test_a_run_whose_every_stop_is_skipped_is_cancelled_too(self):
        out, n = self.delays([self.run_of('t1', [stop(0, rel=1), stop(1, rel=1), stop(2, rel=1)])])
        self.assertEqual(out['trips'][DAY], {'delay': {}, 'cancelled': [1], 'skipped': {}})
        self.assertEqual(n['cancelled'], 1)

    def test_skipped_stops_of_a_run_that_still_runs_are_counted_and_do_not_set_its_delay(self):
        stops = [stop(0, dep=(120, FEED_TIME - 500)), stop(1, rel=1), stop(2, rel=1), stop(3, arr=(60, FEED_TIME + 500))]
        out, _ = self.delays([self.run_of('t3', stops)])
        self.assertEqual(out['trips'][DAY], {'delay': {'3': 2}, 'cancelled': [], 'skipped': {'3': 2}})

    def test_a_skipped_stop_that_carries_a_time_anyway_does_not_set_the_delay(self):
        stops = [stop(0, dep=(60, FEED_TIME - 900)), stop(1, rel=1, dep=(1800, FEED_TIME - 300)), stop(2, arr=(120, FEED_TIME + 300))]
        out, _ = self.delays([self.run_of('t3', stops)])
        self.assertEqual(out['trips'][DAY]['delay'], {'3': 1})

    def test_no_data_stops_alone_say_nothing_about_a_run(self):
        out, _ = self.delays([self.run_of('t0', [stop(0, rel=2), stop(1, rel=2)])])
        self.assertEqual(out['trips'], {})

    def test_a_trip_update_without_stops_says_nothing(self):
        out, _ = self.delays([self.run_of('t0', [])])
        self.assertEqual(out['trips'], {})

    def test_added_and_replacement_runs_are_not_ours_to_show(self):
        out, n = self.delays([self.run_of('t0', [stop(0, dep=sched(360))], rel=1), self.run_of('t4', [stop(0, dep=sched(500))], rel=5)])
        self.assertEqual(out['trips'], {})
        self.assertEqual(n['added or replaced runs'], 2)

    def test_days_outside_the_window_and_bad_dates_are_dropped(self):
        stops = [stop(3, dep=(0, FEED_TIME))]
        ents = [self.run_of('t0', stops, date='20261030'), self.run_of('t1', stops, date='20261201'), self.run_of('t2', stops, date='2026-11-01'),
                self.run_of('t3', stops, date='20261331'), self.run_of('t4', stops, date='20261031')]
        out, n = self.delays(ents)
        self.assertEqual(list(out['trips']), ['2026-10-31'])
        self.assertEqual(n['outside the timetable window'], 4)

    def test_two_service_days_of_one_trip_are_two_runs(self):
        next_day = (0, DAY_START + 86400 + 360 * 60)
        out, _ = self.delays([self.run_of('t0', [stop(0, dep=sched(360, 60))]), self.run_of('t0', [stop(0, dep=next_day)], date='20261102')])
        self.assertEqual({d: v['delay'] for d, v in out['trips'].items()}, {DAY: {'0': 1}, '2026-11-02': {'0': 0}})

    def test_a_delay_beyond_a_day_is_not_a_delay(self):
        out, n = self.delays([self.run_of('t0', [stop(3, dep=(90000, FEED_TIME))]), self.run_of('t1', [stop(3, dep=(-90000, FEED_TIME))])])
        self.assertEqual(out['trips'], {})
        self.assertEqual(n['implausible'], 2)

    def test_the_file_the_cut_makes_passes_the_validation_the_publish_applies(self):
        out, _ = self.delays([self.run_of('t0', [stop(0, dep=sched(360, 60))]), self.run_of('t1', [], rel=3)])
        realtime.validate(out, NOW)

    def test_the_output_is_sorted_and_the_same_for_the_same_stream(self):
        ents = [self.run_of('t4', [stop(0, dep=sched(500, 60))]), self.run_of('t0', [stop(0, dep=sched(360, 120))]), self.run_of('t1', [stop(0, dep=(0, 1), rel=1)], rel=3)]
        a, _ = self.delays(ents)
        b, _ = self.delays(list(reversed(ents)))
        self.assertEqual(realtime.dumps(a), realtime.dumps(b))
        self.assertEqual(list(a['trips'][DAY]['delay']), ['0', '4'])

    # ---- the first-stop check
    def test_first_stop_that_fits_the_build_is_kept_and_counted(self):
        out, n = self.delays([self.run_of('t0', [stop(0, dep=sched(360, 600)), stop(1, arr=sched(400, 600))])])
        self.assertEqual(out['trips'][DAY]['delay'], {'0': 10})
        self.assertEqual((n['checked'], n['mismatch']), (1, 0))

    def test_first_stop_that_does_not_fit_drops_that_run(self):
        out, n = self.delays([self.run_of('t0', [stop(0, dep=sched(361)), stop(1, arr=sched(400))]), self.run_of('t1', [stop(0, dep=sched(400, 60))])])
        self.assertEqual(list(out['trips'][DAY]['delay']), ['1'])
        self.assertEqual((n['checked'], n['mismatch']), (2, 1))

    def test_a_run_the_stream_joins_after_its_first_stop_cannot_be_checked_and_is_kept(self):
        out, n = self.delays([self.run_of('t0', [stop(5, dep=sched(999, 60))])])
        self.assertEqual((out['trips'][DAY]['delay'], n['checked']), ({'0': 1}, 0))

    def test_a_first_stop_without_a_departure_or_without_a_build_minute_is_not_checked(self):
        out, n = self.delays([self.run_of('t0', [stop(0, arr=sched(1))]), self.run_of('t3', [stop(0, dep=sched(5))])])
        self.assertEqual(n['checked'], 0)
        self.assertEqual(sorted(out['trips'][DAY]['delay']), ['0', '3'])

    def test_a_run_after_midnight_checks_against_its_minute_past_1440(self):
        out, n = self.delays([self.run_of('t2', [stop(0, dep=sched(1510, 120))])])
        self.assertEqual((out['trips'][DAY]['delay'], n['mismatch']), ({'2': 2}, 0))

    def test_many_failed_checks_mean_another_feed_version_and_nothing_is_published(self):
        ids = {'r%d' % i: (i, 360) for i in range(40)}
        wrong = [self.run_of('r%d' % i, [stop(0, dep=sched(361 + i))]) for i in range(40)]
        with self.assertRaisesRegex(realtime.NothingToPublish, 'another version'):
            self.delays(wrong, ids=ids)

    def test_a_few_failed_checks_among_many_good_ones_only_drop_those_runs(self):
        ids = {'r%d' % i: (i, 360) for i in range(100)}
        ents = [self.run_of('r%d' % i, [stop(0, dep=sched(360 if i >= 3 else 999))]) for i in range(100)]
        out, n = self.delays(ents, ids=ids)
        self.assertEqual((len(out['trips'][DAY]['delay']), n['mismatch']), (97, 3))

    def test_too_few_checks_cannot_stop_the_publish(self):
        ids = {'r%d' % i: (i, 360) for i in range(5)}
        out, n = self.delays([self.run_of('r%d' % i, [stop(0, dep=sched(999))]) for i in range(5)], ids=ids)
        self.assertEqual((out['trips'], n['mismatch']), ({}, 5))

    def test_the_service_day_starts_at_noon_minus_twelve_hours_also_on_a_clock_change_day(self):
        utc = lambda *a: int(dt.datetime(*a, tzinfo=UTC).timestamp())
        self.assertEqual(realtime.day_start('2026-11-01'), utc(2026, 10, 31, 23))        # CET
        self.assertEqual(realtime.day_start('2026-07-01'), utc(2026, 6, 30, 22))         # CEST
        self.assertEqual(realtime.day_start('2026-10-25'), utc(2026, 10, 24, 23))        # the day the clocks go back: 25 hours long
        self.assertEqual(realtime.day_start('2026-03-29'), utc(2026, 3, 28, 22))         # the day they go forward: 23 hours long

    # ---- stale and future streams
    def test_a_stream_older_than_fifteen_minutes_is_not_published(self):
        ents = [self.run_of('t0', [stop(0, dep=sched(360))])]
        self.delays(ents, at=NOW - 15 * 60)                               # exactly fifteen minutes: still fine
        with self.assertRaisesRegex(realtime.NothingToPublish, 'minutes old'):
            self.delays(ents, at=NOW - 15 * 60 - 1)

    def test_a_stream_dated_in_the_future_is_not_published(self):
        ents = [self.run_of('t0', [stop(0, dep=sched(360))])]
        self.delays(ents, at=NOW + 300)
        with self.assertRaisesRegex(realtime.NothingToPublish, 'future'):
            self.delays(ents, at=NOW + 301)


class TripIdsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.path = os.path.join(self.tmp, 'trip-ids.txt.gz')

    def made(self, ids):
        m = write_map(self.tmp, ids)
        return m

    def test_numbers_follow_the_lines_and_the_minute_may_be_empty(self):
        m = self.made([('a', 1), ('b', None), ('c', 1510)])
        self.assertEqual(realtime.load_trip_ids(self.path, m), {'a': (0, 1), 'b': (1, None), 'c': (2, 1510)})

    def test_a_changed_or_truncated_file_does_not_match_the_manifest(self):
        m = self.made([('a', 1), ('b', 2)])
        with open(self.path, 'rb') as f:
            raw = bytearray(f.read())
        raw[-6] ^= 1
        with open(self.path, 'wb') as f:
            f.write(raw)
        with self.assertRaisesRegex(ValueError, 'manifest'):
            realtime.load_trip_ids(self.path, m)
        with open(self.path, 'wb') as f:
            f.write(raw[:-3])
        with self.assertRaisesRegex(ValueError, 'manifest'):
            realtime.load_trip_ids(self.path, m)

    def test_a_manifest_without_the_file_is_nothing_to_publish(self):
        m = self.made([('a', 1)])
        del m['tripIdsSha256'], m['tripIdsBytes']
        with self.assertRaises(realtime.NothingToPublish):
            realtime.load_trip_ids(self.path, m)

    def test_duplicate_ids_and_malformed_lines_are_refused(self):
        for lines in (['a\t1', 'a\t2'], ['a'], ['a\tx'], ['a\t-1']):
            raw = gzip.compress(('\n'.join(lines) + '\n').encode(), 9, mtime=0)
            with open(self.path, 'wb') as f:
                f.write(raw)
            m = {'tripIdsSha256': hashlib.sha256(raw).hexdigest(), 'tripIdsBytes': len(raw)}
            with self.assertRaisesRegex(ValueError, 'malformed', msg=str(lines)):
                realtime.load_trip_ids(self.path, m)


def good_file(**over):
    d = {'format': 1, 'built': '2026-11-01T11:20:00Z', 'feedTime': '2026-11-01T11:19:30Z',
         'source': {'publisher': 'gtfs.de', 'license': 'CC BY-SA 4.0'}, 'timetable': {'date': '2026-11-01', 'sha256': 'ab' * 32},
         'trips': {DAY: {'delay': {'0': 2, '17': -1}, 'cancelled': [3], 'skipped': {'5': 1}}}}
    d.update(over)
    return d


class ValidateTest(unittest.TestCase):
    def test_a_good_file_passes_with_and_without_a_clock(self):
        realtime.validate(good_file())
        realtime.validate(good_file(), NOW)

    def test_malformed_files_are_refused(self):
        bad = {
            'format': good_file(format=2), 'not an object': [], 'no built': good_file(built=5), 'built not UTC': good_file(built='2026-11-01 11:20'),
            'feedTime not a time': good_file(feedTime='2026-13-01T11:19:30Z'), 'no source': good_file(source={}),
            'empty license': good_file(source={'publisher': 'x', 'license': ''}), 'no timetable': good_file(timetable={'date': '2026-11-01'}),
            'bad sha': good_file(timetable={'date': '2026-11-01', 'sha256': 'XYZ'}), 'trips a list': good_file(trips=[]),
            'day not a date': good_file(trips={'2026-02-30': {'delay': {}, 'cancelled': [], 'skipped': {}}}),
            'day missing a part': good_file(trips={DAY: {'delay': {}, 'cancelled': []}}),
            'delay key not a number': good_file(trips={DAY: {'delay': {'x': 1}, 'cancelled': [], 'skipped': {}}}),
            'delay not an int': good_file(trips={DAY: {'delay': {'1': 1.5}, 'cancelled': [], 'skipped': {}}}),
            'delay a bool': good_file(trips={DAY: {'delay': {'1': True}, 'cancelled': [], 'skipped': {}}}),
            'delay out of range': good_file(trips={DAY: {'delay': {'1': 5000}, 'cancelled': [], 'skipped': {}}}),
            'cancelled not a number': good_file(trips={DAY: {'delay': {}, 'cancelled': ['3'], 'skipped': {}}}),
            'cancelled negative': good_file(trips={DAY: {'delay': {}, 'cancelled': [-1], 'skipped': {}}}),
            'skipped zero': good_file(trips={DAY: {'delay': {}, 'cancelled': [], 'skipped': {'1': 0}}}),
        }
        for name, d in bad.items():
            with self.assertRaises(ValueError, msg=name):
                realtime.validate(d)

    def test_a_clock_makes_old_and_future_files_fail(self):
        realtime.validate(good_file(), NOW - 30 + 15 * 60)
        with self.assertRaisesRegex(ValueError, 'minutes old'):
            realtime.validate(good_file(), NOW - 30 + 15 * 60 + 1)
        with self.assertRaisesRegex(ValueError, 'future'):
            realtime.validate(good_file(), NOW - 30 - 5 * 60 - 1)


class CommandTest(unittest.TestCase):
    """The command line, as the job runs it, on a build made by build_timetable.py from the tiny feed of test_build_timetable."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        feed_dir = os.path.join(self.tmp, 'feed')
        os.makedirs(feed_dir)
        for name, text in FEED.items():
            with open(os.path.join(feed_dir, name), 'w', encoding='utf-8') as f:
                f.write(text)
        self.build = os.path.join(self.tmp, 'build')
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            build_timetable.main(feed_dir, self.build)
        with open(os.path.join(self.build, 'meta.json'), encoding='utf-8') as f:
            meta = json.load(f)
        meta['feed']['sha256'] = 'ef' * 32
        with open(os.path.join(self.build, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f)
        self.dist = os.path.join(self.tmp, 'dist')
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'manifest.py'), 'make', self.build, self.dist, '--date', '2026-11-01'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.mapdir = os.path.join(self.tmp, 'map')
        os.makedirs(self.mapdir)
        shutil.copy(os.path.join(self.dist, 'data', 'latest.json'), self.mapdir)
        shutil.copy(os.path.join(self.dist, 'data', '2026-11-01', 'trip-ids.txt.gz'), self.mapdir)
        self.out = os.path.join(self.tmp, 'out', 'data', 'delays.json')

    def stream(self, data):
        p = os.path.join(self.tmp, 'stream.pb')
        with open(p, 'wb') as f:
            f.write(data)
        return p

    def make(self, data, now=NOW, build=None):
        return subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'realtime.py'), 'make', self.stream(data), build or self.mapdir, self.out, '--now', str(now)],
                              capture_output=True, text=True)

    def test_a_stream_becomes_a_file_with_the_trip_numbers_of_the_binary(self):
        # the tiny feed has two trips: B7 (number 0) Alpha-Beta-Gamma from 06:00, A3 (number 1) Beta-Gamma from 25:10
        data = feed([
            entity(1, trip('A3', stops=[stop(0, dep=sched(1510, 240)), stop(1, arr=sched(1540, 300))])),
            entity(2, trip('B7', stops=[stop(0, dep=sched(360)), stop(1, rel=1), stop(2, rel=1)], rel=3)),
            entity(3, trip('bus-17', stops=[stop(0, dep=sched(5, 900))])),
            entity(4, alert=True),
        ])
        r = self.make(data)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with open(self.out, encoding='utf-8') as f:
            d = json.load(f)
        self.assertEqual(d['trips'], {DAY: {'delay': {'1': 4}, 'cancelled': [0], 'skipped': {}}})
        realtime.validate(d, NOW)
        # number 1 is A3 in the binary, from Beta to Gamma: the delay is on that trip
        cht = read_cht1(os.path.join(self.build, 'timetable.bin.gz'))
        with open(os.path.join(self.build, 'meta.json'), encoding='utf-8') as f:
            names = json.load(f)['stations']
        on_trip_1 = [(names[cht['from'][i]], names[cht['to'][i]]) for i in range(cht['conns']) if cht['trip'][i] == 1]
        self.assertEqual(on_trip_1, [('Beta', 'Gamma')])
        self.assertEqual(d['timetable']['sha256'], manifest.sha256_file(os.path.join(self.build, 'timetable.bin.gz')))
        self.assertIn('3 trip updates, 2 on trips of build 2026-11-01 (2 trips), 1 alerts', r.stdout)

    def test_a_stale_stream_writes_nothing_and_says_why_with_status_3(self):
        r = self.make(feed([entity(1, trip('A3', stops=[stop(0, dep=sched(1510))]))]), now=NOW + 3600)
        self.assertEqual((r.returncode, os.path.exists(self.out)), (3, False))
        self.assertIn('nothing to publish', r.stdout)

    def test_an_unreadable_stream_is_nothing_to_publish_not_an_error(self):
        r = self.make(b'<html>503 Service Unavailable</html>')
        self.assertEqual((r.returncode, os.path.exists(self.out)), (3, False))
        self.assertIn('not a readable', r.stdout)

    def test_a_stream_of_another_feed_version_writes_nothing(self):
        # forty trips whose first stop the stream puts at another minute than the build's: the ids have moved on
        big = os.path.join(self.tmp, 'bigmap')
        write_map(big, [('r%d' % i, 360) for i in range(40)])
        r = self.make(feed([entity(i, trip('r%d' % i, stops=[stop(0, dep=sched(361 + i))])) for i in range(40)]), build=big)
        self.assertEqual((r.returncode, os.path.exists(self.out)), (3, False))
        self.assertIn('another version of the static feed', r.stdout)

    def test_a_build_without_the_trip_id_file_is_nothing_to_publish(self):
        m = json.load(open(os.path.join(self.mapdir, 'latest.json')))
        del m['tripIdsSha256'], m['tripIdsBytes']
        with open(os.path.join(self.mapdir, 'latest.json'), 'w') as f:
            json.dump(m, f)
        r = self.make(feed([]))
        self.assertEqual((r.returncode, os.path.exists(self.out)), (3, False))
        self.assertIn('no trip id file', r.stdout)

    def test_a_trip_id_file_that_does_not_match_the_manifest_is_an_error(self):
        with open(os.path.join(self.mapdir, 'trip-ids.txt.gz'), 'ab') as f:
            f.write(b'x')
        r = self.make(feed([]))
        self.assertEqual((r.returncode, os.path.exists(self.out)), (1, False))
        self.assertIn('error:', r.stderr)

    def test_a_missing_or_malformed_manifest_is_an_error(self):
        os.remove(os.path.join(self.mapdir, 'latest.json'))
        self.assertEqual(self.make(feed([])).returncode, 1)
        with open(os.path.join(self.mapdir, 'latest.json'), 'w') as f:
            f.write('{"format": 1}')
        self.assertEqual(self.make(feed([])).returncode, 1)

    def test_check_accepts_the_file_make_wrote_and_refuses_a_stale_or_broken_one(self):
        self.assertEqual(self.make(feed([entity(1, trip('A3', stops=[stop(0, dep=sched(1510, 60))]))])).returncode, 0)
        script = os.path.join(ROOT, 'build', 'realtime.py')
        run = lambda *a: subprocess.run([sys.executable, '-I', script, 'check', self.out, *a], capture_output=True, text=True)
        self.assertEqual(run('--now', str(NOW)).returncode, 0)
        r = run('--now', str(NOW + 3600))
        self.assertEqual(r.returncode, 1)
        self.assertIn('minutes old', r.stderr)
        with open(self.out, 'w') as f:
            f.write('{"format": 1')
        self.assertEqual(run('--now', str(NOW)).returncode, 1)

    def test_check_refuses_a_file_above_the_size_limit(self):
        os.makedirs(os.path.dirname(self.out))
        with open(self.out, 'w') as f:
            f.write(' ' * (realtime.MAX_FILE_BYTES + 1))
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'realtime.py'), 'check', self.out, '--now', str(NOW)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn('larger', r.stderr)

    def test_usage_errors(self):
        for args in ([], ['nope'], ['make'], ['check']):
            r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'build', 'realtime.py'), *args], capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, args)


if __name__ == '__main__':
    unittest.main()
