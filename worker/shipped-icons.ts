// Logos for receipt lines: an app icon, favicon or og:image fetched server-side, decoded by resvg
// (PNG/JPEG/GIF/SVG), contrast-stretched, Atkinson-dithered to 1-bit ink and saved as a tiny PNG in R2
// (icons/<hash>.png, served at /api/shipped/icon/<hash>.png). Same look as Bryton's own logos.
import { decodePixels } from './shipped-og';

const SIZE = 48;
const MAX_BYTES = 1_500_000;
const INK: [number, number, number] = [28, 25, 23];

export const iconPath = (hash: string) => `/api/shipped/icon/${hash}.png`;
export const iconKey = (hash: string) => `icons/${hash}.png`;
export const ICON_HASH = /^[a-f0-9]{24}$/;

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

function sniff(bytes: Uint8Array, type: string): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return MIME.png;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return MIME.jpeg;
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return MIME.gif;
  if (type.includes('svg') || /^\s*(<\?xml|<svg)/i.test(new TextDecoder().decode(bytes.subarray(0, 200)))) return MIME.svg;
  return null;
}

/** RGBA in, 1-bit ink mask out (true = ink). */
export function dither(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Float32Array(width * height);
  let opaque = 0;
  for (let i = 0; i < gray.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a > 0.1) opaque++;
    const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    gray[i] = a * lum + (1 - a) * 255;
  }
  const mask = new Uint8Array(width * height);
  if (opaque < 12) return mask;
  // Stretch the tones between the 4th and 96th percentile, so pale or dark icons still read.
  const sorted = Float32Array.from(gray).sort();
  const lo = sorted[Math.floor(sorted.length * 0.04)];
  const hi = sorted[Math.floor(sorted.length * 0.96)];
  const span = Math.max(24, hi - lo);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.min(255, Math.max(0, ((gray[i] - lo) / span) * 255));
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ink = gray[i] < 128;
      mask[i] = ink ? 1 : 0;
      const error = (gray[i] - (ink ? 0 : 255)) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) gray[ny * width + nx] += error;
      }
    }
  }
  return mask;
}

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A 2-colour palette PNG: index 0 is ink, index 1 is transparent paper. */
export async function encodeMask(mask: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const stride = Math.ceil(width / 8);
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) raw[y * (stride + 1) + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([1, 3, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', new Uint8Array([...INK, 243, 234, 216])),
    chunk('tRNS', new Uint8Array([255, 0])),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Fetches, dithers and stores one logo; returns its same-origin path, or null if it isn't usable. */
export async function storeIcon(source: string, bucket: R2Bucket | undefined): Promise<string | null> {
  if (!bucket) return null;
  const hash = await sha(source);
  if (await bucket.head(iconKey(hash))) return iconPath(hash);
  const response = await fetch(source, { headers: { 'user-agent': 'brytonzoz.com-shipped', accept: 'image/*' }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!response?.ok) return null;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES || bytes.length < 60) return null;
  const mime = sniff(bytes, response.headers.get('content-type') ?? '');
  if (!mime) return null;
  // Google's favicon service answers unknown sites with a 16px globe: not worth printing.
  if (source.includes('google.com/s2/favicons') && mime === MIME.png && new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) <= 16) return null;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}"><image width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${base64(bytes)}"/></svg>`;
    const { pixels, width, height } = await decodePixels(svg);
    const mask = dither(pixels, width, height);
    if (!mask.some(Boolean)) return null;
    const png = await encodeMask(mask, width, height);
    await bucket.put(iconKey(hash), png, { httpMetadata: { contentType: 'image/png' } });
    return iconPath(hash);
  } catch (error) {
    console.warn('shipped: icon failed', source.slice(0, 120), String(error).slice(0, 120));
    return null;
  }
}

export async function iconDataUri(path: string | null, bucket: R2Bucket | undefined): Promise<string | null> {
  const hash = path?.match(/\/api\/shipped\/icon\/([a-f0-9]{24})\.png$/)?.[1];
  if (!hash || !bucket) return null;
  const object = await bucket.get(iconKey(hash));
  return object ? `data:image/png;base64,${base64(new Uint8Array(await object.arrayBuffer()))}` : null;
}

export async function bytesDataUri(bytes: ArrayBuffer, mime = 'image/png') {
  return `data:${mime};base64,${base64(new Uint8Array(bytes))}`;
}
