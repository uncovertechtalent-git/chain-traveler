// Timetable data on the device: where it is kept, how a new build is fetched, verified and swapped in.
// No DOM, no globals: the browser objects (Cache Storage, fetch, SubtleCrypto) are passed in, so the same code
// runs in the page and in the tests.
//
// Layout in Cache Storage:
//   ct-data-pointer            one entry, <base>data/current: the manifest of the build in use (the switch)
//   ct-data-<date>-<sha8>      the two files of one build: <base>data/<date>/timetable.bin.gz and meta.json
//
// A build is used only after both files match the sha256 and the length in the manifest. The pointer is written
// last, in one put, so a launch sees either the old build or the new one, never a mix. Anything that goes wrong
// before that put (offline, wrong bytes, a full disk) removes the half-written build and leaves the old one.

export const MANIFEST_FORMAT = 1;
export const MAX_BYTES = 64 * 1024 * 1024;         // refuse a manifest that promises more than this
const POINTER_CACHE = 'ct-data-pointer';
// The store reads back what it wrote, by URL. A CDN's Vary header must not turn that into a miss (see app/sw.js).
const MATCH = { ignoreVary: true };
const BUILD_PREFIX = 'ct-data-';
const SHA_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateError extends Error {
  constructor(code, message) { super(message); this.name = 'UpdateError'; this.code = code; }
}

const isInt = v => Number.isInteger(v) && v > 0;
const validDate = s => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// Throws UpdateError('manifest') unless m is a manifest this code understands. Same rules as build/manifest.py.
export function validateManifest(m) {
  const bad = why => { throw new UpdateError('manifest', 'bad manifest: ' + why); };
  if (!m || typeof m !== 'object' || Array.isArray(m)) bad('not an object');
  if (m.format !== MANIFEST_FORMAT) bad('format ' + m.format + ' is not supported by this version of the app');
  for (const k of ['sha256', 'metaSha256', 'feedSha256']) if (typeof m[k] !== 'string' || !SHA_RE.test(m[k])) bad(k);
  for (const k of ['date', 'firstDate']) if (!validDate(m[k])) bad(k);
  for (const k of ['bytes', 'metaBytes', 'nDays']) if (!isInt(m[k])) bad(k);
  if (m.bytes > MAX_BYTES || m.metaBytes > MAX_BYTES) bad('size above the limit');
  if (typeof m.built !== 'string') bad('built');
  return m;
}

// 'same' when the build in use is exactly the published one, otherwise 'different'. The date alone is not enough:
// a rollback publishes an older build, and a rebuild can change the bytes under the same date.
export function compareManifest(local, remote) {
  if (!local) return 'different';
  return local.date === remote.date && local.sha256 === remote.sha256 && local.metaSha256 === remote.metaSha256 ? 'same' : 'different';
}

