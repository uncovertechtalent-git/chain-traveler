"""Tests of how build/build_timetable.py names a station.

The regional feed names a parent station in the local style ("Hauptbahnhof", "Feuersee") and its platforms with the
city ("Stuttgart Hbf", "Stuttgart Feuersee"). The shown name must carry the city, or the station cannot be found by it.
The rules are tested as a function (station_name), and the build as a whole on a small feed: the names change and
nothing else does.
"""
import contextlib
import csv
import gzip
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'build'))
import build_timetable as bt  # noqa: E402

name = bt.station_name


class ExtendsTest(unittest.TestCase):
    def test_something_in_front_of_the_name_set_off_by_a_space_a_hyphen_or_the_like(self):
        self.assertTrue(bt.extends('Stuttgart Hbf', 'Hbf'))
        self.assertTrue(bt.extends('Esslingen-Zell', 'Zell'))
        self.assertTrue(bt.extends('Heilbr.-Böckingen Berufsschulzentrum', 'Böckingen Berufsschulzentrum'))
        self.assertTrue(bt.extends('STUTTGART HBF', 'Hbf'), 'case does not matter')

    def test_not_the_same_name_not_a_longer_word_and_not_the_other_way_round(self):
        self.assertFalse(bt.extends('Hbf', 'Hbf'))
        self.assertFalse(bt.extends('Wiesenzell', 'Zell'), 'the word is longer, there is nothing set off in front of it')
        self.assertFalse(bt.extends('Hbf', 'Stuttgart Hbf'))
        self.assertFalse(bt.extends('Stuttgart Hbf', 'Stuttgart'), 'it must be the end of the name')
        self.assertFalse(bt.extends('Stuttgart Hbf', ''))


class IsBareTest(unittest.TestCase):
    def test_only_generic_words_are_bare(self):
        for n in ('Hbf', 'Hbf (tief)', 'Hbf (U Tram)', 'Stadtmitte', 'Nordbahnhof', 'Ostbahnhof', 'Bahnhof', 'Süd', 'Hbf Süd'):
            self.assertTrue(bt.is_bare(n), n)

    def test_a_place_in_the_name_is_not_bare(self):
        for n in ('Stuttgart Hbf', 'Feuersee', 'Stuttgart-Bad Cannstatt', 'Wolfsburg', 'Hbf Wolfsburg', '', '(tief)'):
            self.assertFalse(bt.is_bare(n), n)


