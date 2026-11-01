// The map behind the graphs: drawn through the projection of the stations, only where the picture is, kept while the
// projection stays, and gone when it is switched off. The data is the committed app/basemap-data.js (Natural Earth).
import test from 'node:test';
import assert from 'node:assert/strict';
import MAP from '../../app/basemap-data.js';
import { mapSvg, projector, withView, svgOf } from '../../app/graph.js';

const W = 720, H = 520, SIZE = { width: W, height: H };
const HAM = { st: 0, name: 'Hamburg Hbf', lat: 53.553, lon: 10.006 };
const HAN = { st: 1, name: 'Hannover Hbf', lat: 52.376, lon: 9.741 };
const MUC = { st: 2, name: 'München Hbf', lat: 48.14, lon: 11.558 };
const model = {
  nodes: [{ ...HAM, src: true, rank: 0, band: 'good', arr: null }, { ...HAN, rank: 0, band: 'good', arr: 500 }, { ...MUC, dst: true, rank: 0, band: 'good', arr: 700, delta: 0 }],
  edges: [{ from: 0, to: 1, kind: 'way', band: 'good', perHour: 2 }, { from: 1, to: 2, kind: 'way', band: 'good', perHour: 2 }],
  t0: 400, context: null, me: null,
};
const fit = projector(model.nodes, { width: W, height: H });
const subpaths = svg => (svg.match(/M/g) || []).length;

// the committed data, decoded again here: first point, then differences
const first = flat => [flat[0] / MAP.q, flat[1] / MAP.q];
const biggest = lines => lines.reduce((a, b) => (b.length > a.length ? b : a));

test('the map is drawn through the projection of the stations: a point of the German border lands where proj puts it', () => {
  const [lon, lat] = first(biggest(MAP.de));
  const p = fit(lat, lon);
  assert.ok(mapSvg(fit, SIZE).includes(`M${p.x} ${p.y}`), 'the first point of the main outline, north up, longitude to the right');
  // and a city of the data is placed by the same projection: Berlin is east of Hamburg and north of Munich
  const berlin = MAP.cities.find(c => c[0] === 'Berlin');
  const b = fit(berlin[2] / 100, berlin[1] / 100), h = fit(HAM.lat, HAM.lon), m = fit(MUC.lat, MUC.lon);
  assert.ok(b.x > h.x && b.y < m.y && b.y > h.y - 40);
});