export async function sha256Hex(subtle, bytes) {
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

// Throws UpdateError('verify') unless bytes has the manifest's length and sha256.
export async function verifyBytes(subtle, bytes, sha256, length, name) {
  if (bytes.byteLength !== length) throw new UpdateError('verify', `${name}: ${bytes.byteLength} bytes, expected ${length}`);
  if ((await sha256Hex(subtle, bytes)) !== sha256) throw new UpdateError('verify', `${name}: sha256 does not match the manifest`);
}

export async function gunzip(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

const dayNumber = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);

// What the app tells the user about the age of its data. `today` is a YYYY-MM-DD date in the timetable's time zone.
export function describeAge(manifest, today) {
  const last = isoOf(dayNumber(manifest.firstDate) + manifest.nDays - 1);
  const left = dayNumber(last) - dayNumber(today);
  if (left < 0) {
    return { level: 'expired', last, text: `The timetable ended on ${last}. Trains after that date are not in it; connect to the internet to update.` };
  }
  if (left <= 3) {
    return { level: 'soon', last, text: `Timetable of ${manifest.date}, valid until ${last} (${left === 0 ? 'last day' : left + ' more day' + (left === 1 ? '' : 's')}). It updates itself when you are online.` };
  }
  return { level: 'ok', last, text: `Timetable of ${manifest.date}, valid until ${last}.` };
}

export class DataStore {
  // base: absolute URL of the app directory, ending in "/". caches: CacheStorage. subtle: SubtleCrypto.
  constructor({ caches, fetch, subtle, base }) {
    if (!base.endsWith('/')) throw new Error('base must end with "/"');
    Object.assign(this, { caches, fetchFn: fetch, subtle, base });
    this.inflight = null;
  }

  url(path) { return new URL(path, this.base).href; }
  // Unique per content of both files, so a new build never writes into the cache of the one in use.
  buildCacheName(m) { return `${BUILD_PREFIX}${m.date}-${m.sha256.slice(0, 8)}-${m.metaSha256.slice(0, 8)}`; }
  buildUrl(m, file) { return this.url(`data/${m.date}/${file}`); }
  pointerUrl() { return this.url('data/current'); }

  // The build in use: { manifest, meta (object), bin (gzip bytes) }, or null. Both files are verified again on
  // every read, so a damaged or tampered cache entry is dropped instead of being used.
  async load() {
    const pointerCache = await this.caches.open(POINTER_CACHE);
    const hit = await pointerCache.match(this.pointerUrl(), MATCH);
    if (!hit) return null;
    let manifest;
    try { manifest = validateManifest(await hit.json()); } catch { await this.forget(); return null; }
    try {
      const cache = await this.caches.open(this.buildCacheName(manifest));
      const [binRes, metaRes] = await Promise.all([cache.match(this.buildUrl(manifest, 'timetable.bin.gz'), MATCH), cache.match(this.buildUrl(manifest, 'meta.json'), MATCH)]);
      if (!binRes || !metaRes) throw new UpdateError('verify', 'build files missing');
      const [bin, metaBytes] = await Promise.all([binRes.arrayBuffer(), metaRes.arrayBuffer()]);
      await verifyBytes(this.subtle, bin, manifest.sha256, manifest.bytes, 'timetable.bin.gz');
      await verifyBytes(this.subtle, metaBytes, manifest.metaSha256, manifest.metaBytes, 'meta.json');
      let meta;
      try { meta = JSON.parse(new TextDecoder().decode(metaBytes)); } catch { throw new UpdateError('verify', 'meta.json is not JSON'); }
      return { manifest, bin, meta };
    } catch (e) {
      // Wrong or missing bytes: drop the build. Any other failure (a storage error that may pass) keeps it.
      if (!(e instanceof UpdateError)) throw e;
      await this.forget();
      return null;
    }
  }

  // Fetch and validate the published manifest. Never cached: the browser and the service worker are bypassed.
  async fetchManifest() {
    let res;
    try { res = await this.fetchFn(this.url('data/latest.json'), { cache: 'no-store' }); } catch (e) { throw new UpdateError('network', 'latest.json: ' + e.message); }
    if (!res.ok) throw new UpdateError('network', 'latest.json: HTTP ' + res.status);
    let m;
    try { m = await res.json(); } catch { throw new UpdateError('manifest', 'latest.json is not JSON'); }
    return validateManifest(m);
  }

  // Bring the device up to the published build. Resolves { status: 'current' | 'updated', manifest }, or rejects with
  // an UpdateError (codes: network, manifest, verify, storage) after leaving the build in use untouched.
  update() {
    if (!this.inflight) this.inflight = this.runUpdate().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async runUpdate() {
    const remote = await this.fetchManifest();
    const pointerCache = await this.caches.open(POINTER_CACHE);
    const hit = await pointerCache.match(this.pointerUrl(), MATCH);
    let local = null;
    if (hit) { try { local = validateManifest(await hit.json()); } catch { local = null; } }
    if (compareManifest(local, remote) === 'same' && (await this.load())) return { status: 'current', manifest: remote };

    const name = this.buildCacheName(remote);
    try {
      const cache = await this.caches.open(name);
      for (const [file, sha, length] of [['timetable.bin.gz', remote.sha256, remote.bytes], ['meta.json', remote.metaSha256, remote.metaBytes]]) {
        const url = this.buildUrl(remote, file);
        let res;
        try { res = await this.fetchFn(url); } catch (e) { throw new UpdateError('network', `${file}: ${e.message}`); }
        if (!res.ok) throw new UpdateError('network', `${file}: HTTP ${res.status}`);
        const promised = Number(res.headers && res.headers.get && res.headers.get('content-length'));
        if (promised > length) throw new UpdateError('verify', `${file}: the server announces ${promised} bytes, expected ${length}`);
        let bytes;
        try { bytes = await res.arrayBuffer(); } catch (e) { throw new UpdateError('network', `${file}: ${e.message}`); }
        await verifyBytes(this.subtle, bytes, sha, length, file);
        try { await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { throw new UpdateError('storage', `${file}: ${e.message}`); }
      }
      // The swap: one put. Before it the old build is in use, after it the new one.
      // Opened here, not earlier: a repair above may have deleted and re-created the pointer cache.
      try { await (await this.caches.open(POINTER_CACHE)).put(this.pointerUrl(), new Response(JSON.stringify(remote), { headers: { 'content-type': 'application/json' } })); } catch (e) { throw new UpdateError('storage', 'pointer: ' + e.message); }
    } catch (e) {
      await this.caches.delete(name);   // never the cache of the build in use: the name differs whenever a file differs
      throw e;
    }
    await this.dropOldBuilds(name);
    return { status: 'updated', manifest: remote };
  }

  // Remove every build cache except `keep`. Runs after the swap, so a failure here costs space, not correctness.
  async dropOldBuilds(keep) {
    for (const k of await this.caches.keys()) {
      if (k.startsWith(BUILD_PREFIX) && k !== POINTER_CACHE && k !== keep) await this.caches.delete(k);
    }
  }

  async forget() {
    await this.caches.delete(POINTER_CACHE);
    await this.dropOldBuilds(null);
  }
}
