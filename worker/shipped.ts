// /shipped/ backend: "Shipped in <year>" receipts (anyone's public shipped work, found by free APIs and
// Claude's web search, see worker/shipped-sources.ts and worker/shipped-ai.ts) and the sponsor lines
// printed in every shared receipt's PAID FOR BY block (paid, then approved by Bryton in /admin).
//
//   GET  /api/shipped/state            counters, generator + sponsor status, the opt-in "recently printed" strip
//   POST /api/shipped/lookup           { q } -> { candidates, auto } (who did they mean?)
//   POST /api/shipped/print            { subject, token, listed } -> { id } (same subject within 7 days: cached)
//   POST /api/shipped/shared           { id, how } share counter (sendBeacon)
//   POST /api/shipped/takedown         { id, reason, token } "Not you? Remove this receipt" -> /admin
//   GET  /api/shipped/receipts/<id>    a printed receipt + its PAID FOR BY block
//   GET  /api/shipped/icon/<hash>.png  a receipt line's 1-bit logo (worker/shipped-icons.ts)
//   POST /api/shipped/sponsor          multipart { tier, text, url?, logo?, token } -> { url } (checkout)
//   GET  /api/shipped/sponsor/status?checkout=<id>        after checkout: confirms payment, where the line stands
//   GET  /api/shipped/sponsor/receipt.png?checkout=<id>   the supporter's downloadable receipt image
//   POST /api/shipped/webhook/<id>     payment provider webhook (worker/shipped-pay.ts; Stripe: /webhook/stripe)
//   GET  /api/shipped/logo/<id>.png    an approved sponsor's 1-bit logo
//   GET  /shipped/r/<id>/              share page: the static shell with this receipt's tags and data
//   GET  /shipped/r/<id>/og.png        the 1200×675 card for X        (?download=1 to save it)
//   GET  /shipped/r/<id>/receipt.png   the whole receipt as one image (?download=1 to save it)
//   /api/admin/shipped*                moderation, takedowns, impressions, spend; behind the /admin password
//
// Tables are created (and new columns added) on first use; see SCHEMA below.
import { DEFAULT_MODEL, PrintError, assembleReceipt, demoReceipt, maxSearches, type AiEnv, type DraftItem } from './shipped-ai';
import { ICON_HASH, bytesDataUri, iconDataUri, iconKey, storeIcon } from './shipped-icons';
import { renderPng, yearCardPng, yearTallPng, type LogoResolver } from './shipped-og';
import { isProduction, sponsorProvider, type PayEnv, type SponsorEvent } from './shipped-pay';
import { clean, faviconUrl, gather, githubUser, hostOf, readSite, searchGithubUsers, type SourceEnv } from './shipped-sources';
import { TINYFISH_DAILY, type TinyfishKind, type TinyfishMeter } from './shipped-tinyfish';
import { receiptBarcodeUnits, receiptDate } from '../lib/shipped';
import { supporterReceiptSvg } from '../lib/receipt-svg';
import { money } from '../lib/shipped-receipt';
import {
  RECEIPT_PATH,
  CARD_PATH,
  isDomain,
  isGithubLogin,
  isXHandle,
  itemsShipped,
  readQuery,
  receiptNumber,
  shareText,
  shippedYear,
  subjectKey,
  subjectLabel,
  type Candidate,
  type PaidBy,
  type PaidFor,
  type Subject,
  type SubjectKind,
  type YearItem,
  type YearReceipt,
} from '../lib/shipped-year';
import {
  HOUSE_SPONSORS,
  LOGO_LIMITS,
  SPONSOR_CONFIG,
  SPONSOR_TIERS,
  hasBlockedWord,
  houseLine,
  isSponsorTier,
  priceCents,
  validateSponsor,
  weightedPick,
  type SponsorTier,
} from '../lib/shipped-sponsors';

export interface ShippedEnv extends AiEnv, PayEnv, SourceEnv {
  DB?: D1Database;
  SHIPPED?: R2Bucket;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Daily AI budget in USD (default 5); printing pauses for the day once reached. */
  SHIPPED_DAILY_CAP_USD?: string;
  /** The year receipts itemize (default: the current year). */
  SHIPPED_YEAR?: string;
}

/**
 * Secret names as Bryton set them (claude_key, tinyfish), their uppercase GitHub forms, or the documented
 * ones: whichever exists. Everything below reads ANTHROPIC_API_KEY and TINYFISH_API_KEY.
 */
export function withKeyAliases<T extends ShippedEnv>(env: T): T {
  const raw = env as T & Record<string, unknown>;
  // Secrets set by hand in the dashboard keep whatever casing they were typed with (e.g. "Claude_key").
  const keys = Object.keys(raw);
  const pick = (...names: string[]) =>
    names
      .map((name) => raw[keys.find((key) => key.toLowerCase() === name.toLowerCase()) ?? name])
      .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const anthropic = pick('claude_key', 'CLAUDE_KEY', 'ANTHROPIC_API_KEY');
  const tinyfish = pick('tinyfish', 'TINYFISH', 'TINYFISH_API_KEY');
  const workspace = pick('claude_workspace', 'CLAUDE_WORKSPACE', 'claude_workspace_id', 'ANTHROPIC_WORKSPACE_ID');
  if (anthropic === env.ANTHROPIC_API_KEY && tinyfish === env.TINYFISH_API_KEY && workspace === env.ANTHROPIC_WORKSPACE_ID) return env;
  // A prototype link keeps every binding (DB, R2, ASSETS) reachable without copying them.
  return Object.assign(Object.create(env) as T, { ANTHROPIC_API_KEY: anthropic, TINYFISH_API_KEY: tinyfish, ANTHROPIC_WORKSPACE_ID: workspace });
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const CACHE_DAYS = 7;
const PRINT_LIMIT_PER_HOUR = 10;
const LOOKUP_LIMIT_PER_HOUR = 40;
const SPONSOR_LIMIT_PER_HOUR = 6;
const TAKEDOWN_LIMIT_PER_HOUR = 5;
const DEFAULT_CAP_USD = 5;
/** Bump when the share images change, so cached ones are redrawn. */
const IMAGE_VERSION = 2;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipped_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, login_key TEXT NOT NULL, day TEXT NOT NULL,
    mode TEXT NOT NULL, data TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_micros INTEGER, created_at INTEGER NOT NULL,
    searches INTEGER, listed INTEGER NOT NULL DEFAULT 0, shares INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS shipped_receipts_daily ON shipped_receipts (login_key, day, mode)',
  `CREATE TABLE IF NOT EXISTS shipped_spend (
    day TEXT PRIMARY KEY, receipts INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0,
    searches INTEGER NOT NULL DEFAULT 0)`,
  'CREATE TABLE IF NOT EXISTS shipped_limits (key TEXT PRIMARY KEY, win INTEGER NOT NULL, count INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS shipped_takedowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id INTEGER NOT NULL, subject_key TEXT NOT NULL, reason TEXT,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS shipped_takedowns_key ON shipped_takedowns (subject_key, status)',
  `CREATE TABLE IF NOT EXISTS sponsor_impressions (
    sponsor TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sponsor, day, kind))`,
  `CREATE TABLE IF NOT EXISTS sponsor_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, text TEXT NOT NULL, url TEXT, logo_key TEXT,
    status TEXT NOT NULL, roll INTEGER NOT NULL, line_no INTEGER, amount_cents INTEGER NOT NULL, provider TEXT NOT NULL,
    checkout_id TEXT, order_id TEXT, note TEXT, created_at INTEGER NOT NULL, paid_at INTEGER, reviewed_at INTEGER,
    starts_at INTEGER, ends_at INTEGER, tax_cents INTEGER, total_cents INTEGER)`,
  'CREATE INDEX IF NOT EXISTS sponsor_lines_status ON sponsor_lines (status, tier)',
  'CREATE UNIQUE INDEX IF NOT EXISTS sponsor_lines_checkout ON sponsor_lines (checkout_id)',
  'CREATE INDEX IF NOT EXISTS sponsor_lines_order ON sponsor_lines (order_id)',
  // Global switches, e.g. 'out-of-credit' (set when Anthropic says the prepaid credits are gone).
  'CREATE TABLE IF NOT EXISTS shipped_flags (key TEXT PRIMARY KEY, value TEXT, set_at INTEGER NOT NULL)',
  // TinyFish units used per UTC day, so we stay inside the free allowance.
  'CREATE TABLE IF NOT EXISTS shipped_tinyfish (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))',
];
// Columns added after the tables first shipped; "duplicate column" means it's already there.
const COLUMNS = [
  'ALTER TABLE sponsor_lines ADD COLUMN tax_cents INTEGER',
  'ALTER TABLE sponsor_lines ADD COLUMN total_cents INTEGER',
  'ALTER TABLE shipped_receipts ADD COLUMN searches INTEGER',
  'ALTER TABLE shipped_receipts ADD COLUMN listed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_receipts ADD COLUMN shares INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_receipts ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_spend ADD COLUMN searches INTEGER NOT NULL DEFAULT 0',
];

