// Offline support. The timetable is cached on first load and served cache-first (it changes only when rebuilt).
// The app shell is network-first with a cache fallback, so edits show up online and the app still opens offline.
const CACHE = 'ct-v2';
const SHELL = ['./', 'index.html', 'app.js', 'engine.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'data/meta.json', 'data/timetable.bin.gz'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const store = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const isData = new URL(req.url).pathname.includes('/data/');
  if (isData) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => store(req, res))));
  } else {
    e.respondWith(fetch(req).then(res => store(req, res)).catch(() => caches.match(req)));
  }
});
