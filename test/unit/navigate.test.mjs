// Navigate: where you are in a chain at a given minute, what the clock, what you said and where you are say about the
// plan, the recalculation when it breaks, and what is kept between launches. The corridor timetable of the Plan B tests:
// the planned chain is RE6, RE30, S5 and arrives at 09:00; a detour through Seitenweg also makes 09:00.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timetable } from '../../app/engine.js';
import { plan } from '../../app/planb.js';
import { where, assess, replan, tripOf, legKey, toStored, fromStored, positionOf, whatIf, MISSED_AFTER, NEAR_KM, ELSEWHERE_KM, ELSEWHERE_WITHIN } from '../../app/navigate.js';
import { graphOf } from '../../app/planb.js';
import { svgOf } from '../../app/graph.js';
import { buildFixture, hm } from '../support/fixture.mjs';

const stations = [
  { name: 'Start Hbf', lat: 52.43, lon: 10.79 },      // 0
  { name: 'Mitte', lat: 52.13, lon: 11.63 },          // 1
  { name: 'Knoten Hbf', lat: 51.48, lon: 11.97 },     // 2
  { name: 'Ziel Hbf', lat: 51.34, lon: 12.37 },       // 3
  { name: 'Seitenweg', lat: 51.9, lon: 10.9 },        // 4
];
const lines = ['RE6', 'RB36', 'RE30', 'S5', 'RB', 'RE'];
const ALL = 0b1111111;
const run = (line, term, a, ad, b, ar) => ({ line, term, svc: ALL, stops: [{ st: a, arr: hm(ad), dep: hm(ad) }, { st: b, arr: hm(ar), dep: hm(ar) }] });
const trips = [
  run(0, 1, 0, '06:23', 1, '07:28'),   // 0 RE6   Start-Mitte   the planned train
  run(1, 1, 0, '07:05', 1, '08:26'),   // 1 RB36  Start-Mitte
  run(2, 2, 1, '07:35', 2, '08:31'),   // 2 RE30  Mitte-Knoten
  run(2, 2, 1, '08:35', 2, '09:31'),   // 3 RE30  Mitte-Knoten
  run(3, 3, 2, '08:45', 3, '09:00'),   // 4 S5    Knoten-Ziel
  run(3, 3, 2, '09:45', 3, '10:00'),   // 5 S5    Knoten-Ziel
  run(4, 4, 0, '06:40', 4, '07:20'),   // 6 RB    Start-Seitenweg   the detour
  run(5, 2, 4, '07:30', 2, '08:40'),   // 7 RE    Seitenweg-Knoten
  run(3, 3, 2, '08:55', 3, '09:10'),   // 8 S5    Knoten-Ziel
  run(4, 4, 0, '07:40', 4, '08:20'),   // 9 RB    Start-Seitenweg
  run(5, 2, 4, '08:30', 2, '09:40'),   // 10 RE   Seitenweg-Knoten
];
const { meta, buf } = buildFixture({ stations, lines, trips, nDays: 7 });
const tt = new Timetable(meta, buf);
const [A, M, H, D, E] = [0, 1, 2, 3, 4];
const planned = plan(tt, { day: 0, src: A, dst: D, t0: hm('06:00') });   // RE6, RE30, S5, arriving 09:00
const legs = planned.options[0].legs;
const at = s => hm(s);
const nav = () => ({ day: 0, dst: D, plannedArr: hm('09:00'), out: new Set() });
const here = (station, km) => ({ station, distTo: s => (s === station ? km : 50) });

test('the planned chain is the three trains', () => {
  assert.deepEqual(legs.map(l => l.line), ['RE6', 'RE30', 'S5']);
  assert.equal(legs.at(-1).arr, hm('09:00'));
});

test('where: before the first train, riding, waiting at a change, done', () => {
  assert.deepEqual([where(legs, at('06:00')).phase, where(legs, at('06:00')).inMin], ['before', 23]);
  const riding = where(legs, at('06:23'));
  assert.deepEqual([riding.phase, riding.i, riding.inMin], ['riding', 0, 65], 'the minute it leaves, you are on it');
  const change = where(legs, at('07:30'));
  assert.deepEqual([change.phase, change.i, change.inMin, change.leg.line], ['waiting', 1, 5, 'RE30']);
  assert.equal(where(legs, at('08:50')).phase, 'riding');
  assert.equal(where(legs, at('09:00')).phase, 'done', 'at the arrival minute you have arrived');
  assert.equal(where(legs, at('23:00')).phase, 'done');
});

