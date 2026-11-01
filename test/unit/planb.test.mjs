// Plan B on a small corridor timetable I can reason about by hand: the planned chain is RE6, RE30, S5 and arrives at
// 09:00. With RE6 cancelled, a detour through a side station still makes 09:00; the next regular chain arrives an hour
// later. Deterministic, no feed, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timetable } from '../../app/engine.js';
import { bandOf, ways, plan, graphOf, GOOD_MIN, LATE_MIN } from '../../app/planb.js';
import { svgOf, widthOf, project, placeLabels, short } from '../../app/graph.js';
import { buildFixture, hm } from '../support/fixture.mjs';

const stations = [
  { name: 'Start Hbf', lat: 52.43, lon: 10.79 },      // 0
  { name: 'Mitte', lat: 52.13, lon: 11.63 },          // 1
  { name: 'Knoten Hbf', lat: 51.48, lon: 11.97 },     // 2
  { name: 'Ziel Hbf', lat: 51.34, lon: 12.37 },       // 3
  { name: 'Seitenweg & Co', lat: 51.9, lon: 10.9 },   // 4
];
const lines = ['RE6', 'RB36', 'RE30', 'S5', 'RB', 'RE'];
const ALL = 0b1111111;
const run = (line, term, a, ad, b, ar) => ({ line, term, svc: ALL, stops: [{ st: a, arr: hm(ad), dep: hm(ad) }, { st: b, arr: hm(ar), dep: hm(ar) }] });
const trips = [
  run(0, 1, 0, '06:23', 1, '07:28'),   // 0 RE6   Start-Mitte   the planned train
  run(1, 1, 0, '07:05', 1, '08:26'),   // 1 RB36  Start-Mitte   the next regular one
  run(2, 2, 1, '07:35', 2, '08:31'),   // 2 RE30  Mitte-Knoten
  run(2, 2, 1, '08:35', 2, '09:31'),   // 3 RE30  Mitte-Knoten
  run(3, 3, 2, '08:45', 3, '09:00'),   // 4 S5    Knoten-Ziel
  run(3, 3, 2, '09:45', 3, '10:00'),   // 5 S5    Knoten-Ziel
  run(4, 4, 0, '06:40', 4, '07:20'),   // 6 RB    Start-Seitenweg   the detour
  run(5, 2, 4, '07:30', 2, '08:40'),   // 7 RE    Seitenweg-Knoten
  run(3, 3, 2, '08:55', 3, '09:10'),   // 8 S5    Knoten-Ziel, a second train within the hour
  run(4, 4, 0, '07:40', 4, '08:20'),   // 9 RB    Start-Seitenweg   the later detour
  run(5, 2, 4, '08:30', 2, '09:40'),   // 10 RE   Seitenweg-Knoten
];
const { meta, buf } = buildFixture({ stations, lines, trips, nDays: 7 });
const tt = new Timetable(meta, buf);
const A = 0, M = 1, H = 2, D = 3, E = 4;
const T0 = 0;
const out0 = new Set([tt.tripKey(0, T0)]);   // RE6 of day 0 does not run

test('a run marked out is never boarded, on its day only', () => {
  const free = tt.earliestArrival({ day: 0, src: A, t0: hm('06:00') });
  assert.equal(free.arr[M], hm('07:28'));
  const cut = tt.earliestArrival({ day: 0, src: A, t0: hm('06:00'), exclude: out0 });
  assert.equal(cut.arr[M], hm('08:26'), 'RB36 is the first train left');
  const nextDay = tt.earliestArrival({ day: 1, src: A, t0: hm('06:00'), exclude: out0 });
  assert.equal(nextDay.arr[M], hm('07:28'), 'the same train runs again the next day');
});

test('legs and departures say which service day their run belongs to', () => {
  const r = tt.earliestArrival({ day: 2, src: A, t0: hm('06:00') });
  const leg = tt.legsTo(r, M)[0];
  assert.equal(leg.svcDay, 2);
  assert.equal(tt.tripKey(leg.svcDay, leg.trip), 2 * tt.nTrips + T0);
  const d = tt.departures({ day: 2, station: A, t: hm('06:00'), limit: 1 })[0];
  assert.equal(d.svcDay, 2);
  assert.equal(d.trip, T0);
});

