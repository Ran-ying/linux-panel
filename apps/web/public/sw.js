/* Only public static resources are cached. Never store authenticated content. */
const CACHE_NAME = 'linux-panel-public-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];
const STATIC_ASSET = /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('linux-panel-public-') &&
      name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Do not intercept API, OAuth, MCP, cookies, or other private routes.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/') ||
      url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return;

  // An offline page is informational only; never cache index.html, redirect
  // documents, authenticated pages, navigation responses or user state.
  if (request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(fetch(request).catch(async () =>
        (await caches.open(CACHE_NAME)).match(OFFLINE_URL)));
    }
    return;
  }

  if (STATIC_ASSET.test(url.pathname) &&
      (request.destination === 'script' || request.destination === 'style')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
