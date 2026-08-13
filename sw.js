/* KidLedger service worker.
 *
 * Strategy: NETWORK-FIRST for same-origin requests, falling back to the cache
 * when offline. This guarantees new deploys show up as soon as you're online,
 * while still working fully offline from the last-seen version. (An earlier
 * cache-first version could pin an old build — hence the switch.)
 *
 * Bump CACHE on any change so old caches are cleared on activate. */
const CACHE = 'parity-v5';
const SHELL = [
  './',
  './index.html',
  './finance.js',
  './sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept Google auth/API traffic — always go to the network.
  if (url.origin !== self.location.origin) return;

  // Network-first: fetch fresh, cache a copy, fall back to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      }))
  );
});
