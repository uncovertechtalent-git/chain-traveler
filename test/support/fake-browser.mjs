// Stand-ins for Cache Storage and for the network, enough for app/data-store.js. Node has Response, crypto.subtle
// and DecompressionStream; it has no CacheStorage, so a small one lives here and can be made to fail on demand.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { sampleNetwork } from './fixture.mjs';

export const BASE = 'https://app.test/';

class FakeCache {
  constructor(store, name) { this.store = store; this.name = name; this.entries = new Map(); }
  async put(url, res) {
    this.store.log.push(`put ${this.name} ${url.replace(BASE, '')}`);
    if (this.store.failPut && this.store.failPut(this.name, url)) throw new Error('QuotaExceededError');
    this.entries.set(url, Buffer.from(await res.arrayBuffer()));
  }
  async match(url) {
    const b = this.entries.get(url);
    return b ? new Response(b) : undefined;
  }
}

export class FakeCaches {
  constructor() { this.map = new Map(); this.log = []; this.failPut = null; }
  async open(name) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this, name));
    return this.map.get(name);
  }
  async keys() { return [...this.map.keys()]; }
  async delete(name) {
    this.log.push(`delete ${name}`);
    return this.map.delete(name);
  }
  names() { return [...this.map.keys()].sort(); }
}

// A published build as the pipeline would make it: gzip of a CHT1 file, a meta.json, and the manifest that describes them.
export function makeBuild({ date, built = date + 'T11:30:00Z', feedSeed = date, firstDate = null, nDays = 7 } = {}) {
  const net = sampleNetwork();
  const raw = Buffer.from(net.buf);
  raw.writeUInt32LE(Number(String(firstDate || date).replaceAll('-', '')), 20);
  raw.writeUInt32LE(nDays, 24);
  const bin = zlib.gzipSync(Buffer.concat([raw, Buffer.from(feedSeed)]), { level: 9 });   // trailing seed makes builds differ
  const meta = Buffer.from(JSON.stringify({ ...net.meta, firstDate: firstDate || date, nDays, feed: { ...net.meta.feed, built } }));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const manifest = {
    format: 1, date, sha256: sha(bin), bytes: bin.length, metaSha256: sha(meta), metaBytes: meta.length,
    firstDate: firstDate || date, nDays, built, feedSha256: sha(Buffer.from(feedSeed)),
  };
  return { date, bin, meta, manifest };
}

// The CDN: serves data/latest.json and data/<date>/... for the builds it was given. Tests change it between calls.
export class FakeCdn {
  constructor() { this.files = new Map(); this.calls = []; this.offline = false; this.failOn = new Map(); }
  publish(build) {
    this.files.set(`data/${build.date}/timetable.bin.gz`, build.bin);
    this.files.set(`data/${build.date}/meta.json`, build.meta);
    this.point(build);
  }
  point(build) { this.files.set('data/latest.json', Buffer.from(JSON.stringify(build.manifest))); }
  damage(path, how) {
    const b = Buffer.from(this.files.get(path));
    if (how === 'flip') b[Math.floor(b.length / 2)] ^= 1;
    if (how === 'truncate') this.files.set(path, b.subarray(0, b.length - 5)); else this.files.set(path, b);
  }
  get fetch() {
    return async (url, init = {}) => {
      const path = url.replace(BASE, '');
      this.calls.push({ path, init });
      if (this.offline) throw new TypeError('Failed to fetch');
      if (this.failOn.has(path)) return new Response('', { status: this.failOn.get(path) });
      const b = this.files.get(path);
      if (!b) return new Response('', { status: 404 });
      return new Response(b, { status: 200 });
    };
  }
  count(path) { return this.calls.filter(c => c.path === path).length; }
}
