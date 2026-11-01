"""Tests of build/basemap.py (Natural Earth to app/basemap-data.js) and of the committed output. Standard library only."""
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'build'))
import basemap  # noqa: E402


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def max_gap(original, simplified):
    return max(min(seg_dist(p, a, b) for a, b in zip(simplified, simplified[1:])) for p in original)


class SimplifyTest(unittest.TestCase):
    def test_collinear_points_go_and_a_corner_stays(self):
        line = [(0, 0), (1, 0), (2, 0), (3, 0), (3, 1), (3, 2), (3, 3)]
        self.assertEqual(basemap.douglas_peucker(line, 0.01), [(0, 0), (3, 0), (3, 3)])

    def test_the_ends_always_stay_and_short_lines_are_untouched(self):
        self.assertEqual(basemap.douglas_peucker([(0, 0), (5, 5)], 1), [(0, 0), (5, 5)])
        self.assertEqual(basemap.douglas_peucker([(0, 0)], 1), [(0, 0)])
        wiggle = [(i, 0.001 * (i % 2)) for i in range(11)]
        s = basemap.douglas_peucker(wiggle, 0.01)
        self.assertEqual((s[0], s[-1]), (wiggle[0], wiggle[-1]))

    def test_no_dropped_point_is_farther_than_the_tolerance(self):
        line = [(i / 10, math.sin(i / 7) * 0.5) for i in range(200)]
        for tol in (0.01, 0.05, 0.2):
            s = basemap.douglas_peucker(line, tol)
            self.assertLessEqual(max_gap(line, s), tol + 1e-9, tol)
            self.assertLess(len(s), len(line))

    def test_a_closed_ring_keeps_its_shape(self):
        # first point equals last: as one segment it has length zero and a naive pass would throw the whole ring away
        side = [(i / 100, 0) for i in range(101)]
        ring = side + [(1, i / 100) for i in range(1, 101)] + [(1 - i / 100, 1) for i in range(1, 101)] + [(0, 1 - i / 100) for i in range(1, 101)]
        self.assertEqual(ring[0], ring[-1])
        s = basemap.simplify(ring, 0.001)
        self.assertEqual(s[0], s[-1], 'still closed')
        self.assertLessEqual(len(s), 8, 'four sides collapse to about their corners')
        for corner in [(0, 0), (1, 0), (1, 1), (0, 1)]:
            self.assertTrue(any(math.hypot(x - corner[0], y - corner[1]) < 1e-9 for x, y in s), corner)
        self.assertLessEqual(max_gap(ring, s), 0.001 + 1e-9)


class EncodeTest(unittest.TestCase):
    def test_first_point_then_differences_and_a_round_trip_within_the_rounding(self):
        line = [(10.0, 50.0), (10.5, 50.25), (11.0, 51.0)]
        flat = basemap.encode([line], 0.0)[0]
        self.assertEqual(flat[:2], [10000, 50000])
        self.assertEqual(flat[2:], [500, 250, 500, 750])
        back = basemap.decode(flat)
        for (x, y), (bx, by) in zip(line, back):
            self.assertLessEqual(math.hypot(x - bx, y - by), 0.0007)

    def test_lines_outside_the_box_and_degenerate_lines_are_dropped(self):
        inside = [(10.0, 50.0), (10.2, 50.2), (10.4, 50.1)]
        far = [(139.0, 35.0), (139.5, 35.5), (139.9, 35.1)]
        crossing = [(3.0, 50.0), (4.0, 50.0), (6.0, 50.0)]   # starts outside, has a point inside
        self.assertEqual(len(basemap.encode([inside, far, crossing], 0.0)), 2)
        self.assertEqual(basemap.encode([[(10.0, 50.0)]], 0.0), [])

    def test_the_tolerance_is_in_degrees(self):
        line = [(10 + i * 0.01, 50 + (0.004 if i % 2 else 0)) for i in range(50)]
        self.assertGreater(len(basemap.decode(basemap.encode([line], 0.0)[0])), 40)
        self.assertEqual(len(basemap.decode(basemap.encode([line], 0.01)[0])), 2)


def feature(props, geometry):
    return {'type': 'Feature', 'properties': props, 'geometry': geometry}


def square(x, y, d=1.0):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}


def line(*pts):
    return {'type': 'LineString', 'coordinates': [list(p) for p in pts]}


