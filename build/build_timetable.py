#!/usr/bin/env python3
"""Build the compact timetable files for Chain Traveler from a GTFS directory.

Input : an unpacked gtfs.de "Schienenregionalverkehr Deutschland" feed (DELFI NeTEx converted to GTFS).
Output: <out>/meta.json          station names and positions, line labels, feed provenance
        <out>/timetable.bin.gz   connection arrays, trip arrays, and footpaths, little-endian

Every consecutive stop pair of every trip becomes one connection (from, to, dep, arr, trip, flags).
Times are whole minutes after midnight of the service day and may exceed 1440. A trip carries a
bitmask of the days (from firstDate) it runs on. Platforms are merged into their parent station.
Stations within 300 m of each other get a footpath so a change between them is possible.

Run it with:  python3 -I build/build_timetable.py <feed-dir> <out-dir>
"""
import array
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import os
import re
import struct
import sys

MAGIC = b'CHT1'
FOOT_RADIUS_M = 300
WALK_M_PER_MIN = 75      # 4.5 km/h
DETOUR = 1.3


def read(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        yield from csv.DictReader(f)


def minutes(s):
    h, m, _ = s.split(':')
    return int(h) * 60 + int(m)


def align4(n):
    return (n + 3) & ~3


def clean_name(name):
    """DELFI names differ by region: 'Wolfsburg, Hauptbahnhof', 'Kassel Hauptbahnhof'. Show 'Wolfsburg Hbf'."""
    n = name.replace('Hauptbahnhof', 'Hbf')
    m = re.match(r'^([^,]+), (.+)$', n)
    return (m.group(1) + ' ' + m.group(2)) if m else n


def main(feed, out):
    os.makedirs(out, exist_ok=True)

    # stops and stations (platforms merged into their parent station)
    stops = {}
    for r in read(os.path.join(feed, 'stops.txt')):
        stops[r['stop_id']] = r
    st_key_of = {}
    for sid, r in stops.items():
        st_key_of[sid] = r['parent_station'] or sid

    # service calendar -> bitmask over the days of the feed window
    cal = list(read(os.path.join(feed, 'calendar.txt')))
    cdt = list(read(os.path.join(feed, 'calendar_dates.txt')))
    first = min([c['start_date'] for c in cal] + [c['date'] for c in cdt])
    last = max([c['end_date'] for c in cal] + [c['date'] for c in cdt])
    d0 = dt.datetime.strptime(first, '%Y%m%d').date()
    n_days = min(32, (dt.datetime.strptime(last, '%Y%m%d').date() - d0).days + 1)
    mask = {}
    wk = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    for c in cal:
        m = 0
        a = dt.datetime.strptime(c['start_date'], '%Y%m%d').date()
        b = dt.datetime.strptime(c['end_date'], '%Y%m%d').date()
        for i in range(n_days):
            d = d0 + dt.timedelta(days=i)
            if a <= d <= b and c[wk[d.weekday()]] == '1':
                m |= 1 << i
        mask[c['service_id']] = m
    for c in cdt:
        d = dt.datetime.strptime(c['date'], '%Y%m%d').date()
        i = (d - d0).days
        if 0 <= i < n_days:
            m = mask.get(c['service_id'], 0)
            m = (m | (1 << i)) if c['exception_type'] == '1' else (m & ~(1 << i))
            mask[c['service_id']] = m

    # routes and trips
    route_label = {}
    for r in read(os.path.join(feed, 'routes.txt')):
        route_label[r['route_id']] = (r['route_short_name'] or r['route_long_name'] or '?').replace(' ', '')
    trips = {}
    for r in read(os.path.join(feed, 'trips.txt')):
        m = mask.get(r['service_id'], 0)
        if m:
            trips[r['trip_id']] = (route_label.get(r['route_id'], '?'), m)

    # stop times grouped by trip
    by_trip = {}
    for r in read(os.path.join(feed, 'stop_times.txt')):
        t = r['trip_id']
        if t not in trips:
            continue
        by_trip.setdefault(t, []).append((
            int(r['stop_sequence']),
            minutes(r['arrival_time']) if r['arrival_time'] else None,
            minutes(r['departure_time']) if r['departure_time'] else None,
            st_key_of.get(r['stop_id']),
            r.get('pickup_type') or '0',
            r.get('drop_off_type') or '0',
        ))

    # station index only for stations that appear in a kept trip
    used = {}
    for rows in by_trip.values():
        for row in rows:
            if row[3] is not None and row[3] not in used:
                used[row[3]] = len(used)
    if len(used) > 65535:
        raise SystemExit('too many stations for uint16: %d' % len(used))

    children = {}
    for sid, r in stops.items():
        children.setdefault(st_key_of[sid], []).append(r)
    st_name, st_lat, st_lon = [''] * len(used), [0.0] * len(used), [0.0] * len(used)
    for key, i in used.items():
        rec = stops.get(key)
        kids = children.get(key, [])
        name = (rec['stop_name'] if rec else None) or (kids[0]['stop_name'] if kids else key)
        pts = [rec] if rec and rec['stop_lat'] else [k for k in kids if k['stop_lat']]
        st_name[i] = clean_name(name)
        st_lat[i] = sum(float(p['stop_lat']) for p in pts) / max(1, len(pts))
        st_lon[i] = sum(float(p['stop_lon']) for p in pts) / max(1, len(pts))

    # connections
    line_idx, lines = {}, []
    trip_idx = {}
    trip_svc, trip_line, trip_term = array.array('I'), array.array('H'), array.array('H')
    conns = []
    for tid, rows in by_trip.items():
        rows.sort(key=lambda x: x[0])
        label, m = trips[tid]
        if len(rows) < 2:
            continue
        if label not in line_idx:
            line_idx[label] = len(lines)
            lines.append(label)
        ti = len(trip_svc)
        trip_svc.append(m)
        trip_line.append(line_idx[label])
        trip_term.append(used[rows[-1][3]])
        for a, b in zip(rows, rows[1:]):
            if a[3] is None or b[3] is None or a[3] == b[3]:
                continue
            dep = a[2] if a[2] is not None else a[1]
            arr = b[1] if b[1] is not None else b[2]
            if dep is None or arr is None or arr < dep:
                continue
            flags = (1 if a[4] != '1' else 0) | (2 if b[5] != '1' else 0)
            conns.append((dep, arr, used[a[3]], used[b[3]], ti, flags))
    conns.sort()
    n_conn = len(conns)

    c_from = array.array('H', (c[2] for c in conns))
    c_to = array.array('H', (c[3] for c in conns))
    c_dep = array.array('H', (c[0] for c in conns))
    c_arr = array.array('H', (c[1] for c in conns))
    c_trip = array.array('I', (c[4] for c in conns))
    c_flags = array.array('B', (c[5] for c in conns))

    # footpaths between nearby stations
    cell = 0.004
    grid = {}
    for i in range(len(used)):
        grid.setdefault((int(st_lat[i] / cell), int(st_lon[i] / cell)), []).append(i)
    f_a, f_b, f_min = array.array('H'), array.array('H'), array.array('B')
    for i in range(len(used)):
        gy, gx = int(st_lat[i] / cell), int(st_lon[i] / cell)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), []):
                    if j == i:
                        continue
                    dlat = (st_lat[i] - st_lat[j]) * 111320
                    dlon = (st_lon[i] - st_lon[j]) * 111320 * math.cos(math.radians(st_lat[i]))
                    dist = math.hypot(dlat, dlon)
                    if dist <= FOOT_RADIUS_M:
                        f_a.append(i)
                        f_b.append(j)
                        f_min.append(max(2, min(20, math.ceil(dist * DETOUR / WALK_M_PER_MIN))))
    n_foot = len(f_a)

    # binary layout: header, then sections each aligned to 4 bytes
    sections = [c_from, c_to, c_dep, c_arr, c_trip, c_flags, trip_svc, trip_line, trip_term, f_a, f_b, f_min]
    header = MAGIC + struct.pack('<6I', len(used), n_conn, len(trip_svc), n_foot, int(first), n_days)
    header = header.ljust(32, b'\0')
    blob = bytearray(header)
    for arr_ in sections:
        if sys.byteorder != 'little':
            arr_.byteswap()
        blob += arr_.tobytes()
        blob += b'\0' * (align4(len(blob)) - len(blob))
    packed = gzip.compress(bytes(blob), 9)
    with open(os.path.join(out, 'timetable.bin.gz'), 'wb') as f:
        f.write(packed)

    zip_sha = None
    zpath = os.path.join(os.path.dirname(os.path.abspath(feed)), 'latest.zip')
    if os.path.exists(zpath):
        zip_sha = hashlib.sha256(open(zpath, 'rb').read()).hexdigest()
    meta = {
        'format': 1,
        'firstDate': '%s-%s-%s' % (first[:4], first[4:6], first[6:]),
        'nDays': n_days,
        'counts': {'stations': len(used), 'connections': n_conn, 'trips': len(trip_svc), 'footpaths': n_foot},
        'feed': {
            'source': 'https://download.gtfs.de/germany/rv_free/latest.zip',
            'publisher': 'gtfs.de, data provided by DELFI e.V.',
            'license': 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
            'sha256': zip_sha,
            'built': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        },
        'stations': st_name,
        'lat': [round(x, 4) for x in st_lat],
        'lon': [round(x, 4) for x in st_lon],
        'lines': lines,
    }
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    print('stations %d  connections %d  trips %d  footpaths %d  days %d from %s' % (len(used), n_conn, len(trip_svc), n_foot, n_days, first))
    print('timetable.bin.gz %.1f MB  meta.json %.2f MB' % (len(packed) / 1e6, os.path.getsize(os.path.join(out, 'meta.json')) / 1e6))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
