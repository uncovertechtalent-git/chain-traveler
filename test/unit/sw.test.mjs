// app/sw.js against a Cache Storage that honours Vary, as the real one does. The CDN answers every file with
// "Vary: Origin" and Chrome adds an Origin header to module-script requests: a file stored at install (a plain request)
// must still be found for its own module request, or the first launch offline after an install does not start.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ORIGIN = 'https://app.test';
const SRC = fs.readFileSync(new URL('../../app/sw.js', import.meta.url), 'utf8');

class FakeRequest {
  constructor(input, init = {}) {
    const from = typeof input === 'string' ? null : input;
    this.url = new URL(from ? from.url : input, ORIGIN + '/').href;
    this.method = init.method || (from && from.method) || 'GET';
    this.mode = init.mode || (from && from.mode) || 'cors';
    const headers = init.headers || (from ? Object.fromEntries(from.headers) : {});
    this.headers = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  }
}
const asRequest = input => (input instanceof FakeRequest ? input : new FakeRequest(input));
const bare = u => { const x = new URL(u); return x.origin + x.pathname; };

// The Cache API compares the request headers named in the stored response's Vary header.
function varyMatches(entry, req) {
  const vary = entry.resHeaders.get('vary');
  if (!vary) return true;
  return vary.split(',').map(h => h.trim().toLowerCase()).every(h => h !== '*' && (entry.headers.get(h) ?? null) === (req.headers.get(h) ?? null));
}

class VaryCache {
  constructor(fetchImpl) { this.fetchImpl = fetchImpl; this.entries = []; }
  async put(input, res) {
    const r = asRequest(input);
    this.entries = this.entries.filter(e => !(e.url === r.url && varyMatches(e, r)));
    this.entries.push({ url: r.url, headers: r.headers, status: res.status, resHeaders: new Headers(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  }
  async addAll(inputs) {
    for (const input of inputs) {
      const res = await this.fetchImpl(input);
      if (!res.ok) throw new TypeError('addAll: ' + res.status);
      await this.put(input, res);
    }
  }
  async match(input, opts = {}) {
    const r = asRequest(input);
    const e = this.entries.find(x => (opts.ignoreSearch ? bare(x.url) === bare(r.url) : x.url === r.url) && (opts.ignoreVary || varyMatches(x, r)));
    return e ? new Response(e.body, { status: e.status, headers: e.resHeaders }) : undefined;
  }
}

class VaryCaches {
  constructor(fetchImpl) { this.fetchImpl = fetchImpl; this.map = new Map(); }
  async open(name) { if (!this.map.has(name)) this.map.set(name, new VaryCache(this.fetchImpl)); return this.map.get(name); }
  async keys() { return [...this.map.keys()]; }
  async delete(name) { return this.map.delete(name); }
  async match(input, opts) {
    for (const c of this.map.values()) { const hit = await c.match(input, opts); if (hit) return hit; }
    return undefined;
  }
}

// The real worker source, run with fake globals. The CDN part of the fake: every file comes back with Vary: Origin.
function loadWorker() {
  const handlers = {};
  const net = { up: true };
  const fetchImpl = async input => {
    if (!net.up) throw new TypeError('Failed to fetch');
    const r = asRequest(input);
    return new Response('// ' + new URL(r.url).pathname, { status: 200, headers: { 'content-type': 'text/javascript', vary: 'Origin' } });
  };
  const caches = new VaryCaches(fetchImpl);
  const self = { location: { origin: ORIGIN }, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(SRC, { self, caches, fetch: fetchImpl, Request: FakeRequest, Response, URL, Promise });
  return {
    net, caches,
    async install() { let p; handlers.install({ waitUntil: x => { p = x; } }); await p; },
    async fetch(request) { let p; handlers.fetch({ request, respondWith: x => { p = x; } }); return p; },
  };
}

// What Chrome sends for <script type="module" src="app.js"> and for the imports of that module.
const moduleRequest = path => new FakeRequest(path, { mode: 'cors', headers: { origin: ORIGIN } });

test('the fake cache models Vary, so the tests below can fail', async () => {
  const w = loadWorker();
  await w.install();
  assert.equal(await w.caches.match(moduleRequest('app.js')), undefined, 'another Origin than the stored one misses by default');
  assert.ok(await w.caches.match(moduleRequest('app.js'), { ignoreVary: true }));
});

test('offline, a module script request is answered from the release cache', async () => {
  const w = loadWorker();
  await w.install();
  w.net.up = false;
  const res = await w.fetch(moduleRequest('app.js'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '// /app.js');
});

test('offline, every script of the module graph is found, whatever the Origin header', async () => {
  const w = loadWorker();
  await w.install();
  w.net.up = false;
  for (const file of ['app.js', 'engine.js', 'data-store.js']) {
    for (const req of [moduleRequest(file), new FakeRequest(file)]) {
      const res = await w.fetch(req);
      assert.equal(res.status, 200, file + ' with headers ' + JSON.stringify([...req.headers]));
    }
  }
});

test('offline, a navigation falls back to index.html', async () => {
  const w = loadWorker();
  await w.install();
  w.net.up = false;
  const res = await w.fetch(new FakeRequest('/anything', { mode: 'navigate' }));
  assert.equal(await res.text(), '// /index.html');
});

test('offline, a file that was never cached fails instead of hanging', async () => {
  const w = loadWorker();
  await w.install();
  w.net.up = false;
  const res = await w.fetch(new FakeRequest('other.js'));
  assert.equal(res.type, 'error');
});

test('a dated build file is served from the data store cache, offline, with or without an Origin header', async () => {
  const w = loadWorker();
  await w.install();
  const store = await w.caches.open('ct-data-2026-11-01-aaaaaaaa-bbbbbbbb');
  await store.put('data/2026-11-01/meta.json', new Response('{}', { status: 200, headers: { vary: 'Origin' } }));
  w.net.up = false;
  for (const req of [new FakeRequest('data/2026-11-01/meta.json'), moduleRequest('data/2026-11-01/meta.json')]) {
    const res = await w.fetch(req);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{}');
  }
});

test('data/latest.json is never answered by the worker', async () => {
  const w = loadWorker();
  await w.install();
  assert.equal(await w.fetch(new FakeRequest('data/latest.json')), undefined);
});

test('data/delays.json is never answered by the worker, online or offline, and never put in a cache', async () => {
  const w = loadWorker();
  await w.install();
  for (const req of [new FakeRequest('data/delays.json'), moduleRequest('data/delays.json')]) {
    assert.equal(await w.fetch(req), undefined, 'the worker leaves it to the network');
  }
  assert.ok(![...w.caches.map.values()].some(c => c.entries.some(e => e.url.includes('delays.json'))), 'not in any cache');
  w.net.up = false;
  assert.equal(await w.fetch(new FakeRequest('data/delays.json')), undefined, 'offline it is still not served from a cache');
});

test('the precache holds delays.js, the code that reads the delays', () => {
  assert.ok(SRC.includes("'delays.js'"));
});