async function migrate(db: D1Database) {
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  for (const sql of COLUMNS) {
    await db
      .prepare(sql)
      .run()
      .catch((error: unknown) => {
        if (!String(error).includes('duplicate column')) throw error;
      });
  }
}

let schemaReady: Promise<unknown> | null = null;

async function database(env: ShippedEnv): Promise<D1Database | null> {
  const db = env.DB;
  if (!db) return null;
  schemaReady ??= migrate(db).catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
  return db;
}

const NOINDEX = 'noindex, nofollow, noarchive';

function json(data: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache, 'x-robots-tag': NOINDEX },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const capMicros = (env: ShippedEnv) => Math.round((Number(env.SHIPPED_DAILY_CAP_USD) || DEFAULT_CAP_USD) * 1_000_000);
const yearOf = (env: ShippedEnv) => shippedYear(env.SHIPPED_YEAR);
const modeOf = (year: number) => `y${year}`;

// Cloudflare's published always-pass test keys: staging works before real Turnstile keys exist.
const TEST_TURNSTILE = { site: '1x00000000000000000000AA', secret: '1x0000000000000000000000000000000AA' };

function turnstileKeys(env: ShippedEnv): { site: string; secret: string; test: boolean } | null {
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) return { site: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET_KEY, test: false };
  return isProduction(env) ? null : { ...TEST_TURNSTILE, test: true };
}

let warnedTurnstile = false;

