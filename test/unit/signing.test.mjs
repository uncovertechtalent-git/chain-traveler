// The signature of the manifest, as the app checks it (app/data-store.js, app/keys.js): the canonical bytes agree with
// the Python that signs (a golden manifest made with build/manifest.py and openssl), a signature by a trusted key is
// accepted, everything else is refused before a byte of the build is downloaded, and an app with no keys behaves as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStore, UpdateError, validateManifest, canonicalManifest, verifySignature } from '../../app/data-store.js';
import { MANIFEST_KEYS } from '../../app/keys.js';
import { FakeCaches, FakeCdn, BASE, makeBuild } from '../support/fake-browser.mjs';

const subtle = globalThis.crypto.subtle;
const golden = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'support', 'signed-manifest.json'), 'utf8'));
const toBase64 = bytes => Buffer.from(bytes).toString('base64');
const rejects = async (p, code) => assert.rejects(p, e => e instanceof UpdateError && e.code === code, 'expected UpdateError ' + code);

async function newKey() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  const kid = Buffer.from(await subtle.digest('SHA-256', spki)).toString('hex').slice(0, 8);
  return { pair, spki: toBase64(spki), kid };
}
async function sign(manifest, key, kid = key.kid) {
  const m = { ...manifest, kid };
  delete m.sig;
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.pair.privateKey, canonicalManifest(m));
  return { ...m, sig: toBase64(new Uint8Array(sig)) };
}
const signedBuild = async (build, key, kid) => ({ ...build, manifest: await sign(build.manifest, key, kid) });
function setup(keys) {
  const caches = new FakeCaches(), cdn = new FakeCdn();
  return { caches, cdn, store: new DataStore({ caches, fetch: cdn.fetch, subtle, base: BASE, keys }) };
}
const b1 = makeBuild({ date: '2026-11-01' }), b2 = makeBuild({ date: '2026-11-02' });

test('the shipped key list is empty until a key exists: the app behaves as before signing', () => {
  assert.deepEqual(MANIFEST_KEYS, {});
});

test('golden: the browser makes the same canonical bytes as build/manifest.py, and verifies its openssl signature', async () => {
  assert.equal(new TextDecoder().decode(canonicalManifest(golden.manifest)), golden.canonical);
  await verifySignature(subtle, golden.manifest, { [golden.manifest.kid]: golden.spki });
  validateManifest(golden.manifest);
});

test('golden: a changed field, a changed signature or another key is refused', async () => {
  const keys = { [golden.manifest.kid]: golden.spki };
  for (const edit of [{ sha256: 'cd'.repeat(32) }, { bytes: 1 }, { date: '2026-11-02' }, { built: '2026-11-01T09:13:31Z' }]) {
    await rejects(verifySignature(subtle, { ...golden.manifest, ...edit }, keys), 'signature');
  }
  const sig = Buffer.from(golden.manifest.sig, 'base64');
  sig[10] ^= 1;
  await rejects(verifySignature(subtle, { ...golden.manifest, sig: sig.toString('base64') }, keys), 'signature');
  const other = await newKey();
  await rejects(verifySignature(subtle, golden.manifest, { [golden.manifest.kid]: other.spki }), 'signature');
});

test('the key id and the signature are part of what is signed', async () => {
  const k = await newKey();
  const m = await sign(b1.manifest, k);
  assert.notDeepEqual(canonicalManifest(m), canonicalManifest({ ...m, kid: '00000000' }));
  assert.deepEqual(canonicalManifest(m), canonicalManifest({ ...m, sig: 'x' }), 'sig is left out');
  await rejects(verifySignature(subtle, { ...m, kid: '00000000' }, { [k.kid]: k.spki, '00000000': k.spki }), 'signature');
});

test('validateManifest: kid and sig must have the shape the pipeline writes', () => {
  const ok = { ...b1.manifest, kid: '0123abcd', sig: Buffer.alloc(64, 1).toString('base64') };
  validateManifest(ok);
  for (const extra of [{ kid: 'XYZ' }, { kid: '0123ABCD' }, { kid: 5 }, { sig: 'short' }, { sig: Buffer.alloc(63).toString('base64') }, { sig: 7 }]) {
    assert.throws(() => validateManifest({ ...ok, ...extra }), e => e instanceof UpdateError && e.code === 'manifest', JSON.stringify(extra));
  }
});

