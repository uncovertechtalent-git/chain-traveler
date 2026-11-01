// The live delays overlay (app/delays.js): the file is checked before use, a run without data shows nothing (and never
// reads as on time), a stale or foreign file counts as no file, and the routing is the same with and without delays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timetable } from '../../app/engine.js';
import { Delays, DelaysError, checkDelays, fetchDelays, describe, paintRt, rtMark, rtNote, useDelays, haveDelays, delaysInfo, clock, PATH, MAX_AGE_MS, MAX_BYTES } from '../../app/delays.js';
import { sampleNetwork, hm } from '../support/fixture.mjs';

const NOW = Date.parse('2026-11-01T11:20:00Z');
const MANIFEST = { date: '2026-11-01', sha256: 'ab'.repeat(32) };
const stamp = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function file(over = {}) {
  return {
    format: 1, built: stamp(NOW), feedTime: stamp(NOW - 30000),
    source: { publisher: 'gtfs.de, realtime stream (GTFS-Realtime, beta)', license: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)', changes: 'cut' },
    timetable: { date: '2026-11-01', sha256: 'ab'.repeat(32) },
    trips: { '2026-11-01': { delay: { 7: 12, 9: 0, 11: -2, 13: 40 }, cancelled: [3], skipped: { 15: 2 } } },
    ...over,
  };
}
const check = (d, now = NOW) => checkDelays(d, { manifest: MANIFEST, now });
const refuses = (d, why, now = NOW) => assert.throws(() => check(d, now), e => e instanceof DelaysError, why);

test('a good file answers per service day and trip number', () => {
  const d = check(file());
  assert.deepEqual(d.of('2026-11-01', 7), { cancelled: false, min: 12, skipped: 0 });
  assert.deepEqual(d.of('2026-11-01', 9), { cancelled: false, min: 0, skipped: 0 });
  assert.deepEqual(d.of('2026-11-01', 11), { cancelled: false, min: -2, skipped: 0 });
  assert.deepEqual(d.of('2026-11-01', 3), { cancelled: true, min: null, skipped: 0 });
  assert.deepEqual(d.of('2026-11-01', 15), { cancelled: false, min: null, skipped: 2 });
  assert.equal(d.feedTime, NOW - 30000);
  assert.match(d.source.license, /CC BY-SA 4\.0/);
});

test('a run the file does not mention has no data: null, which is not on time', () => {
  const d = check(file());
  assert.equal(d.of('2026-11-01', 8), null);          // not listed
  assert.equal(d.of('2026-11-02', 7), null);          // the same trip number on another day
  assert.equal(d.of('2026-10-31', 7), null);
  assert.equal(d.of('2026-11-01', '7'), null, 'trip numbers are numbers');
});

test('a delay of zero is data: on time is only said for a run that has an entry', () => {
  const d = check(file());
  assert.equal(d.of('2026-11-01', 9).min, 0);
  assert.equal(d.of('2026-11-01', 10), null);
});

test('a file made for another timetable build is not used: trip numbers are per build', () => {
  refuses(file({ timetable: { date: '2026-11-01', sha256: 'cd'.repeat(32) } }), 'other sha256');
  refuses(file({ timetable: { date: '2026-10-31', sha256: 'ab'.repeat(32) } }), 'other date');
  refuses(file({ timetable: {} }), 'no build named');
  refuses(file({ timetable: undefined }), 'no timetable');
});

test('a file whose stream is older than fifteen minutes is stale: no data', () => {
  check(file({ feedTime: stamp(NOW - MAX_AGE_MS) }));
  refuses(file({ feedTime: stamp(NOW - MAX_AGE_MS - 1000) }), 'a second too old');
  refuses(file({ feedTime: stamp(NOW - 3600 * 1000) }), 'an hour old');
});

test('the age is the stream timestamp, not the time the file was made', () => {
  refuses(file({ built: stamp(NOW), feedTime: stamp(NOW - 20 * 60000) }), 'built now from an old stream');
});

test('a file dated ahead of the clock is not trusted either', () => {
  check(file({ feedTime: stamp(NOW + 5 * 60000) }));
  refuses(file({ feedTime: stamp(NOW + 5 * 60000 + 1000) }), 'six minutes ahead');
});

test('fresh() follows the clock, so a file ages out while the page stays open', () => {
  const d = check(file());
  assert.equal(d.fresh(NOW), true);
  assert.equal(d.fresh(NOW - 30000 + MAX_AGE_MS), true);
  assert.equal(d.fresh(NOW - 30000 + MAX_AGE_MS + 1), false);
});

