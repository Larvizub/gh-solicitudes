
// Bump this value on deploy to force clients to update the Service Worker and avoid serving stale shells
const CACHE_NAME = 'gh-solicitudes-v2';

self.addEventListener('install', () => {
  console.log('[sw] install - cacheName:', CACHE_NAME);
  // do not pre-cache index to avoid serving stale HTML after deploy
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE_NAME) return caches.delete(k);
      return Promise.resolve();
    }))).then(() => console.log('[sw] activate - ready with cache:', CACHE_NAME))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Handle navigation requests with network-first so deploys don't show stale shells
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        // update cache with latest index.html for offline fallback
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy)).catch((e) => { console.warn('[sw] cache index.html failed', e); });
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // For other requests (assets), prefer cache but avoid serving HTML for JS/modules.
  event.respondWith(
    caches.match(req).then(async cached => {
      try {
        // If we have a cached response, and it's not an HTML payload masquerading as an asset, return it
        if (cached) {
          const ct = cached.headers && cached.headers.get ? cached.headers.get('content-type') || '' : '';
          const expectsScript = req.destination === 'script' || (req.headers.get && req.headers.get('accept') && req.headers.get('accept').includes('module'));
          if (!(expectsScript && ct.includes('text/html'))) {
            return cached;
          }
          // If cached is HTML but request expects a script/module, ignore the cached value and attempt network fetch
        }
      } catch (e) {
        // ignore header inspection issues and continue to fetch
        console.warn('[sw] cache header inspect failed', e);
      }

      return fetch(req).then(res => {
        try {
          // only cache successful GET same-origin HTTP(S) responses of basic type and non-HTML
          const url = new URL(req.url);
          const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
          const isSameOrigin = url.origin === self.location.origin;
          const contentType = res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
          if (req.method === 'GET' && res && res.status === 200 && res.type === 'basic' && isHttp && isSameOrigin && !contentType.includes('text/html')) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, resClone)).catch((e) => { console.warn('[sw] cache put failed for', req.url, e); });
          }
        } catch (err) {
          // If URL parsing or caching fails, ignore and continue
          console.warn('[sw] fetch handling warn', err);
        }
        return res;
      }).catch(() => {
        // For navigations we already handled above; for assets return a simple 503 instead of index.html
        return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
