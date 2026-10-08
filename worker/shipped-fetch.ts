// Every server-side fetch of a URL that a visitor typed or a fetched page named (their site, its icons,
// a sponsor's link) goes through safeFetch: http(s) on the default ports only, no credentials, no IP
// literals, no private, loopback, link-local or metadata hosts, redirects followed by hand (at most 3,
// each one checked again), a timeout and a byte cap. Workers can't reach private networks in the first
// place; this keeps it that way even for hostnames that point somewhere odd, and keeps us off anything
// that isn't a plain public web page.

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa|test|invalid|example|onion)$|^metadata(\.google\.internal)?$|^(instance-data|metadata\.goog)$/i;

export type FetchProblem = 'scheme' | 'credentials' | 'port' | 'ip' | 'host' | 'redirect' | 'too-big' | 'timeout' | 'status' | 'type' | 'network';

export class FetchBlocked extends Error {
  constructor(public problem: FetchProblem) {
    super(problem);
  }
}

const isIpv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
// Decimal, octal and hex spellings of an address ("2130706433", "0x7f.1") are IPs too.
const looksNumeric = (host: string) => /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host);

/** The URL if it's a public http(s) address we'd fetch, else the reason it isn't. */
export function checkFetchUrl(raw: string | URL): { ok: true; url: URL } | { ok: false; problem: FetchProblem } {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    return { ok: false, problem: 'scheme' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, problem: 'scheme' };
  if (url.username || url.password) return { ok: false, problem: 'credentials' };
  if (url.port && url.port !== '443' && url.port !== '80') return { ok: false, problem: 'port' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':') || isIpv4(host) || looksNumeric(host)) return { ok: false, problem: 'ip' };
  if (!host.includes('.') || BLOCKED_HOSTS.test(host) || host.length > 253) return { ok: false, problem: 'host' };
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, problem: 'host' };
  url.hash = '';
  return { ok: true, url };
}

export type SafeFetchOptions = {
  accept?: string;
  /** Bytes of body to read at most (default 1 MB). */
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Content types we expect (prefix match); anything else is refused. */
  types?: string[];
  userAgent?: string;
};

export type SafeResponse = { url: string; status: number; type: string; bytes: Uint8Array };

const UA = 'shipped-receipts (+https://shipped.brytonzoz.com/)';

/** Reads at most maxBytes; bigger bodies are refused rather than truncated. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new FetchBlocked('too-big');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchBlocked('too-big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { accept = '*/*', maxBytes = 1_000_000, timeoutMs = 6000, maxRedirects = 3, types, userAgent = UA } = options;
  const deadline = AbortSignal.timeout(timeoutMs);
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = checkFetchUrl(current);
    if (!checked.ok) throw new FetchBlocked(checked.problem);
    let response: Response;
    try {
      response = await fetch(checked.url.toString(), { headers: { 'user-agent': userAgent, accept }, redirect: 'manual', signal: deadline });
    } catch (error) {
      throw new FetchBlocked(deadline.aborted || (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new FetchBlocked('redirect');
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchBlocked('status');
    }
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (types && !types.some((prefix) => type.startsWith(prefix))) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchBlocked('type');
    }
    try {
      return { url: checked.url.toString(), status: response.status, type, bytes: await readCapped(response, maxBytes) };
    } catch (error) {
      if (error instanceof FetchBlocked) throw error;
      throw new FetchBlocked(deadline.aborted ? 'timeout' : 'network');
    }
  }
  throw new FetchBlocked('redirect');
}

/** Where a link really goes after its redirects (sponsor links: a QR code must not bounce somewhere else). */
export async function finalUrl(raw: string, timeoutMs = 5000): Promise<string> {
  const deadline = AbortSignal.timeout(timeoutMs);
  let current = raw;
  for (let hop = 0; hop <= 3; hop++) {
    const checked = checkFetchUrl(current);
    if (!checked.ok) throw new FetchBlocked(checked.problem);
    let response: Response;
    try {
      response = await fetch(checked.url.toString(), { method: 'GET', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'manual', signal: deadline });
    } catch {
      throw new FetchBlocked(deadline.aborted ? 'timeout' : 'network');
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FetchBlocked('redirect');
      current = new URL(location, checked.url).toString();
      continue;
    }
    return checked.url.toString();
  }
  throw new FetchBlocked('redirect');
}

// ---- Image dimensions, before anything decodes them (a 1 MB PNG can claim 50,000 × 50,000 px) ----------

export function imageSize(bytes: Uint8Array): { width: number; height: number; type: 'png' | 'jpeg' | 'gif' | 'webp' } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20), type: 'png' };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), type: 'gif' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), type: 'jpeg' };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return null;
  return null;
}

export const MAX_IMAGE_SIDE = 2048;