test('malformed files are refused', () => {
  const day = x => ({ trips: { '2026-11-01': { delay: {}, cancelled: [], skipped: {}, ...x } } });
  const bad = {
    'not an object': null, 'an array': [], 'format 2': file({ format: 2 }), 'no format': file({ format: undefined }),
    'built missing': file({ built: undefined }), 'feedTime not UTC': file({ feedTime: '2026-11-01 11:19:30' }), 'feedTime nonsense': file({ feedTime: '2026-13-45T99:00:00Z' }),
    'no source': file({ source: undefined }), 'empty license': file({ source: { publisher: 'x', license: '' } }), 'license not a string': file({ source: { publisher: 'x', license: 5 } }),
    'trips missing': file({ trips: undefined }), 'trips an array': file({ trips: [] }),
    'day not a date': file({ trips: { yesterday: { delay: {}, cancelled: [], skipped: {} } } }), 'day impossible': file({ trips: { '2026-02-30': { delay: {}, cancelled: [], skipped: {} } } }),
    'day without parts': file({ trips: { '2026-11-01': { delay: {} } } }), 'day null': file({ trips: { '2026-11-01': null } }),
    'delay as array': file(day({ delay: [] })), 'delay key not a number': file(day({ delay: { x: 1 } })), 'delay key negative': file(day({ delay: { '-1': 1 } })),
    'delay a string': file(day({ delay: { 1: '5' } })), 'delay fractional': file(day({ delay: { 1: 1.5 } })), 'delay beyond a day': file(day({ delay: { 1: 2000 } })),
    'cancelled a string': file(day({ cancelled: ['3'] })), 'cancelled negative': file(day({ cancelled: [-3] })), 'cancelled an object': file(day({ cancelled: {} })),
    'skipped zero': file(day({ skipped: { 1: 0 } })), 'skipped key not a number': file(day({ skipped: { a: 1 } })),
  };
  for (const [name, d] of Object.entries(bad)) refuses(d, name);
});

test('keys that could reach the prototype are plain data, not a way in', () => {
  refuses(file({ trips: { '2026-11-01': { delay: JSON.parse('{"__proto__": 5}'), cancelled: [], skipped: {} } } }), '__proto__ as a trip number');
  const d = check(file());
  assert.equal(d.of('__proto__', 1), null);
  assert.equal(d.of('constructor', 1), null);
});

// ---- the fetch

const okResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const BASE = 'https://app.test/';

test('fetchDelays asks for data/delays.json of its own origin, past every cache', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return okResponse(file()); };
  const d = await fetchDelays({ fetch, base: BASE, manifest: MANIFEST, now: NOW });
  assert.ok(d instanceof Delays);
  assert.deepEqual(calls, [{ url: 'https://app.test/data/delays.json', init: { cache: 'no-store' } }]);
  assert.equal(PATH, 'data/delays.json');
});

test('fetchDelays resolves null, never throws, for anything that goes wrong', async () => {
  const cases = {
    'offline': async () => { throw new TypeError('Failed to fetch'); },
    'not published': async () => okResponse('', 404),
    'server error': async () => okResponse('', 503),
    'an error page with status 200': async () => okResponse('<html>maintenance</html>'),
    'truncated JSON': async () => okResponse('{"format":1,"tri'),
    'stale': async () => okResponse(file({ feedTime: stamp(NOW - 3600000) })),
    'another build': async () => okResponse(file({ timetable: { date: '2026-10-30', sha256: 'cd'.repeat(32) } })),
    'a body that is not text': async () => ({ ok: true, status: 200, text: async () => { throw new Error('stream error'); } }),
    'too large, though it would parse': async () => okResponse(JSON.stringify(file()) + ' '.repeat(MAX_BYTES)),
    'a good body with an error status': async () => okResponse(file(), 500),
    'null': async () => okResponse('null'),
  };
  for (const [name, fetch] of Object.entries(cases)) {
    assert.equal(await fetchDelays({ fetch, base: BASE, manifest: MANIFEST, now: NOW }), null, name);
  }
});

// ---- the overlay on a timetable

// The sample network: Alpha-Beta-Gamma on RE1 (trip 0), Gamma-Delta on RB2 (trip 1), Beta-Delta on RE3 (trip 2, day 0 only).
function chain() {
  const { meta, buf } = sampleNetwork();
  const tt = new Timetable(meta, buf);
  const plan = tt.plan({ day: 0, src: tt.find('Alpha Hbf'), dst: tt.find('Delta Hbf'), t0: hm('05:45') });
  assert.ok(!plan.error, plan.error);
  return { tt, plan };
}
const ride = plan => plan.legs.filter(l => !l.walk);

