
const CACHE = 'rr-rewards-live-v1';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith('rr-rewards-') &&
            key !== CACHE
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.search ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rest/')
  ) return;

  const allowed = ASSETS.some(asset =>
    new URL(asset, self.registration.scope)
      .pathname === url.pathname
  );

  if (!allowed) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(
            event.request,
            response.clone()
          );
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(
          event.request
        );

        return cached || new Response(
          'Please reconnect to the internet.',
          {
            status: 503,
            headers: {
              'Content-Type': 'text/plain'
            }
          }
        );
      })
  );
});
