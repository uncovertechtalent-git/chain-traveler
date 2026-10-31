// The update flow of app/data-store.js: manifest check, download, sha256 verification, swap, rollback of a bad update.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore, UpdateError, validateManifest, compareManifest, describeAge, gunzip, sha256Hex, MAX_BYTES } from '../../app/data-store.js';
import { Timetable } from '../../app/engine.js';
import { FakeCaches, FakeCdn, BASE, makeBuild } from '../support/fake-browser.mjs';

const subtle = globalThis.crypto.subtle;
function setup() {
  const caches = new FakeCaches(), cdn = new FakeCdn();
  const store = new DataStore({ caches, fetch: cdn.fetch, subtle, base: BASE });
  return { caches, cdn, store };
}
const rejects = async (p, code) => assert.rejects(p, e => e instanceof UpdateError && e.code === code, 'expected UpdateError ' + code);
const b1 = makeBuild({ date: '2026-11-01' }), b2 = makeBuild({ date: '2026-11-02' }), b3 = makeBuild({ date: '2026-11-03' });

test('first launch: downloads, verifies, stores, and the build loads and routes', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  assert.equal(await store.load(), null);
  const r = await store.update();
  assert.equal(r.status, 'updated');
  assert.deepEqual(r.manifest, b1.manifest);
  const cur = await store.load();
  assert.deepEqual(cur.manifest, b1.manifest);
  const tt = new Timetable(cur.meta, await gunzip(cur.bin));
  const a = tt.find('Alpha Hbf'), d = tt.find('Delta Hbf');
  const plan = tt.plan({ day: 0, src: a, dst: d, t0: 5 * 60 + 45 });
  assert.ok(!plan.error, plan.error);
});

test('the manifest is requested without the HTTP cache', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  assert.equal(cdn.calls.find(c => c.path === 'data/latest.json').init.cache, 'no-store');
});

test('an online launch with nothing new downloads no data', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  const before = cdn.calls.length;
  const r = await store.update();
  assert.equal(r.status, 'current');
  assert.deepEqual(cdn.calls.slice(before).map(c => c.path), ['data/latest.json']);
});

test('a new build is downloaded, swapped in, and the old build is dropped afterwards', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  caches.log.length = 0;
  const r = await store.update();
  assert.equal(r.status, 'updated');
  assert.equal((await store.load()).manifest.date, '2026-11-02');
  const ops = caches.log;
  const pointerPut = ops.findIndex(o => o.startsWith('put ct-data-pointer'));
  const filePuts = ops.map((o, i) => (o.startsWith('put ct-data-2026-11-02') ? i : -1)).filter(i => i >= 0);
  const oldDelete = ops.findIndex(o => o.startsWith('delete ct-data-2026-11-01'));
  assert.equal(filePuts.length, 2);
  assert.ok(filePuts.every(i => i < pointerPut), 'both files are stored before the pointer moves');
  assert.ok(oldDelete > pointerPut, 'the old build is dropped only after the swap');
  assert.deepEqual(caches.names().filter(n => n !== 'ct-data-pointer').length, 1);
});

test('a corrupted download is refused and the old data stays in use', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  cdn.damage('data/2026-11-02/timetable.bin.gz', 'flip');
  await rejects(store.update(), 'verify');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
  assert.ok(!caches.names().some(n => n.startsWith('ct-data-2026-11-02')), 'the half-written build is removed');
});

test('a truncated download is refused by its length', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  cdn.damage('data/2026-11-01/timetable.bin.gz', 'truncate');
  await rejects(store.update(), 'verify');
  assert.equal(await store.load(), null);
});

test('a corrupted second file (meta.json) refuses the whole build', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  cdn.damage('data/2026-11-02/meta.json', 'flip');
  await rejects(store.update(), 'verify');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
  assert.ok(!caches.names().some(n => n.startsWith('ct-data-2026-11-02')));
});

test('a server that sends more bytes than the manifest promises is refused before hashing', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  const real = cdn.fetch;
  const store2 = new DataStore({ caches: new FakeCaches(), subtle, base: BASE,
    fetch: async (url, init) => { const r = await real(url, init); return url.endsWith('.gz') ? new Response(r.body, { headers: { 'content-length': String(b1.bin.length + 1000) } }) : r; } });
  await rejects(store2.update(), 'verify');
  void store;
});

test('offline: the check fails with a network error and the old data is untouched', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.offline = true;
  await rejects(store.update(), 'network');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('the connection drops during the download: the old data is untouched', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  cdn.failOn.set('data/2026-11-02/meta.json', 503);
  await rejects(store.update(), 'network');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
  assert.ok(!caches.names().some(n => n.startsWith('ct-data-2026-11-02')));
});

