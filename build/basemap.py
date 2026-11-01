#!/usr/bin/env python3
"""Build the basemap of the Plan B graphs: app/basemap-data.js, from Natural Earth. Standard library only.

Natural Earth (naturalearthdata.com) is public domain. Run this by hand when the map needs to change; the output is
committed, so a build never needs the network for it. The five GeoJSON files (10 m scale) are read from a directory:

  ne_10m_admin_0_countries.geojson           countries: Germany and its neighbours, land and borders
  ne_10m_admin_1_states_provinces.geojson    the German states
  ne_10m_rivers_lake_centerlines.geojson     the larger rivers
  ne_10m_lakes.geojson                       lakes
  ne_10m_populated_places.geojson            cities of 150,000 or more, with their German names

  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<file>

Usage: basemap.py <natural-earth-dir> <out.js> [tolerance-in-degrees]

Every line is simplified (Douglas-Peucker, default 0.01 degrees, about a kilometre), kept only if some point is inside the
box around Germany, rounded to 0.001 degrees and written as the first point followed by differences. The result is one
JSON object after "export default", so it is a valid JS module and valid JSON for the tests. The sha256 of every input
is written into the header, so the output says what it was made from.
"""
import hashlib
import json
import math
import os
import sys

BOX = (4.2, 46.4, 16.8, 55.6)      # lon0, lat0, lon1, lat1: a margin around Germany
Q = 1000                           # coordinates are integers of 1/Q degree
NEIGHBOURS = ('Netherlands', 'Belgium', 'Luxembourg', 'France', 'Switzerland', 'Austria', 'Czechia', 'Poland', 'Denmark',
              'Italy', 'Liechtenstein', 'Sweden', 'Lithuania', 'Slovenia', 'Hungary', 'Slovakia')
CITY_MIN_POP = 150000
FILES = ('ne_10m_admin_0_countries', 'ne_10m_admin_1_states_provinces', 'ne_10m_rivers_lake_centerlines', 'ne_10m_lakes',
         'ne_10m_populated_places')


def in_box(x, y, box=BOX):
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def lines_of(geometry):
    """The rings or lines of a GeoJSON geometry, as lists of (lon, lat)."""
    t, c = geometry['type'], geometry['coordinates']
    if t == 'Polygon':
        rings = list(c)
    elif t == 'MultiPolygon':
        rings = [r for poly in c for r in poly]
    elif t == 'LineString':
        rings = [c]
    elif t == 'MultiLineString':
        rings = list(c)
    else:
        rings = []
    return [[(p[0], p[1]) for p in r] for r in rings]


def douglas_peucker(points, tol):
    """The points that keep the line within tol of the original. The first and the last are always kept."""
    n = len(points)
    if n < 3:
        return list(points)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        far, at = 0.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / length if length else math.hypot(px - x1, py - y1)
            if d > far:
                far, at = d, i
        if far > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]


def simplify(points, tol):
    """douglas_peucker for a line or a closed ring. A ring starts and ends at one point: the segment between its ends has
    length zero, and then the distance of a point to it is the distance to that point, so the first cut is at the point
    farthest from the start and the ring keeps its shape."""
    return douglas_peucker(points, tol)


def encode(lines, tol, q=Q, box=BOX):
    """Lines with a point in the box, simplified, as flat integer lists: first point, then differences."""
    out = []
    for line in lines:
        if not any(in_box(x, y, box) for x, y in line):
            continue
        pts = [(round(x * q), round(y * q)) for x, y in simplify(line, tol)]
        if len(pts) < 2:
            continue
        flat = [pts[0][0], pts[0][1]]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            flat += [x1 - x0, y1 - y0]
        out.append(flat)
    return out


def decode(flat, q=Q):
    """The inverse of encode, for the tests: a list of (lon, lat)."""
    x, y, pts = flat[0], flat[1], [(flat[0] / q, flat[1] / q)]
    for i in range(2, len(flat), 2):
        x, y = x + flat[i], y + flat[i + 1]
        pts.append((x / q, y / q))
    return pts


def features(directory, name):
    with open(os.path.join(directory, name + '.geojson'), encoding='utf-8') as f:
        return json.load(f)['features']


def prop(f, *names):
    for n in names:
        v = f['properties'].get(n)
        if v not in (None, ''):
            return v
    return None


def build(directory, tol=0.01):
    countries = features(directory, 'ne_10m_admin_0_countries')
    de = [l for f in countries if prop(f, 'NAME', 'name') == 'Germany' for l in lines_of(f['geometry'])]
    other = [l for f in countries if prop(f, 'NAME', 'name') in NEIGHBOURS for l in lines_of(f['geometry'])]
    states = [l for f in features(directory, 'ne_10m_admin_1_states_provinces') if prop(f, 'admin', 'ADMIN') == 'Germany'
              for l in lines_of(f['geometry'])]
    rivers = [l for f in features(directory, 'ne_10m_rivers_lake_centerlines') if (prop(f, 'scalerank', 'SCALERANK') or 99) <= 6
              for l in lines_of(f['geometry'])]
    lakes = [l for f in features(directory, 'ne_10m_lakes') for l in lines_of(f['geometry'])]
    cities = []
    for f in features(directory, 'ne_10m_populated_places'):
        lon, lat = f['geometry']['coordinates'][:2]
        pop = prop(f, 'POP_MAX', 'pop_max') or 0
        if prop(f, 'ADM0NAME', 'adm0name') in NEIGHBOURS + ('Germany',) and in_box(lon, lat) and pop >= CITY_MIN_POP:
            cities.append([prop(f, 'NAME_DE', 'name_de', 'NAME', 'name'), round(lon * 100), round(lat * 100), round(pop / 1000)])
    cities.sort(key=lambda c: (-c[3], c[0]))
    return {'q': Q, 'box': list(BOX), 'de': encode(de, tol), 'other': encode(other, tol), 'states': encode(states, tol),
            'rivers': encode(rivers, tol), 'lakes': encode(lakes, tol), 'cities': cities}


def render(data, digests):
    head = ['// Generated by build/basemap.py from Natural Earth (naturalearthdata.com, public domain). Do not edit.',
            '// Lines are integers of 1/q degree: the first point, then differences. Cities: name, lon and lat in 1/100 degree,',
            '// inhabitants in thousands. Inputs (sha256):']
    head += ['//   %s.geojson %s' % (n, digests[n]) for n in FILES]
    body = ',\n'.join('  %s: %s' % (json.dumps(k), json.dumps(v, separators=(',', ':'), ensure_ascii=False)) for k, v in data.items())
    return '\n'.join(head) + '\nexport default {\n' + body + '\n};\n'


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    directory, out = argv[1], argv[2]
    tol = float(argv[3]) if len(argv) > 3 else 0.01
    digests = {}
    for n in FILES:
        with open(os.path.join(directory, n + '.geojson'), 'rb') as f:
            digests[n] = hashlib.sha256(f.read()).hexdigest()
    text = render(build(directory, tol), digests)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote %s (%.1f KB)' % (out, len(text.encode('utf-8')) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