test('where: a walk is a phase of its own', () => {
  const walked = [{ walk: true, from: A, to: M, dep: 100, arr: 110 }, ...legs.map(l => ({ ...l, dep: l.dep + 200, arr: l.arr + 200 }))];
  assert.equal(where(walked, 105).phase, 'walking');
  assert.equal(where(walked, 111).phase, 'waiting', 'after the walk you wait for the train');
});

test('assess: on plan, nothing to say', () => {
  for (const t of ['06:00', '06:30', '07:30', '08:50', '09:30']) assert.equal(assess({ legs, now: at(t) }).alert, null, t);
});

test('assess: you say you missed it', () => {
  const confirmed = { [legKey(legs[0])]: 'missed' };
  assert.deepEqual(assess({ legs, now: at('06:25'), confirmed }).alert, { kind: 'missed', why: 'said' });
  assert.deepEqual(assess({ legs, now: at('06:10'), confirmed }).alert, { kind: 'missed', why: 'said' }, 'before it left, too: you can give up on it early');
});

test('assess: still at the platform after the train left is missed; on board overrides it', () => {
  const now = legs[0].dep + 2;
  assert.equal(MISSED_AFTER, 2);
  assert.deepEqual(assess({ legs, now, here: here(A, 0.1) }).alert, { kind: 'missed', why: 'position' });
  assert.equal(assess({ legs, now: legs[0].dep + 1, here: here(A, 0.1) }).alert, null, 'not yet: a minute of grace');
  assert.equal(assess({ legs, now, here: here(A, 0.1), confirmed: { [legKey(legs[0])]: 'on' } }).alert, null, 'you said you are on it');
  assert.equal(assess({ legs, now, here: here(A, NEAR_KM + 0.1) }).alert, null, 'a few hundred metres on is moving, not waiting');
  assert.equal(assess({ legs, now, here: here(M, 0.2) }).alert, null, 'at another station: on the way');
});

test('assess: not at the boarding station shortly before the train leaves', () => {
  const now = legs[0].dep - ELSEWHERE_WITHIN;
  assert.deepEqual(assess({ legs, now, here: here(E, ELSEWHERE_KM + 5) }).alert, { kind: 'elsewhere', station: E });
  assert.equal(assess({ legs, now: now - 1, here: here(E, 20) }).alert, null, 'still time to get there');
  assert.equal(assess({ legs, now, here: here(A, 0.3) }).alert, null, 'at the station');
  assert.equal(assess({ legs, now, here: here(null, 20) }).alert, null, 'no station near: nothing to recalculate from');
  assert.equal(assess({ legs, now, here: null }).alert, null, 'no position');
});

test('assess: at a change, not at the change station when the next train is about to leave', () => {
  const now = legs[1].dep - 5;
  assert.deepEqual(assess({ legs, now, here: here(E, 8) }).alert, { kind: 'elsewhere', station: E });
  assert.equal(assess({ legs, now, here: here(M, 0.2) }).alert, null);
});

test('replan: the train you missed is out for good, and the way on is set against the plan you had', () => {
  const n = nav();
  const missed = tt.tripKey(0, 0);   // RE6 of day 0
  const r = replan(tt, n, { now: hm('06:25'), src: A, missedKey: missed });
  assert.ok(!r.error, r.error);
  assert.ok(n.out.has(missed));
  assert.equal(r.option.arr, hm('09:00'), 'the detour through Seitenweg still makes it');
  assert.equal(r.option.delta, 0);
  assert.deepEqual(r.option.legs.map(l => l.line), ['RB', 'RE', 'S5']);
  const r2 = replan(tt, n, { now: hm('06:41'), src: A, missedKey: tt.tripKey(0, 6) });   // and then the RB to Seitenweg
  assert.equal(r2.option.arr, hm('10:00'));
  assert.equal(r2.option.delta, 60);
  assert.equal(n.out.size, 2, 'both stay out');
});

test('replan: from another station, and nothing left that day is an error with a code', () => {
  const r = replan(tt, nav(), { now: hm('07:00'), src: M });
  assert.equal(r.option.legs[0].from, M);
  const none = replan(tt, { ...nav(), day: 6 }, { now: hm('23:00'), src: A });   // the last day of the timetable
  assert.equal(none.code, 'noWay');
  assert.match(none.error, /No way on/);
});

