// Shipped's guardrails, in one place so worker/shipped.ts reads as the product and this reads as the fence
// (threat list and kill switches: docs/shipped-security.md). Everything here is server-side and keyed on
// D1, so it holds across isolates and data centers:
//   - fixed-window counters per hashed IP, per /24 (IPv4) or /48 (IPv6) subnet and globally
//   - locks: one print per IP at a time, one print per subject at a time, a global ceiling of concurrent prints
//   - the daily AI budget, reserved before each call (concurrent prints can't overspend) and settled after
//   - kill switches (D1 flags set in /admin, or the SHIPPED_OFF var) for the site, printing, sponsors, prints
//   - "are you human": Turnstile when its keys exist, else a proof-of-work puzzle (HMAC-signed, single use)
//   - request hygiene: same-origin POSTs only, body size caps, obvious scripts and headless browsers turned away
//   - security headers and a hash-based CSP for every page on the Shipped host
// No IP address is ever stored: keys are SHA-256 of the address and the UTC day.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const today = () => new Date().toISOString().slice(0, 10);

export interface GuardEnv {
  SITE_ENV?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_PASSWORD?: string;
  /** Comma list of kill switches forced on (site, generate, sponsors, prints, sponsor-display). */
  SHIPPED_OFF?: string;
  /** Daily AI budget in USD (default 5). */
  SHIPPED_DAILY_CAP_USD?: string;
  /** Receipts generated per UTC day across everyone (default 1500). */
  SHIPPED_DAILY_PRINTS?: string;
  /** Receipts generated per minute across everyone (default 20). */
  SHIPPED_PRINTS_PER_MINUTE?: string;
  /** Prints generating at the same moment across everyone (default 6). */
  SHIPPED_MAX_CONCURRENT?: string;
  /** Proof-of-work difficulty in leading zero bits when Turnstile isn't configured (default 16). */
  SHIPPED_POW_BITS?: string;
  SHIPPED_POW_SECRET?: string;
}

const isProduction = (env: GuardEnv) => env.SITE_ENV === 'production';
const num = (value: string | undefined, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? Math.min(max, Math.max(min, n)) : fallback;
};

// ---- Tables -----------------------------------------------------------------------------------------