/** Without Turnstile keys in production, printing relies on the per-IP limits and the daily spend cap. */
async function verifyTurnstile(env: ShippedEnv, token: unknown, ip: string): Promise<boolean> {
  const keys = turnstileKeys(env);
  if (!keys) {
    if (!warnedTurnstile) console.warn('shipped: TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY not set; relying on rate limits and the spend cap');
    warnedTurnstile = true;
    return true;
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.set('secret', keys.secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

/** Salted per day, so no IP address is ever stored. */
async function ipKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${today()}|shipped`));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Fixed-window counter; true while under the limit. */
async function allow(db: D1Database, key: string, limit: number, windowMs: number): Promise<boolean> {
  const win = Math.floor(Date.now() / windowMs);
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

const limited = async (request: Request, db: D1Database, name: string, limit: number) => !(await allow(db, `${name}:${await ipKey(request)}`, limit, HOUR));

function seedOf(text: string): number {
  let hash = 2166136261;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return hash >>> 0;
}

type GeneratorState = { enabled: boolean; demo: boolean; reason: string | null; turnstileSiteKey: string | null; year: number; sources: string[] };

function sourceNames(env: ShippedEnv): string[] {
  const names = ['github', 'appstore', 'hn', 'npm'];
  if (env.PRODUCTHUNT_TOKEN) names.push('producthunt');
  if (env.TINYFISH_API_KEY) names.push('tinyfish');
  return names;
}

async function generatorState(env: ShippedEnv, db: D1Database | null): Promise<GeneratorState> {
  const keys = turnstileKeys(env);
  const year = yearOf(env);
  const base = { turnstileSiteKey: keys?.site ?? null, year, sources: sourceNames(env) };
  const off = (reason: string): GeneratorState => ({ ...base, enabled: false, demo: false, reason });
  if (!db) return off('no-database');
  const demo = !env.ANTHROPIC_API_KEY;
  if (demo && isProduction(env)) return off('no-ai');
  if (!demo) {
    if (await outOfCredit(db)) return off('out-of-paper');
    const spend = await db.prepare('SELECT cost_micros FROM shipped_spend WHERE day = ?').bind(today()).first<{ cost_micros: number }>();
    if ((spend?.cost_micros ?? 0) >= capMicros(env)) return off('out-of-paper');
  }
  return { ...base, enabled: true, demo, reason: null };
}

// Out of Anthropic credit: the machine says OUT OF PAPER for everyone. After CREDIT_RECHECK one print may
// try again (a failed call costs nothing); /admin's "Paper restocked" clears it at once.
const CREDIT_RECHECK = 6 * HOUR;

async function outOfCredit(db: D1Database): Promise<boolean> {
  const flag = await db.prepare(`SELECT set_at FROM shipped_flags WHERE key = 'out-of-credit'`).first<{ set_at: number }>();
  return Boolean(flag && Date.now() - flag.set_at < CREDIT_RECHECK);
}

const setOutOfCredit = (db: D1Database) =>
  db.prepare(`INSERT INTO shipped_flags (key, value, set_at) VALUES ('out-of-credit', '1', ?) ON CONFLICT(key) DO UPDATE SET set_at = excluded.set_at`).bind(Date.now()).run();

function tinyfishMeter(db: D1Database): TinyfishMeter {
  return {
    async take(kind: TinyfishKind, n: number) {
      const row = await db
        .prepare(
          `INSERT INTO shipped_tinyfish (day, kind, n) VALUES (?, ?, ?)
           ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n RETURNING n`,
        )
        .bind(today(), kind, n)
        .first<{ n: number }>();
      return (row?.n ?? n) <= TINYFISH_DAILY[kind];
    },
    async exhausted(kind: TinyfishKind) {
      await db
        .prepare(`INSERT INTO shipped_tinyfish (day, kind, n) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET n = excluded.n`)
        .bind(today(), kind, TINYFISH_DAILY[kind] + 1)
        .run();
    },
  };
}

async function recordSpend(db: D1Database, ok: boolean, input: number, output: number, searches: number, cost: number) {
  await db
    .prepare(
      `INSERT INTO shipped_spend (day, receipts, failures, input_tokens, output_tokens, searches, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET receipts = receipts + excluded.receipts, failures = failures + excluded.failures,
       input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
       searches = searches + excluded.searches, cost_micros = cost_micros + excluded.cost_micros`,
    )
    .bind(today(), ok ? 1 : 0, ok ? 0 : 1, input, output, searches, cost)
    .run();
}

type ReceiptRow = { id: number; data: string; hidden: number };

async function loadReceipt(db: D1Database, id: number): Promise<YearReceipt | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = await db.prepare('SELECT id, data, hidden FROM shipped_receipts WHERE id = ?').bind(id).first<ReceiptRow>();
  if (!row || row.hidden) return null;
  const data = JSON.parse(row.data) as Omit<YearReceipt, 'id'>;
  // Receipts from the first (GitHub-only) printer aren't in this format; they're retired.
  if (data.version !== 2) return null;
  return { ...data, id: row.id };
}

// ---- Who did they mean? -------------------------------------------------------------------------------

async function lookup(request: Request, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  if (!db) return json({ error: 'offline' }, 503);
  const body = await readJson(request);
  const query = readQuery(String(body?.q ?? ''));
  if (!query) return json({ error: 'invalid-query' }, 400);
  if (await limited(request, db, 'lookup', LOOKUP_LIMIT_PER_HOUR)) return json({ error: 'slow-down' }, 429);

  const candidates: Candidate[] = [];
  if (query.kind === 'domain') {
    candidates.push({ kind: 'domain', id: query.value, display: query.value, detail: 'Website' });
  } else if (query.kind === 'handle') {
    const handle = query.value;
    let user = null;
    let unsure = false;
    try {
      user = await githubUser(handle, env);
    } catch {
      unsure = true;
    }
    if (user) {
      const detail = [`GitHub · ${user.repos} public repos`, user.x ? `@${user.x} on X` : null].filter(Boolean).join(' · ');
      candidates.push({ kind: 'github', id: user.login, display: user.name || `@${user.login}`, detail });
    } else if (unsure && isGithubLogin(handle)) {
      candidates.push({ kind: 'github', id: handle, display: `@${handle}`, detail: 'GitHub' });
    }
    // Same person on both: the GitHub profile already links the X handle.
    if (isXHandle(handle) && user?.x?.toLowerCase() !== handle.toLowerCase()) {
      candidates.push({ kind: 'x', id: handle, display: `@${handle}`, detail: 'X / Twitter handle' });
    }
  } else {
    const people = await searchGithubUsers(query.value, env).catch(() => []);
    for (const person of people.slice(0, 3)) candidates.push({ kind: 'github', id: person.login, display: query.value, detail: `GitHub @${person.login}` });
    candidates.push({ kind: 'name', id: query.value, display: query.value, detail: people.length ? 'Search the web for this name' : 'Name or brand' });
  }
  const safe = candidates.filter((c) => !hasBlockedWord(c.id) && !hasBlockedWord(c.display)).slice(0, 4);
  if (!safe.length) return json({ error: 'invalid-query' }, 400);
  return json({ candidates: safe, auto: safe.length === 1 });
}

function readSubject(raw: unknown): Subject | null {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = value.kind as SubjectKind;
  const id = String(value.id ?? '').trim().replace(/^@/, '');
  const valid =
    (kind === 'github' && isGithubLogin(id)) ||
    (kind === 'x' && isXHandle(id)) ||
    (kind === 'domain' && isDomain(id.toLowerCase())) ||
    (kind === 'name' && readQuery(id)?.kind === 'name');
  if (!valid || hasBlockedWord(id)) return null;
  const subject: Subject = { kind, id: kind === 'domain' ? id.toLowerCase() : id, display: '' };
  const display = clean(value.display, 60);
  subject.display = display && !hasBlockedWord(display) ? display : kind === 'github' || kind === 'x' ? `@${subject.id}` : subject.id;
  return subject;
}

// ---- Printing -----------------------------------------------------------------------------------------

const PLAIN_HOSTS = new Set(['github.com', 'gist.github.com', 'npmjs.com', 'www.npmjs.com', 'news.ycombinator.com', 'x.com', 'twitter.com', 'producthunt.com', 'www.producthunt.com', 'youtube.com', 'medium.com', 'reddit.com', 'linkedin.com']);

/** Each line's logo: its own icon if a source had one, else the favicon of its site. Slow ones are skipped. */
async function withLogos(items: DraftItem[], env: ShippedEnv): Promise<YearItem[]> {
  const late = new Promise<null>((resolve) => setTimeout(resolve, 7000, null));
  return Promise.all(
    items.map(async (item) => {
      const host = hostOf(item.link);
      const own = !item.icon && item.link && host && !PLAIN_HOSTS.has(host);
      // The page's apple-touch-icon or PNG icon beats the generic favicon service.
      const page = own ? await Promise.race([readSite(item.link!).catch(() => null), late]) : null;
      const source = item.icon ?? page?.icon ?? (own ? faviconUrl(item.link!) : null);
      const logo = source ? await Promise.race([storeIcon(source, env.SHIPPED).catch(() => null), late]) : null;
      return { name: item.name, description: item.description, date: item.date, status: item.status, link: item.link, logo, source: item.source };
    }),
  );
}

async function blocked(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM shipped_takedowns WHERE subject_key = ? AND status = 'removed'
       UNION ALL SELECT 1 AS x FROM shipped_receipts WHERE login_key = ? AND hidden = 1 LIMIT 1`,
    )
    .bind(key, key)
    .first();
  return Boolean(row);
}

async function print(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response> {
  const db = await database(env);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad-request' }, 400);
  const subject = readSubject(body.subject);
  if (!subject) return json({ error: 'invalid-query' }, 400);

  if (!db) return json({ error: 'offline' }, 503);
  if (!(await verifyTurnstile(env, body.token, request.headers.get('cf-connecting-ip') ?? ''))) return json({ error: 'turnstile' }, 403);
  if (await limited(request, db, 'print', PRINT_LIMIT_PER_HOUR)) return json({ error: 'slow-down' }, 429);
  if (Math.random() < 0.02) ctx.waitUntil(db.prepare('DELETE FROM shipped_limits WHERE win < ?').bind(Math.floor(Date.now() / HOUR) - 48).run());

  const key = subjectKey(subject);
  const year = yearOf(env);
  const mode = modeOf(year);
  if (await blocked(db, key)) return json({ error: 'taken-down' }, 410);
  // Already printed this week: reprinted for free, even while the machine is out of paper.
  const cached = await db
    .prepare('SELECT id FROM shipped_receipts WHERE login_key = ? AND mode = ? AND demo = ? AND hidden = 0 AND created_at > ? ORDER BY id DESC LIMIT 1')
    .bind(key, mode, env.ANTHROPIC_API_KEY ? 0 : 1, Date.now() - CACHE_DAYS * DAY)
    .first<{ id: number }>();
  if (cached) return json({ id: cached.id, cached: true });
  const state = await generatorState(env, db);
  if (!state.enabled) return json({ error: state.reason ?? 'offline' }, 503);

  const seed = seedOf(key);
  const listed = body.listed === true;
  try {
    const gathered = await gather(subject, env, year, tinyfishMeter(db));
    if (subject.kind === 'github' && gathered.profile.name && !hasBlockedWord(gathered.profile.name)) subject.display = gathered.profile.name;
    let model: string | null = null;
    let usage = { input: 0, output: 0, searches: 0, cost: 0 };
    let draft;
    if (state.demo) {
      draft = demoReceipt(gathered, year, seed);
    } else {
      try {
        const result = await assembleReceipt(subject, gathered, year, seed, env);
        draft = result;
        model = result.model;
        usage = { input: result.inputTokens, output: result.outputTokens, searches: result.searches, cost: result.costMicros };
      } catch (error) {
        const spent = error as { costMicros?: number; inputTokens?: number; outputTokens?: number };
        ctx.waitUntil(recordSpend(db, false, spent.inputTokens ?? 0, spent.outputTokens ?? 0, 0, spent.costMicros ?? 0));
        if (error instanceof PrintError && error.code === 'out-of-credit') {
          await setOutOfCredit(db);
          return json({ error: 'out-of-paper' }, 503);
        }
        if (error instanceof PrintError && !isProduction(env)) {
          const g = gathered;
          error.detail = `${error.detail ?? ''} | gathered: ran ${g.ran.join(',')}; failed ${g.failed.join(',') || 'none'}; ${g.found.length} found, ${g.web.length} web, ${g.pages.length} pages`;
        }
        throw error;
      }
    }
    const receipt: Omit<YearReceipt, 'id'> = {
      version: 2,
      year,
      subject,
      printedAt: new Date().toISOString(),
      items: await withLogos(draft.items, env),
      note: draft.note,
      potential: draft.potential,
      demo: state.demo,
      listed,
    };
    const day = today();
    const inserted = await db
      .prepare(
        `INSERT INTO shipped_receipts (login, login_key, day, mode, data, demo, model, input_tokens, output_tokens, searches, cost_micros, listed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(login_key, day, mode) DO UPDATE SET data = excluded.data, demo = excluded.demo, model = excluded.model,
           input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, searches = excluded.searches,
           cost_micros = excluded.cost_micros, listed = excluded.listed, hidden = 0, created_at = excluded.created_at RETURNING id`,
      )
      .bind(subjectLabel(subject), key, day, mode, JSON.stringify(receipt), state.demo ? 1 : 0, model, usage.input, usage.output, usage.searches, usage.cost, listed ? 1 : 0, Date.now())
      .first<{ id: number }>();
    if (!state.demo) ctx.waitUntil(recordSpend(db, true, usage.input, usage.output, usage.searches, usage.cost));
    if (!inserted) return json({ error: 'jammed' }, 500);
    console.log(JSON.stringify({ shipped: 'print', id: inserted.id, kind: subject.kind, items: receipt.items.length, potential: receipt.potential, ran: gathered.ran, failed: gathered.failed, costMicros: usage.cost }));
    return json({ id: inserted.id });
  } catch (error) {
    if (error instanceof PrintError) return json({ error: error.code, ...(error.detail && !isProduction(env) ? { detail: error.detail } : {}) }, error.status);
    console.error('shipped: print failed', error);
    return json({ error: 'jammed' }, 500);
  }
}

async function shared(request: Request, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!db || !Number.isSafeInteger(id) || id < 1) return json({ ok: false }, 400);
  if (await limited(request, db, 'shared', 60)) return json({ ok: false }, 429);
  await db.prepare('UPDATE shipped_receipts SET shares = shares + 1 WHERE id = ? AND hidden = 0').bind(id).run();
  return json({ ok: true });
}

async function takedown(request: Request, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const body = await readJson(request);
  if (!db || !body) return json({ error: 'bad-request' }, 400);
  if (!(await verifyTurnstile(env, body.token, request.headers.get('cf-connecting-ip') ?? ''))) return json({ error: 'turnstile' }, 403);
  if (await limited(request, db, 'takedown', TAKEDOWN_LIMIT_PER_HOUR)) return json({ error: 'slow-down' }, 429);
  const id = Number(body.id);
  const row = Number.isSafeInteger(id) && id > 0 ? await db.prepare('SELECT login_key FROM shipped_receipts WHERE id = ?').bind(id).first<{ login_key: string }>() : null;
  if (!row) return json({ error: 'not-found' }, 404);
  const open = await db.prepare(`SELECT 1 AS x FROM shipped_takedowns WHERE receipt_id = ? AND status = 'open'`).bind(id).first();
  if (!open) {
    await db
      .prepare(`INSERT INTO shipped_takedowns (receipt_id, subject_key, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
      .bind(id, row.login_key, clean(body.reason, 300) || null, Date.now())
      .run();
  }
  return json({ ok: true });
}

// ---- Sponsors ------------------------------------------------------------------------------------

type LineRow = {
  id: number;
  tier: SponsorTier;
  text: string;
  url: string | null;
  logo_key: string | null;
  status: string;
  roll: number;
  line_no: number | null;
  amount_cents: number;
  provider: string;
  checkout_id: string | null;
  order_id: string | null;
  note: string | null;
  created_at: number;
  paid_at: number | null;
  reviewed_at: number | null;
  starts_at: number | null;
  ends_at: number | null;
  tax_cents: number | null;
  total_cents: number | null;
};

const holding = () => Date.now() - SPONSOR_CONFIG.checkoutHoldMinutes * 60_000;
const sponsorLogoPath = (id: number) => `/api/shipped/logo/${id}.png`;

async function presentedTaken(db: D1Database): Promise<{ taken: number; nextOpen: number | null }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(CASE WHEN status = 'approved' THEN ends_at END) AS next FROM sponsor_lines WHERE tier = 'header' AND (
        (status = 'approved' AND ends_at > ?) OR status = 'paid_pending_review' OR (status = 'checkout' AND created_at > ?))`,
    )
    .bind(Date.now(), holding())
    .first<{ n: number; next: number | null }>();
  return { taken: row?.n ?? 0, nextOpen: row?.next ?? null };
}

const toPaidBy = (row: LineRow): PaidBy => ({
  key: `line:${row.id}`,
  tier: row.tier,
  text: row.text,
  url: row.url,
  logo: row.tier === 'logo' && row.logo_key ? sponsorLogoPath(row.id) : null,
});

const house = (entry: { key: string; text: string; url: string }): PaidBy => ({ ...entry, tier: 'house', logo: null });

/** Who paid for this receipt right now: the presented-by slot, then weighted picks from the running lines. */
async function paidFor(db: D1Database | null, receiptId: number): Promise<PaidFor> {
  const seed = receiptId * 7919 + Math.floor(Date.now() / HOUR);
  const fallback: PaidFor = { presented: null, lines: [house(HOUSE_SPONSORS.main), house(houseLine(seed))] };
  if (!db) return fallback;
  const { results } = await db
    .prepare(`SELECT * FROM sponsor_lines WHERE status = 'approved' AND ends_at > ? ORDER BY starts_at`)
    .bind(Date.now())
    .all<LineRow>();
  const presented = results.find((row) => row.tier === 'header') ?? null;
  const lines = weightedPick(results.filter((row) => row.tier !== 'header'), SPONSOR_CONFIG.footerLines, seed).map(toPaidBy);
  return { presented: presented ? toPaidBy(presented) : null, lines: lines.length ? lines : fallback.lines };
}

async function countImpressions(db: D1Database, paid: PaidFor, kind: 'card' | 'tall' | 'page') {
  const keys = [paid.presented, ...paid.lines].filter((entry): entry is PaidBy => Boolean(entry)).map((entry) => entry.key);
  if (!keys.length) return;
  const day = today();
  await db.batch(
    keys.map((key) =>
      db
        .prepare('INSERT INTO sponsor_impressions (sponsor, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT(sponsor, day, kind) DO UPDATE SET n = n + 1')
        .bind(key, day, kind),
    ),
  );
}

async function state(env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const generator = await generatorState(env, db);
  const provider = sponsorProvider(env);
  if (!db) return json({ printed: 0, shared: 0, recent: [], generator, sponsors: { open: false, reason: 'no-database' } });

  const [counts, recent, presented] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS printed, COALESCE(SUM(shares), 0) AS shared FROM shipped_receipts').first<{ printed: number; shared: number }>(),
    db
      .prepare(`SELECT id, data FROM shipped_receipts WHERE listed = 1 AND hidden = 0 AND mode = ? ORDER BY id DESC LIMIT 12`)
      .bind(modeOf(generator.year))
      .all<{ id: number; data: string }>(),
    presentedTaken(db),
  ]);
  const open = Boolean(provider && env.SHIPPED);
  const presentedLeft = Math.max(0, (SPONSOR_CONFIG.tiers.header.slots ?? 1) - presented.taken);
  return json(
    {
      printed: counts?.printed ?? 0,
      shared: counts?.shared ?? 0,
      recent: recent.results.flatMap((row) => {
        const receipt = JSON.parse(row.data) as YearReceipt;
        return receipt.version === 2 ? [{ id: row.id, who: subjectLabel(receipt.subject), count: itemsShipped(receipt), potential: receipt.potential }] : [];
      }),
      generator,
      sponsors: {
        open,
        reason: open ? null : provider ? 'no-storage' : 'no-provider',
        provider: provider?.id ?? null,
        live: provider?.live ?? false,
        taxAtCheckout: provider?.id === 'stripe',
        presentedNextOpen: presentedLeft ? null : presented.nextOpen,
        tiers: SPONSOR_TIERS.map((tier) => ({
          tier,
          ...SPONSOR_CONFIG.tiers[tier],
          cents: priceCents(tier),
          available: open && (tier !== 'header' || presentedLeft > 0),
        })),
      },
    },
    200,
    'public, max-age=30',
  );
}

/** A PNG we accept as a logo: real PNG signature, small, within the print size. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function createSponsor(request: Request, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider || !env.SHIPPED) return json({ error: 'sponsors-closed' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const tier = form.get('tier');
  if (!isSponsorTier(tier)) return json({ error: 'bad-tier' }, 400);
  if (!(await verifyTurnstile(env, form.get('token'), request.headers.get('cf-connecting-ip') ?? ''))) return json({ error: 'turnstile' }, 403);
  if (await limited(request, db, 'sponsor', SPONSOR_LIMIT_PER_HOUR)) return json({ error: 'slow-down' }, 429);

  const config = SPONSOR_CONFIG.tiers[tier];
  const check = validateSponsor({ tier, text: String(form.get('text') ?? ''), url: String(form.get('url') ?? '') || null });
  if (!check.ok) return json({ error: 'invalid', message: check.error }, 400);

  let logo: Uint8Array | null = null;
  if (config.logo) {
    const file = form.get('logo');
    if (!file || typeof file === 'string') return json({ error: 'invalid', message: 'Add a logo.' }, 400);
    if (file.size > LOGO_LIMITS.maxBytes) return json({ error: 'invalid', message: 'That logo is too big.' }, 400);
    logo = new Uint8Array(await file.arrayBuffer());
    const size = pngSize(logo);
    if (!size || size.width > LOGO_LIMITS.maxWidth || size.height > LOGO_LIMITS.maxHeight || size.width < 8 || size.height < 8) {
      return json({ error: 'invalid', message: 'The logo must be a PNG up to 384×160.' }, 400);
    }
  }

  if (config.slots !== null && (await presentedTaken(db)).taken >= config.slots) {
    return json({ error: 'invalid', message: 'The presented-by slot is taken right now.' }, 409);
  }
  const amount = priceCents(tier);
  const line = await db
    .prepare(
      `INSERT INTO sponsor_lines (tier, text, url, status, roll, amount_cents, provider, created_at)
       VALUES (?, ?, ?, 'checkout', 1, ?, ?, ?) RETURNING id`,
    )
    .bind(tier, check.text, check.url, amount, provider.id, Date.now())
    .first<{ id: number }>();
  if (!line) return json({ error: 'jammed' }, 500);

  let logoKey: string | null = null;
  if (logo) {
    logoKey = `logos/${line.id}-${crypto.randomUUID()}.png`;
    await env.SHIPPED.put(logoKey, logo, { httpMetadata: { contentType: 'image/png' } });
  }
  try {
    const checkout = await provider.createCheckout({
      lineId: line.id,
      tier,
      label: `Supporter shout-out: ${config.label}, ${config.days} days`,
      description: `"${check.text}" in the PAID FOR BY block on shared Shipped receipts for ${config.days} days once approved, plus a downloadable receipt image. Refunded in full if not approved.`,
      amountCents: amount,
      origin: new URL(request.url).origin,
      // Closes 5 minutes before the line stops being held (Stripe's minimum is 30 minutes).
      expiresAt: Math.floor(Date.now() / 1000) + Math.max(30, SPONSOR_CONFIG.checkoutHoldMinutes - 5) * 60,
    });
    await db.prepare('UPDATE sponsor_lines SET checkout_id = ?, logo_key = ? WHERE id = ?').bind(checkout.checkoutId, logoKey, line.id).run();
    return json({ url: checkout.url });
  } catch (error) {
    console.error('shipped: checkout failed', error);
    const note = (error instanceof Error ? error.message : 'checkout failed').slice(0, 200);
    await db.prepare(`UPDATE sponsor_lines SET status = 'failed', logo_key = ?, note = ? WHERE id = ?`).bind(logoKey, note, line.id).run();
    return json({ error: 'checkout-failed' }, 502);
  }
}

/** One place where payments, expiries and refunds change a line, whether from a webhook or a confirm. */
async function applyEvent(db: D1Database, env: ShippedEnv, event: SponsorEvent): Promise<void> {
  const now = Date.now();
  if (event.type === 'paid') {
    const line = await db.prepare('SELECT * FROM sponsor_lines WHERE checkout_id = ?').bind(event.checkoutId).first<LineRow>();
    if (!line || line.status !== 'checkout') return;
    const note = event.amountCents === line.amount_cents ? null : `paid ${event.amountCents} for ${line.amount_cents}`;
    await db
      .prepare(
        `UPDATE sponsor_lines SET status = 'paid_pending_review', order_id = ?, paid_at = ?, note = ?, tax_cents = ?, total_cents = ?
         WHERE id = ? AND status = 'checkout'`,
      )
      .bind(event.orderId, now, note, event.taxCents, event.totalCents, line.id)
      .run();
  } else if (event.type === 'expired') {
    await db
      .prepare(`UPDATE sponsor_lines SET status = 'failed', note = 'checkout expired' WHERE checkout_id = ? AND status = 'checkout'`)
      .bind(event.checkoutId)
      .run();
  } else if (event.type === 'refunded') {
    // Any refund (from /admin or the Stripe dashboard) takes the line out of the rotation.
    const lines = await db
      .prepare(`SELECT * FROM sponsor_lines WHERE order_id = ? AND status IN ('paid_pending_review', 'approved', 'refund_failed')`)
      .bind(event.orderId)
      .all<LineRow>();
    for (const line of lines.results) {
      await db
        .prepare(`UPDATE sponsor_lines SET status = 'refunded', reviewed_at = COALESCE(reviewed_at, ?), note = 'refunded in Stripe' WHERE id = ?`)
        .bind(now, line.id)
        .run();
      if (line.logo_key) await env.SHIPPED?.delete(line.logo_key);
    }
  } else if (event.type === 'refund_failed') {
    await db
      .prepare(`UPDATE sponsor_lines SET status = 'refund_failed', note = ? WHERE order_id = ? AND status = 'refunded'`)
      .bind(event.reason.slice(0, 200), event.orderId)
      .run();
  }
}

async function webhook(request: Request, env: ShippedEnv, providerId: string): Promise<Response> {
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider || provider.id !== providerId) return json({ error: 'not-found' }, 404);
  if (provider.id === 'stripe' && !env.STRIPE_SHIPPED_WEBHOOK_SECRET) return json({ error: 'not-configured' }, 503);
  const event = await provider.parseWebhook(request);
  if (!event) return json({ error: 'invalid-signature' }, 400);
  await applyEvent(db, env, event);
  return json({ received: true, ignored: event.type === 'ignored' || undefined });
}