test('tripOf finds the run behind a line and a departure, and nothing for a wrong line or time', () => {
  assert.equal(tripOf(tt, 0, A, hm('06:23'), 'RE6'), tt.tripKey(0, 0));
  assert.equal(tripOf(tt, 0, A, hm('07:05'), 'RB36'), tt.tripKey(0, 1));
  assert.equal(tripOf(tt, 0, A, hm('06:23'), 'RB36'), null);
  assert.equal(tripOf(tt, 0, A, hm('06:24'), 'RE6'), null);
});

test('stored by names and times, and taken up again; the runs you missed are found again by line and time', () => {
  const n = { ...nav(), legs, recalcs: 2, out: new Set([tt.tripKey(0, 0)]), outNamed: [{ from: 'Start Hbf', dep: hm('06:23'), line: 'RE6' }] };
  const stored = JSON.parse(JSON.stringify(toStored(tt, n)));
  assert.equal(stored.dst, 'Ziel Hbf');
  assert.equal(stored.dayIso, '2026-11-01');
  assert.ok(stored.legs.every(l => typeof l.from === 'string' && typeof l.to === 'string'), 'names, not numbers');
  const back = fromStored(tt, stored);
  assert.deepEqual(back.legs.map(l => [l.from, l.to, l.dep, l.arr, l.line]), legs.map(l => [l.from, l.to, l.dep, l.arr, l.line]));
  assert.equal(back.dst, D);
  assert.equal(back.plannedArr, hm('09:00'));
  assert.equal(back.recalcs, 2);
  assert.deepEqual([...back.out], [tt.tripKey(0, 0)]);
});

test('a stored chain that no longer fits the timetable is dropped, not half used', () => {
  const n = { ...nav(), legs, recalcs: 0, out: new Set() };
  const good = JSON.parse(JSON.stringify(toStored(tt, n)));
  assert.equal(fromStored(tt, null), null);
  assert.equal(fromStored(tt, { ...good, v: 2 }), null);
  assert.equal(fromStored(tt, { ...good, legs: [] }), null);
  assert.equal(fromStored(tt, { ...good, dayIso: '2026-12-31' }), null, 'a day outside the timetable');
  assert.equal(fromStored(tt, { ...good, dst: 'Nowhere' }), null);
  assert.equal(fromStored(tt, { ...good, legs: [{ ...good.legs[0], from: 'Nowhere' }] }), null);
});

test('a chain after midnight keeps counting: the legs past 24:00 are on the next day of the same minute line', () => {
  const late = [{ walk: false, from: A, to: M, dep: 1430, arr: 1500, line: 'X' }];
  assert.equal(where(late, 1440).phase, 'riding');
  assert.equal(where(late, 1440).inMin, 60);
  assert.equal(where(late, 1500).phase, 'done');
});

// ---- the map: where you are on it, and the ways around the route
test('positionOf: at the station you wait at, on the line while you ride, at the end when done, the device when it says', () => {
  const at = st => ({ lat: tt.lat[st], lon: tt.lon[st] });
  const before = positionOf(tt, legs, hm('06:00'));
  assert.deepEqual([before.lat, before.lon, before.source], [at(A).lat, at(A).lon, 'clock']);
  const wait = positionOf(tt, legs, hm('07:30'));
  assert.deepEqual([wait.lat, wait.lon], [at(M).lat, at(M).lon], 'at the change station');
  const mid = positionOf(tt, legs, legs[0].dep + (legs[0].arr - legs[0].dep) / 2);
  assert.ok(Math.abs(mid.lat - (at(A).lat + at(M).lat) / 2) < 1e-9 && Math.abs(mid.lon - (at(A).lon + at(M).lon) / 2) < 1e-9, 'halfway through the leg, halfway along it');
  const quarter = positionOf(tt, legs, legs[0].dep + (legs[0].arr - legs[0].dep) / 4);
  assert.ok(Math.abs(quarter.lat - (at(A).lat * 0.75 + at(M).lat * 0.25)) < 1e-9, 'a quarter of the way');
  const done = positionOf(tt, legs, hm('09:30'));
  assert.deepEqual([done.lat, done.lon], [at(D).lat, at(D).lon]);
  const device = positionOf(tt, legs, hm('07:00'), { lat: 50.5, lon: 11.5 });
  assert.deepEqual([device.lat, device.lon, device.source], [50.5, 11.5, 'device']);
  assert.equal(positionOf(tt, legs, hm('07:00'), { lat: NaN, lon: 1 }).source, 'clock', 'a broken position is not used');
});