test('every layer is there at fit, with the classes the style sheet colours', () => {
  const svg = mapSvg(fit, SIZE);
  for (const c of ['bm-other', 'bm-de', 'bm-state', 'bm-river']) assert.match(svg, new RegExp(`class="${c}" d="M`), c);
  assert.ok(svg.startsWith('<g class="bm">') && svg.endsWith('</g>'));
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

test('the switch: no map and no map class without it, both with it', () => {
  const off = svgOf(model, { width: W, height: H });
  assert.ok(!off.includes('bm') && !off.includes('hasmap'));
  const on = svgOf(model, { width: W, height: H, basemap: true });
  assert.match(on, /<svg class="pb hasmap" /);
  assert.ok(on.includes('class="bm-de"'));
  assert.ok(on.indexOf('class="bm"') < on.indexOf('<line'), 'the map is behind the ways');
});

test('the finished map is kept while the projection stays and made again when it changes', () => {
  let calls = 0;
  const counting = (lat, lon) => { calls++; return fit(lat, lon); };
  mapSvg(withView(fit, { k: 1.1, dx: 5, dy: 5 }, W, H), SIZE);   // something else in the cache
  const a = mapSvg(counting, SIZE); const drawn = calls;
  assert.ok(drawn > 100, 'drawing projects every point');
  calls = 0;
  const b = mapSvg(counting, SIZE);
  assert.equal(b, a);
  assert.equal(calls, 2, 'the same projection: two points to tell, nothing drawn');
  calls = 0;
  const moved = mapSvg((lat, lon) => { calls++; const p = fit(lat, lon); return { x: p.x + 7, y: p.y }; }, SIZE);
  assert.notEqual(moved, a, 'a shifted projection is a different map');
  assert.ok(calls > 100);
  calls = 0;
  mapSvg(counting, { width: W + 1, height: H });
  assert.ok(calls > 100, 'a different size is a different map');
});

test('zoomed in on Berlin only the lines that reach the picture are drawn', () => {
  const full = mapSvg(fit, SIZE);
  const berlin = fit(52.52, 13.4), k = 8;
  const zoomed = mapSvg(withView(fit, { k, dx: -(berlin.x - W / 2) * k, dy: -(berlin.y - H / 2) * k }, W, H), SIZE);
  assert.ok(subpaths(zoomed) < subpaths(full) / 3, `${subpaths(zoomed)} of ${subpaths(full)} subpaths`);
  assert.ok(zoomed.length < full.length / 2);
  assert.match(zoomed, /class="bm-state" d="M/, 'Berlin and Brandenburg are still there');
});

test('far from the data nothing is drawn, and the map stays valid', () => {
  const svg = mapSvg(withView(fit, { k: 8, dx: 9e5, dy: 9e5 }, W, H), SIZE);
  assert.equal(svg, '<g class="bm"></g>');
});

test('thinning: no two points of a line are less than a pixel apart', () => {
  const svg = mapSvg(fit, SIZE);
  let lines = 0;
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const sub of m[1].split('M').filter(Boolean)) {   // one line at a time: a new line starts anywhere
      const pts = [...sub.matchAll(/([-\d.]+) ([-\d.]+)/g)].map(x => [+x[1], +x[2]]);
      let tight = 0;
      for (let i = 1; i < pts.length - 1; i++) if (Math.abs(pts[i][0] - pts[i - 1][0]) < 0.7 && Math.abs(pts[i][1] - pts[i - 1][1]) < 0.7) tight++;
      assert.equal(tight, 0);
      lines++;
    }
  }
  assert.ok(lines > 50);
});

test('drawing the map costs milliseconds, not a frame: 20 views in well under a second', () => {
  const t = performance.now();
  for (let i = 0; i < 20; i++) mapSvg(withView(fit, { k: 1 + i * 0.05, dx: i, dy: -i }, W, H), SIZE);
  assert.ok(performance.now() - t < 1000, `${(performance.now() - t).toFixed(0)} ms`);
});

test('city names: the biggest ones in the picture, at most six, clear of the stations, none without the map', () => {
  const on = svgOf(model, { width: W, height: H, basemap: true });
  const names = [...on.matchAll(/<text class="nm hub city"[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
  const known = new Set(MAP.cities.map(c => c[0]));
  assert.ok(names.length > 0 && names.length <= 6, names.join());
  assert.ok(names.every(n => known.has(n)));
  assert.ok(!names.includes('Hamburg') && !names.includes('Hannover') && !names.includes('München'), 'a city at a station is not named twice');
  assert.ok(!svgOf(model, { width: W, height: H }).includes('city'));
});

test('withView: nothing for the fit, the middle stays put when zooming, a point moves k times as far', () => {
  assert.equal(withView(fit, { k: 1, dx: 0, dy: 0 }, W, H), fit);
  assert.equal(withView(fit, null, W, H), fit);
  const flat = (lat, lon) => ({ x: lon, y: lat });
  const v = withView(flat, { k: 2, dx: 10, dy: -4 }, W, H);
  assert.deepEqual(v(H / 2, W / 2), { x: W / 2 + 10, y: H / 2 - 4 });
  assert.deepEqual(v(H / 2 + 30, W / 2 - 50), { x: W / 2 - 100 + 10, y: H / 2 + 60 - 4 });
});

test('stations outside the picture get no label; the start and the target keep theirs', () => {
  const away = svgOf(model, { width: W, height: H, view: { k: 8, dx: 6000, dy: 0 } });
  assert.ok(!away.includes('>Hannover<'));
  assert.ok(away.includes('>Hamburg<') && away.includes('>München<'));
  assert.ok(svgOf(model, { width: W, height: H }).includes('>Hannover<'));
});
