
// Basic Service Worker for Offline support
const CACHE_NAME = 'gh-solicitudes-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE_NAME) return caches.delete(k);
      return Promise.resolve();
    })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
  
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const url = new URL(req.url);
        if (req.method === 'GET' && res.status === 200 && res.type === 'basic' && (url.protocol === 'http:' || url.protocol === 'https:')) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone)).catch(() => {});
        }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
