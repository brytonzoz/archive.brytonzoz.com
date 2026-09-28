// Makes the site open instantly on repeat visits and still show the pages (with artwork) when the
// connection drops. Hashed build files and artwork are kept; pages are fetched fresh when possible.
// Music (/audio) and metrics (/api) always go to the network.
const VERSION = 'v1';
const ASSETS = `bz-assets-${VERSION}`;
const PAGES = `bz-pages-${VERSION}`;
const MAX_ASSETS = 300;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([ASSETS, PAGES]);
    for (const key of await caches.keys()) if (key.startsWith('bz-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    trim(cache, MAX_ASSETS);
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(request, { ignoreSearch: request.mode === 'navigate' }))
      || (request.mode === 'navigate' ? await cache.match('/', { ignoreSearch: true }) : undefined);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/audio/') || path.startsWith('/api/') || path.startsWith('/go/') || path.startsWith('/admin')) return;

  if (path.startsWith('/_next/static/') || path.startsWith('/media/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate' || url.searchParams.has('_rsc') || request.headers.get('RSC') === '1') {
    event.respondWith(networkFirst(request));
  }
});
