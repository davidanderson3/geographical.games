const CACHE_NAME = 'dashboard-cache-v3';
const OFFLINE_URLS = [
  './',
  './index.html',
  './style.css',
  './js/geoscore.js',
  './js/tabs.js',
  // GeoLayers entry (assets within load dynamically)
  './geolayers-game/public/index.html',
  './geolayers-game/public/style.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Add each URL individually and ignore failures so install never rejects
      await Promise.all(
        OFFLINE_URLS.map(url => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch {}
    try { await self.clients.claim(); } catch {}
    try { await self.registration.unregister(); } catch {}
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests; let others pass through
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return; // do not call respondWith; browser handles normally
  }

  const isHTML = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html');
  const isStatic = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  event.respondWith((async () => {
    // Network-first for HTML/JS/CSS to avoid stale UI during development
    if (isHTML || isStatic) {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isHTML) {
          const offline = await caches.match('./index.html');
          if (offline) return offline;
        }
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // For other requests, use cache-first as before
    try {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