class StationNameTest(unittest.TestCase):
    def test_the_stuttgart_case(self):
        # the parent has the local name; one platform is named like it, one is a bus company's, one has the city
        self.assertEqual(name('Hauptbahnhof', ['Hauptbahnhof', 'Stuttgart Central Station (FlixTrain)', 'Stuttgart Hbf']), 'Stuttgart Hbf')
        self.assertEqual(name('Hauptbahnhof (tief)', ['Stuttgart Hbf (tief)']), 'Stuttgart Hbf (tief)')
        self.assertEqual(name('Stadtmitte', ['Stuttgart Stadtmitte']), 'Stuttgart Stadtmitte')
        self.assertEqual(name('Nordbahnhof', ['Stuttgart Nordbahnhof']), 'Stuttgart Nordbahnhof')

    def test_the_mirror_case_a_parent_with_the_fuller_name_keeps_it(self):
        self.assertEqual(name('Stuttgart Hbf', ['Hbf']), 'Stuttgart Hbf')
        self.assertEqual(name('Stuttgart Hauptbahnhof', ['Hauptbahnhof']), 'Stuttgart Hbf')
        self.assertEqual(name('S+U Berlin Hbf', ['Berlin Hbf', 'S+U Berlin Hbf', 'Berlin Central Station (FlixTrain)']), 'S+U Berlin Hbf')

    def test_a_parent_named_only_by_a_kind_of_station_never_wins_over_a_platform_that_carries_a_place(self):
        self.assertEqual(name('Ostbahnhof', ['München Ost']), 'München Ost', 'no platform name extends it: the one with a place')
        self.assertEqual(name('Hauptbahnhof (U, Tram)', ['München Hbf (tief)']), 'München Hbf (tief)')
        self.assertEqual(name('Hbf', ['Bahnhof', 'Hbf (tief)']), 'Hbf', 'platforms of generic words only: nothing carries more')
        self.assertEqual(name('Hbf', []), 'Hbf', 'no platforms at all')
        self.assertEqual(name('Hbf', ['Hbf']), 'Hbf')

    def test_a_platform_name_that_extends_the_parent_beats_one_that_only_has_a_place(self):
        self.assertEqual(name('Hbf', ['Stuttgart Central Station (FlixTrain)', 'Stuttgart Hbf']), 'Stuttgart Hbf')

    def test_the_comma_style_and_the_long_word_are_cleaned_first(self):
        self.assertEqual(name('Hauptbahnhof', ['Stuttgart, Hauptbahnhof']), 'Stuttgart Hbf')
        self.assertEqual(name('Hauptbahnhof', ['Stuttgart Hauptbahnhof']), 'Stuttgart Hbf')

    def test_the_commonest_extending_name_wins_then_the_shortest_then_the_first_alphabetically(self):
        self.assertEqual(name('Hbf', ['A Hbf', 'B Hbf', 'B Hbf']), 'B Hbf')
        self.assertEqual(name('Hbf', ['Xyzzy Hbf', 'Ab Hbf']), 'Ab Hbf')
        self.assertEqual(name('Hbf', ['Zz Hbf', 'Aa Hbf']), 'Aa Hbf')
        self.assertEqual(name('Hbf', ['Zz Hbf', 'Aaaaaa Hbf']), 'Zz Hbf', 'shorter before alphabetical')
        a, b = ['Xx Hbf', 'Yy Hbf', 'Yy Hbf'], ['Yy Hbf', 'Xx Hbf', 'Yy Hbf']
        self.assertEqual(name('Hbf', a), name('Hbf', b), 'the order of the platforms does not matter')

    def test_any_other_parent_takes_the_platforms_name_when_every_platform_has_it_and_it_extends(self):
        self.assertEqual(name('Feuersee', ['Stuttgart Feuersee']), 'Stuttgart Feuersee')
        self.assertEqual(name('Zell', ['Esslingen-Zell', 'Esslingen-Zell']), 'Esslingen-Zell')
        self.assertEqual(name('Bad Cannstatt', ['Stuttgart-Bad Cannstatt']), 'Stuttgart-Bad Cannstatt')

    def test_a_parent_with_a_platform_named_like_itself_or_platforms_that_disagree_keeps_its_name(self):
        self.assertEqual(name('Wörlitz', ['Bahnhof Wörlitz', 'Wörlitz']), 'Wörlitz')
        self.assertEqual(name('Oberndorf', ['Oberndorf', 'Rudersberg-Oberndorf']), 'Oberndorf')
        self.assertEqual(name('Garmisch-Partenkirchen', ['Garmisch-Partenkirchen', 'Zugspitzbahnhof Garmisch-Partenkirchen']), 'Garmisch-Partenkirchen')
        self.assertEqual(name('Zell', ['Esslingen-Zell', 'Wiesenzell']), 'Zell')
        self.assertEqual(name('Zell', ['Esslingen-Zell', 'Kirchheim-Zell']), 'Zell', 'two different extensions: which city?')

    def test_platform_names_that_do_not_extend_the_parent_change_nothing(self):
        self.assertEqual(name('Achern Bahnhof', ['Achern']), 'Achern Bahnhof')
        self.assertEqual(name('Adorf Bahnhof', ['Adorf(Vogtl)']), 'Adorf Bahnhof')
        self.assertEqual(name('Ahnatal-Weimar Bahnhof', ['Ahnatal-Weimar Gl.1 Ri.Wolfhagen']), 'Ahnatal-Weimar Bahnhof')
        self.assertEqual(name('Zell', ['Wiesenzell']), 'Zell', 'a longer word is not an extension')
        self.assertEqual(name('Wolfsburg Hbf', ['Wolfsburg Hbf']), 'Wolfsburg Hbf')

    def test_without_a_parent_name_the_first_platform_is_used_as_before(self):
        self.assertEqual(name(None, ['Wolfsburg, Hauptbahnhof', 'x']), 'Wolfsburg Hbf')
        self.assertEqual(name('', ['Kassel Hauptbahnhof']), 'Kassel Hbf')
        self.assertIsNone(name(None, []))
        self.assertIsNone(name('', []))


