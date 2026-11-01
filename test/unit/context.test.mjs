// The network around a journey, for the Plan B graph: the earliest-arrival tree from the start (Timetable.reachEdges),
// planb.contextOf, and how graph.js draws it. A small star network I can reason about by hand. Deterministic, no feed.
//
//   Nord (1) --- Hub (0) --- Ost (2) --- Fern (4)      Hub to Sued (3) on foot from Hub Sued Fussweg (5)
//                  |
//                Sued (3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timetable } from '../../app/engine.js';
import { contextOf, graphOf, plan } from '../../app/planb.js';
import { svgOf } from '../../app/graph.js';
import { buildFixture, hm } from '../support/fixture.mjs';

const stations = [
  { name: 'Hub Hbf', lat: 51.0, lon: 10.0 },        // 0
  { name: 'Nord', lat: 51.6, lon: 10.0 },           // 1
  { name: 'Ost', lat: 51.0, lon: 10.9 },            // 2
  { name: 'Sued', lat: 50.4, lon: 10.0 },           // 3
  { name: 'Fern', lat: 51.0, lon: 11.9 },           // 4
  { name: 'Hub Sued Fussweg', lat: 50.99, lon: 10.0 },  // 5, a few minutes on foot from Hub
  { name: 'Insel', lat: 52.5, lon: 13.0 },          // 6, no train at all
  { name: 'Nord Fussweg', lat: 51.61, lon: 10.0 },  // 7, a walk from Nord, which is a train ride from Hub
];
const lines = ['RE1', 'RE2', 'RB3', 'RB4'];
const ALL = 0b1111111;
const run = (line, a, ad, b, ar) => ({ line, term: b, svc: ALL, stops: [{ st: a, arr: hm(ad), dep: hm(ad) }, { st: b, arr: hm(ar), dep: hm(ar) }] });
const trips = [
  run(0, 0, '06:10', 1, '06:40'),   // 0 Hub-Nord
  run(1, 0, '06:20', 2, '06:50'),   // 1 Hub-Ost
  run(2, 2, '07:00', 4, '08:30'),   // 2 Ost-Fern, arrives 150 min after 06:00
  run(3, 0, '06:30', 3, '07:30'),   // 3 Hub-Sued
  run(0, 3, '08:00', 0, '09:00'),   // 4 Sued-Hub, gives Sued a departure and the south a way back
];
const { meta, buf } = buildFixture({ stations, lines, trips, foot: [[0, 5, 4], [5, 0, 4], [1, 7, 3], [7, 1, 3]], nDays: 7 });
const tt = new Timetable(meta, buf);
const [HUB, NORD, OST, SUED, FERN, FUSS, INSEL, NFUSS] = [0, 1, 2, 3, 4, 5, 6, 7];
const scan = (extra = {}) => tt.earliestArrival({ day: 0, src: HUB, t0: hm('06:00'), ...extra });
const pairs = edges => edges.map(e => `${tt.names[e.from]}>${tt.names[e.to]}`).sort();

test('reachEdges: each station reached is joined to the station its last leg started from', () => {
  assert.deepEqual(pairs(tt.reachEdges(scan(), { maxMin: 300 })), [
    'Hub Hbf>Hub Sued Fussweg', 'Hub Hbf>Nord', 'Hub Hbf>Ost', 'Hub Hbf>Sued', 'Nord>Nord Fussweg', 'Ost>Fern',
  ]);
});

test('reachEdges: the start has no edge into it, and a station no train reaches is absent', () => {
  const edges = tt.reachEdges(scan(), { maxMin: 300 });
  assert.ok(!edges.some(e => e.to === HUB), 'nothing leads back to the start');
  assert.ok(!edges.some(e => e.from === INSEL || e.to === INSEL), 'Insel has no train');
});

test('reachEdges: a leg that is part of a longer chain starts where that leg was boarded, not where the journey began', () => {
  const fern = tt.reachEdges(scan(), { maxMin: 300 }).find(e => e.to === FERN);
  assert.equal(fern.from, OST);
  assert.equal(fern.arr, hm('08:30'));
});

test('reachEdges: only stations within maxMin minutes of the start time', () => {
  assert.ok(!tt.reachEdges(scan(), { maxMin: 120 }).some(e => e.to === FERN), 'Fern is 150 minutes away');
  assert.ok(tt.reachEdges(scan(), { maxMin: 150 }).some(e => e.to === FERN));
  assert.ok(tt.reachEdges(scan(), { maxMin: 120 }).some(e => e.to === SUED), 'Sued is 90 minutes away');
});

