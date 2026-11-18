// "I bring": a bicycle, a folding bicycle or an e-scooter adds minutes to every change, everywhere the scan runs, and is kept
// on the device. The corridor timetables here have one change whose length is the thing under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timetable } from '../../app/engine.js';
import { plan, ways, contextOf } from '../../app/planb.js';
import { replan, whatIf } from '../../app/navigate.js';
import {
  ITEMS, EXTRA_MIN, NOTHING_EXTRA_MIN, BICYCLE_EXTRA_MIN, FOLDING_EXTRA_MIN, SCOOTER_EXTRA_MIN, NOTES, STORE_KEY,
  normalizeItem, extraMin, noteKeys, changeTime, loadItem, saveItem,
} from '../../app/bring.js';
import { buildFixture, hm } from '../support/fixture.mjs';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const read = f => fs.readFileSync(path.join(appDir, f), 'utf8');
const en = (await import(path.join(appDir, 'locales', 'en.js'))).default;

// Start Hbf -> Mitte (06:00 to 06:30), then Mitte -> Ziel Hbf leaving `gap` minutes after the first arrives.
const DAY0 = 0b1;      // the trips run on the first day only, so a change that is too short has no later way round
const stations = [
  { name: 'Start Hbf', lat: 52.4, lon: 10.8 },    // 0
  { name: 'Mitte', lat: 52.1, lon: 11.6 },        // 1
  { name: 'Ziel Hbf', lat: 51.3, lon: 12.4 },     // 2
];
function corridor(gap) {
  const leave = 30 + gap;     // minutes after 06:00
  const at = m => `${String(6 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const trips = [
    { line: 0, term: 1, svc: DAY0, stops: [{ st: 0, arr: hm('06:00'), dep: hm('06:00') }, { st: 1, arr: hm('06:30'), dep: hm('06:30') }] },
    { line: 1, term: 2, svc: DAY0, stops: [{ st: 1, arr: hm(at(leave)), dep: hm(at(leave)) }, { st: 2, arr: hm(at(leave + 30)), dep: hm(at(leave + 30)) }] },
  ];
  const { meta, buf } = buildFixture({ stations, lines: ['RE1', 'RE2'], trips });
  return new Timetable(meta, buf);
}
const [S, M, Z] = [0, 1, 2];
const BASE = 4;   // the box "Minimum change" as it ships

// What a scan is asked for with each thing brought, from the same function the page uses.
const asked = item => changeTime(BASE, item);
const reached = (tt, item) => plan(tt, { day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: asked(item) }).options.length > 0;
const chained = (tt, item) => !tt.plan({ day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: asked(item) }).error;

test('the extra minutes are named constants in one place, and nothing adds nothing', () => {
  assert.deepEqual([NOTHING_EXTRA_MIN, BICYCLE_EXTRA_MIN, FOLDING_EXTRA_MIN, SCOOTER_EXTRA_MIN], [0, 4, 2, 2]);
  assert.deepEqual(EXTRA_MIN, { none: NOTHING_EXTRA_MIN, bike: BICYCLE_EXTRA_MIN, folding: FOLDING_EXTRA_MIN, scooter: SCOOTER_EXTRA_MIN });
  assert.deepEqual(ITEMS, ['none', 'bike', 'folding', 'scooter']);
  for (let base = 0; base <= 20; base++) assert.equal(changeTime(base, 'none'), base, 'nothing brought: the box as it is');
  assert.deepEqual(ITEMS.map(i => changeTime(4, i)), [4, 8, 6, 6]);
  assert.equal(changeTime(0, 'bike'), 4, 'a minimum of 0 still gets the extra');
});

test('anything that is not one of the four items is nothing', () => {
  for (const v of [undefined, null, '', 'car', 'BIKE', 1, {}, [], 'bike '] ) assert.equal(normalizeItem(v), 'none', String(v));
  assert.equal(extraMin('car'), 0);
  assert.equal(changeTime('x', 'bike'), 4, 'a box that is not a number counts as 0');
  assert.equal(changeTime(-3, 'scooter'), 2, 'a negative box counts as 0');
  assert.equal(changeTime('5', 'folding'), 7, 'the box holds text');
});

test('a chain that works with 4 minutes and fails with 8 is found with nothing and not found with a bicycle', () => {
  const tt = corridor(6);    // a change of 6 minutes at Mitte
  assert.equal(chained(tt, 'none'), true, 'found with nothing (4 minutes)');
  assert.equal(chained(tt, 'bike'), false, 'not found with a bicycle (8 minutes)');
  assert.equal(chained(tt, 'folding'), true, '6 minutes are enough for 6');
  assert.equal(chained(tt, 'scooter'), true);
  assert.equal(reached(tt, 'none'), true, 'Plan B: found with nothing');
  assert.equal(reached(tt, 'bike'), false, 'Plan B: not found with a bicycle');
  const res = plan(tt, { day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: asked('bike') });
  assert.equal(res.code, 'noWay');
});

test('each item turns away exactly the changes shorter than its minimum', () => {
  // columns: none (needs 4), bicycle (8), folding bicycle (6), e-scooter (6)
  const expect = { 3: [false, false, false, false], 4: [true, false, false, false], 5: [true, false, false, false], 6: [true, false, true, true], 7: [true, false, true, true], 8: [true, true, true, true] };
  for (const [gap, want] of Object.entries(expect)) {
    const tt = corridor(+gap);
    assert.deepEqual(ITEMS.map(i => chained(tt, i)), want, `a change of ${gap} min, for ${ITEMS.join(', ')}`);
    assert.deepEqual(ITEMS.map(i => reached(tt, i)), want, `Plan B, a change of ${gap} min`);
  }
});

test('the reach map: a station behind a short change is reached with nothing and not with a bicycle', () => {
  const tt = corridor(6);
  const arr = item => tt.earliestArrival({ day: 0, src: S, t0: hm('05:50'), minTransfer: asked(item) }).arr[Z];
  assert.equal(arr('none'), hm('07:06'));
  assert.ok(arr('bike') >= 2 ** 30, 'not reached with a bicycle (INF)');
});

// Every function that starts a scan is called with what the page hands over, and the scan must see exactly that.
function spy(tt) {
  const seen = [];
  const real = tt.earliestArrival.bind(tt);
  tt.earliestArrival = o => { seen.push(o.minTransfer); return real(o); };
  return seen;
}

test('the change time of the page reaches earliestArrival in every caller', () => {
  for (const item of ITEMS) {
    const want = asked(item);
    const ask = (name, run) => {
      const tt = corridor(20);      // a long change, so every caller finds a chain and scans more than once
      const seen = spy(tt);
      run(tt);
      assert.ok(seen.length > 0, `${name}: no scan`);
      assert.deepEqual([...new Set(seen)], [want], `${name} with ${item}: the scans saw ${[...new Set(seen)]}, the page said ${want}`);
    };
    const q = { day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: want };
    ask('chain (Timetable.plan)', tt => tt.plan({ day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: want }));
    ask('chain with a stop-over', tt => tt.plan({ day: 0, src: S, dst: Z, via: M, stayMin: 10, t0: hm('05:50'), minTransfer: want }));
    ask('Plan B ways', tt => ways(tt, q));
    ask('Plan B plan', tt => plan(tt, q));
    ask('Plan B network', tt => contextOf(tt, { day: 0, src: S, t0: hm('05:50'), minTransfer: want }));
    ask('reach map', tt => tt.earliestArrival({ day: 0, src: S, t0: hm('05:50'), minTransfer: want }));
    // Navigate: the chain being followed is planned first (with the same change time), then the scan under test runs
    const followed = tt => {
      const legs = plan(tt, { day: 0, src: S, dst: Z, t0: hm('05:50'), minTransfer: want }).options[0].legs;
      return { day: 0, dst: Z, plannedArr: legs[legs.length - 1].arr, out: new Set(), legs };
    };
    ask('Navigate whatIf', tt => whatIf(tt, followed(tt), hm('05:55'), want));
    ask('Navigate replan', tt => replan(tt, followed(tt), { now: hm('05:55'), src: S, minTransfer: want }));
  }
});

test('with nothing brought every result is the one of today', () => {
  const tt = corridor(20);
  const today = { day: 0, src: S, dst: Z, t0: hm('05:50') };      // no minTransfer: the default of 4
  const mine = { ...today, minTransfer: changeTime(BASE, 'none') };
  assert.deepEqual(plan(tt, mine), plan(tt, today));
  assert.deepEqual(ways(tt, mine), ways(tt, today));
  assert.deepEqual(tt.plan(mine), tt.plan(today));
  const a = tt.earliestArrival({ ...mine, t0: hm('05:50') }), b = tt.earliestArrival({ day: 0, src: S, t0: hm('05:50') });
  assert.deepEqual([...a.arr], [...b.arr]);
  assert.deepEqual(contextOf(tt, { day: 0, src: S, t0: hm('05:50'), minTransfer: changeTime(BASE, 'none') }), contextOf(tt, { day: 0, src: S, t0: hm('05:50') }));
});

// A storage that keeps strings, as localStorage does. A new object over the same map is a page loaded again.
const store = (map = new Map()) => ({ getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map });

test('the setting survives a reload, and a page with nothing stored brings nothing', () => {
  const map = new Map();
  assert.equal(loadItem(store(map)), 'none', 'first visit');
  for (const item of ITEMS) {
    saveItem(item, store(map));
    assert.equal(map.get(STORE_KEY), item);
    assert.equal(loadItem(store(map)), item, `reloaded with ${item}`);
  }
  saveItem('bike', store(map));
  saveItem('car', store(map));
  assert.equal(loadItem(store(map)), 'none', 'a value that is not an item is not kept');
});

test('a damaged, missing or failing store never breaks the page', () => {
  assert.equal(loadItem(store(new Map([[STORE_KEY, '{"x":1}']]))), 'none', 'junk');
  assert.equal(loadItem(store(new Map([[STORE_KEY, 'BIKE']]))), 'none', 'case matters');
  assert.equal(loadItem({ getItem() { throw new Error('SecurityError'); } }), 'none', 'storage that throws');
  assert.equal(loadItem(null), 'none', 'no storage at all');
  assert.doesNotThrow(() => saveItem('bike', { setItem() { throw new Error('QuotaExceededError'); } }));
  assert.doesNotThrow(() => saveItem('bike', null));
});

test('the notes: none for nothing, general ones for each item, all in English', () => {
  assert.deepEqual(noteKeys('none'), []);
  assert.deepEqual(noteKeys('car'), [], 'an unknown item has no notes');
  for (const item of ITEMS.filter(i => i !== 'none')) {
    assert.ok(noteKeys(item).length > 0, item);
    for (const k of noteKeys(item)) assert.ok(typeof en[k] === 'string' && en[k].length > 0, `${item}: ${k} is in English`);
  }
  assert.ok(en['bring.note.lead'] && en['bring.note.label'] && en['bring.hint'], 'lead, label and hint');
  assert.deepEqual(Object.keys(NOTES).sort(), [...ITEMS].sort());
});

test('the notes say nothing about a particular train', () => {
  const all = [...Object.values(NOTES).flat().map(k => en[k]), en['bring.note.lead']].join(' ');
  assert.ok(!/\b(RE|RB|S)\s?\d+\b/.test(all), 'no line name');
  assert.ok(!/\b(always|never|every train|all trains)\b/i.test(all), 'no absolute: the timetable has no data on this');
});

test('the page: one box in the bar with a label and four options; one place adds the item to the change time', () => {
  const html = read('index.html');
  assert.match(html, /<label[^>]*>\s*<span data-i18n="field\.bring">[^<]*<\/span>\s*<select id="bring">/, 'the box has a visible label around it');
  const options = [...html.matchAll(/<option value="(\w+)" data-i18n="(bring\.\w+)">/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(options, ITEMS.map(i => [i, 'bring.' + i]));
  assert.match(html, /id="bringhint"[^>]*aria-live="polite"/, 'the extra time is said politely to a screen reader');
  const app = read('app.js');
  const reads = app.split('\n').filter(l => l.includes("#tr').value"));
  assert.equal(reads.length, 3, 'the box is read in three places: persist, restore and the change time\n' + reads.join('\n'));
  assert.equal(reads.filter(l => l.includes('changeTime(')).length, 1, 'only transferMin adds the item');
  assert.match(app, /const changedTime = \(\) => \{ persist\(\); paintBring\(\); nav\.refresh\(\); renderTab\(\); \};/, 'one handler for the change time');
  assert.match(app, /\$\('#tr'\)\.addEventListener\('change', changedTime\)/, 'a changed "Minimum change" draws the line under the box, the card of Navigate and the tab');
  assert.match(app, /saveItem\(bring\); changedTime\(\);/, 'a changed item does the same');
  assert.match(app, /tr: transferMin\(\)/, 'the chain and the reach map take their change time from transferMin');
  assert.match(app, /initLive\(\{[^}]*minTransfer: transferMin/, 'Plan B');
  assert.match(app, /initNavigate\(\{[^}]*minTransfer: transferMin/, 'Navigate');
});

test('Plan B and Navigate hand the change time of the page to every scan they start', () => {
  const live = read('live.js'), nav = read('navigate.js');
  assert.match(live, /plan\(tt, \{[^}]*minTransfer: minTransfer\(\) \}\)/, 'the ways on');
  assert.match(live, /const ask = \{[^}]*minTransfer: minTransfer\(\)/, 'the network around you');
  assert.match(nav, /replan\(tt, nav, \{[^}]*minTransfer: minTransfer\(\) \}\)/, 'a recalculation');
  assert.match(nav, /whatIf\(tt, nav, n, minTransfer\(\)\)/, 'the ways around the route');
  assert.match(nav, /Math\.floor\(n \/ 3\), minTransfer\(\)\]/, 'a changed setting is not answered from the ways worked out before');
});
