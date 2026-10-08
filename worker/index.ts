// Serves songs from R2 at /audio/<key> on the site's own domain (seekable, edge-cached), and the
// listening metrics API at /api/* (worker/metrics.ts), the Scrapwrk checkout (worker/store.ts) and
// /shipped's printed receipts and sponsor lines (worker/shipped.ts). Every other path is handled by static
// assets before this script runs (see run_worker_first).
import { handleApi, type MetricsEnv } from './metrics';
import { placeManualOrders, reconcileMerch, type MerchEnv } from './merch';
import { handleShipped, handleShippedPage } from './shipped';
import { handleStore } from './store';

interface Env extends MetricsEnv, MerchEnv {
  ASSETS: Fetcher;
  MUSIC: R2Bucket;
}

const AUDIO_PREFIX = '/audio/';
const CACHE_CONTROL = 'public, max-age=86400';

function baseHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', CACHE_CONTROL);
  return headers;
}

type ByteRange = { offset: number; length?: number } | { suffix: number };

// Single ranges only ("bytes=a-b", "bytes=a-", "bytes=-n"), which is what media elements send.
function parseRange(header: string | null): ByteRange | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') return { suffix: Number(match[2]) };
  const offset = Number(match[1]);
  if (match[2] === '') return { offset };
  const end = Number(match[2]);
  return end >= offset ? { offset, length: end - offset + 1 } : null;
}

function resolveRange(range: ByteRange, size: number): { offset: number; length: number } | null {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size);
    return length > 0 ? { offset: size - length, length } : null;
  }
  if (range.offset >= size) return null;
  return { offset: range.offset, length: Math.min(range.length ?? size - range.offset, size - range.offset) };
}

async function serveAudio(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.slice(AUDIO_PREFIX.length));
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  if (request.method === 'HEAD') {
    const head = await env.MUSIC.head(key);
    if (!head) return new Response(null, { status: 404 });
    const headers = baseHeaders(head);
    headers.set('content-length', String(head.size));
    return new Response(null, { headers });
  }

  // Edge cache: full songs are stored once per location and range requests are answered from them.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(new Request(url.toString(), { headers: request.headers }));
  if (cached) return cached;

  const requested = parseRange(request.headers.get('range'));
  if (requested) {
    const head = await env.MUSIC.head(key);
    if (!head) return new Response('Not found', { status: 404 });
    const bounds = resolveRange(requested, head.size);
    if (!bounds) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
    }
    const object = await env.MUSIC.get(key, { range: bounds });
    if (!object) return new Response('Not found', { status: 404 });
    const headers = baseHeaders(object);
    headers.set('content-range', `bytes ${bounds.offset}-${bounds.offset + bounds.length - 1}/${head.size}`);
    headers.set('content-length', String(bounds.length));
    // Warm the edge cache once per song (on the opening request), not on every seek.
    if (bounds.offset === 0) ctx.waitUntil(
      env.MUSIC.get(key).then((full) => {
        if (!full) return;
        const fullHeaders = baseHeaders(full);
        fullHeaders.set('content-length', String(full.size));
        return cache.put(cacheKey, new Response(full.body, { headers: fullHeaders }));
      }),
    );
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.MUSIC.get(key, { onlyIf: request.headers });
  if (!object) return new Response('Not found', { status: 404 });
  const headers = baseHeaders(object);
  if (!('body' in object)) return new Response(null, { status: 304, headers });

  headers.set('content-length', String(object.size));
  const response = new Response(object.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(AUDIO_PREFIX)) return serveAudio(request, env, ctx);
    if (url.pathname.startsWith('/api/')) {
      return (await handleShipped(request, env, ctx)) ?? (await handleStore(request, env)) ?? handleApi(request, env);
    }
    // Printed receipts' share pages and their preview images (worker/shipped.ts).
    if (url.pathname.startsWith('/shipped/r/')) return handleShippedPage(request, env);
    // Campaign links for posts and bios: brytonzoz.com/go/ig -> the homepage, tagged "ig" in /admin.
    if (url.pathname.startsWith('/go/')) {
      const code = url.pathname.slice(4).replace(/\/+$/, '').toLowerCase();
      const target = new URL('/', url);
      if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code)) target.searchParams.set('ref', code);
      return Response.redirect(target.toString(), 302);
    }
    return env.ASSETS.fetch(request);
  },
  // Every 10 minutes (production): make sure every paid checkout with NonParallel tees has its
  // Printify order, even when the buyer closed the tab before the thank-you page; and place any
  // one-off sample orders added to D1 `manual_orders`.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    const db = { ...env, DB: env.DB };
    ctx.waitUntil(reconcileMerch(db).catch((error) => console.error('reconcile failed', error)));
    ctx.waitUntil(placeManualOrders(db).catch((error) => console.error('manual orders failed', error)));
  },
} satisfies ExportedHandler<Env>;