test('reachEdges: a walk is an edge from where the walk began, and a run marked out takes its stations with it', () => {
  const edges = tt.reachEdges(scan(), { maxMin: 300 });
  assert.ok(edges.some(e => e.from === HUB && e.to === FUSS), 'the footpath at the start');
  assert.ok(edges.some(e => e.from === NORD && e.to === NFUSS), 'the footpath after a ride starts at the station the ride ended at');
  const cut = pairs(tt.reachEdges(scan({ exclude: new Set([tt.tripKey(0, 1)]) }), { maxMin: 300 }));
  assert.ok(!cut.some(p => p.includes('Ost') || p.includes('Fern')), 'Hub-Ost is out, so Ost and Fern are not reached: ' + cut);
});

test('contextOf: stations with positions and degree, edges as pairs', () => {
  const c = contextOf(tt, { day: 0, src: HUB, t0: hm('06:00'), maxMin: 300 });
  assert.equal(c.edges.length, 6);
  assert.deepEqual(c.edges.map(e => Object.keys(e).sort()), c.edges.map(() => ['from', 'to']));
  const hub = c.nodes.find(n => n.st === HUB);
  assert.deepEqual([hub.name, hub.lat, hub.lon, hub.deg], ['Hub Hbf', 51.0, 10.0, tt.degree[HUB]]);
  assert.ok(hub.deg >= 3, 'the hub has the most departures');
});

test('graphOf carries the context along, and none by default', () => {
  const r = plan(tt, { day: 0, src: HUB, dst: OST, t0: hm('06:00') });
  assert.equal(graphOf(tt, r).context, null);
  const c = contextOf(tt, { day: 0, src: HUB, t0: hm('06:00'), maxMin: 300 });
  assert.equal(graphOf(tt, r, { context: c }).context, c);
});

test('the SVG draws the context quietly, under the ways, with no inline style', () => {
  const r = plan(tt, { day: 0, src: HUB, dst: OST, t0: hm('06:00') });
  const c = contextOf(tt, { day: 0, src: HUB, t0: hm('06:00'), maxMin: 300 });
  const svg = svgOf(graphOf(tt, r, { context: c }), { label: 'test' });
  const lines = (svg.match(/class="cl"/g) || []).length, dots = (svg.match(/class="cx"/g) || []).length;
  assert.ok(lines >= 3, 'hairlines for the legs of the network: ' + lines);
  assert.ok(dots >= 1 && dots < c.nodes.length - 2, 'dots only for the stations inside the box that are not on a way, the rest is clipped: ' + dots);
  assert.ok(svg.lastIndexOf('class="cl"') < svg.indexOf('class="e '), 'every context line is drawn before the first way');
  assert.ok(!/\sstyle\s*=/.test(svg), 'no style attribute');
  const at = cls => new Set([...svg.matchAll(new RegExp('<circle class="' + cls + '[^"]*" cx="([\\d.]+)" cy="([\\d.]+)"', 'g'))].map(m => m[1] + ',' + m[2]));
  const onWays = at('n'), asContext = at('cx');
  assert.ok(onWays.size >= 2 && asContext.size >= 1);
  assert.deepEqual([...asContext].filter(p => onWays.has(p)), [], 'a station on a way is not drawn again as context');
});

test('without context the SVG is the one it was', () => {
  const r = plan(tt, { day: 0, src: HUB, dst: OST, t0: hm('06:00') });
  const svg = svgOf(graphOf(tt, r), { label: 'test' });
  assert.ok(!svg.includes('class="cl"') && !svg.includes('class="cx"'));
});

test('the context does not move the ways: same positions with and without it', () => {
  const r = plan(tt, { day: 0, src: HUB, dst: OST, t0: hm('06:00') });
  const c = contextOf(tt, { day: 0, src: HUB, t0: hm('06:00'), maxMin: 300 });
  const way = svg => svg.match(/<line class="e [^>]*>/g).join('');
  assert.equal(way(svgOf(graphOf(tt, r, { context: c }), { label: 't' })), way(svgOf(graphOf(tt, r), { label: 't' })));
});

test('a hub label is only drawn where it is clear of the other labels', () => {
  const r = plan(tt, { day: 0, src: HUB, dst: OST, t0: hm('06:00') });
  const c = contextOf(tt, { day: 0, src: HUB, t0: hm('06:00'), maxMin: 300 });
  const svg = svgOf(graphOf(tt, r, { context: c }), { label: 'test' });
  const hubs = [...svg.matchAll(/<text class="nm hub"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  assert.ok(hubs.length <= 4, 'at most four');
  assert.ok(!hubs.includes('Hub') && !hubs.includes('Ost'), 'the stations of the way are labelled as ways, not as context');
});