test('callsAt finds where a trip calls further on, and -1 where it does not', () => {
  const ci = i => { for (let c = 0; c < tt.nConn; c++) if (tt.connFrom[c] === i.from && tt.connDep[c] === hm(i.dep)) return c; return -1; };
  const c6 = ci({ from: A, dep: '06:40' });
  assert.equal(tt.callsAt(c6, E), hm('07:20'));
  assert.equal(tt.callsAt(c6, D), -1, 'the detour train never reaches Ziel');
  assert.equal(tt.callsAt(c6, A), -1, 'it does not call at the station it leaves from');
});

test('trains an hour: runs that serve the link inside the window, minus the ones that are out', () => {
  const at = { day: 0, from: H, to: D, t: hm('08:45') };
  assert.equal(tt.callsPerWindow(at), 2, 'S5 at 08:45 and the extra S5 at 08:55');
  assert.equal(tt.callsPerWindow({ ...at, exclude: new Set([tt.tripKey(0, 8)]) }), 1);
  assert.equal(tt.callsPerWindow({ day: 0, from: A, to: D, t: hm('07:05') }), 0, 'no direct link');
  assert.equal(tt.callsPerWindow({ day: 0, from: H, to: D, t: hm('08:45'), before: 0, after: 5 }), 1, 'a narrower window');
});

test('bands: on plan up to the good limit, late up to the late limit, much later beyond', () => {
  assert.equal(GOOD_MIN, 15);
  assert.equal(LATE_MIN, 60);
  assert.deepEqual([-30, 0, 15, 16, 60, 61, 300].map(bandOf), ['good', 'good', 'good', 'mid', 'mid', 'bad', 'bad']);
});

test('with the planned train out, the detour keeps the plan and the next regular chain is an hour later', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.options.map(o => o.arr), [hm('09:00'), hm('10:00'), hm('10:00')]);
  assert.deepEqual(r.options.map(o => o.delta), [0, 60, 60]);
  assert.deepEqual(r.options.map(o => o.band), ['good', 'mid', 'mid']);
  assert.deepEqual(r.options[0].legs.map(l => l.line), ['RB', 'RE', 'S5']);
  assert.deepEqual(r.options[1].legs.map(l => l.line), ['RB36', 'RE30', 'S5']);
  assert.equal(r.baseKind, 'plan');
  assert.deepEqual(r.options[0].tags, ['earliest']);
});

test('every way carries its changes, its tightest change and the trains an hour behind each leg', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  const o = r.options[0];
  assert.equal(o.changes, 2);
  assert.equal(o.tightest, 5, 'Seitenweg 07:20 to 07:30 is 10 min, Knoten 08:40 to 08:45 is 5 min');
  assert.deepEqual(o.perLeg, [1, 1, 2]);
  assert.equal(o.thinnest, 1);
});

test('without a plan, the best way on is the yardstick', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), exclude: out0 });
  assert.equal(r.baseKind, 'best');
  assert.equal(r.base, r.options[0].arr);
  assert.equal(r.options[0].delta, 0);
  assert.equal(r.options[1].delta, 60);
});

test('a plan later than the best way makes the best way early and green', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:30'), exclude: out0 });
  assert.equal(r.options[0].delta, -30);
  assert.equal(r.options[0].band, 'good');
  assert.equal(r.options[1].delta, 30);
  assert.equal(r.options[1].band, 'mid');
});

test('ways stops at the window and at the cap', () => {
  const few = ways(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), exclude: out0, max: 2 });
  assert.equal(few.length, 2);
  const tight = ways(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), exclude: out0, window: 30 });
  assert.deepEqual(tight.map(o => o.arr), [hm('09:00')], 'nothing within half an hour of the best arrival but the best');
});

test('no way on, and the same station, are told plainly', () => {
  const late = plan(tt, { day: 6, src: A, dst: D, t0: hm('23:00') });
  assert.match(late.error, /No way on/);
  assert.deepEqual(late.options, []);
  assert.match(plan(tt, { day: 0, src: A, dst: A, t0: 0 }).error, /already/);
});

test('the graph keeps the best colour and the most trains an hour per leg, and the plan we had as dotted legs', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  const g = graphOf(tt, r, { ghost: [{ from: A, to: M }, { from: M, to: H }, { from: H, to: D }] });
  const edge = (a, b, kind = 'ride') => g.edges.find(e => e.from === a && e.to === b && e.kind === kind);
  assert.equal(edge(H, D).perHour, 2, 'the S5 pair at 08:45 and 08:55 serves the leg the detour uses');
  assert.equal(edge(H, D).band, 'good', 'the best way through it arrives on plan');
  assert.equal(edge(A, M).band, 'mid');
  assert.equal(edge(A, E).band, 'good');
  assert.equal(g.edges.filter(e => e.kind === 'ghost').length, 3);
  const dst = g.nodes.find(n => n.dst);
  assert.equal(dst.band, 'good');
  assert.equal(dst.delta, 0);
  assert.equal(g.nodes.find(n => n.src).st, A);
});

