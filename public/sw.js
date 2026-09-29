// Makes the site open instantly on repeat visits and still show the pages (with artwork) when the
// connection drops. Hashed build files and artwork are kept; pages are fetched fresh when possible.
// Music (/audio) and metrics (/api) always go to the network.
const VERSION = 'v1';
const ASSETS = `bz-assets-${VERSION}`;
const PAGES = `bz-pages-${VERSION}`;
// Shop photos get their own shelf, so browsing the shop never pushes the scenes' artwork out.
const PHOTOS = `bz-photos-${VERSION}`;
const MAX_ASSETS = 300;
const MAX_PHOTOS = 400;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([ASSETS, PAGES, PHOTOS]);
    for (const key of await caches.keys()) if (key.startsWith('bz-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// The response goes to the page straight away; storing a copy happens alongside, not before.
async function cacheFirst(event, name, max) {
  const { request } = event;
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache, max)).catch(() => {}));
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

  if (path.startsWith('/media/merch')) {
    event.respondWith(cacheFirst(event, PHOTOS, MAX_PHOTOS));
  } else if (path.startsWith('/_next/static/') || path.startsWith('/media/')) {
    event.respondWith(cacheFirst(event, ASSETS, MAX_ASSETS));
  } else if (request.mode === 'navigate' || url.searchParams.has('_rsc') || request.headers.get('RSC') === '1') {
    event.respondWith(networkFirst(request));
  }
});