class Mark {
  constructor(iso, trip) { this.dataset = { rt: `${iso}:${trip}` }; this.hidden = true; this.textContent = ''; this.className = 'rt'; this.title = ''; }
}
class Note { constructor() { this.hidden = true; this.textContent = ''; } }
const rootOf = (marks, notes = []) => ({ querySelectorAll: sel => (sel === '[data-rt]' ? marks : sel === '[data-rt-note]' ? notes : []) });

test('a chain: the legs with live data show it, the others show nothing', () => {
  const { tt, plan } = chain();
  const legs = ride(plan);
  assert.ok(legs.length >= 2, 'the chain has at least two rides');
  const iso = tt.dateOf(legs[0].svcDay);
  const marks = legs.map(l => new Mark(tt.dateOf(l.svcDay), l.trip));
  const notes = [new Note()];
  const days = {};
  days[iso] = { delay: { [legs[0].trip]: 12 }, cancelled: legs.length > 2 ? [legs[1].trip] : [], skipped: {} };
  useDelays(check(file({ trips: days }), NOW));
  paintRt(rootOf(marks, notes), NOW);
  assert.equal(marks[0].hidden, false);
  assert.equal(marks[0].textContent, '+12 min');
  assert.match(marks[0].className, /\bmid\b/);
  if (legs.length > 2) {
    assert.equal(marks[1].textContent, 'cancelled');
    assert.match(marks[1].className, /\bbad\b/);
  }
  const without = marks.filter((m, i) => i > (legs.length > 2 ? 1 : 0));
  for (const m of without) assert.deepEqual([m.hidden, m.textContent], [true, ''], 'no data, nothing shown: not "on time"');
  assert.equal(notes[0].hidden, false);
  assert.match(notes[0].textContent, /does not mean it is on time/);
  useDelays(null);
});

test('a run on time says so only when the file has an entry for it', () => {
  const { tt, plan } = chain();
  const [first, second] = ride(plan);
  const iso = tt.dateOf(first.svcDay);
  useDelays(check(file({ trips: { [iso]: { delay: { [first.trip]: 0 }, cancelled: [], skipped: {} } } }), NOW));
  const a = new Mark(iso, first.trip), b = new Mark(tt.dateOf(second.svcDay), second.trip);
  paintRt(rootOf([a, b]), NOW);
  assert.equal(a.textContent, 'on time');
  assert.match(a.className, /\bgood\b/);
  assert.equal(b.hidden, true);
  assert.equal(b.textContent, '');
  useDelays(null);
});

test('the routing is the same with and without delays: the overlay only annotates', () => {
  const { tt, plan } = chain();
  const before = JSON.stringify(plan.legs);
  const legs = ride(plan);
  useDelays(check(file({ trips: { [tt.dateOf(legs[0].svcDay)]: { delay: { [legs[0].trip]: 90 }, cancelled: [legs[1].trip], skipped: {} } } }), NOW));
  const again = tt.plan({ day: 0, src: tt.find('Alpha Hbf'), dst: tt.find('Delta Hbf'), t0: hm('05:45') });
  assert.equal(JSON.stringify(again.legs), before, 'a cancelled leg is still in the plan');
  useDelays(null);
});

test('the marks are looked up by the service day of the leg, so a train after midnight finds its own day', () => {
  const { meta, buf } = sampleNetwork();
  const tt = new Timetable(meta, buf);
  // RE5 Delta-Epsilon (trip 3) leaves 23:40 on day 0 and arrives 00:20 the next day
  const night = tt.plan({ day: 0, src: tt.find('Delta Hbf'), dst: tt.find('Epsilon Hbf'), t0: hm('23:30') });
  const leg = ride(night)[0];
  assert.equal(leg.svcDay, 0);
  const d = check(file({ trips: { '2026-11-01': { delay: { [leg.trip]: 7 }, cancelled: [], skipped: {} } } }), NOW);
  assert.equal(d.of(tt.dateOf(leg.svcDay), leg.trip).min, 7);
  assert.equal(d.of(tt.dateOf(leg.svcDay + 1), leg.trip), null, 'the next day is another run');
});

// ---- what the page draws

test('rtMark is an empty hidden placeholder with the run in a data attribute, nothing to escape, no style or handler', () => {
  const html = rtMark('2026-11-01', 1234);
  assert.equal(html, '<span class="rt" data-rt="2026-11-01:1234" hidden></span>');
  assert.ok(!/\sstyle\s*=|\son[a-z]+\s*=/i.test(html + rtNote()));
  assert.match(rtNote(), /data-rt-note hidden/);
});