const PUBLIC_STATUS: Record<string, string> = {
  checkout: 'unpaid',
  paid_pending_review: 'pending',
  approved: 'printed',
  refunded: 'refunded',
  refund_failed: 'refunding',
  failed: 'closed',
};
const PAID = new Set(['paid_pending_review', 'approved']);

/** The buyer's line, by the checkout id only they have (it's in their return URL). */
async function buyerLine(url: URL, env: ShippedEnv): Promise<{ db: D1Database; line: LineRow; checkoutId: string } | Response> {
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider) return json({ error: 'sponsors-closed' }, 503);
  const checkoutId = url.searchParams.get('checkout') ?? '';
  if (!provider.checkoutId.test(checkoutId)) return json({ error: 'bad-request' }, 400);
  let line = await db.prepare('SELECT * FROM sponsor_lines WHERE checkout_id = ?').bind(checkoutId).first<LineRow>();
  if (!line || line.provider !== provider.id) return json({ error: 'not-found' }, 404);
  if (line.status === 'checkout' && provider.confirm) {
    try {
      await applyEvent(db, env, await provider.confirm(checkoutId));
      line = (await db.prepare('SELECT * FROM sponsor_lines WHERE id = ?').bind(line.id).first<LineRow>()) ?? line;
    } catch (error) {
      console.error('shipped: confirm failed', error);
    }
  }
  return { db, line, checkoutId };
}

