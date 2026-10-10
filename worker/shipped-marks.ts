// Color marks for the sponsor rail: Brandfetch, then a favicon, cached in R2 and served same-origin
// so CSP doesn't have to allow those CDNs. Receipts keep using 1-bit logos; this is UI only.

import { HOUSE_SLOTS, isSlot } from '../lib/shipped-sponsors';
import { imageSize, MAX_IMAGE_SIDE, safeFetch } from './shipped-fetch';
import { INERT_CSP, secure } from './shipped-guard';
import { brandIcon, hostOf, type SourceEnv } from './shipped-sources';

const MARK_KEY = (host: string) => `marks/v1/${host}`;
const MAX_BYTES = 200_000;

export function markUrls(host: string, brand?: string | null): string[] {
  const urls: string[] = [];
  if (brand) urls.push(brand);
  urls.push(`https://cdn.brandfetch.io/${encodeURIComponent(host)}/w/128/h/128/icon`);
  urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`);
  urls.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
  return urls;
}

function sniffMime(bytes: Uint8Array, type: string): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'image/x-icon';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  const mime = type.split(';')[0]?.trim();
  if (mime && mime.startsWith('image/') && !mime.includes('svg')) return mime;
  return null;
}

function isTinyGoogleGlobe(url: string, mime: string, bytes: Uint8Array): boolean {
  if (!url.includes('google.com/s2/favicons') || mime !== 'image/png' || bytes.length < 24) return false;
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) <= 16;
}

function imageResponse(body: BodyInit, mime: string, cache: string): Response {
  const headers = secure(new Headers({ 'content-type': mime, 'cache-control': cache, 'x-robots-tag': 'noindex' }));
  headers.set('content-security-policy', INERT_CSP);
  return new Response(body, { headers });
}

async function pullMark(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const fetched = await safeFetch(url, {
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/x-icon,*/*;q=0.1',
    maxBytes: MAX_BYTES,
    timeoutMs: 4000,
    types: ['image/'],
  }).catch(() => null);
  if (!fetched || fetched.bytes.length < 32) return null;
  const mime = sniffMime(fetched.bytes, fetched.type);
  if (!mime) return null;
  if (isTinyGoogleGlobe(url, mime, fetched.bytes)) return null;
  if (mime !== 'image/x-icon' && mime !== 'image/vnd.microsoft.icon') {
    const size = imageSize(fetched.bytes);
    if (size && (size.width < 8 || size.height < 8 || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE)) return null;
  }
  return { bytes: fetched.bytes, mime };
}

export async function houseMark(env: SourceEnv & { SHIPPED?: R2Bucket }, slot: number): Promise<Response> {
  if (!isSlot(slot)) return new Response('Not found', { status: 404 });
  const host = hostOf(HOUSE_SLOTS[slot].url);
  if (!host) return new Response('Not found', { status: 404 });
  const key = MARK_KEY(host);
  const cached = await env.SHIPPED?.get(key);
  if (cached) {
    return imageResponse(cached.body, cached.httpMetadata?.contentType || 'image/png', 'public, max-age=86400');
  }
  const brand = await brandIcon(HOUSE_SLOTS[slot].url, env).catch(() => null);
  for (const url of markUrls(host, brand)) {
    const got = await pullMark(url);
    if (!got) continue;
    const copy = got.bytes.slice();
    await env.SHIPPED?.put(key, copy, { httpMetadata: { contentType: got.mime } }).catch(() => undefined);
    return imageResponse(got.bytes, got.mime, 'public, max-age=86400');
  }
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
}
