// Service worker: keeps the app shell available offline and leaves the timetable to app/data-store.js.
//
// Shell (index.html, scripts, styles): every release has its own cache, filled completely at install, so the
// offline shell is one release and never a mix. Requests are network-first: online you always get the newest file
// (the CDN sends no-cache and the browser revalidates), offline you get the cached one. The version is a hash of the
// shell files; scripts/ci/deploy-shell.sh replaces the placeholder below when it publishes. Run from a checkout, the
// placeholder stays and one cache name is reused, which network-first makes harmless.
//
// Data: the verified timetable lives in Cache Storage under names the data store controls. This worker does not
// cache it. Dated build files (data/<date>/...) are served cache-first if the store has them, data/latest.json is
// never touched, so the update check always sees the live manifest. Nor is data/delays.json (the live delays, replaced
// every five minutes): anything under data/ that is not a dated build goes straight to the network, so a delay is never
// older than the CDN's half minute and never answered from a cache when the device is offline.
const VERSION = '__SHELL_VERSION__';
const SHELL_CACHE = 'ct-shell-' + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'engine.js', 'data-store.js', 'planb.js', 'graph.js', 'live.js', 'delays.js', 'i18n.js', 'style.css', 'manifest.webmanifest', 'icon.svg',
  'locales/en.js', 'locales/pl.js', 'locales/ru.js', 'locales/ro.js', 'locales/bg.js', 'locales/uk.js', 'locales/tr.js', 'locales/nl.js', 'locales/fr.js', 'locales/es.js'];
const DATED_BUILD = /\/data\/\d{4}-\d{2}-\d{2}\//;
// Lookups in our own caches ignore Vary. The CDN answers every file with "Vary: Origin", and Chrome adds an Origin
// header to module-script requests, so a file stored at install (a plain request) would not match its own module
// request, and the first launch offline after an install or an update would not start. One release per cache, keyed
// by URL: there is no variant to tell apart.
const IGNORE_VARY = { ignoreVary: true };

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('ct-shell-') && k !== SHELL_CACHE) || k === 'ct-v2').map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (DATED_BUILD.test(url.pathname)) {
    e.respondWith(caches.match(req, IGNORE_VARY).then(hit => hit || fetch(req)));
    return;
  }
  if (url.pathname.includes('/data/')) return;   // latest.json and anything else under data/: straight to the network

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true, ...IGNORE_VARY }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html', IGNORE_VARY) : Response.error()))),
  );
});