test('a malformed or newer-format manifest is refused and the old data stays', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  for (const bad of [{ ...b2.manifest, format: 2 }, { ...b2.manifest, sha256: 'xyz' }, { ...b2.manifest, date: '2026-13-45' }, { ...b2.manifest, bytes: 0 }, [], 'x']) {
    cdn.files.set('data/latest.json', Buffer.from(JSON.stringify(bad)));
    await rejects(store.update(), 'manifest');
  }
  cdn.files.set('data/latest.json', Buffer.from('<html>captive portal</html>'));
  await rejects(store.update(), 'manifest');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('a manifest that promises an absurd size is refused without a download', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  cdn.files.set('data/latest.json', Buffer.from(JSON.stringify({ ...b1.manifest, bytes: MAX_BYTES + 1 })));
  await rejects(store.update(), 'manifest');
  assert.equal(cdn.count('data/2026-11-01/timetable.bin.gz'), 0);
});

test('a full disk while storing leaves the old build and no half build', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  caches.failPut = (name, url) => name.startsWith('ct-data-2026-11-02') && url.endsWith('meta.json');
  await rejects(store.update(), 'storage');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
  assert.ok(!caches.names().some(n => n.startsWith('ct-data-2026-11-02')));
});

test('a failure writing the pointer keeps the old build', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  cdn.publish(b2);
  caches.failPut = name => name === 'ct-data-pointer';
  await rejects(store.update(), 'storage');
  caches.failPut = null;
  assert.equal((await store.load()).manifest.date, '2026-11-01');
  assert.ok(!caches.names().some(n => n.startsWith('ct-data-2026-11-02')));
});

test('a cached build that was changed on the device is not used', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  const build = [...caches.map.keys()].find(n => n.startsWith('ct-data-2026-11-01'));
  const entry = caches.map.get(build).entries;
  const key = [...entry.keys()].find(k => k.endsWith('timetable.bin.gz'));
  entry.get(key)[10] ^= 0xff;
  assert.equal(await store.load(), null);
  assert.deepEqual(caches.names(), [], 'the damaged build and its pointer are removed');
  cdn.offline = false;
  assert.equal((await store.update()).status, 'updated', 'the next online launch repairs it');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('a damaged cache is repaired by the update even when the manifest is unchanged', async () => {
  const { caches, cdn, store } = setup();
  cdn.publish(b1);
  await store.update();
  const entry = caches.map.get([...caches.map.keys()].find(n => n.startsWith('ct-data-2026-11-01'))).entries;
  entry.get([...entry.keys()].find(k => k.endsWith('meta.json')))[5] ^= 0xff;
  assert.equal((await store.update()).status, 'updated');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('the app follows a rollback: an older published build replaces a newer one', async () => {
  const { cdn, store } = setup();
  cdn.publish(b2);
  await store.update();
  cdn.publish(b1);
  assert.equal((await store.update()).status, 'updated');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('two update calls at once share one run', async () => {
  const { cdn, store } = setup();
  cdn.publish(b1);
  const [a, b] = await Promise.all([store.update(), store.update()]);
  assert.equal(a, b);
  assert.equal(cdn.count('data/latest.json'), 1);
  assert.equal(cdn.count('data/2026-11-01/timetable.bin.gz'), 1);
});

test('three builds in a row leave exactly one build and the pointer', async () => {
  const { caches, cdn, store } = setup();
  for (const b of [b1, b2, b3]) { cdn.publish(b); await store.update(); }
  assert.equal(caches.names().length, 2);
  assert.equal((await store.load()).manifest.date, '2026-11-03');
});

test('compareManifest: same only when date and both hashes agree', () => {
  assert.equal(compareManifest(null, b1.manifest), 'different');
  assert.equal(compareManifest(b1.manifest, b1.manifest), 'same');
  assert.equal(compareManifest(b1.manifest, b2.manifest), 'different');
  assert.equal(compareManifest(b1.manifest, { ...b1.manifest, sha256: 'f'.repeat(64) }), 'different');
  assert.equal(compareManifest(b1.manifest, { ...b1.manifest, metaSha256: 'f'.repeat(64) }), 'different');
});

test('validateManifest accepts what the pipeline writes', () => {
  assert.equal(validateManifest(b1.manifest), b1.manifest);
});

test('sha256Hex matches a known digest', async () => {
  assert.equal(await sha256Hex(subtle, new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('describeAge: ok, soon, last day, expired', () => {
  const m = { firstDate: '2026-11-01', nDays: 31, date: '2026-11-01' };     // last day 2026-12-01
  assert.deepEqual([describeAge(m, '2026-11-10').level, describeAge(m, '2026-11-10').last], ['ok', '2026-12-01']);
  assert.equal(describeAge(m, '2026-11-27').level, 'ok');
  assert.equal(describeAge(m, '2026-11-28').level, 'soon');
  assert.match(describeAge(m, '2026-12-01').text, /last day/);
  assert.equal(describeAge(m, '2026-12-01').level, 'soon');
  const gone = describeAge(m, '2026-12-02');
  assert.equal(gone.level, 'expired');
  assert.match(gone.text, /ended on 2026-12-01/);
});
