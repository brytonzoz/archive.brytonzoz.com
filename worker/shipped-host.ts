// Shipped's own host (SHIPPED_HOST: shipped.brytonzoz.com, shipped-staging.brytonzoz.com on staging). The
// static build keeps the app under /shipped/, so on that host the root maps onto it: / is the printer,
// /r/<id>/ a receipt (+ og.png, receipt.png, rollo.png), /terms/ (terms, refunds, privacy; /refunds/ too), /remove/,
// /sandbox-pay/, and /q/<key> (a printed QR code). Every response gets the security headers and pages a CSP
// (worker/shipped-guard.ts). With the "site" kill switch on, every page is the out-of-paper notice. On every other host
// /shipped/* answers with a 301 to the same path on SHIPPED_HOST, so old links keep working.
// Only paths listed in wrangler.jsonc's run_worker_first reach this; the rest are served as plain assets.
import { handleShippedPage, outOfPaper, qrRedirect, type ShippedEnv } from './shipped';
import { hardenPage, secure, switchedOff } from './shipped-guard';
import { SHIPPED_APP_TITLE, SHIPPED_DESCRIPTION, SHIPPED_MANIFEST_NAME, SHIPPED_MANIFEST_SHORT } from '../lib/shipped-brand';
import { SHIPPED_URL } from '../lib/shipped-year';
import shareImages from '../lib/share-images.json';

const NOINDEX = 'noindex, nofollow, noarchive';
const PAGES = /^\/(?:(lab|refunds|remove|sandbox-pay|terms)(?:\/.*)?)?$/;
/** Static files the app itself loads from /shipped/ (Bryton's dithered logos). */
const OWN_FILES = /^\/shipped\/logos\//;

type HostEnv = ShippedEnv & { ASSETS: Fetcher };

const isShippedPath = (path: string) => path === '/shipped' || path.startsWith('/shipped/');

function noindex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', NOINDEX);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Author / keywords / creator / Twitter handles inherited from brytonzoz.com's root layout. */
const DROP_META = new Set(['author', 'creator', 'keywords', 'publisher', 'twitter:creator', 'twitter:site']);

/** Strip Bryton's JSON-LD and author tags; keep only the small made-by credit in the page body. */
function debrand(response: Response): Response {
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  return new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element(el) {
        el.remove();
      },
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') ?? el.getAttribute('property') ?? '').toLowerCase();
        if (DROP_META.has(name)) el.remove();
        else if (name === 'apple-mobile-web-app-title' || name === 'application-name') el.setAttribute('content', SHIPPED_APP_TITLE);
      },
    })
    .transform(response);
}

/** Absolute links baked into the build name production's host; on staging (or locally) they name this one. */
function retarget(response: Response, origin: string): Response {
  if (origin === SHIPPED_URL || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const swap = (name: string) => ({
    element(el: Element) {
      const value = el.getAttribute(name);
      if (value?.startsWith(SHIPPED_URL)) el.setAttribute(name, origin + value.slice(SHIPPED_URL.length));
    },
  });
  return new HTMLRewriter().on('meta[content]', swap('content')).on('link[href]', swap('href')).transform(response);
}

/** A /shipped/... asset served at the root; its trailing-slash redirects lose the /shipped prefix too. */
async function asset(request: Request, env: HostEnv, url: URL, path: string): Promise<Response> {
  const inner = new URL(`/shipped${path}${url.search}`, url);
  const response = await env.ASSETS.fetch(new Request(inner, request));
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location) {
    const next = new URL(location, inner);
    if (isShippedPath(next.pathname)) return Response.redirect(new URL(next.pathname.slice('/shipped'.length) + next.search, url).toString(), response.status);
  }
  return retarget(noindex(response), url.origin);
}

const ROBOTS = 'User-agent: *\nAllow: /\n';

export async function handleShippedHost(request: Request, env: HostEnv, ctx: ExecutionContext): Promise<Response | null> {
  const response = await route(request, env, ctx);
  if (!response) return null;
  // Redirects and plain-text answers get the headers; HTML pages also get a CSP listing exactly their inline scripts.
  if (response.status >= 300 && response.status < 400) {
    const headers = secure(new Headers(response.headers));
    return new Response(null, { status: response.status, headers });
  }
  return hardenPage(debrand(response));
}

async function route(request: Request, env: HostEnv, ctx: ExecutionContext): Promise<Response | null> {
  const host = env.SHIPPED_HOST;
  if (!host) return null;
  const url = new URL(request.url);
  const path = url.pathname;

  if (url.host !== host) {
    if (!isShippedPath(path) || OWN_FILES.test(path)) return null;
    const target = new URL(path.slice('/shipped'.length) || '/', `https://${host}`);
    target.search = url.search;
    return Response.redirect(target.toString(), 301);
  }

  // Indexing is off (noindex on every page and header), but crawlers must be allowed in to see that.
  if (path === '/robots.txt') return new Response(ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (path === '/manifest.webmanifest' || path === '/manifest.json') {
    return new Response(
      JSON.stringify({
        name: SHIPPED_MANIFEST_NAME,
        short_name: SHIPPED_MANIFEST_SHORT,
        description: SHIPPED_DESCRIPTION,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#121316',
        theme_color: '#121316',
        icons: [
          { src: shareImages.icons['192'], sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: shareImages.icons['512'], sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: shareImages.icons['512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }),
      { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-robots-tag': NOINDEX } },
    );
  }
  if (OWN_FILES.test(path)) return null;
  const qr = path.match(/^\/q\/([a-z0-9]{1,12})\/?$/i);
  if (qr) return qrRedirect(env, qr[1].toLowerCase(), ctx);
  if (path.startsWith('/q/')) return Response.redirect(new URL('/', url).toString(), 302);
  if ((path === '/' || path.startsWith('/r/') || PAGES.test(path)) && (await switchedOff(env, env.DB ?? null)).has('site')) return outOfPaper();
  if (isShippedPath(path)) return Response.redirect(new URL((path.slice('/shipped'.length) || '/') + url.search, url).toString(), 301);
  if (path.startsWith('/r/')) {
    const inner = new URL(`/shipped${path}${url.search}`, url);
    const response = await handleShippedPage(new Request(inner, request), env, ctx);
    const location = response.headers.get('location');
    if (location) {
      const next = new URL(location, inner);
      if (isShippedPath(next.pathname)) return Response.redirect(new URL(next.pathname.slice('/shipped'.length) + next.search, url).toString(), response.status);
    }
    return retarget(noindex(response), url.origin);
  }
  if (PAGES.test(path)) return asset(request, env, url, path);
  return null;
}
