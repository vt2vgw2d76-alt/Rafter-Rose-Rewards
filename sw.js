
const CACHE_NAME = "rr-rewards-live-v3";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.png",
  "./icon-512.png"
];

const ALLOWED_URLS = new Set(
  ASSETS.map(
    asset => new URL(
      asset,
      self.registration.scope
    ).href
  )
);

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await cache.addAll(
        ASSETS.map(
          asset => new Request(
            asset,
            { cache: "reload" }
          )
        )
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            key =>
              key.startsWith("rr-rewards-") &&
              key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search ||
    !ALLOWED_URLS.has(url.href)
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const response = await fetch(
          request,
          { cache: "no-cache" }
        );

        if (response.ok) {
          await cache.put(
            request,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        const cached = await cache.match(request);

        return cached || new Response(
          "Please reconnect to the internet.",
          {
            status: 503,
            headers: {
              "Content-Type": "text/plain"
            }
          }
        );
      }
    })()
  );
});
