// Engine tests on a small in-memory timetable (test/support/fixture.mjs): deterministic, no feed, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timetable, fmt, INF } from '../../app/engine.js';
import { sampleNetwork, hm } from '../support/fixture.mjs';

const { meta, buf } = sampleNetwork();
const tt = new Timetable(meta, buf);
const st = name => { const i = tt.find(name); assert.ok(i >= 0, 'station not found: ' + name); return i; };
const lineOf = legs => legs.filter(l => !l.walk).map(l => l.line);

test('the fixture loads with the counts it was built with', () => {
  assert.equal(tt.nStations, 6);
  assert.equal(tt.nTrips, 8);
  assert.equal(tt.nFoot, 2);
  assert.equal(tt.dateOf(0), '2026-11-01');
  assert.equal(tt.dayIndex('2026-11-03'), 2);
});

test('earliest chain takes the faster of two ways and changes where it saves time', () => {
  const res = tt.plan({ day: 0, src: st('Alpha Hbf'), dst: st('Delta Hbf'), t0: hm('05:45') });
  assert.ok(!res.error, res.error);
  // Alpha 06:00 to Beta 07:00, then RE3 07:10 to Delta 08:50, beating RE1 + RB2 (09:00).
  assert.deepEqual(lineOf(res.legs), ['RE1', 'RE3']);
  assert.equal(res.legs.at(-1).arr, hm('08:50'));
});

test('a trip that does not run on the day is not used', () => {
  const res = tt.plan({ day: 1, src: st('Alpha Hbf'), dst: st('Delta Hbf'), t0: hm('05:45') });
  assert.ok(!res.error, res.error);
  assert.deepEqual(lineOf(res.legs), ['RE1', 'RB2']);
  assert.equal(res.legs.at(-1).arr, hm('09:00'));
});

test('staying on a train costs no change time', () => {
  const res = tt.plan({ day: 0, src: st('Alpha Hbf'), dst: st('Gamma Hbf'), t0: hm('05:45'), minTransfer: 30 });
  assert.ok(!res.error, res.error);
  assert.equal(res.legs.length, 1);
  assert.equal(res.legs[0].arr, hm('08:00'));
});

test('a change shorter than the minimum is refused', () => {
  const r = tt.earliestArrival({ day: 0, src: st('Alpha Hbf'), t0: hm('05:45'), minTransfer: 15 });
  // Both changes (10 min at Beta, 10 min at Gamma) are too short, so only RE8 at 10:30 is left.
  assert.equal(r.arr[st('Delta Hbf')], hm('12:00'));
});

test('a footpath continues the chain and needs no change time', () => {
  const res = tt.plan({ day: 0, src: st('Alpha Hbf'), dst: st('Epsilon Hbf'), t0: hm('05:45') });
  assert.ok(!res.error, res.error);
  assert.deepEqual(res.legs.map(l => l.walk ? 'walk' : l.line), ['RE1', 'RE3', 'walk', 'RB6']);
  assert.equal(res.legs.at(-1).arr, hm('10:00'));
});

test('a stop-over waits out the minimum stay, then chains onward', () => {
  const res = tt.plan({ day: 0, src: st('Alpha Hbf'), dst: st('Delta Hbf'), via: st('Beta Hbf'), t0: hm('05:45'), stayMin: 180 });
  assert.ok(!res.error, res.error);
  const stay = res.stays[0];
  assert.equal(stay.station, st('Beta Hbf'));
  assert.ok(stay.dep - stay.arr >= 180);
  assert.equal(res.legs.at(-1).arr, hm('12:00'));
});

test('a stop-over that cannot be left after the stay is an error, not a wrong chain', () => {
  const res = tt.plan({ day: 6, src: st('Alpha Hbf'), dst: st('Delta Hbf'), via: st('Beta Hbf'), t0: hm('05:45'), stayMin: 600 });
  assert.match(res.error, /onward connection/);
});

test('a train that crosses midnight arrives on the next day', () => {
  const r = tt.earliestArrival({ day: 0, src: st('Delta Hbf'), t0: hm('23:00'), minTransfer: 4 });
  assert.equal(r.arr[st('Epsilon Hbf')], 24 * 60 + 20);
  assert.equal(fmt(r.arr[st('Epsilon Hbf')]), '00:20+1');
});

test('a night train of the next service day is found from the evening before', () => {
  const r = tt.earliestArrival({ day: 0, src: st('Delta Hbf'), t0: hm('23:50'), minTransfer: 4 });
  assert.equal(r.arr[st('Epsilon Hbf')], 24 * 60 + 50);
});

test('an unreachable station stays at infinity', () => {
  const r = tt.earliestArrival({ day: 0, src: st('Epsilon Hbf'), t0: hm('06:00'), minTransfer: 4 });
  assert.equal(r.arr[st('Alpha Hbf')], INF);
  const res = tt.plan({ day: 0, src: st('Epsilon Hbf'), dst: st('Alpha Hbf'), t0: hm('06:00') });
  assert.match(res.error, /No connection/);
});

test('departures list boardable trains in time order', () => {
  const d = tt.departures({ day: 0, station: st('Beta Hbf'), t: hm('07:00'), limit: 3 });
  assert.deepEqual(d.map(x => x.line), ['RE1', 'RE3', 'RE8']);
  assert.deepEqual(d.map(x => x.dep), [hm('07:02'), hm('07:10'), hm('10:30')]);
});

test('station search ignores case, umlauts and the ue spelling', () => {
  assert.equal(tt.names[tt.search('delta sued', 1)[0]], 'Delta Süd');
  assert.equal(tt.names[tt.search('DELTA SUD', 1)[0]], 'Delta Süd');
  assert.equal(tt.names[tt.search('delta h', 1)[0]], 'Delta Hbf');
  assert.deepEqual(tt.search('', 3), []);
});

test('a file with the wrong magic is refused', () => {
  const bad = buf.slice(0);
  new Uint8Array(bad)[0] = 0x58;
  assert.throws(() => new Timetable(meta, bad), /bad timetable file/);
});