async function sponsorStatus(url: URL, env: ShippedEnv): Promise<Response> {
  const found = await buyerLine(url, env);
  if (found instanceof Response) return found;
  const { line, checkoutId } = found;
  return json({
    status: PUBLIC_STATUS[line.status] ?? 'closed',
    tier: line.tier,
    text: line.text,
    endsAt: line.status === 'approved' ? line.ends_at : null,
    amountCents: line.amount_cents,
    taxCents: line.tax_cents,
    totalCents: line.total_cents,
    receipt: PAID.has(line.status) ? `/api/shipped/sponsor/receipt.png?checkout=${encodeURIComponent(checkoutId)}` : null,
  });
}

async function supporterReceipt(url: URL, env: ShippedEnv): Promise<Response> {
  const found = await buyerLine(url, env);
  if (found instanceof Response) return found;
  const { line } = found;
  if (!PAID.has(line.status)) return json({ error: 'not-paid' }, 404);
  const config = SPONSOR_CONFIG.tiers[line.tier];
  const tax = line.tax_cents ?? 0;
  const svg = supporterReceiptSvg({
    number: `S${String(line.id).padStart(5, '0')}`,
    date: receiptDate(new Date(line.paid_at ?? line.created_at).toISOString()),
    text: line.text.toUpperCase(),
    link: line.url ? new URL(line.url).hostname.replace(/^www\./, '') : null,
    details: [
      { label: 'SHOUT-OUT', value: config.label },
      { label: 'PRINTS ON', value: 'SHARED RECEIPTS' },
      line.status === 'approved' && line.ends_at
        ? { label: 'RUNS UNTIL', value: receiptDate(new Date(line.ends_at).toISOString()) }
        : { label: 'RUNS', value: `${config.days} DAYS FROM APPROVAL` },
    ],
    charges: [
      { label: 'SUPPORTER SHOUT-OUT', value: money(line.amount_cents) },
      { label: 'TAX', value: money(tax) },
    ],
    total: money(line.total_cents ?? line.amount_cents + tax),
    status: line.status === 'approved' ? 'IN THE PAID FOR BY ROTATION' : 'PAID · PRINTS ONCE APPROVED',
    barcode: receiptBarcodeUnits(`BZS${line.id}${line.text}`),
  });
  return new Response(await renderPng(svg), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60', 'x-robots-tag': 'noindex' },
  });
}