const GUARD_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS shipped_limits (key TEXT PRIMARY KEY, win INTEGER NOT NULL, count INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS shipped_locks (key TEXT PRIMARY KEY, until INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS shipped_flags (key TEXT PRIMARY KEY, value TEXT, set_at INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS shipped_spend (
    day TEXT PRIMARY KEY, receipts INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0,
    searches INTEGER NOT NULL DEFAULT 0, reserved_micros INTEGER NOT NULL DEFAULT 0)`,
];

const guardReady = new WeakMap<D1Database, Promise<unknown>>();

export async function guardTables(db: D1Database): Promise<void> {
  let ready = guardReady.get(db);
  if (!ready) {
    ready = (async () => {
      await db.batch(GUARD_SCHEMA.map((sql) => db.prepare(sql)));
      await db
        .prepare('ALTER TABLE shipped_spend ADD COLUMN reserved_micros INTEGER NOT NULL DEFAULT 0')
        .run()
        .catch((error: unknown) => {
          if (!String(error).includes('duplicate column')) throw error;
        });
    })().catch((error) => {
      guardReady.delete(db);
      throw error;
    });
    guardReady.set(db, ready);
  }
  await ready;
}

// ---- Who's asking ---------------------------------------------------------------------------------

export const clientIp = (request: Request) => request.headers.get('cf-connecting-ip')?.trim() || 'unknown';

/** The network an address sits in: IPv4 /24, IPv6 /48. One person with many addresses usually stays inside one. */
export function subnetOf(ip: string): string {
  if (ip.includes(':')) {
    const groups = expandIpv6(ip);
    return groups ? `${groups.slice(0, 3).join(':')}::/48` : ip;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.0/24` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (clean.includes('.')) return null;
  const [head, tail] = clean.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  if (clean.split('::').length > 2) return null;
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

async function sha256Hex(text: string, bytes = 32): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Salted with the UTC day: counters work, addresses aren't recoverable from D1. */
export const hashedKey = (value: string, day = today()) => sha256Hex(`${value}|${day}|shipped`, 12);

// ---- Counters ---------------------------------------------------------------------------------------

/** Fixed-window counter; true while this hit is within the limit. */
export async function hit(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  await guardTables(db);
  const win = Math.floor(now / windowMs);
  const row = await db
    .prepare(
      `INSERT INTO shipped_limits (key, win, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET count = CASE WHEN win = excluded.win THEN count + 1 ELSE 1 END, win = excluded.win
       RETURNING count`,
    )
    .bind(key, win)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

export type Limit = { ip: number; subnet: number; window: number };

/** Per hashed IP and per hashed subnet, all server-side. */
export const LIMITS = {
  lookup: { ip: 40, subnet: 150, window: HOUR },
  print: { ip: 8, subnet: 24, window: HOUR },
  toss: { ip: 30, subnet: 90, window: HOUR },
  shared: { ip: 60, subnet: 200, window: HOUR },
  seen: { ip: 60, subnet: 240, window: HOUR },
  takedown: { ip: 5, subnet: 15, window: HOUR },
  bid: { ip: 6, subnet: 12, window: HOUR },
  order: { ip: 10, subnet: 25, window: HOUR },
  challenge: { ip: 60, subnet: 200, window: HOUR },
  admin: { ip: 10, subnet: 30, window: HOUR },
} satisfies Record<string, Limit>;
export type LimitName = keyof typeof LIMITS;

/** True when this request is over its limit (and counts it either way). */
export async function overLimit(db: D1Database, request: Request, name: LimitName, now = Date.now()): Promise<boolean> {
  const limit = LIMITS[name];
  const ip = clientIp(request);
  const [ipKey, netKey] = await Promise.all([hashedKey(ip), hashedKey(subnetOf(ip))]);
  const [ipOk, netOk] = await Promise.all([hit(db, `${name}:ip:${ipKey}`, limit.ip, limit.window, now), hit(db, `${name}:net:${netKey}`, limit.subnet, limit.window, now)]);
  return !ipOk || !netOk;
}

/** Whether this request is already over its limit, without counting it (for counting only failures, e.g. admin logins). */
export async function atLimit(db: D1Database, request: Request, name: LimitName, now = Date.now()): Promise<boolean> {
  await guardTables(db);
  const limit = LIMITS[name];
  const ip = clientIp(request);
  const [ipKey, netKey] = await Promise.all([hashedKey(ip), hashedKey(subnetOf(ip))]);
  const win = Math.floor(now / limit.window);
  const rows = await db
    .prepare('SELECT key, count FROM shipped_limits WHERE key IN (?, ?) AND win = ?')
    .bind(`${name}:ip:${ipKey}`, `${name}:net:${netKey}`, win)
    .all<{ key: string; count: number }>();
  return rows.results.some((row) => row.count >= (row.key.includes(':ip:') ? limit.ip : limit.subnet));
}

/** Everyone together: at most N receipts generated per minute and per day. */
export async function overGlobalPrintLimit(db: D1Database, env: GuardEnv, now = Date.now()): Promise<'minute' | 'day' | null> {
  const perMinute = num(env.SHIPPED_PRINTS_PER_MINUTE, 20, 1);
  const perDay = num(env.SHIPPED_DAILY_PRINTS, 1500, 1);
  if (!(await hit(db, 'print:global:minute', perMinute, MINUTE, now))) return 'minute';
  if (!(await hit(db, 'print:global:day', perDay, DAY, now))) return 'day';
  return null;
}

/** Old windows, now and then. */
export const sweepLimits = (db: D1Database, now = Date.now()) =>
  db.batch([db.prepare('DELETE FROM shipped_limits WHERE win < ? AND key NOT LIKE ?').bind(Math.floor(now / HOUR) - 48, '%:day'), db.prepare('DELETE FROM shipped_locks WHERE until < ?').bind(now)]);

// ---- Locks ------------------------------------------------------------------------------------------

/** Takes the lock if it's free or stale. */
export async function acquire(db: D1Database, key: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  await guardTables(db);
  const row = await db
    .prepare(
      `INSERT INTO shipped_locks (key, until) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE shipped_locks.until < ? RETURNING key`,
    )
    .bind(key, now + ttlMs, now)
    .first<{ key: string }>();
  return Boolean(row);
}

export const release = (db: D1Database, key: string) => db.prepare('DELETE FROM shipped_locks WHERE key = ?').bind(key).run();

/** One of N global print slots, or null when all are busy. Released by the caller. */
export async function concurrencySlot(db: D1Database, env: GuardEnv, ttlMs: number, now = Date.now()): Promise<string | null> {
  const max = num(env.SHIPPED_MAX_CONCURRENT, 6, 1, 50);
  const start = Math.floor(Math.random() * max);
  for (let i = 0; i < max; i++) {
    const key = `gen:slot:${(start + i) % max}`;
    if (await acquire(db, key, ttlMs, now)) return key;
  }
  return null;
}

// ---- Budget -----------------------------------------------------------------------------------------

export const capMicros = (env: GuardEnv) => Math.round(num(env.SHIPPED_DAILY_CAP_USD, 5, 0, 1000) * 1_000_000);

/**
 * Holds `micros` of today's budget before an AI call, so concurrent prints can't push past the cap together.
 * False when the cap would be passed: the machine is OUT OF PAPER until tomorrow (UTC) or a higher cap.
 */
export async function reserveBudget(db: D1Database, cap: number, micros: number, day = today()): Promise<boolean> {
  await guardTables(db);
  if (micros > cap) return false;
  const row = await db
    .prepare(
      `INSERT INTO shipped_spend (day, reserved_micros) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET reserved_micros = reserved_micros + excluded.reserved_micros
       WHERE shipped_spend.cost_micros + shipped_spend.reserved_micros + excluded.reserved_micros <= ? RETURNING day`,
    )
    .bind(day, micros, cap)
    .first<{ day: string }>();
  return Boolean(row);
}

/** Swaps the reservation for what the call really cost (which may be more; the next reservation sees it). */
export const settleBudget = (db: D1Database, reserved: number, actual: number, day = today()) =>
  db
    .prepare('UPDATE shipped_spend SET reserved_micros = MAX(0, reserved_micros - ?), cost_micros = cost_micros + ? WHERE day = ?')
    .bind(reserved, Math.max(0, Math.round(actual)), day)
    .run();

/** What today has spent plus what's held for calls in flight. */
export async function budgetUsed(db: D1Database, day = today()): Promise<{ spent: number; reserved: number }> {
  await guardTables(db);
  const row = await db.prepare('SELECT cost_micros, reserved_micros FROM shipped_spend WHERE day = ?').bind(day).first<{ cost_micros: number; reserved_micros: number }>();
  return { spent: row?.cost_micros ?? 0, reserved: row?.reserved_micros ?? 0 };
}

// ---- Kill switches ------------------------------------------------------------------------------------

export const SWITCHES = ['site', 'generate', 'sponsors', 'prints', 'sponsor-display'] as const;
export type Switch = (typeof SWITCHES)[number];
export const isSwitch = (value: unknown): value is Switch => SWITCHES.includes(value as Switch);

let switchMemo: { at: number; db: D1Database | null; off: Set<Switch> } | null = null;

/** Which parts are switched off: SHIPPED_OFF (wrangler var) plus /admin's flags (cached 5 s per isolate). */
export async function switchedOff(env: GuardEnv, db: D1Database | null, now = Date.now()): Promise<Set<Switch>> {
  const off = new Set<Switch>((env.SHIPPED_OFF ?? '').split(',').map((s) => s.trim()).filter(isSwitch));
  if (db) {
    if (!switchMemo || switchMemo.db !== db || now - switchMemo.at > 5000) {
      await guardTables(db);
      const rows = await db.prepare(`SELECT key FROM shipped_flags WHERE key LIKE 'off:%'`).all<{ key: string }>();
      switchMemo = { at: now, db, off: new Set(rows.results.map((row) => row.key.slice(4)).filter(isSwitch)) };
    }
    for (const name of switchMemo.off) off.add(name);
  }
  // Switching the whole site off switches everything off.
  if (off.has('site')) for (const name of SWITCHES) off.add(name);
  return off;
}

export async function setSwitch(db: D1Database, name: Switch, off: boolean): Promise<void> {
  await guardTables(db);
  if (off) await db.prepare(`INSERT INTO shipped_flags (key, value, set_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET set_at = excluded.set_at`).bind(`off:${name}`, Date.now()).run();
  else await db.prepare('DELETE FROM shipped_flags WHERE key = ?').bind(`off:${name}`).run();
  switchMemo = null;
}

// ---- Are you human? ---------------------------------------------------------------------------------

// Cloudflare's published always-pass test keys: staging works before real Turnstile keys exist.
const TEST_TURNSTILE = { site: '1x00000000000000000000AA', secret: '1x0000000000000000000000000000000AA' };

export function turnstileKeys(env: GuardEnv): { site: string; secret: string; test: boolean } | null {
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) return { site: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET_KEY, test: false };
  return isProduction(env) ? null : { ...TEST_TURNSTILE, test: true };
}

export type HumanCheck = { kind: 'turnstile'; siteKey: string } | { kind: 'pow'; bits: number };

export function humanCheck(env: GuardEnv): HumanCheck {
  const keys = turnstileKeys(env);
  return keys ? { kind: 'turnstile', siteKey: keys.site } : { kind: 'pow', bits: powBits(env) };
}

const powBits = (env: GuardEnv) => Math.round(num(env.SHIPPED_POW_BITS, 16, 8, 24));
const powSecret = (env: GuardEnv) => env.SHIPPED_POW_SECRET || env.TURNSTILE_SECRET_KEY || env.ADMIN_PASSWORD || 'shipped-pow';
const POW_LIFE = 10 * MINUTE;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A fresh puzzle: find a nonce so SHA-256("<challenge>:<nonce>") starts with `bits` zero bits. */
export async function issueChallenge(env: GuardEnv, now = Date.now()): Promise<{ challenge: string; bits: number }> {
  const bits = powBits(env);
  const rand = crypto.randomUUID().replace(/-/g, '');
  const body = `${now}.${bits}.${rand}`;
  return { challenge: `${body}.${await hmacHex(powSecret(env), body)}`, bits };
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** "pow:<challenge>:<nonce>", signed by us, under 10 minutes old, solved, and never used before. */
export async function verifyPow(env: GuardEnv, db: D1Database | null, token: string, now = Date.now()): Promise<boolean> {
  const match = token.match(/^pow:((\d{13})\.(\d{1,2})\.([a-f0-9]{32})\.([a-f0-9]{32})):(\d{1,12})$/);
  if (!match) return false;
  const [, challenge, at, bits, rand, sig, nonce] = match;
  const issued = Number(at);
  if (!(now - issued >= 0 && now - issued < POW_LIFE)) return false;
  if (Number(bits) < powBits(env)) return false;
  const expected = await hmacHex(powSecret(env), `${at}.${bits}.${rand}`);
  if (!sameText(expected, sig)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge}:${nonce}`)));
  if (leadingZeroBits(digest) < Number(bits)) return false;
  return db ? acquire(db, `pow:${rand}`, POW_LIFE * 2, now) : true;
}

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Turnstile's siteverify (single-use tokens, 5 s timeout) or, without Turnstile keys, the proof of work. */
export async function verifyHuman(env: GuardEnv, db: D1Database | null, token: unknown, request: Request): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const keys = turnstileKeys(env);
  if (!keys) return verifyPow(env, db, token);
  const form = new FormData();
  form.set('secret', keys.secret);
  form.set('response', token);
  const ip = clientIp(request);
  if (ip !== 'unknown') form.set('remoteip', ip);
  form.set('idempotency_key', crypto.randomUUID());
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    const result = (await response.json()) as { success?: boolean; hostname?: string };
    if (result.success !== true) return false;
    // The test keys answer "example.com"; real ones say which page solved it, and it has to be ours.
    return keys.test || !result.hostname || result.hostname === new URL(request.url).hostname;
  } catch {
    return false;
  }
}

// ---- Request hygiene --------------------------------------------------------------------------------

const SCRIPTED = /curl|wget|python|httpie|go-http|java\/|okhttp|libwww|scrapy|aiohttp|axios|node-fetch|undici|postman|insomnia|headlesschrome|phantomjs|selenium|puppeteer|playwright|bot\b|spider|crawler/i;

/** Why a POST that spends money or makes content is refused before anything else runs, or null. */
export function refuseRequest(request: Request, maxBytes: number): { status: number; error: string } | null {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return { status: 403, error: 'cross-origin' };
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return { status: 403, error: 'cross-origin' };
  const ua = request.headers.get('user-agent') ?? '';
  if (ua.length < 20 || SCRIPTED.test(ua)) return { status: 403, error: 'browser-only' };
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) return { status: 413, error: 'too-big' };
  return null;
}

/** The body as JSON, at most `max` bytes whatever content-length claimed. */
export async function readJsonCapped(request: Request, max = 8192): Promise<Record<string, unknown> | null> {
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---- Headers ------------------------------------------------------------------------------------------

const BASE_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=(), payment=(self "https://js.stripe.com")',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

/** Every Shipped response: API JSON, images and pages. */
export function secure(headers: Headers): Headers {
  for (const [name, value] of Object.entries(BASE_HEADERS)) headers.set(name, value);
  headers.delete('access-control-allow-origin');
  return headers;
}

/** For images and other non-page bodies: nothing in them may run. */
export const INERT_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";

export function cspFor(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets the pile's physics (Rapier) compile WebAssembly; JS eval stays blocked.
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.map((hash) => `'sha256-${hash}'`).join(' ')} https://challenges.cloudflare.com https://js.stripe.com https://static.cloudflareinsights.com`.replace(/\s+/g, ' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.stripe.com",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com https://*.stripe.com https://m.stripe.network https://cloudflareinsights.com",
    'frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://pay.google.com',
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

const EXECUTABLE = /^(|text\/javascript|application\/javascript|module)$/i;

/** SHA-256 (base64) of every inline script the browser would run. Data blocks (JSON, JSON-LD) don't run. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
    if (!EXECUTABLE.test(type)) continue;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[2]));
    hashes.add(btoa(String.fromCharCode(...new Uint8Array(digest))));
  }
  return [...hashes];
}

/** A page with the security headers and a CSP that allows exactly its own inline scripts. */
export async function hardenPage(response: Response): Promise<Response> {
  const headers = secure(new Headers(response.headers));
  const type = headers.get('content-type') ?? '';
  if (!type.includes('text/html') || !response.body) {
    if (!type.includes('text/html')) headers.set('content-security-policy', INERT_CSP);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const html = await response.text();
  headers.set('content-security-policy', cspFor(await inlineScriptHashes(html)));
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