# ---- the build as a whole, on a feed of a few rows
def write_csv(path, header, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def write_feed(feed):
    os.makedirs(feed)
    stops = [
        # stop_id, name, parent, lat, lon, location_type
        ('p1', 'Hauptbahnhof', '', '48.7847', '9.1832', '1'),
        ('p1a', 'Hauptbahnhof', 'p1', '48.7847', '9.1832', ''),
        ('p1b', 'Stuttgart Hbf', 'p1', '48.7848', '9.1830', ''),
        ('p2', 'Wolfsburg Hbf', '', '52.4290', '10.7880', '1'),
        ('p2a', 'Hbf', 'p2', '52.4290', '10.7880', ''),
        ('p3', 'Feuersee', '', '48.7712', '9.1700', '1'),
        ('p3a', 'Stuttgart Feuersee', 'p3', '48.7712', '9.1700', ''),
        ('p4', 'Achern Bahnhof', '', '48.6300', '8.0700', '1'),
        ('p4a', 'Achern', 'p4', '48.6300', '8.0700', ''),
    ]
    write_csv(os.path.join(feed, 'stops.txt'), ['stop_id', 'stop_name', 'parent_station', 'stop_lat', 'stop_lon', 'location_type'], stops)
    write_csv(os.path.join(feed, 'routes.txt'), ['route_id', 'route_short_name', 'route_long_name'], [('r1', 'RE1', ''), ('r2', 'S1', '')])
    write_csv(os.path.join(feed, 'trips.txt'), ['trip_id', 'route_id', 'service_id'], [('t1', 'r1', 's'), ('t2', 'r2', 's')])
    write_csv(os.path.join(feed, 'calendar.txt'), ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
              [('s', 1, 1, 1, 1, 1, 1, 1, '20261101', '20261130')])
    write_csv(os.path.join(feed, 'calendar_dates.txt'), ['service_id', 'date', 'exception_type'], [('s', '20261105', 2)])
    write_csv(os.path.join(feed, 'stop_times.txt'), ['trip_id', 'stop_sequence', 'arrival_time', 'departure_time', 'stop_id'], [
        ('t1', 1, '08:00:00', '08:00:00', 'p1b'), ('t1', 2, '08:10:00', '08:11:00', 'p3a'), ('t1', 3, '08:40:00', '08:40:00', 'p4a'),
        ('t2', 1, '09:00:00', '09:00:00', 'p2a'), ('t2', 2, '09:30:00', '09:30:00', 'p1a'),
    ])


def build(feed, out):
    with contextlib.redirect_stdout(io.StringIO()):
        bt.main(feed, out)
    with open(os.path.join(out, 'meta.json'), encoding='utf-8') as f:
        meta = json.load(f)
    with open(os.path.join(out, 'timetable.bin.gz'), 'rb') as f:
        return meta, gzip.decompress(f.read())


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.feed = os.path.join(self.tmp, 'feed')
        write_feed(self.feed)

    def built(self, tag):
        out = os.path.join(self.tmp, tag)
        os.makedirs(out)
        return build(self.feed, out)

    def test_the_stations_are_named_by_the_rules(self):
        meta, _ = self.built('new')
        self.assertEqual(sorted(meta['stations']), sorted(['Stuttgart Hbf', 'Wolfsburg Hbf', 'Stuttgart Feuersee', 'Achern Bahnhof']))
        self.assertNotIn('Hbf', meta['stations'])
        self.assertNotIn('Hauptbahnhof', meta['stations'])

    def test_only_the_names_change_not_the_timetable_the_positions_or_the_footpaths(self):
        new_meta, new_bin = self.built('new')
        saved = bt.station_name
        # what the build did before: the parent's name, cleaned (the first platform's when there is none)
        bt.station_name = lambda parent, kids: bt.clean_name(parent) if parent else (bt.clean_name(kids[0]) if kids else None)
        self.addCleanup(setattr, bt, 'station_name', saved)
        old_meta, old_bin = self.built('old')
        self.assertEqual(sorted(old_meta['stations']), sorted(['Hbf', 'Wolfsburg Hbf', 'Feuersee', 'Achern Bahnhof']), 'the old rule really is what the stub does')
        self.assertEqual(new_bin, old_bin, 'connections, trips, footpaths and the order of the stations are the same bytes')
        for m in (new_meta, old_meta):
            m['feed'].pop('built')
        self.assertEqual({k: v for k, v in new_meta.items() if k != 'stations'}, {k: v for k, v in old_meta.items() if k != 'stations'})
        changed = [(a, b) for a, b in zip(old_meta['stations'], new_meta['stations']) if a != b]
        self.assertEqual(changed, [('Hbf', 'Stuttgart Hbf'), ('Feuersee', 'Stuttgart Feuersee')])

    def test_a_parent_without_a_record_is_named_by_its_first_platform(self):
        # a platform whose parent_station is not in stops.txt: the key has no row of its own
        stops = os.path.join(self.feed, 'stops.txt')
        with open(stops, newline='', encoding='utf-8') as f:
            rows = list(csv.reader(f))
        rows.append(['q1', 'Ghost, Hauptbahnhof', 'missing', '50.0', '8.0', ''])
        write_csv(stops, rows[0], rows[1:])
        write_csv(os.path.join(self.feed, 'stop_times.txt'), ['trip_id', 'stop_sequence', 'arrival_time', 'departure_time', 'stop_id'], [
            ('t1', 1, '08:00:00', '08:00:00', 'p1b'), ('t1', 2, '08:10:00', '08:11:00', 'q1'),
        ])
        meta, _ = self.built('new')
        self.assertIn('Ghost Hbf', meta['stations'])


if __name__ == '__main__':
    unittest.main()
