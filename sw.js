// Offline support for the Scores app: cache the app shell (including the PDF renderer),
// serve cache-first and refresh in the background. The scores themselves live in IndexedDB.
const CACHE = 'scores-v17';
// The LilyPond engine (about 30 MB) is cached separately, only once it is first used, and
// kept across app updates. Change this name when the engine in vendor/lilypond-wasm changes.
const ENGINE_CACHE = 'lilypond-engine-2.26.0';
const ENGINE_PATH = 'vendor/lilypond-wasm/';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/viewer.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('scores-') && k !== CACHE) || (k.startsWith('lilypond-engine-') && k !== ENGINE_CACHE)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  if (url.pathname.startsWith(new URL(ENGINE_PATH, location).pathname)) {
    // Engine files never change under one cache name: cache-first, fetched once.
    e.respondWith(caches.open(ENGINE_CACHE).then(cache => cache.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(cache => cache.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || cache.match('index.html'));
      return cached || network;
    }))
  );
});