test('verifySignature: no signature, an unknown key id and a prototype name are refused', async () => {
  const k = await newKey();
  const keys = { [k.kid]: k.spki };
  const m = await sign(b1.manifest, k);
  await rejects(verifySignature(subtle, b1.manifest, keys), 'signature');
  await rejects(verifySignature(subtle, { ...m, kid: '11111111' }, keys), 'signature');
  await rejects(verifySignature(subtle, { ...m, kid: 'constructor' }, keys), 'signature');
  await rejects(verifySignature(subtle, { ...m, kid: '__proto__' }, keys), 'signature');
  await rejects(verifySignature(subtle, { ...m, sig: undefined }, keys), 'signature');
  await rejects(verifySignature(subtle, m, { [k.kid]: 'not a key' }), 'signature');
});

test('an app with a key installs a build whose manifest is signed by it', async () => {
  const k = await newKey();
  const { cdn, store } = setup({ [k.kid]: k.spki });
  cdn.publish(await signedBuild(b1, k));
  const r = await store.update();
  assert.equal(r.status, 'updated');
  assert.equal((await store.load()).manifest.sig.length, 88, 'the signed manifest is what is stored');
});

test('an unsigned manifest is refused before any build file is downloaded, and the old data stays', async () => {
  const k = await newKey();
  const { cdn, store } = setup({ [k.kid]: k.spki });
  cdn.publish(await signedBuild(b1, k));
  await store.update();
  cdn.calls.length = 0;
  cdn.publish(b2);   // unsigned
  await rejects(store.update(), 'signature');
  assert.deepEqual(cdn.calls.map(c => c.path).filter(p => p !== 'data/latest.json'), [], 'only the manifest was fetched, no build file');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('a manifest signed by a key the app does not hold is refused', async () => {
  const mine = await newKey(), stranger = await newKey();
  const { cdn, store } = setup({ [mine.kid]: mine.spki });
  cdn.publish(await signedBuild(b1, stranger));
  await rejects(store.update(), 'signature');
  assert.equal(await store.load(), null);
});

test('a signed manifest whose fields were changed afterwards is refused (the hashes of another build swapped in)', async () => {
  const k = await newKey();
  const { cdn, store } = setup({ [k.kid]: k.spki });
  const signed = await signedBuild(b1, k);
  cdn.publish({ ...b2, manifest: { ...b2.manifest, kid: signed.manifest.kid, sig: signed.manifest.sig } });
  await rejects(store.update(), 'signature');
  assert.equal(await store.load(), null);
});

test('the key may be one of several: a rotation lists the old and the new key', async () => {
  const oldKey = await newKey(), newer = await newKey();
  const keys = { [oldKey.kid]: oldKey.spki, [newer.kid]: newer.spki };
  for (const k of [oldKey, newer]) {
    const { cdn, store } = setup(keys);
    cdn.publish(await signedBuild(b1, k));
    assert.equal((await store.update()).status, 'updated');
  }
});

test('a rollback is a signed older manifest, and it is accepted: the signature says who published, not which build is newer', async () => {
  const k = await newKey();
  const { cdn, store } = setup({ [k.kid]: k.spki });
  const older = await signedBuild(b1, k), newest = await signedBuild(b2, k);
  cdn.publish(older); cdn.publish(newest);
  await store.update();
  cdn.point(older);
  assert.equal((await store.update()).status, 'updated');
  assert.equal((await store.load()).manifest.date, '2026-11-01');
});

test('an app with no keys takes signed and unsigned manifests alike, and does not look at the signature', async () => {
  const k = await newKey();
  for (const build of [b1, await signedBuild(b1, k), { ...b1, manifest: { ...(await signedBuild(b1, k)).manifest, sig: Buffer.alloc(64).toString('base64') } }]) {
    const { cdn, store } = setup({});
    cdn.publish(build);
    assert.equal((await store.update()).status, 'updated');
  }
});
