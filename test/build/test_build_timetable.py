"""Tests of build/build_timetable.py on a tiny GTFS feed: the trip id file lines up with the trip numbers of the binary."""
import contextlib
import gzip
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'build'))
import build_timetable  # noqa: E402

FEED = {
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,parent_station\nS1,"Alpha, Hauptbahnhof",52.0,10.0,\nS2,Beta,51.5,10.5,\nS3,Gamma,51.0,11.0,\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
                    'daily,1,1,1,1,1,1,1,20261101,20261107\nnever,0,0,0,0,0,0,0,20261101,20261107\n',
    'calendar_dates.txt': 'service_id,date,exception_type\ndaily,20261103,2\n',
    'routes.txt': 'route_id,route_short_name,route_long_name\nR1,RE 1,\nR2,RB2,\n',
    # B7 and A3 run; Z9 has one stop only; N0 runs on no day
    'trips.txt': 'route_id,service_id,trip_id\nR1,daily,B7\nR1,daily,Z9\nR2,daily,A3\nR2,never,N0\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
                      'B7,05:58:00,06:00:30,S1,0\nB7,07:00:00,07:02:00,S2,1\nB7,08:00:00,08:00:00,S3,2\n'
                      'Z9,09:00:00,09:00:00,S1,0\n'
                      'A3,25:10:00,25:10:00,S2,0\nA3,25:40:00,25:40:00,S3,1\n'
                      'N0,10:00:00,10:00:00,S1,0\nN0,11:00:00,11:00:00,S2,1\n',
}


def read_cht1(path):
    """The sections of a CHT1 file that tie connections to trips: (header, per connection from/to/trip, per trip line/term)."""
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    assert raw[:4] == b'CHT1'
    n_st, n_conn, n_trip, n_foot, first, n_days = struct.unpack('<6I', raw[4:28])
    off = 32

    def take(fmt, n):
        nonlocal off
        size = struct.calcsize('<' + fmt) * n
        vals = struct.unpack('<%d%s' % (n, fmt), raw[off:off + size])
        off = (off + size + 3) & ~3
        return vals

    c_from, c_to, c_dep, c_arr, c_trip, c_flags = take('H', n_conn), take('H', n_conn), take('H', n_conn), take('H', n_conn), take('I', n_conn), take('B', n_conn)
    t_svc, t_line, t_term = take('I', n_trip), take('H', n_trip), take('H', n_trip)
    return {'trips': n_trip, 'conns': n_conn, 'from': c_from, 'to': c_to, 'dep': c_dep, 'trip': c_trip, 'line': t_line, 'term': t_term}


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.feed = os.path.join(self.tmp, 'feed')
        os.makedirs(self.feed)
        for name, text in FEED.items():
            with open(os.path.join(self.feed, name), 'w', encoding='utf-8') as f:
                f.write(text)

    def build(self, name='out'):
        out = os.path.join(self.tmp, name)
        with contextlib.redirect_stdout(io.StringIO()):
            build_timetable.main(self.feed, out)
        return out

    def ids(self, out):
        with gzip.open(os.path.join(out, 'trip-ids.txt.gz'), 'rt', encoding='utf-8') as f:
            return f.read().splitlines()

    def test_one_line_per_trip_number_with_the_feed_id_and_the_first_departure(self):
        out = self.build()
        # trips that do not run, or have one stop, get no number; numbers follow the order of stop_times.txt
        self.assertEqual(self.ids(out), ['B7\t360', 'A3\t1510'])
        self.assertEqual(read_cht1(os.path.join(out, 'timetable.bin.gz'))['trips'], 2)

    def test_the_line_of_a_trip_number_is_the_trip_the_binary_calls_by_that_number(self):
        out = self.build()
        cht = read_cht1(os.path.join(out, 'timetable.bin.gz'))
        with open(os.path.join(out, 'meta.json'), encoding='utf-8') as f:
            meta = json.load(f)
        ids = [line.split('\t')[0] for line in self.ids(out)]
        by_id = {}
        for i in range(cht['conns']):
            by_id.setdefault(ids[cht['trip'][i]], []).append((meta['stations'][cht['from'][i]], meta['stations'][cht['to'][i]]))
        self.assertEqual(by_id['B7'], [('Alpha Hbf', 'Beta'), ('Beta', 'Gamma')])
        self.assertEqual(by_id['A3'], [('Beta', 'Gamma')])
        self.assertEqual([meta['lines'][cht['line'][n]] for n in range(2)], ['RE1', 'RB2'])
        self.assertEqual([meta['stations'][cht['term'][n]] for n in range(2)], ['Gamma', 'Gamma'])

    def test_the_same_feed_gives_the_same_bytes(self):
        a, b = self.build('a'), self.build('b')
        for name in ('timetable.bin.gz', 'trip-ids.txt.gz'):
            with open(os.path.join(a, name), 'rb') as f, open(os.path.join(b, name), 'rb') as g:
                self.assertEqual(f.read(), g.read(), name)

    def test_the_binary_stays_as_it_was_and_carries_no_trip_ids(self):
        # the app reads timetable.bin.gz and meta.json only; the id file is a sidecar, not a section of CHT1
        out = self.build()
        self.assertEqual(sorted(os.listdir(out)), ['meta.json', 'timetable.bin.gz', 'trip-ids.txt.gz'])
        with gzip.open(os.path.join(out, 'timetable.bin.gz'), 'rb') as f:
            raw = f.read()
        self.assertEqual(raw[:4], b'CHT1')
        self.assertNotIn(b'B7', raw)

    def test_a_trip_id_that_would_break_the_lines_is_refused(self):
        with self.assertRaises(SystemExit):
            build_timetable.trip_ids_file(['a\tb'], [0])
        with self.assertRaises(SystemExit):
            build_timetable.trip_ids_file(['a\nb'], [0])

    def test_the_file_does_not_depend_on_the_clock(self):
        from unittest import mock
        with mock.patch('time.time', return_value=1000.0):
            a = build_timetable.trip_ids_file(['x', 'y'], [1, 2])
        with mock.patch('time.time', return_value=2000.0):
            b = build_timetable.trip_ids_file(['x', 'y'], [1, 2])
        self.assertEqual(a, b)

    def test_a_first_stop_without_a_time_leaves_the_minute_empty(self):
        raw = gzip.decompress(build_timetable.trip_ids_file(['x', 'y'], [None, 5])).decode()
        self.assertEqual(raw, 'x\t\ny\t5\n')


if __name__ == '__main__':
    unittest.main()