test('line thickness runs from thin for one train an hour to thick for four or more', () => {
  assert.equal(widthOf(1), 3.75);
  assert.ok(widthOf(2) > widthOf(1) && widthOf(3) > widthOf(2));
  assert.equal(widthOf(4), 9);
  assert.equal(widthOf(11), 9);
  assert.equal(widthOf(0), 3.75, 'never thinner than one train');
});

test('stations keep their real positions: north is up, east is right, all inside the box', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  const g = graphOf(tt, r);
  const pos = project(g.nodes);
  const of = st => pos[g.nodes.findIndex(n => n.st === st)];
  assert.ok(of(A).y < of(D).y, 'Start lies north of Ziel');
  assert.ok(of(A).x < of(D).x, 'Start lies west of Ziel');
  for (const p of pos) assert.ok(p.x >= 0 && p.x <= 720 && p.y >= 0 && p.y <= 520);
});

test('labels do not sit on top of each other', () => {
  const items = [0, 1, 2, 3].map(() => ({ x: 300, y: 200, w: 80, h: 30 }));
  const placed = placeLabels(items);
  const keys = placed.map(p => p.anchor + p.x + ',' + p.y);
  assert.equal(new Set(keys).size, 4, 'four labels at one point land in four different places');
});

test('the SVG draws colour, thickness, escaped names and no inline style', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  const svg = svgOf(graphOf(tt, r, { ghost: [{ from: A, to: M }] }), { label: 'test' });
  assert.match(svg, /^<svg class="pb" viewBox="0 0 720 520"/);
  assert.match(svg, /class="e good"[^>]*stroke-width="5.5"/, 'the S5 pair is two trains an hour');
  assert.match(svg, /class="e mid"/);
  assert.match(svg, /class="e ghost"/);
  assert.ok(svg.includes('Seitenweg &amp; Co'), 'names are escaped');
  assert.ok(!/\sstyle\s*=/.test(svg), 'no style attribute');
  assert.ok(!/https?:/.test(svg), 'no absolute URL');
  assert.equal((svg.match(/<circle/g) || []).length, 5);
  assert.match(svg, /09:00/, 'the arrival time at the target is on the graph');
});

test('names are shortened without merging two stations that are a short walk apart', () => {
  assert.equal(short('Leipzig Hbf'), 'Leipzig');
  assert.equal(short('Leipzig Hbf (tief)'), 'Leipzig (tief)');
  assert.equal(short('Wolfsburg Fallersleben Bahnhof'), 'Wolfsburg Fallersleben Bahnhof');
});

test('the plan we had is drawn last, over the ways, and the target says how many minutes late it is', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('08:30'), exclude: out0 });
  const svg = svgOf(graphOf(tt, r, { ghost: [{ from: A, to: M }, { from: M, to: H }, { from: H, to: D }] }));
  const lines = svg.match(/<line [^>]*>/g);
  assert.ok(lines.slice(-3).every(l => l.includes('class="e ghost"')), 'the three dotted legs come last');
  assert.ok(lines.slice(0, -3).every(l => !l.includes('ghost')));
  assert.match(svg, /09:00 \+30 min/, 'plan 08:30, best way 09:00');
});

test('drawn at phone width, the viewBox follows the width and every station stays inside it', () => {
  const r = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:23'), plannedArr: hm('09:00'), exclude: out0 });
  const g = graphOf(tt, r);
  const svg = svgOf(g, { width: 340, height: 391 });
  assert.match(svg, /viewBox="0 0 340 391"/);
  for (const m of svg.matchAll(/<circle [^>]*cx="([\d.]+)" cy="([\d.]+)"/g)) {
    assert.ok(+m[1] >= 0 && +m[1] <= 340 && +m[2] >= 0 && +m[2] <= 391, `circle at ${m[1]},${m[2]}`);
  }
  for (const m of svg.matchAll(/<text [^>]*text-anchor="(start|end)" [^>]*>/g)) assert.ok(m[1]);
});