async function publicLogo(env: ShippedEnv, id: number): Promise<Response> {
  const db = await database(env);
  if (!db || !env.SHIPPED) return new Response('Not found', { status: 404 });
  const line = await db
    .prepare(`SELECT logo_key FROM sponsor_lines WHERE id = ? AND tier = 'logo' AND status = 'approved'`)
    .bind(id)
    .first<{ logo_key: string | null }>();
  const object = line?.logo_key ? await env.SHIPPED.get(line.logo_key) : null;
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' },
  });
}

async function icon(env: ShippedEnv, hash: string): Promise<Response> {
  const object = ICON_HASH.test(hash) ? await env.SHIPPED?.get(iconKey(hash)) : null;
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable', 'x-robots-tag': 'noindex' },
  });
}

// ---- Share pages and images ------------------------------------------------------------------------

function logoResolver(env: ShippedEnv, db: D1Database | null): LogoResolver {
  return async (path) => {
    if (!path) return null;
    if (path.startsWith('/api/shipped/icon/')) return iconDataUri(path, env.SHIPPED);
    const id = path.match(/^\/api\/shipped\/logo\/(\d{1,9})\.png$/)?.[1];
    if (!id || !db || !env.SHIPPED) return null;
    const line = await db.prepare('SELECT logo_key FROM sponsor_lines WHERE id = ?').bind(Number(id)).first<{ logo_key: string | null }>();
    const object = line?.logo_key ? await env.SHIPPED.get(line.logo_key) : null;
    return object ? bytesDataUri(await object.arrayBuffer()) : null;
  };
}

type ImageKind = 'card' | 'tall';

