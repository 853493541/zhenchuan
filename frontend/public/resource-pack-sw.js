const RESOURCE_PACK_CACHE = 'zhenchuan-resource-pack-v1';

function isResourcePackRequest(url) {
  return url.origin === self.location.origin && (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/game/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/full-exports/') ||
    url.pathname.startsWith('/_next/static/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate' || request.destination === 'document') return;

  const url = new URL(request.url);
  if (!isResourcePackRequest(url)) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    return fetch(request);
  })());
});