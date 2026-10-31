// Feed tests: the engine against the real national timetable in app/data (built by scripts/fetch-feed.sh).
// The timetable workflow runs them on every build before anything is published; run them locally after a build:
//   npm run test:feed
// The days come from the data (a Wednesday and a Friday inside the window), the bounds are generous ceilings.
// Reference chains read from the OEBB Scotty regional-only timetable on 2026-10-31 (Wednesday 18 and Friday 20
// November 2026): Wolfsburg 06:23 to Leipzig 09:27 and to München 16:16, München to Wolfsburg via Nürnberg
// with a 3 h stay arriving 20:44, Wolfsburg to München via Leipzig with a 3 h stay arriving 20:16.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Timetable, fmt, INF } from '../../app/engine.js';

// The data directory is laid out as on the CDN: latest.json names the dated build next to it. CT_DATA_DIR overrides app/data.
const dataDir = process.env.CT_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'data');
const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8'));
const dir = path.join(dataDir, manifest.date);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'timetable.bin.gz')));
const tt = new Timetable(meta, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const st = name => { const i = tt.find(name); assert.ok(i >= 0, 'station not found: ' + name); return i; };
const min = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);

// First day at least `from` days into the window that falls on weekday `wd` (0 = Sunday), with room to scan on.
function dayOn(wd, from = 3) {
  for (let d = from; d < tt.nDays - 3; d++) {
    if (new Date(tt.dateOf(d) + 'T12:00:00Z').getUTCDay() === wd) return d;
  }
  assert.fail('no weekday ' + wd + ' in the window');
}
const wednesday = dayOn(3), friday = dayOn(5);

test('the feed is a usable window: stations, connections and days', () => {
  assert.ok(tt.nStations >= 5000, 'stations ' + tt.nStations);
  assert.ok(tt.nConn >= 1000000, 'connections ' + tt.nConn);
  assert.ok(tt.nDays >= 14, 'days ' + tt.nDays);
  assert.ok(meta.feed.sha256 && /^[0-9a-f]{64}$/.test(meta.feed.sha256), 'feed sha256 recorded');
});

test('the build matches its manifest byte for byte', () => {
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  assert.equal(sha('timetable.bin.gz'), manifest.sha256);
  assert.equal(sha('meta.json'), manifest.metaSha256);
  assert.equal(fs.statSync(path.join(dir, 'timetable.bin.gz')).size, manifest.bytes);
  assert.equal(manifest.firstDate, meta.firstDate);
  assert.equal(manifest.nDays, meta.nDays);
});

test('the window starts no more than three days before today', () => {
  const ageDays = (Date.now() - Date.parse(meta.firstDate + 'T00:00:00Z')) / 86400000;
  assert.ok(ageDays <= 3, 'the feed starts ' + ageDays.toFixed(1) + ' days ago; it is regenerated daily');
});

test('Wolfsburg to Leipzig from 06:00 on a Wednesday arrives the same morning', () => {
  const r = tt.earliestArrival({ day: wednesday, src: st('Wolfsburg Hbf'), t0: min('06:00'), minTransfer: 4 });
  const arr = Math.min(r.arr[st('Leipzig Hbf')], r.arr[st('Leipzig Hbf (tief)')]);
  assert.ok(arr < INF && arr <= min('12:30'), 'arrival ' + fmt(arr));
});

test('Wolfsburg to München from 06:00 on a Wednesday arrives the same evening', () => {
  const res = tt.plan({ day: wednesday, src: st('Wolfsburg Hbf'), dst: st('München Hbf'), t0: min('06:00') });
  assert.ok(!res.error, res.error);
  const last = res.legs[res.legs.length - 1];
  assert.ok(last.arr <= min('20:00'), 'arrival ' + fmt(last.arr));
});

test('München to Wolfsburg via Nürnberg on a Friday, 3 h stay, arrives the same day', () => {
  const res = tt.plan({ day: friday, src: st('München Hbf'), dst: st('Wolfsburg Hbf'), via: st('Nürnberg Hbf'), t0: min('09:00'), stayMin: 180 });
  assert.ok(!res.error, res.error);
  const last = res.legs[res.legs.length - 1];
  assert.ok(last.arr < 1440, 'arrival ' + fmt(last.arr));
  const stay = res.stays[0];
  assert.ok(stay.dep - stay.arr >= 180, 'stay ' + (stay.dep - stay.arr));
});

test('Wolfsburg to München via Leipzig on a Wednesday, 3 h stay, arrives the same day', () => {
  const res = tt.plan({ day: wednesday, src: st('Wolfsburg Hbf'), dst: st('München Hbf'), via: st('Leipzig Hbf'), t0: min('06:00'), stayMin: 180 });
  assert.ok(!res.error, res.error);
  const last = res.legs[res.legs.length - 1];
  assert.ok(last.arr < 1440, 'arrival ' + fmt(last.arr));
});

test('footpath links Leipzig Hbf and Leipzig Hbf (tief)', () => {
  const a = st('Leipzig Hbf'), b = st('Leipzig Hbf (tief)');
  let found = false;
  for (let k = tt.fpStart[a]; k < tt.fpStart[a + 1]; k++) if (tt.fpTo[k] === b) found = true;
  assert.ok(found);
});

test('departures at Wolfsburg after 06:00 on a Wednesday are listed in time order', () => {
  const d = tt.departures({ day: wednesday, station: st('Wolfsburg Hbf'), t: min('06:00'), limit: 12 });
  assert.ok(d.length >= 6, 'departures ' + d.length);
  for (let i = 0; i < d.length; i++) {
    assert.ok(d[i].dep >= min('06:00'));
    if (i > 0) assert.ok(d[i].dep >= d[i - 1].dep);
  }
});

test('a train that crosses midnight is found (late departure on a Friday)', () => {
  const r = tt.earliestArrival({ day: friday, src: st('München Hbf'), t0: min('22:30'), minTransfer: 4 });
  const reach = [...r.arr].filter(x => x < INF).length;
  assert.ok(reach > 20, 'reachable ' + reach);
});

test('station search ranks the main station first', () => {
  const hits = tt.search('muenchen hbf', 3).map(i => tt.names[i]);
  assert.equal(hits[0], 'München Hbf');
});