async function shareImage(request: Request, env: ShippedEnv, ctx: ExecutionContext, id: number, kind: ImageKind): Promise<Response> {
  const url = new URL(request.url);
  const db = await database(env);
  const receipt = db ? await loadReceipt(db, id) : null;
  if (!receipt) return kind === 'card' ? Response.redirect(new URL('/og-shipped.jpg', url).toString(), 302) : new Response('Not found', { status: 404 });
  const paid = await paidFor(db, id);
  if (db) ctx.waitUntil(countImpressions(db, paid, kind).catch(() => undefined));
  const sponsors = [paid.presented, ...paid.lines].map((entry) => entry?.key ?? '-').join(',');
  const cacheKey = `share/${id}/${kind}-v${IMAGE_VERSION}-${seedOf(sponsors).toString(36)}.png`;
  const headers: Record<string, string> = { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' };
  if (url.searchParams.has('download')) {
    headers['content-disposition'] = `attachment; filename="shipped-${receipt.year}-${receiptNumber(id)}${kind === 'tall' ? '-receipt' : ''}.png"`;
  }
  const stored = await env.SHIPPED?.get(cacheKey);
  if (stored) return new Response(stored.body, { headers });
  const render = kind === 'card' ? yearCardPng : yearTallPng;
  const png = await render(receipt, paid, url.origin, logoResolver(env, db));
  ctx.waitUntil(env.SHIPPED?.put(cacheKey, png, { httpMetadata: { contentType: 'image/png' } }) ?? Promise.resolve());
  return new Response(png, { headers });
}

async function dropShareImages(env: ShippedEnv, id: number) {
  if (!env.SHIPPED) return;
  const listed = await env.SHIPPED.list({ prefix: `share/${id}/` });
  await Promise.all(listed.objects.map((object) => env.SHIPPED!.delete(object.key)));
}

const attr = (value: string) => ({ element: (el: Element) => void el.setAttribute('content', value) });

async function sharePage(request: Request, env: ShippedEnv & { ASSETS: Fetcher }, ctx: ExecutionContext, id: number): Promise<Response> {
  const url = new URL(request.url);
  const shell = await env.ASSETS.fetch(new Request(new URL('/shipped/r/', url)));
  const db = await database(env);
  const receipt = db ? await loadReceipt(db, id) : null;
  const headers = new Headers(shell.headers);
  headers.set('x-robots-tag', NOINDEX);
  headers.set('cache-control', 'private, no-store');
  if (!receipt || !db) return new Response(shell.body, { status: 404, headers });

  const paid = await paidFor(db, id);
  ctx.waitUntil(
    Promise.all([countImpressions(db, paid, 'page'), db.prepare('UPDATE shipped_receipts SET views = views + 1 WHERE id = ?').bind(id).run()]).catch(() => undefined),
  );
  const payload = JSON.stringify({ receipt, paidFor: paid }).replace(/</g, '\\u003c');
  const who = subjectLabel(receipt.subject);
  const n = itemsShipped(receipt);
  const title = receipt.potential ? `${who}: shipped in ${receipt.year} (potential) | Shipped` : `${who} shipped ${n} thing${n === 1 ? '' : 's'} in ${receipt.year} | Shipped`;
  const description = `${shareText(receipt)} Printed at brytonzoz.com/shipped.`;
  const page = new URL(RECEIPT_PATH(receipt.id), url).toString();
  const image = new URL(CARD_PATH(receipt.id), url).toString();
  const alt = `A printed receipt: what ${who} shipped in ${receipt.year}, one line per item`;

  return new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"]', attr(description))
    .on('meta[property="og:title"]', attr(title))
    .on('meta[property="og:description"]', attr(description))
    .on('meta[property="og:url"]', attr(page))
    .on('meta[property="og:image"]', attr(image))
    .on('meta[property="og:image:alt"]', attr(alt))
    .on('meta[name="twitter:title"]', attr(title))
    .on('meta[name="twitter:description"]', attr(description))
    .on('meta[name="twitter:image"]', attr(image))
    .on('meta[name="twitter:image:alt"]', attr(alt))
    .on('link[rel="canonical"]', { element: (el) => void el.setAttribute('href', page) })
    .on('head', {
      element: (el) => void el.append(`<script id="shipped-receipt-data" type="application/json">${payload}</script>`, { html: true }),
    })
    .transform(new Response(shell.body, { status: 200, headers }));
}

/** /shipped/r/<id>/, its og.png and receipt.png. Anything else under /shipped/r/ is the static shell. */
export async function handleShippedPage(request: Request, env: ShippedEnv & { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
  env = withKeyAliases(env);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/shipped\/r\/(\d{1,9})(\/(og\.png|receipt\.png)?)?$/);
  if (!match) return env.ASSETS.fetch(request);
  const id = Number(match[1]);
  if (!match[2]) return Response.redirect(new URL(RECEIPT_PATH(id), url).toString(), 301);
  if (match[3] === 'og.png') return shareImage(request, env, ctx, id, 'card');
  if (match[3] === 'receipt.png') return shareImage(request, env, ctx, id, 'tall');
  return sharePage(request, env, ctx, id);
}

export async function handleShipped(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response | null> {
  env = withKeyAliases(env);
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/shipped/')) return null;
  const method = request.method;

  if (path === '/api/shipped/state' && method === 'GET') return state(env);
  if (path === '/api/shipped/lookup' && method === 'POST') return lookup(request, env);
  if (path === '/api/shipped/print' && method === 'POST') return print(request, env, ctx);
  if (path === '/api/shipped/shared' && method === 'POST') return shared(request, env);
  if (path === '/api/shipped/takedown' && method === 'POST') return takedown(request, env);
  if (path === '/api/shipped/sponsor' && method === 'POST') return createSponsor(request, env);
  if (path === '/api/shipped/sponsor/status' && method === 'GET') return sponsorStatus(url, env);
  if (path === '/api/shipped/sponsor/receipt.png' && method === 'GET') return supporterReceipt(url, env);

  const receipt = path.match(/^\/api\/shipped\/receipts\/(\d{1,9})$/);
  if (receipt && method === 'GET') {
    const db = await database(env);
    const found = db ? await loadReceipt(db, Number(receipt[1])) : null;
    if (!found || !db) return json({ error: 'not-found' }, 404);
    return json({ receipt: found, paidFor: await paidFor(db, found.id) }, 200, 'public, max-age=60');
  }
  const iconMatch = path.match(/^\/api\/shipped\/icon\/([a-f0-9]{24})\.png$/);
  if (iconMatch && method === 'GET') return icon(env, iconMatch[1]);
  const hook = path.match(/^\/api\/shipped\/webhook\/([a-z0-9-]{1,20})$/);
  if (hook && method === 'POST') return webhook(request, env, hook[1]);
  const logo = path.match(/^\/api\/shipped\/logo\/(\d{1,9})\.png$/);
  if (logo && method === 'GET') return publicLogo(env, Number(logo[1]));

  return json({ error: 'not-found' }, 404);
}

// ---- Admin (/admin, behind the password check in worker/metrics.ts) --------------------------------

async function hideReceipts(db: D1Database, env: ShippedEnv, key: string) {
  const { results } = await db.prepare('SELECT id FROM shipped_receipts WHERE login_key = ?').bind(key).all<{ id: number }>();
  await db.prepare('UPDATE shipped_receipts SET hidden = 1 WHERE login_key = ?').bind(key).run();
  await Promise.all(results.map((row) => dropShareImages(env, row.id)));
}

export async function adminShipped(request: Request, env: ShippedEnv): Promise<Response> {
  env = withKeyAliases(env);
  const db = await database(env);
  if (!db) return json({ error: 'no-database' }, 503);
  const url = new URL(request.url);

  const logo = url.pathname.match(/^\/api\/admin\/shipped\/logo\/(\d{1,9})$/);
  if (logo) {
    const line = await db.prepare('SELECT logo_key FROM sponsor_lines WHERE id = ?').bind(Number(logo[1])).first<{ logo_key: string | null }>();
    const object = line?.logo_key && env.SHIPPED ? await env.SHIPPED.get(line.logo_key) : null;
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  }
  if (url.pathname !== '/api/admin/shipped') return json({ error: 'not-found' }, 404);

  const provider = sponsorProvider(env);
  if (request.method === 'POST') {
    const body = await readJson(request);
    if (!body) return json({ error: 'bad-request' }, 400);
    const id = Number(body.id);
    const now = Date.now();

    if (body.action === 'hide-receipt' || body.action === 'show-receipt') {
      const hidden = body.action === 'hide-receipt' ? 1 : 0;
      await db.prepare('UPDATE shipped_receipts SET hidden = ? WHERE id = ?').bind(hidden, id).run();
      if (hidden) await dropShareImages(env, id);
      return json({ ok: true });
    }

    if (body.action === 'remove-takedown' || body.action === 'dismiss-takedown') {
      const ask = await db.prepare(`SELECT * FROM shipped_takedowns WHERE id = ?`).bind(id).first<{ subject_key: string; status: string }>();
      if (!ask) return json({ error: 'not-found' }, 404);
      const removing = body.action === 'remove-takedown';
      await db.prepare('UPDATE shipped_takedowns SET status = ?, reviewed_at = ? WHERE id = ?').bind(removing ? 'removed' : 'dismissed', now, id).run();
      // Removing takes down every receipt for that name, handle or site, and stops new ones printing.
      if (removing) await hideReceipts(db, env, ask.subject_key);
      return json({ ok: true });
    }

    if (body.action === 'restock') {
      await db.prepare(`DELETE FROM shipped_flags WHERE key = 'out-of-credit'`).run();
      return json({ ok: true });
    }

    const line = await db.prepare('SELECT * FROM sponsor_lines WHERE id = ?').bind(id).first<LineRow>();
    if (!line) return json({ error: 'not-found' }, 404);

    if (body.action === 'approve') {
      if (line.status !== 'paid_pending_review') return json({ error: 'not-pending' }, 409);
      const next = await db.prepare(`SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM sponsor_lines WHERE status = 'approved'`).first<{ n: number }>();
      const days = SPONSOR_CONFIG.tiers[line.tier].days;
      // The presented-by slot starts when the current one ends, so two never run at once.
      const after = line.tier === 'header' ? (await presentedTaken(db)).nextOpen : null;
      const starts = Math.max(now, after ?? 0);
      await db
        .prepare(`UPDATE sponsor_lines SET status = 'approved', line_no = ?, reviewed_at = ?, starts_at = ?, ends_at = ? WHERE id = ?`)
        .bind(next?.n ?? 1, now, starts, starts + days * DAY, id)
        .run();
      return json({ ok: true });
    }

    if (body.action === 'reject') {
      if (line.status !== 'paid_pending_review') return json({ error: 'not-pending' }, 409);
      const refund =
        provider && provider.id === line.provider && line.order_id
          ? await provider.refund(line.order_id, line.amount_cents)
          : { ok: false, error: `provider ${line.provider} not available` };
      await db
        .prepare(`UPDATE sponsor_lines SET status = ?, reviewed_at = ?, note = ? WHERE id = ?`)
        .bind(refund.ok ? 'refunded' : 'refund_failed', now, refund.ok ? null : (refund.error ?? 'refund failed').slice(0, 200), id)
        .run();
      if (line.logo_key) await env.SHIPPED?.delete(line.logo_key);
      return json({ ok: true, error: refund.ok ? undefined : refund.error });
    }

    return json({ error: 'bad-action' }, 400);
  }

  const since = new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10);
  const month = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
  const [pending, lines, receipts, spend, totals, takedowns, impressions, credit, tinyfish] = await db.batch([
    db.prepare(`SELECT * FROM sponsor_lines WHERE status = 'paid_pending_review' ORDER BY paid_at`),
    db.prepare(`SELECT * FROM sponsor_lines WHERE status NOT IN ('checkout', 'paid_pending_review', 'failed') ORDER BY id DESC LIMIT 60`),
    db.prepare(
      'SELECT id, login, mode, demo, hidden, listed, shares, views, model, searches, input_tokens, output_tokens, cost_micros, created_at FROM shipped_receipts ORDER BY id DESC LIMIT 40',
    ),
    db.prepare('SELECT * FROM shipped_spend WHERE day >= ? ORDER BY day DESC').bind(since),
    db.prepare('SELECT COUNT(*) AS printed, COALESCE(SUM(shares), 0) AS shared, COALESCE(SUM(views), 0) AS views FROM shipped_receipts'),
    db.prepare(
      `SELECT t.id, t.receipt_id, t.subject_key, t.reason, t.created_at, r.login FROM shipped_takedowns t
       LEFT JOIN shipped_receipts r ON r.id = t.receipt_id WHERE t.status = 'open' ORDER BY t.id`,
    ),
    db.prepare(
      `SELECT sponsor, SUM(CASE WHEN kind = 'card' THEN n ELSE 0 END) AS card, SUM(CASE WHEN kind = 'tall' THEN n ELSE 0 END) AS tall,
       SUM(CASE WHEN kind = 'page' THEN n ELSE 0 END) AS page FROM sponsor_impressions WHERE day >= ? GROUP BY sponsor ORDER BY SUM(n) DESC`,
    ).bind(month),
    db.prepare(`SELECT set_at FROM shipped_flags WHERE key = 'out-of-credit'`),
    db.prepare('SELECT kind, n FROM shipped_tinyfish WHERE day = ?').bind(today()),
  ]);
  const t = totals.results[0] as { printed: number; shared: number; views: number } | undefined;
  const lineText = new Map((lines.results as LineRow[]).map((line) => [`line:${line.id}`, `${line.text} (${SPONSOR_CONFIG.tiers[line.tier].label})`]));
  const houseText = new Map([HOUSE_SPONSORS.main, ...HOUSE_SPONSORS.rotating].map((entry) => [entry.key, `${entry.text} (house)`]));
  return json({
    provider: provider ? { id: provider.id, live: provider.live } : null,
    generator: await generatorState(env, db),
    model: env.SHIPPED_MODEL || DEFAULT_MODEL,
    maxSearches: maxSearches(env),
    outOfCreditAt: (credit.results[0] as { set_at: number } | undefined)?.set_at ?? null,
    tinyfish: {
      enabled: Boolean(env.TINYFISH_API_KEY),
      today: Object.fromEntries((tinyfish.results as { kind: string; n: number }[]).map((row) => [row.kind, row.n])),
      daily: TINYFISH_DAILY,
    },
    capUsd: capMicros(env) / 1_000_000,
    printed: t?.printed ?? 0,
    shared: t?.shared ?? 0,
    views: t?.views ?? 0,
    pending: pending.results,
    lines: lines.results,
    receipts: receipts.results,
    spend: spend.results,
    takedowns: takedowns.results,
    impressions: (impressions.results as { sponsor: string; card: number; tall: number; page: number }[]).map((row) => ({
      ...row,
      label: lineText.get(row.sponsor) ?? houseText.get(row.sponsor) ?? row.sponsor,
    })),
  });
}