test('whatIf: from the station of the next train you have not boarded, with that train out', () => {
  const n = { ...nav(), legs };
  const before = whatIf(tt, n, hm('06:10'));
  assert.equal(before.src, A);
  assert.equal(before.next.line, 'RE6');
  assert.ok(!before.result.error);
  assert.equal(before.result.options[0].arr, hm('09:00'), 'the detour through Seitenweg: no later than planned');
  assert.ok(before.result.options.every(o => o.legs[0].line !== 'RE6'), 'the planned train is not among the ways');
  const riding = whatIf(tt, n, hm('06:40'));
  assert.equal(riding.src, M, 'while you ride, from the change station');
  assert.equal(riding.t0, hm('07:28'), 'at the minute you get there');
  assert.equal(riding.next.line, 'RE30');
  assert.equal(whatIf(tt, n, hm('08:50')), null, 'on the last train there is none ahead to be out');
  assert.equal(whatIf(tt, n, hm('09:30')), null, 'done');
});

test('whatIf keeps the runs already out, out', () => {
  const n = { ...nav(), legs, out: new Set([tt.tripKey(0, 6)]) };   // the RB to Seitenweg is out as well
  const r = whatIf(tt, n, hm('06:10'));
  assert.ok(r.result.options.every(o => !(o.legs[0].line === 'RB' && o.legs[0].dep === hm('06:40'))), 'no way starts with the 06:40 RB to Seitenweg');
  assert.equal(r.result.options[0].arr, hm('10:00'));
});

test('the map draws the route bold, the old plan dotted, the ways coloured and you, with the same positions for the same station', () => {
  const n = { ...nav(), legs };
  const wi = whatIf(tt, n, hm('06:10'));
  const me = positionOf(tt, legs, hm('06:10'));
  const model = graphOf(tt, wi.result, { ghost: [{ from: A, to: M }], active: legs.filter(l => !l.walk), me: { ...me, label: 'You are here' } });
  const svg = svgOf(model, { label: 'map' });
  assert.ok(svg.includes('class="e act"'), 'the route');
  assert.ok(svg.includes('class="e ghost"'), 'the plan before');
  assert.match(svg, /class="e (good|mid|bad)"/, 'the ways');
  assert.ok(svg.includes('class="me"') && svg.includes('class="me halo"'), 'you');
  assert.ok(svg.includes('>You are here<'), 'labelled');
  assert.ok(svg.lastIndexOf('class="e act"') > svg.lastIndexOf('class="e ghost"') && svg.lastIndexOf('class="e ghost"') > svg.indexOf('class="e good"'), 'route over plan over ways');
  assert.ok(svg.indexOf('class="me"') > svg.lastIndexOf('class="e act"'), 'you are drawn last');
  assert.ok(!/\sstyle\s*=/.test(svg));
});

test('the map copes with no ways at all: the route and you', () => {
  const stub = { options: [], src: A, dst: D, t0: hm('08:50'), baseKind: 'plan' };
  const svg = svgOf(graphOf(tt, stub, { active: legs.slice(2), me: { lat: 51.4, lon: 12.1, label: 'Here' } }), { label: 'map' });
  assert.ok(svg.includes('class="e act"') && svg.includes('class="me"'));
  assert.ok(!svg.includes('class="e good"') && !svg.includes('class="e bad"'));
});

test('where: the minute a train arrives you are at its station, waiting for the next; the minute one leaves you are on it', () => {
  const arrived = where(legs, legs[0].arr);
  assert.deepEqual([arrived.phase, arrived.i, arrived.leg.line, arrived.inMin], ['waiting', 1, 'RE30', hm('07:35') - hm('07:28')]);
  const leaving = where(legs, legs[1].dep);
  assert.deepEqual([leaving.phase, leaving.i, leaving.leg.line], ['riding', 1, 'RE30']);
  assert.equal(where(legs, legs[1].dep - 1).phase, 'waiting', 'a minute before it leaves you are still waiting');
});