test('the words of a mark: late, on time, early, cancelled, skipped, and the band', () => {
  assert.deepEqual(describe({ cancelled: false, min: 4, skipped: 0 }), { text: '+4 min', band: 'good' });
  assert.deepEqual(describe({ cancelled: false, min: 6, skipped: 0 }), { text: '+6 min', band: 'mid' });
  assert.deepEqual(describe({ cancelled: false, min: 29, skipped: 0 }), { text: '+29 min', band: 'mid' });
  assert.deepEqual(describe({ cancelled: false, min: 30, skipped: 0 }), { text: '+30 min', band: 'bad' });
  assert.deepEqual(describe({ cancelled: false, min: 65, skipped: 0 }), { text: '+1 h 05 min', band: 'bad' });
  assert.deepEqual(describe({ cancelled: false, min: 0, skipped: 0 }), { text: 'on time', band: 'good' });
  assert.deepEqual(describe({ cancelled: false, min: -3, skipped: 0 }), { text: '3 min early', band: 'good' });
  assert.deepEqual(describe({ cancelled: true, min: null, skipped: 0 }), { text: 'cancelled', band: 'bad' });
  assert.deepEqual(describe({ cancelled: true, min: 12, skipped: 3 }), { text: 'cancelled', band: 'bad' });
  assert.deepEqual(describe({ cancelled: false, min: null, skipped: 1 }), { text: '1 stop skipped', band: 'mid' });
  assert.deepEqual(describe({ cancelled: false, min: 2, skipped: 3 }), { text: '+2 min, 3 stops skipped', band: 'mid' });
  assert.deepEqual(describe({ cancelled: false, min: 40, skipped: 2 }), { text: '+40 min, 2 stops skipped', band: 'bad' });
});

test('a mark says that it is live data, in the tag and in the title with the time of the stream', () => {
  useDelays(check(file(), NOW));
  const m = new Mark('2026-11-01', 7);
  paintRt(rootOf([m]), NOW);
  assert.equal(m.dataset.live, 'live');
  assert.equal(m.title, `Live data from the gtfs.de realtime stream, as of ${clock(NOW - 30000)}. Routes are still planned on the timetable.`);
  assert.equal(clock(NOW - 30000), '12:19', 'Berlin time, 24-hour');
  useDelays(null);
});

test('delays that have gone stale are not drawn: the marks and the note go away with the clock', () => {
  useDelays(check(file(), NOW));
  const m = new Mark('2026-11-01', 7), n = new Note();
  paintRt(rootOf([m], [n]), NOW);
  assert.equal(m.hidden, false);
  paintRt(rootOf([m], [n]), NOW - 30000 + MAX_AGE_MS + 1000);
  assert.deepEqual([m.hidden, m.textContent, m.className, n.hidden, n.textContent], [true, '', 'rt', true, '']);
  assert.equal(haveDelays(NOW), true);
  assert.equal(haveDelays(NOW + MAX_AGE_MS), false);
  useDelays(null);
});

test('with no delays at all nothing is drawn, and the footer has nothing to attribute', () => {
  useDelays(null);
  const m = new Mark('2026-11-01', 7), n = new Note();
  paintRt(rootOf([m], [n]), NOW);
  assert.deepEqual([m.hidden, n.hidden], [true, true]);
  assert.equal(haveDelays(NOW), false);
  assert.equal(delaysInfo(), null);
});

test('while delays are in use the source and licence are at hand for the footer', () => {
  useDelays(check(file(), NOW));
  const info = delaysInfo();
  assert.match(info.source.publisher, /gtfs\.de/);
  assert.match(info.source.license, /CC BY-SA 4\.0/);
  assert.equal(info.feedTime, NOW - 30000);
  useDelays(null);
});

test('painting is repeatable and follows a replaced file', () => {
  const m = new Mark('2026-11-01', 7);
  useDelays(check(file(), NOW));
  paintRt(rootOf([m]), NOW);
  paintRt(rootOf([m]), NOW);
  assert.equal(m.textContent, '+12 min');
  useDelays(check(file({ trips: { '2026-11-01': { delay: { 7: 3 }, cancelled: [], skipped: {} } } }), NOW));
  paintRt(rootOf([m]), NOW);
  assert.equal(m.textContent, '+3 min');
  useDelays(check(file({ trips: {} }), NOW));
  paintRt(rootOf([m]), NOW);
  assert.deepEqual([m.hidden, m.textContent], [true, '']);
  useDelays(null);
});