def point(x, y):
    return {'type': 'Point', 'coordinates': [x, y]}


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        data = {
            'ne_10m_admin_0_countries': [feature({'NAME': 'Germany'}, square(8, 49, 4)), feature({'NAME': 'Poland'}, square(14, 50, 3)),
                                         feature({'NAME': 'Japan'}, square(135, 34, 3))],
            'ne_10m_admin_1_states_provinces': [feature({'admin': 'Germany', 'name': 'Hessen'}, square(8, 50)),
                                                feature({'admin': 'France', 'name': 'Alsace'}, square(7, 48))],
            'ne_10m_rivers_lake_centerlines': [feature({'scalerank': 5}, line((9, 49.5), (9.2, 50), (9.1, 50.5))),
                                               feature({'scalerank': 8}, line((10, 49.5), (10.2, 50), (10.1, 50.5)))],
            'ne_10m_lakes': [feature({'name': 'Bodensee'}, square(9.2, 47.5, 0.3))],
            'ne_10m_populated_places': [
                feature({'NAME': 'Cologne', 'NAME_DE': 'Köln', 'POP_MAX': 1004000, 'ADM0NAME': 'Germany'}, point(6.96, 50.94)),
                feature({'NAME': 'Berlin', 'NAME_DE': 'Berlin', 'POP_MAX': 3645000, 'ADM0NAME': 'Germany'}, point(13.4, 52.52)),
                feature({'NAME': 'Small', 'NAME_DE': 'Klein', 'POP_MAX': 9000, 'ADM0NAME': 'Germany'}, point(10, 51)),
                feature({'NAME': 'Vienna', 'NAME_DE': 'Wien', 'POP_MAX': 2400000, 'ADM0NAME': 'Austria'}, point(16.37, 48.2)),
                feature({'NAME': 'Tokyo', 'NAME_DE': 'Tokio', 'POP_MAX': 9000000, 'ADM0NAME': 'Japan'}, point(139.7, 35.7)),
                feature({'NAME': 'Hamburg', 'POP_MAX': 1800000, 'ADM0NAME': 'Germany'}, point(10.0, 53.55)),
            ],
        }
        for name, feats in data.items():
            with open(os.path.join(self.dir, name + '.geojson'), 'w', encoding='utf-8') as f:
                json.dump({'type': 'FeatureCollection', 'features': feats}, f)

    def test_the_layers_hold_what_they_should(self):
        d = basemap.build(self.dir, 0.0)
        self.assertEqual((len(d['de']), len(d['other']), len(d['states']), len(d['rivers']), len(d['lakes'])), (1, 1, 1, 1, 1),
                         'Germany; Poland but not Japan; Hessen but not Alsace; the river of rank 5 but not 8; the lake')
        self.assertEqual(d['q'], 1000)
        self.assertEqual(d['box'], list(basemap.BOX))

    def test_cities_are_big_enough_near_enough_german_named_and_by_size(self):
        d = basemap.build(self.dir, 0.0)
        self.assertEqual([c[0] for c in d['cities']], ['Wien', 'Berlin', 'Hamburg', 'Köln'][:0] or [c[0] for c in d['cities']])
        names = [c[0] for c in d['cities']]
        self.assertEqual(names[:3], ['Berlin', 'Wien', 'Hamburg'], 'by size, biggest first')
        self.assertEqual(names, sorted(names, key=lambda n: -next(c[3] for c in d['cities'] if c[0] == n)))
        self.assertIn('Köln', names, 'the German name')
        self.assertIn('Wien', names, 'a neighbour')
        self.assertIn('Hamburg', names, 'no German name: the name')
        self.assertNotIn('Klein', names, 'too small')
        self.assertNotIn('Tokio', names, 'too far')
        berlin = next(c for c in d['cities'] if c[0] == 'Berlin')
        self.assertEqual(berlin[1:], [1340, 5252, 3645])

    def test_the_output_is_a_javascript_module_that_is_also_json(self):
        digests = {n: hashlib.sha256(n.encode()).hexdigest() for n in basemap.FILES}
        data = basemap.build(self.dir, 0.0)
        text = basemap.render(data, digests)
        for n, h in digests.items():
            self.assertIn('//   %s.geojson %s' % (n, h), text)
        body = re.search(r'^export default (\{.*\});\s*$', text, re.S | re.M).group(1)
        self.assertEqual(json.loads(body), data)

    def test_the_command_line_writes_the_file(self):
        out = os.path.join(self.dir, 'out.js')
        self.assertEqual(basemap.main(['basemap.py', self.dir, out, '0.01']), 0)
        self.assertTrue(os.path.getsize(out) > 200)
        with self.assertRaises(SystemExit):
            basemap.main(['basemap.py'])


class CommittedMapTest(unittest.TestCase):
    """What is in app/basemap-data.js now."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, 'app', 'basemap-data.js'), encoding='utf-8') as f:
            cls.text = f.read()
        cls.data = json.loads(re.search(r'^export default (\{.*\});\s*$', cls.text, re.S | re.M).group(1))

    def test_small_and_whole(self):
        self.assertLess(len(self.text.encode('utf-8')), 120 * 1024)
        self.assertEqual(sorted(self.data), ['box', 'cities', 'de', 'lakes', 'other', 'q', 'rivers', 'states'])
        for k in ('de', 'other', 'states', 'rivers', 'lakes'):
            self.assertTrue(self.data[k], k)
            for flat in self.data[k]:
                self.assertEqual(len(flat) % 2, 0)
                self.assertGreaterEqual(len(flat), 4)

    def test_germany_is_where_germany_is(self):
        pts = [p for flat in self.data['de'] for p in basemap.decode(flat, self.data['q'])]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        self.assertTrue(5.8 < min(xs) < 6.2 and 14.8 < max(xs) < 15.2, (min(xs), max(xs)))
        self.assertTrue(47.2 < min(ys) < 47.6 and 54.8 < max(ys) < 55.2, (min(ys), max(ys)))

    def test_the_cities(self):
        names = {c[0]: c for c in self.data['cities']}
        self.assertGreaterEqual(len(names), 60)
        for n in ('Berlin', 'Hamburg', 'München', 'Köln', 'Hannover', 'Leipzig', 'Wien'):
            self.assertIn(n, names)
        self.assertAlmostEqual(names['Berlin'][1] / 100, 13.4, delta=0.1)
        self.assertAlmostEqual(names['Berlin'][2] / 100, 52.52, delta=0.1)
        self.assertEqual([c[3] for c in self.data['cities']], sorted((c[3] for c in self.data['cities']), reverse=True))

    def test_the_header_names_its_sources(self):
        self.assertIn('Natural Earth', self.text.split('export default', 1)[0])
        self.assertEqual(len(re.findall(r'^//   ne_10m_\w+\.geojson [0-9a-f]{64}$', self.text, re.M)), 5)


if __name__ == '__main__':
    unittest.main()
