// Shipped 2026 backend: receipts (anyone's public shipped work, found by free APIs and Claude, see
// worker/shipped-sources.ts and worker/shipped-ai.ts), the pile, the 10-slot sponsor block (bid up, frozen when
// the two-week event ends, lib/shipped-sponsors.ts) and $5 mailed prints. The event window is lib/shipped-event.ts.
//
//   GET  /api/shipped/state            event window, counters, generator, payments, the sponsor block
//   POST /api/shipped/lookup           { q } -> { candidates, auto } (who did they mean?)
//   POST /api/shipped/print            { subject, token, listed } -> { id, pile } (same subject within 7 days: cached)
//   GET  /api/shipped/pile             the pile (lib/shipped-pile.ts); POST { id, token } tosses a receipt on
//   POST /api/shipped/shared           { id, how } share counter (sendBeacon)
//   POST /api/shipped/seen             { id } sponsor-block impression (once per visitor/receipt/day)
//   POST /api/shipped/takedown         { id, reason, token, pile? } report / remove: hidden at once, reviewed in /admin
//   GET  /api/shipped/challenge        a proof-of-work puzzle (only when Turnstile isn't configured)
//   GET  /api/shipped/receipts/<id>    a printed receipt + the sponsor block
//   GET  /api/shipped/icon/<hash>.png  a receipt line's 1-bit logo (worker/shipped-icons.ts)
//   POST /api/shipped/bid              multipart { slot, name, cta, url, cents, terms, express, token, logo? } -> checkout at the posted price
//   POST /api/shipped/print-order      { id, express, token } -> checkout for a mailed thermal print ($5, US)
//   GET  /api/shipped/checkout?checkout=<id>   after paying: confirms with Stripe, says how it went
//   POST /api/shipped/checkout/cancel  { checkout } the wallet sheet closed unpaid
//   POST /api/shipped/webhook/<id>     payment provider webhook (worker/shipped-pay.ts; Stripe: /webhook/stripe)
//   GET  /api/shipped/logo/<bid>.png   a sponsor's reviewed 1-bit logo
//   GET  /q/<key>                      a printed QR code -> the slot's link (counts scans; worker/shipped-host.ts)
//   GET  /shipped/r/<id>/              share page: the static shell with this receipt's tags and data
//   GET  /shipped/r/<id>/og.png        the 1200×675 card for X        (?download=1 to save it)
//   GET  /shipped/r/<id>/receipt.png   the whole receipt as one image (?download=1 to save it)
//   GET  /shipped/r/<id>/rollo.png     4-inch Rollo print (832 dots, ?download=1)
//   /api/admin/shipped*                moderation, takedowns, bids, the print queue, spend; behind the /admin password
//
// Every guardrail (rate limits, locks, the budget, kill switches, the human check, headers) lives in
// worker/shipped-guard.ts; the threat list is docs/shipped-security.md.
// Tables are created (and new columns added) on first use; see SCHEMA below.
import { DEFAULT_MODEL, PrintError, assembleReceipt, demoReceipt, maxSearches, promptFor, worstCaseMicros, type AiEnv, type DraftItem } from './shipped-ai';
import { ICON_HASH, bytesDataUri, iconDataUri, iconKey, reencodeLogo, storeIcon } from './shipped-icons';
import { yearCardPng, yearRolloPng, yearTallPng, type LogoResolver } from './shipped-og';
import { PRINT_KIND, SPONSOR_KIND, isProduction, sponsorProvider, type PayEnv, type SponsorEvent } from './shipped-pay';
import { brandIcon, clean, faviconUrl, gather, githubUser, hostOf, readSite, searchGithubUsers, tinyfishAccess, type SourceEnv } from './shipped-sources';
import { TINYFISH_DAILY, type TinyfishKind, type TinyfishMeter } from './shipped-tinyfish';
import { checkFetchUrl, finalUrl } from './shipped-fetch';
import {
  IMPRESSIONS_NOW,
  MARKET_COLUMNS,
  MARKET_SCHEMA,
  bump,
  bumpSlotClose,
  counters,
  logTakeover,
  market,
  nextSponsorSerial,
  slotClosesAt,
  slotHistory,
  type Market,
} from './shipped-market';
import {
  DAY,
  HOUR,
  MINUTE,
  acquire,
  budgetKey,
  budgetUsed,
  cycleBudgetCap,
  clientIp,
  concurrencySlot,
  guardTables,
  hashedKey,
  humanCheck,
  isSwitch,
  issueChallenge,
  overGlobalPrintLimit,
  overLimit,
  readJsonCapped,
  refuseRequest,
  release,
  reserveBudget,
  secure,
  setSwitch,
  settleBudget,
  sweepLimits,
  switchedOff,
  today,
  verifyHuman,
  type GuardEnv,
  type HumanCheck,
  type Switch,
} from './shipped-guard';
import { money } from '../lib/shipped-receipt';
import { EVENT_NAME, eventWindow } from '../lib/shipped-event';
import type { PileReceipt, PileResponse } from '../lib/shipped-pile';
import {
  RECEIPT_PATH,
  SHIPPED_HOST,
  SHIPPED_URL,
  CARD_PATH,
  TALL_PATH,
  ROLLO_PATH,
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
  type SponsorBlock,
  type SponsorSlot,
  type Subject,
  type SubjectKind,
  type YearItem,
  type YearReceipt,
} from '../lib/shipped-year';
import {
  BID_RULES,
  HERO_SLOT,
  HOUSE_SLOTS,
  LOGO_LIMITS,
  SLOT_COUNT,
  checkSponsorUrl,
  bidRange,
  cooldownUntil,
  hasBlockedWord,
  inAntiSnipeWindow,
  isSlot,
  isValidBid,
  proratedRefund,
  sameHolder,
  slotCooling,
  slotLabel,
  takeoversOpen,
  validateBid,
} from '../lib/shipped-sponsors';

export interface ShippedEnv extends AiEnv, PayEnv, SourceEnv, GuardEnv {
  /** Google Safe Browsing API key: sponsor links are checked against it when set. */
  SAFE_BROWSING_KEY?: string;
  DB?: D1Database;
  /** Shipped's own host (worker/shipped-host.ts). */
  SHIPPED_HOST?: string;
  SHIPPED?: R2Bucket;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Daily AI budget in USD (legacy / tests). */
  SHIPPED_DAILY_CAP_USD?: string;
  /** Cycle AI budget base in USD (default 180), plus 80% of last cycle's net sales. */
  SHIPPED_CYCLE_CAP_USD?: string;
  /** The year receipts itemize (default: the current year). */
  SHIPPED_YEAR?: string;
  ANTHROPIC_WORKSPACE_DEFAULT?: string;
  /** The event window (ISO dates); defaults in lib/shipped-event.ts. */
  SHIPPED_OPENS_AT?: string;
  SHIPPED_CLOSES_AT?: string;
  /** Public Stripe key: shows Apple Pay / Google Pay on our own page. */
  STRIPE_PUBLISHABLE_KEY?: string;
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
  const workspace = pick('claude_workspace', 'CLAUDE_WORKSPACE', 'claude_workspace_id', 'ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_WORKSPACE_DEFAULT');
  if (anthropic === env.ANTHROPIC_API_KEY && tinyfish === env.TINYFISH_API_KEY && workspace === env.ANTHROPIC_WORKSPACE_ID) return env;
  // A prototype link keeps every binding (DB, R2, ASSETS) reachable without copying them.
  return Object.assign(Object.create(env) as T, { ANTHROPIC_API_KEY: anthropic, TINYFISH_API_KEY: tinyfish, ANTHROPIC_WORKSPACE_ID: workspace });
}

/** Where Shipped's Stripe return URLs point: this request's origin when it's already on the Shipped host. */
function shippedOrigin(env: ShippedEnv, url: URL): string {
  return !env.SHIPPED_HOST || url.host === env.SHIPPED_HOST ? url.origin : `https://${env.SHIPPED_HOST}`;
}

const CACHE_DAYS = 7;
/** A subject whose print just failed isn't tried again for this long (no paying twice for the same failure). */
const FAILED_FOR = 10 * MINUTE;
/** Longest a print may hold its locks (gathering + up to three 40 s model calls). */
const PRINT_LOCK = 3 * MINUTE;
/** Bump when the share images change, so cached ones are redrawn. */
const IMAGE_VERSION = 5;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipped_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, login_key TEXT NOT NULL, day TEXT NOT NULL,
    mode TEXT NOT NULL, data TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_micros INTEGER, created_at INTEGER NOT NULL,
    searches INTEGER, listed INTEGER NOT NULL DEFAULT 0, shares INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS shipped_receipts_daily ON shipped_receipts (login_key, day, mode)',
  'CREATE INDEX IF NOT EXISTS shipped_receipts_key ON shipped_receipts (login_key, hidden)',
  `CREATE TABLE IF NOT EXISTS shipped_takedowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id INTEGER NOT NULL, subject_key TEXT NOT NULL, reason TEXT,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS shipped_takedowns_key ON shipped_takedowns (subject_key, status)',
  // TinyFish units used per UTC day, so we stay inside the free allowance.
  'CREATE TABLE IF NOT EXISTS shipped_tinyfish (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))',
  // Sponsor bids: one row per checkout; at most one 'live' per slot (the holder).
  `CREATE TABLE IF NOT EXISTS shipped_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slot INTEGER NOT NULL, name TEXT NOT NULL, cta TEXT NOT NULL, url TEXT NOT NULL,
    logo_key TEXT, logo_ok INTEGER NOT NULL DEFAULT 0, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
    checkout_id TEXT, order_id TEXT, tax_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, note TEXT, email TEXT,
    scans INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, paid_at INTEGER, live_at INTEGER, ended_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS shipped_bids_slot ON shipped_bids (slot, status)',
  'CREATE UNIQUE INDEX IF NOT EXISTS shipped_bids_checkout ON shipped_bids (checkout_id)',
  'CREATE INDEX IF NOT EXISTS shipped_bids_order ON shipped_bids (order_id)',
  // $5 mailed prints: 'to_print' is the queue in /admin, 'shipped' once it's in the mail.
  `CREATE TABLE IF NOT EXISTS print_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
    checkout_id TEXT, order_id TEXT, amount_cents INTEGER NOT NULL, tax_cents INTEGER, total_cents INTEGER, email TEXT,
    ship_name TEXT, ship_line1 TEXT, ship_line2 TEXT, ship_city TEXT, ship_state TEXT, ship_postal TEXT, ship_country TEXT,
    created_at INTEGER NOT NULL, paid_at INTEGER, shipped_at INTEGER, note TEXT)`,
  'CREATE INDEX IF NOT EXISTS print_orders_status ON print_orders (status)',
  'CREATE UNIQUE INDEX IF NOT EXISTS print_orders_checkout ON print_orders (checkout_id)',
];
// Columns added after the tables first shipped; "duplicate column" means it's already there.
const COLUMNS = [
  'ALTER TABLE shipped_receipts ADD COLUMN searches INTEGER',
  'ALTER TABLE shipped_receipts ADD COLUMN listed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_receipts ADD COLUMN shares INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_receipts ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shipped_spend ADD COLUMN searches INTEGER NOT NULL DEFAULT 0',
  ...MARKET_COLUMNS,
  'ALTER TABLE shipped_bids ADD COLUMN serial INTEGER',
];

async function migrate(db: D1Database) {
  await guardTables(db);
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  for (const sql of COLUMNS) {
    await db
      .prepare(sql)
      .run()
      .catch((error: unknown) => {
        if (!String(error).includes('duplicate column')) throw error;
      });
  }
  await db.batch(MARKET_SCHEMA.map((sql) => db.prepare(sql)));
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
  const headers = secure(new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-robots-tag': NOINDEX }));
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  return new Response(JSON.stringify(data), { status, headers });
}

const refused = (why: { status: number; error: string }) => json({ error: why.error }, why.status);
const readJson = (request: Request) => readJsonCapped(request, 8192);

const yearOf = (env: ShippedEnv) => shippedYear(env.SHIPPED_YEAR);
const modeOf = (year: number) => `y${year}`;

function seedOf(text: string): number {
  let hash = 2166136261;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return hash >>> 0;
}

type GeneratorState = { enabled: boolean; demo: boolean; reason: string | null; turnstileSiteKey: string | null; human: HumanCheck; year: number; sources: string[] };

function sourceNames(env: ShippedEnv): string[] {
  const names = ['github', 'appstore', 'hn', 'npm'];
  if (env.PRODUCTHUNT_TOKEN || (env.PRODUCTHUNT_KEY && env.PRODUCTHUNT_SECRET)) names.push('producthunt');
  if (env.TINYFISH_API_KEY) names.push('tinyfish');
  return names;
}

async function generatorState(env: ShippedEnv, db: D1Database | null, off?: Set<Switch>): Promise<GeneratorState> {
  const human = humanCheck(env);
  const year = yearOf(env);
  const base = { turnstileSiteKey: human.kind === 'turnstile' ? human.siteKey : null, human, year, sources: sourceNames(env) };
  const stop = (reason: string): GeneratorState => ({ ...base, enabled: false, demo: false, reason });
  if (!db) return stop('no-database');
  if (isClosed(env)) return stop('closed');
  if ((off ?? (await switchedOff(env, db))).has('generate')) return stop('out-of-paper');
  const demo = !env.ANTHROPIC_API_KEY;
  if (demo && isProduction(env)) return stop('no-ai');
  if (!demo) {
    if (await outOfCredit(db)) return stop('out-of-paper');
    const cap = await cycleBudgetCap(db, env);
    if (cap === null) return stop('out-of-paper');
    const used = await budgetUsed(db, budgetKey());
    if (used.spent + used.reserved >= cap) return stop('out-of-paper');
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

/** Counts and tokens for /admin. The money itself moves through reserveBudget / settleBudget. */
async function recordSpend(db: D1Database, ok: boolean, input: number, output: number, searches: number) {
  await db
    .prepare(
      `INSERT INTO shipped_spend (day, receipts, failures, input_tokens, output_tokens, searches) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET receipts = receipts + excluded.receipts, failures = failures + excluded.failures,
       input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
       searches = searches + excluded.searches`,
    )
    .bind(today(), ok ? 1 : 0, ok ? 0 : 1, input, output, searches)
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
  const why = refuseRequest(request, 2048);
  if (why) return refused(why);
  const db = await database(env);
  if (!db) return json({ error: 'offline' }, 503);
  const body = await readJson(request);
  const query = typeof body?.q === 'string' && body.q.length <= 200 ? readQuery(body.q) : null;
  if (!query || hasBlockedWord(query.value)) return json({ error: 'invalid-query' }, 400);
  const off = await switchedOff(env, db);
  if (off.has('generate') || isClosed(env)) return json({ error: isClosed(env) ? 'closed' : 'out-of-paper' }, 503);
  if (await overLimit(db, request, 'lookup')) return json({ error: 'slow-down' }, 429);

  const candidates: Candidate[] = [];
  if (query.kind === 'domain') {
    candidates.push({ kind: 'domain', id: query.value, display: query.value, detail: 'Website' });
  } else if (query.kind === 'handle') {
    const handle = query.value;
    let user = null;
    let unsure = false;
    try {
      user = await githubUser(handle, env, tinyfishAccess(env, tinyfishMeter(db)));
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
    const people = await searchGithubUsers(query.value, env, tinyfishAccess(env, tinyfishMeter(db))).catch(() => []);
    for (const person of people.slice(0, 3)) candidates.push({ kind: 'github', id: person.login, display: query.value, detail: `GitHub @${person.login}` });
    candidates.push({ kind: 'name', id: query.value, display: query.value, detail: people.length ? 'Search the web for this name' : 'Name or brand' });
  }
  const safe = candidates.filter((c) => !hasBlockedWord(c.id) && !hasBlockedWord(c.display) && (c.kind !== 'domain' || publicDomain(c.id))).slice(0, 4);
  if (!safe.length) return json({ error: 'invalid-query' }, 400);
  return json({ candidates: safe, auto: safe.length === 1 });
}

/** A domain we would actually fetch: no IPs in disguise (127.0.0.1.nip.io), no local or internal names. */
const publicDomain = (domain: string) => checkFetchUrl(`https://${domain.toLowerCase()}/`).ok;

function readSubject(raw: unknown): Subject | null {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = value.kind as SubjectKind;
  const id = String(value.id ?? '').trim().replace(/^@/, '');
  const valid =
    (kind === 'github' && isGithubLogin(id)) ||
    (kind === 'x' && isXHandle(id)) ||
    (kind === 'domain' && isDomain(id.toLowerCase()) && publicDomain(id)) ||
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
      const [brand, page] = own
        ? await Promise.all([Promise.race([brandIcon(item.link!, env).catch(() => null), late]), Promise.race([readSite(item.link!).catch(() => null), late])])
        : [null, null];
      const source = item.icon ?? brand ?? page?.icon ?? (own ? faviconUrl(item.link!) : null);
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
  // Cheapest checks first: nothing below spends money until a request has passed every one of these.
  const why = refuseRequest(request, 4096);
  if (why) return refused(why);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad-request' }, 400);
  const subject = readSubject(body.subject);
  if (!subject) return json({ error: 'invalid-query' }, 400);
  const db = await database(env);
  if (!db) return json({ error: 'offline' }, 503);
  if (isClosed(env)) return json({ error: 'closed' }, 410);
  const off = await switchedOff(env, db);
  if (off.has('generate')) return json({ error: 'out-of-paper' }, 503);
  if (await overLimit(db, request, 'print')) return json({ error: 'slow-down' }, 429);
  if (!(await verifyHuman(env, db, body.token, request))) return json({ error: 'turnstile' }, 403);
  if (Math.random() < 0.02) ctx.waitUntil(sweepLimits(db).catch(() => undefined));

  const key = subjectKey(subject);
  const year = yearOf(env);
  const mode = modeOf(year);
  if (await blocked(db, key)) return json({ error: 'taken-down' }, 410);
  // Already printed this week: the same receipt again, free, even while the machine is out of paper.
  const cached = await db
    .prepare('SELECT id FROM shipped_receipts WHERE login_key = ? AND mode = ? AND demo = ? AND hidden = 0 AND created_at > ? ORDER BY id DESC LIMIT 1')
    .bind(key, mode, env.ANTHROPIC_API_KEY ? 0 : 1, Date.now() - CACHE_DAYS * DAY)
    .first<{ id: number }>();
  if (cached) return json({ id: cached.id, cached: true, pile: await pileToken(env, cached.id) });
  const recentFailure = await db.prepare('SELECT 1 AS x FROM shipped_locks WHERE key = ? AND until > ?').bind(`failed:${key}`, Date.now()).first();
  if (recentFailure) return json({ error: 'jammed', retryAfter: Math.round(FAILED_FOR / 1000) }, 503);
  const state = await generatorState(env, db, off);
  if (!state.enabled) return json({ error: state.reason ?? 'offline' }, 503);
  const global = await overGlobalPrintLimit(db, env);
  if (global) return json({ error: global === 'day' ? 'out-of-paper' : 'busy' }, 503);

  // One print per subject, one per visitor and N everywhere at a time; all released in `finally`.
  const subjectLock = `print:${key}`;
  const ipLock = `print:ip:${await hashedKey(clientIp(request))}`;
  if (!(await acquire(db, subjectLock, PRINT_LOCK))) return json({ error: 'printing', retryAfter: 15 }, 409);
  const held = [subjectLock];
  let reserved = 0;
  try {
    if (!(await acquire(db, ipLock, PRINT_LOCK))) return json({ error: 'slow-down' }, 429);
    held.push(ipLock);
    const slot = await concurrencySlot(db, env, PRINT_LOCK);
    if (!slot) return json({ error: 'busy', retryAfter: 10 }, 503);
    held.push(slot);
    return await generate(request, env, ctx, db, subject, key, year, mode, state, body.listed === true, (micros) => {
      reserved = micros;
    });
  } finally {
    await Promise.all(held.map((lock) => release(db, lock).catch(() => undefined)));
    if (reserved) ctx.waitUntil(settleBudget(db, reserved, 0, budgetKey()).catch(() => undefined));
  }
}

async function generate(
  request: Request,
  env: ShippedEnv,
  ctx: ExecutionContext,
  db: D1Database,
  subject: Subject,
  key: string,
  year: number,
  mode: string,
  state: GeneratorState,
  listed: boolean,
  holdBudget: (micros: number) => void,
): Promise<Response> {
  const seed = seedOf(key);
  try {
    const gathered = await gather(subject, env, year, tinyfishMeter(db));
    if (subject.kind === 'github' && gathered.profile.name && !hasBlockedWord(gathered.profile.name)) subject.display = clean(gathered.profile.name, 60);
    let model: string | null = null;
    let usage = { input: 0, output: 0, searches: 0, cost: 0 };
    let draft;
    if (state.demo) {
      draft = demoReceipt(gathered, year, seed);
    } else {
      // The worst this print could cost is held against today's budget first, so a burst can't overspend it.
      model = env.SHIPPED_MODEL || DEFAULT_MODEL;
      const worst = worstCaseMicros(model, promptFor(subject, gathered, year).length, maxSearches(env));
      const cap = await cycleBudgetCap(db, env);
      if (cap === null) return json({ error: 'out-of-paper' }, 503);
      if (!(await reserveBudget(db, cap, worst, budgetKey()))) return json({ error: 'out-of-paper' }, 503);
      holdBudget(worst);
      try {
        const result = await assembleReceipt(subject, gathered, year, seed, env, worst);
        draft = result;
        usage = { input: result.inputTokens, output: result.outputTokens, searches: result.searches, cost: result.costMicros };
        holdBudget(0);
        await settleBudget(db, worst, usage.cost, budgetKey());
      } catch (error) {
        const spent = error as { costMicros?: number; inputTokens?: number; outputTokens?: number };
        holdBudget(0);
        await settleBudget(db, worst, spent.costMicros ?? 0, budgetKey());
        ctx.waitUntil(recordSpend(db, false, spent.inputTokens ?? 0, spent.outputTokens ?? 0, 0));
        ctx.waitUntil(acquire(db, `failed:${key}`, FAILED_FOR).catch(() => undefined));
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
    // Only a new row adds to "printed"; a second print of the same subject the same day replaces the first.
    const replaces = await db.prepare('SELECT 1 AS x FROM shipped_receipts WHERE login_key = ? AND day = ? AND mode = ?').bind(key, day, mode).first();
    const inserted = await db
      .prepare(
        `INSERT INTO shipped_receipts (login, login_key, day, mode, data, demo, model, input_tokens, output_tokens, searches, cost_micros, listed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(login_key, day, mode) DO UPDATE SET data = excluded.data, demo = excluded.demo, model = excluded.model,
           input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, searches = excluded.searches,
           cost_micros = excluded.cost_micros, listed = excluded.listed, created_at = excluded.created_at
         WHERE shipped_receipts.hidden != 1 RETURNING id`,
      )
      .bind(subjectLabel(subject), key, day, mode, JSON.stringify(receipt), state.demo ? 1 : 0, model, usage.input, usage.output, usage.searches, usage.cost, listed ? 1 : 0, Date.now())
      .first<{ id: number }>();
    if (!state.demo) ctx.waitUntil(recordSpend(db, true, usage.input, usage.output, usage.searches));
    if (!inserted) return json({ error: 'taken-down' }, 410);
    await db.prepare('UPDATE shipped_receipts SET hidden = 0 WHERE id = ? AND hidden = 2').bind(inserted.id).run();
    if (!replaces) await bump(db, 'printed');
    console.log(JSON.stringify({ shipped: 'print', id: inserted.id, kind: subject.kind, items: receipt.items.length, potential: receipt.potential, ran: gathered.ran, failed: gathered.failed, costMicros: usage.cost }));
    return json({ id: inserted.id, pile: await pileToken(env, inserted.id) });
  } catch (error) {
    if (error instanceof PrintError) return json({ error: error.code, ...(error.detail && !isProduction(env) ? { detail: error.detail } : {}) }, error.status);
    console.error('shipped: print failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'jammed' }, 500);
  }
}

const SHARE_WAYS = new Set(['x', 'card', 'tall', 'copy']);

/**
 * Counted once per visitor, receipt and way of sharing per day: the counters are public and sponsor prices
 * lean on them, so a reload loop can't run them up.
 */
async function onceToday(db: D1Database, request: Request, what: string): Promise<boolean> {
  return acquire(db, `${what}:${await hashedKey(clientIp(request))}`, DAY);
}

async function shared(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, 1024);
  if (why) return refused(why);
  const db = await database(env);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!db || !Number.isSafeInteger(id) || id < 1) return json({ ok: false }, 400);
  if (await overLimit(db, request, 'shared')) return json({ ok: false }, 429);
  const how = typeof body?.how === 'string' && SHARE_WAYS.has(body.how) ? body.how : 'other';
  if (!(await onceToday(db, request, `share:${id}:${how}`))) return json({ ok: true, counted: false });
  const row = await db.prepare('UPDATE shipped_receipts SET shares = shares + 1 WHERE id = ? AND hidden = 0 RETURNING id').bind(id).first();
  if (row) await bump(db, 'shared');
  return json({ ok: true, counted: Boolean(row) });
}

/** POST /api/shipped/seen { id }: the sponsor block of receipt `id` was on screen (once per visitor/receipt/day). */
async function seen(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, 1024);
  if (why) return refused(why);
  const db = await database(env);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!db || !Number.isSafeInteger(id) || id < 1) return json({ ok: false }, 400);
  if (await overLimit(db, request, 'seen')) return json({ ok: false }, 429);
  // While sponsor-display is off the block shows house ads only, so no holder is credited.
  if ((await switchedOff(env, db)).has('sponsor-display')) return json({ ok: true, counted: false });
  const real = await db.prepare('SELECT 1 AS x FROM shipped_receipts WHERE id = ? AND hidden = 0').bind(id).first();
  if (!real || !(await onceToday(db, request, `seen:${id}`))) return json({ ok: true, counted: false });
  await bump(db, 'impressions');
  return json({ ok: true, counted: true });
}

/**
 * "Report / remove this receipt". The receipt comes down at once (hidden, share images and edge copies purged)
 * and waits in /admin: dismissing puts it back, removing keeps that name, handle or site from printing again.
 * The browser that printed it (it holds the pile token) removes it outright, without blocking the subject.
 */
async function takedown(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response> {
  const why = refuseRequest(request, 4096);
  if (why) return refused(why);
  const db = await database(env);
  const body = await readJson(request);
  if (!db || !body) return json({ error: 'bad-request' }, 400);
  const id = Number(body.id);
  const row = Number.isSafeInteger(id) && id > 0 ? await db.prepare('SELECT login_key, hidden FROM shipped_receipts WHERE id = ?').bind(id).first<{ login_key: string; hidden: number }>() : null;
  if (!row) return json({ error: 'not-found' }, 404);
  const mine = typeof body.pile === 'string' && body.pile === (await pileToken(env, id));
  if (await overLimit(db, request, 'takedown')) return json({ error: 'slow-down' }, 429);
  if (!mine && !(await verifyHuman(env, db, body.token, request))) return json({ error: 'turnstile' }, 403);
  if (mine) {
    await db.prepare('UPDATE shipped_receipts SET hidden = 2, listed = 0 WHERE id = ? AND hidden = 0').bind(id).run();
  } else {
    await db.prepare('UPDATE shipped_receipts SET hidden = 1, listed = 0 WHERE id = ?').bind(id).run();
    const open = await db.prepare(`SELECT 1 AS x FROM shipped_takedowns WHERE receipt_id = ? AND status = 'open'`).bind(id).first();
    if (!open) {
      await db
        .prepare(`INSERT INTO shipped_takedowns (receipt_id, subject_key, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
        .bind(id, row.login_key, clean(body.reason, 300) || null, Date.now())
        .run();
    }
  }
  ctx.waitUntil(purgeReceipt(env, id, new URL(request.url).origin));
  return json({ ok: true, removed: true });
}

/** Everything cached about a receipt: its share images in R2 and every edge copy of its page, images and JSON. */
async function purgeReceipt(env: ShippedEnv, id: number, origin?: string): Promise<void> {
  await dropShareImages(env, id).catch(() => undefined);
  const origins = new Set([origin, env.SHIPPED_HOST ? `https://${env.SHIPPED_HOST}` : null, SHIPPED_URL].filter((o): o is string => Boolean(o)));
  const paths = [RECEIPT_PATH(id), CARD_PATH(id), TALL_PATH(id), ROLLO_PATH(id), `/shipped${RECEIPT_PATH(id)}`, `/shipped${CARD_PATH(id)}`, `/shipped${TALL_PATH(id)}`, `/shipped${ROLLO_PATH(id)}`, `/api/shipped/receipts/${id}`, '/api/shipped/state', '/api/shipped/pile'];
  const cache = edgeCache();
  if (!cache) return;
  await Promise.all([...origins].flatMap((o) => paths.map((path) => cache.delete(new Request(new URL(path, o))).catch(() => false))));
}

/** The data center's cache (absent in tests and local dev). */
const edgeCache = (): Cache | null => (typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null);

/** Serves a GET from this data center's cache, or makes it, keeps it `seconds`, and serves that. */
async function cached(request: Request, ctx: ExecutionContext, seconds: number, make: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache();
  const key = new Request(new URL(request.url).toString().replace(/\?.*$/, ''), { method: 'GET' });
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit;
  const response = await make();
  if (cache && response.status === 200) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set('cache-control', `public, max-age=${seconds}`);
    ctx.waitUntil(cache.put(key, copy).catch(() => undefined));
  }
  return response;
}

// ---- The event, the pile ------------------------------------------------------------------------------

const event = (env: ShippedEnv) => eventWindow(env);

/** Advertised close. Per-slot anti-snipe lives on shipped_flags slot-close:<n>, not here. */
async function liveWindow(env: ShippedEnv, db: D1Database | null, now = Date.now()) {
  const base = event(env);
  return { opensAt: base.opensAt, closesAt: base.closesAt, phase: (now >= base.closesAt ? 'closed' : 'open') as const, now };
}

const isClosed = (env: ShippedEnv) => event(env).phase === 'closed';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Proof the browser printed this receipt (handed out with the print), so only its printer can toss it on the pile. */
const pileToken = (env: ShippedEnv, id: number) => hmacHex(env.ADMIN_PASSWORD || env.STRIPE_SECRET_KEY || 'shipped-pile', `pile:${id}`);

type PileRow = { id: number; data: string; created_at: number };

function pileEntry(row: PileRow): PileReceipt | null {
  const receipt = JSON.parse(row.data) as YearReceipt;
  if (receipt.version !== 2) return null;
  return {
    id: row.id,
    who: subjectLabel(receipt.subject),
    count: itemsShipped(receipt),
    potential: receipt.potential,
    items: receipt.items.slice(0, 6).map((item) => ({ name: item.name, status: item.status })),
    printedAt: receipt.printedAt,
  };
}

/** GET /api/shipped/pile?before=<id>&limit=<n>: the newest receipts their printers tossed on the pile. */
async function pile(url: URL, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const window = event(env);
  if (!db) return json({ receipts: [], total: 0, frozen: window.phase === 'closed', next: null } satisfies PileResponse);
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 120));
  const [rows, total] = await Promise.all([
    db
      .prepare('SELECT id, data, created_at FROM shipped_receipts WHERE listed = 1 AND hidden = 0 AND mode = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .bind(modeOf(yearOf(env)), before, limit)
      .all<PileRow>(),
    db.prepare('SELECT COUNT(*) AS n FROM shipped_receipts WHERE listed = 1 AND hidden = 0 AND mode = ?').bind(modeOf(yearOf(env))).first<{ n: number }>(),
  ]);
  const receipts = rows.results.flatMap((row) => pileEntry(row) ?? []);
  const body: PileResponse = {
    receipts,
    total: total?.n ?? receipts.length,
    frozen: window.phase === 'closed',
    next: rows.results.length === limit ? rows.results[rows.results.length - 1].id : null,
  };
  return json(body, 200, window.phase === 'closed' ? 'public, max-age=3600' : 'public, max-age=15');
}

/** POST /api/shipped/pile { id, token }: toss your receipt on the pile (until the printer shuts off). */
async function tossOnPile(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, 2048);
  if (why) return refused(why);
  const db = await database(env);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!db || !body || !Number.isSafeInteger(id) || id < 1) return json({ error: 'bad-request' }, 400);
  if (isClosed(env)) return json({ error: 'closed' }, 410);
  if (await overLimit(db, request, 'toss')) return json({ error: 'slow-down' }, 429);
  if (typeof body.token !== 'string' || body.token !== (await pileToken(env, id))) return json({ error: 'not-yours' }, 403);
  const row = await db.prepare('SELECT data FROM shipped_receipts WHERE id = ? AND hidden = 0').bind(id).first<{ data: string }>();
  if (!row) return json({ error: 'not-found' }, 404);
  const listed = body.off !== true;
  const data = { ...(JSON.parse(row.data) as YearReceipt), listed };
  await db.prepare('UPDATE shipped_receipts SET listed = ?, data = ? WHERE id = ?').bind(listed ? 1 : 0, JSON.stringify(data), id).run();
  return json({ ok: true, listed });
}

// ---- Sponsor block: 10 bidding slots, taken over at a legal raise, frozen when that slot closes ----

type BidRow = {
  id: number;
  slot: number;
  name: string;
  cta: string;
  url: string;
  logo_key: string | null;
  logo_ok: number;
  amount_cents: number;
  status: 'checkout' | 'live' | 'outbid' | 'lost' | 'removed' | 'refunded' | 'failed';
  provider: string;
  checkout_id: string | null;
  order_id: string | null;
  tax_cents: number | null;
  total_cents: number | null;
  refund_cents: number | null;
  note: string | null;
  email: string | null;
  scans: number;
  created_at: number;
  paid_at: number | null;
  live_at: number | null;
  ended_at: number | null;
  seen_at_live: number | null;
  seen_at_end: number | null;
  serial: number | null;
};

const bidLogoPath = (id: number) => `/api/shipped/logo/${id}.png`;
const houseKey = (slot: number) => `h${slot}`;

type SlotContext = { impressions: number; lastOutbid: number | null; holders: number; seenAtEnd: number | null; closesAt: number };

function priced(currentCents: number): { next: number; maxNext: number } {
  const range = bidRange(currentCents);
  return { next: range.min, maxNext: range.max };
}

function houseSlot(slot: number, ctx: SlotContext): SponsorSlot {
  const ad = HOUSE_SLOTS[slot];
  return {
    slot,
    name: ad.name,
    cta: ad.cta,
    url: ad.url,
    qr: houseKey(slot),
    logo: null,
    house: true,
    cents: 0,
    ...priced(0),
    impressions: Math.max(0, ctx.impressions - (ctx.seenAtEnd ?? 0)),
    since: null,
    lastOutbid: ctx.lastOutbid,
    holders: ctx.holders,
    serial: null,
    cooldownUntil: null,
    closesAt: ctx.closesAt,
  };
}

function slotFrom(slot: number, bid: BidRow | undefined, ctx: SlotContext): SponsorSlot {
  if (!bid) return houseSlot(slot, ctx);
  return {
    slot,
    name: bid.name,
    cta: bid.cta,
    url: bid.url,
    qr: String(bid.id),
    logo: bid.logo_key && bid.logo_ok ? bidLogoPath(bid.id) : null,
    house: false,
    cents: bid.amount_cents,
    ...priced(bid.amount_cents),
    // Bids that went live before impressions were counted started at zero.
    impressions: Math.max(0, ctx.impressions - (bid.seen_at_live ?? 0)),
    since: bid.live_at,
    lastOutbid: ctx.lastOutbid,
    holders: ctx.holders,
    serial: bid.serial,
    cooldownUntil: cooldownUntil(bid.live_at),
    closesAt: ctx.closesAt,
  };
}

/** Who holds each slot right now (after close: forever), at what price. With sponsor-display switched off, the house ads. */
async function sponsorBlock(db: D1Database | null, env: ShippedEnv, off?: Set<Switch>, known?: Market): Promise<SponsorBlock> {
  const window = await liveWindow(env, db);
  const [live, history, now, closes] = await Promise.all([
    db && !(off ?? (await switchedOff(env, db))).has('sponsor-display')
      ? db.prepare(`SELECT * FROM shipped_bids WHERE status = 'live'`).all<BidRow>().then((r) => r.results)
      : Promise.resolve([] as BidRow[]),
    db ? slotHistory(db) : Promise.resolve(new Map()),
    known ?? market(db),
    slotClosesAt(db, window.closesAt),
  ]);
  const frozen = window.phase === 'closed' && closes.every((at) => window.now >= at);
  const bySlot = new Map(live.map((bid) => [bid.slot, bid]));
  const slots = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const past = history.get(slot);
    const ctx: SlotContext = {
      impressions: now.counts.impressions,
      lastOutbid: past?.lastOutbid ?? null,
      holders: past?.holders ?? 0,
      seenAtEnd: past?.seenAtEnd ?? null,
      closesAt: closes[slot] ?? window.closesAt,
    };
    return slotFrom(slot, bySlot.get(slot), ctx);
  });
  return { slots, frozen };
}

const checkoutExpiry = () => Math.floor(Date.now() / 1000) + BID_RULES.checkoutMinutes * 60 + 60;

/** Google Safe Browsing (when SAFE_BROWSING_KEY is set): true when the link is known malware, phishing or unwanted. */
async function knownBad(env: ShippedEnv, url: string): Promise<boolean> {
  if (!env.SAFE_BROWSING_KEY) return false;
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(env.SAFE_BROWSING_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'shipped', clientVersion: '1' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { matches?: unknown[] };
    return Boolean(body.matches?.length);
  } catch {
    return false;
  }
}

/** The sponsor's link, followed: it must answer, stay on the same site (no hops to a shortener or elsewhere), and not be known-bad. */
async function vetSponsorUrl(env: ShippedEnv, url: string): Promise<string | null> {
  const start = new URL(url);
  let landed: string;
  try {
    landed = await finalUrl(url, 5000);
  } catch {
    return 'We couldn\u2019t open that link. Use a public page that loads.';
  }
  const end = checkSponsorUrl(landed);
  const site = (host: string) => host.replace(/^www\./, '');
  if (!end || site(new URL(end).hostname) !== site(start.hostname)) return 'That link redirects to another site. Use the final address.';
  if ((await knownBad(env, url)) || (end !== url && (await knownBad(env, end)))) return 'That link isn\u2019t accepted.';
  return null;
}

/** POST /api/shipped/bid (multipart: slot, name, cta, url, cents, terms, express, token, logo?) -> { url } or { clientSecret, id }. */
async function createBid(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, LOGO_LIMITS.maxBytes * 4 + 16_384);
  if (why) return refused(why);
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider) return json({ error: 'sponsors-closed' }, 503);
  if ((await switchedOff(env, db)).has('sponsors')) return json({ error: 'sponsors-closed' }, 503);
  const window = await liveWindow(env, db);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const slot = Number(form.get('slot'));
  if (!isSlot(slot)) return json({ error: 'bad-slot' }, 400);
  const closes = await slotClosesAt(db, window.closesAt);
  const slotClose = closes[slot] ?? window.closesAt;
  if (!takeoversOpen(window.now, slotClose)) {
    return json({ error: window.now >= slotClose ? 'closed' : 'locked', message: 'This slot is no longer changing hands.' }, 410);
  }
  if (form.get('terms') !== '1') return json({ error: 'invalid', field: 'terms', message: 'Please accept the sponsor terms.' }, 400);
  if (await overLimit(db, request, 'bid')) return json({ error: 'slow-down' }, 429);
  if (!(await verifyHuman(env, db, form.get('token'), request))) return json({ error: 'turnstile' }, 403);
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.slice(0, 400) : '';
  };
  const check = validateBid({ slot, name: text('name'), cta: text('cta'), url: text('url') });
  if (!check.ok) return json({ error: 'invalid', field: check.field, message: check.error }, 400);

  // The price is ours: a whole-dollar raise in [+$1, +max($5, 10% of current)], or $1 on a house ad.
  const holder = await db
    .prepare(`SELECT amount_cents, live_at, email FROM shipped_bids WHERE slot = ? AND status = 'live'`)
    .bind(slot)
    .first<{ amount_cents: number; live_at: number | null; email: string | null }>();
  if (slotCooling(holder?.live_at, Date.now())) {
    const until = cooldownUntil(holder?.live_at) ?? Date.now();
    const wait = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return json({ error: 'cooldown', message: `This slot just changed hands. Try again in ${wait}s.`, retryAfter: wait }, 429);
  }
  const current = holder?.amount_cents ?? 0;
  const range = bidRange(current);
  if (range.min > BID_RULES.maxCents) return json({ error: 'sold-out', message: 'This slot is at its ceiling price and can\u2019t be taken over.' }, 409);
  const cents = Number(form.get('cents'));
  if (!isValidBid(current, cents)) {
    return json({ error: 'price-changed', message: `Bid between ${money(range.min)} and ${money(range.max)}.`, price: range.min, min: range.min, max: range.max }, 409);
  }

  const badUrl = await vetSponsorUrl(env, check.url);
  if (badUrl) return json({ error: 'invalid', field: 'url', message: badUrl }, 400);

  // Logos are redrawn by us (1-bit, metadata and anything else in the file dropped) and print only after review.
  let logo: Uint8Array | null = null;
  const file = form.get('logo');
  if (file && typeof file !== 'string' && file.size > 0) {
    if (file.size > LOGO_LIMITS.maxBytes * 4) return json({ error: 'invalid', field: 'logo', message: 'That logo is too big (256 KB max).' }, 400);
    const redrawn = await reencodeLogo(new Uint8Array(await file.arrayBuffer()), LOGO_LIMITS.maxWidth, LOGO_LIMITS.maxHeight).catch(() => null);
    if (!redrawn) return json({ error: 'invalid', field: 'logo', message: 'The logo must be a PNG or JPEG.' }, 400);
    logo = env.SHIPPED ? redrawn.png : null;
  }

  const bid = await db
    .prepare(`INSERT INTO shipped_bids (slot, name, cta, url, amount_cents, status, provider, created_at) VALUES (?, ?, ?, ?, ?, 'checkout', ?, ?) RETURNING id`)
    .bind(slot, check.name, check.cta, check.url, cents, provider.id, Date.now())
    .first<{ id: number }>();
  if (!bid) return json({ error: 'jammed' }, 500);
  let logoKey: string | null = null;
  if (logo && env.SHIPPED) {
    logoKey = `logos/bid-${bid.id}-${crypto.randomUUID()}.png`;
    await env.SHIPPED.put(logoKey, logo, { httpMetadata: { contentType: 'image/png' } });
  }
  const express = form.get('express') === '1';
  const label = `${EVENT_NAME} sponsor slot: ${slotLabel(slot)}`;
  try {
    const checkout = await provider.createCheckout({
      kind: SPONSOR_KIND,
      ref: String(bid.id),
      label,
      description: `"${check.name}" with your line and QR code in the ${slot === HERO_SLOT ? 'hero' : 'small'} slot of the sponsor block on Shipped 2026 receipts, share images and mailed prints. Bid ${money(cents)}. If someone takes the slot at a higher bid, you are refunded for the time you lose; when this slot closes the block freezes for good. Full terms: ${shippedOrigin(env, new URL(request.url))}/terms/`,
      amountCents: cents,
      origin: shippedOrigin(env, new URL(request.url)),
      returnPath: '/?bid={CHECKOUT_SESSION_ID}#sponsor',
      cancelPath: '/#sponsor',
      expiresAt: checkoutExpiry(),
      express,
      metadata: { slot: String(slot) },
    });
    await db.prepare('UPDATE shipped_bids SET checkout_id = ?, logo_key = ? WHERE id = ?').bind(checkout.checkoutId, logoKey, bid.id).run();
    return json(checkout.clientSecret ? { clientSecret: checkout.clientSecret, id: checkout.checkoutId } : { url: checkout.url, id: checkout.checkoutId });
  } catch (error) {
    console.error('shipped: bid checkout failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    await db.prepare(`UPDATE shipped_bids SET status = 'failed', logo_key = ?, note = ? WHERE id = ?`).bind(logoKey, String(error).slice(0, 200), bid.id).run();
    return json({ error: 'checkout-failed' }, 502);
  }
}

/** A paid event we act on must be exactly what we asked for: our own row, in dollars, for the price we set. */
function paidAsAsked(paid: Extract<SponsorEvent, { type: 'paid' }>, ref: number, cents: number): string | null {
  if (paid.ref !== String(ref)) return `ref ${paid.ref} != ${ref}`;
  if (paid.currency !== 'usd') return `currency ${paid.currency}`;
  if (paid.amountCents !== cents) return `amount ${paid.amountCents} != ${cents}`;
  return null;
}

/** A paid bid takes its slot if the price still holds (and takeovers are open); otherwise it's refunded in full. */
async function settleBid(db: D1Database, env: ShippedEnv, bid: BidRow, paid: Extract<SponsorEvent, { type: 'paid' }>): Promise<void> {
  // Webhook and the buyer's return can both arrive; only one settles.
  if (!(await acquire(db, `settle:bid:${bid.id}`, 2 * MINUTE))) return;
  const now = Date.now();
  const window = await liveWindow(env, db, now);
  const provider = sponsorProvider(env);
  const claimed = await db
    .prepare(`UPDATE shipped_bids SET order_id = ?, paid_at = ?, tax_cents = ?, total_cents = ?, email = ? WHERE id = ? AND status = 'checkout' AND paid_at IS NULL RETURNING id`)
    .bind(paid.orderId, now, paid.taxCents, paid.totalCents, paid.email, bid.id)
    .first();
  if (!claimed) return;
  const refundAll = async (note: string) => {
    const refund = provider && paid.orderId ? await provider.refund(paid.orderId, undefined, `bid-${bid.id}-full`) : { ok: false, error: 'no provider' };
    await db
      .prepare(`UPDATE shipped_bids SET status = 'lost', ended_at = ?, refund_cents = ?, note = ? WHERE id = ?`)
      .bind(now, refund.ok ? paid.totalCents : 0, refund.ok ? note : `${note}; refund failed: ${refund.error ?? ''}`.slice(0, 200), bid.id)
      .run();
  };
  const mismatch = paidAsAsked(paid, bid.id, bid.amount_cents);
  if (mismatch) {
    console.error(JSON.stringify({ shipped: 'pay-mismatch', bid: bid.id, mismatch }));
    return refundAll(`payment didn't match: ${mismatch}`);
  }
  const closes = await slotClosesAt(db, window.closesAt);
  const slotClose = closes[bid.slot] ?? window.closesAt;
  if (!takeoversOpen(now, slotClose)) return refundAll('paid after this slot closed');

  const live = await db
    .prepare(`SELECT email, live_at, amount_cents FROM shipped_bids WHERE slot = ? AND status = 'live'`)
    .bind(bid.slot)
    .first<{ email: string | null; live_at: number | null; amount_cents: number }>();
  if (sameHolder(live?.email, paid.email)) return refundAll('holder cannot raise their own slot');
  if (slotCooling(live?.live_at, now)) return refundAll('slot is in cooldown');
  const current = live?.amount_cents ?? 0;
  if (!isValidBid(current, bid.amount_cents)) return refundAll('bid is outside the legal raise for this slot');

  // One transaction: the bid goes live only if the holder still paid less than this price; then it pushes them out.
  const [promoted, pushed] = await db.batch([
    db
      .prepare(
        `UPDATE shipped_bids SET status = 'live', live_at = ?, seen_at_live = ${IMPRESSIONS_NOW} WHERE id = ? AND status = 'checkout'
         AND NOT EXISTS (SELECT 1 FROM shipped_bids WHERE slot = ? AND status = 'live' AND amount_cents >= ?)`,
      )
      .bind(now, bid.id, bid.slot, bid.amount_cents),
    db
      .prepare(
        `UPDATE shipped_bids SET status = 'outbid', ended_at = ?, seen_at_end = ${IMPRESSIONS_NOW} WHERE slot = ? AND status = 'live' AND id != ?
         AND (SELECT status FROM shipped_bids WHERE id = ?) = 'live' RETURNING *`,
      )
      .bind(now, bid.slot, bid.id, bid.id),
  ]);
  if (!promoted.meta.changes) {
    const current = await db.prepare('SELECT status FROM shipped_bids WHERE id = ?').bind(bid.id).first<{ status: string }>();
    if (current?.status === 'checkout') await refundAll('someone else paid this price first');
    return;
  }
  const pushedOut = (pushed.results ?? []) as BidRow[];
  const serial = await nextSponsorSerial(db);
  await db.prepare('UPDATE shipped_bids SET serial = ? WHERE id = ? AND serial IS NULL').bind(serial, bid.id).run();
  if (inAntiSnipeWindow(now, slotClose)) {
    await bumpSlotClose(db, bid.slot, slotClose, now);
  }
  const { printed } = await counters(db);
  await logTakeover(db, bid.slot, pushedOut[0]?.amount_cents ?? 0, bid.amount_cents, printed, bid.id, now).catch(() => undefined);
  for (const previous of pushedOut) {
    const total = previous.total_cents ?? previous.amount_cents;
    const owed = proratedRefund(total, previous.live_at ?? previous.paid_at ?? now, now, slotClose);
    const refund =
      owed > 0 && provider && previous.order_id && previous.provider === provider.id
        ? await provider.refund(previous.order_id, owed, `bid-${previous.id}-outbid-${bid.id}`)
        : { ok: owed === 0, error: 'no provider' };
    await db
      .prepare('UPDATE shipped_bids SET refund_cents = ?, note = ? WHERE id = ?')
      .bind(refund.ok ? owed : 0, refund.ok ? `taken over by #${bid.id}` : `taken over by #${bid.id}; prorated refund of ${owed} failed: ${refund.error ?? ''}`.slice(0, 200), previous.id)
      .run();
  }
}

type OrderRow = {
  id: number;
  receipt_id: number;
  status: 'checkout' | 'to_print' | 'shipped' | 'refunded' | 'failed';
  provider: string;
  checkout_id: string | null;
  order_id: string | null;
  amount_cents: number;
  tax_cents: number | null;
  total_cents: number | null;
  email: string | null;
  ship_name: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal: string | null;
  ship_country: string | null;
  created_at: number;
  paid_at: number | null;
  shipped_at: number | null;
  note: string | null;
};

export const PRINT_PRICE_CENTS = 500;

/** POST /api/shipped/print-order { id, express, token } -> { url } or { clientSecret, id }: the receipt on real thermal paper, mailed (US). */
async function createPrintOrder(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, 4096);
  if (why) return refused(why);
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider) return json({ error: 'orders-closed' }, 503);
  if ((await switchedOff(env, db)).has('prints')) return json({ error: 'orders-closed' }, 503);
  if (isClosed(env)) return json({ error: 'closed' }, 410);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad-request' }, 400);
  const id = Number(body.id);
  const receipt = Number.isSafeInteger(id) && id > 0 ? await loadReceipt(db, id) : null;
  if (!receipt) return json({ error: 'not-found' }, 404);
  if (await overLimit(db, request, 'order')) return json({ error: 'slow-down' }, 429);
  if (!(await verifyHuman(env, db, body.token, request))) return json({ error: 'turnstile' }, 403);
  const order = await db
    .prepare(`INSERT INTO print_orders (receipt_id, status, provider, amount_cents, created_at) VALUES (?, 'checkout', ?, ?, ?) RETURNING id`)
    .bind(id, provider.id, PRINT_PRICE_CENTS, Date.now())
    .first<{ id: number }>();
  if (!order) return json({ error: 'jammed' }, 500);
  try {
    const origin = shippedOrigin(env, new URL(request.url));
    const checkout = await provider.createCheckout({
      kind: PRINT_KIND,
      ref: String(order.id),
      label: `${EVENT_NAME} receipt #${receiptNumber(id)}, printed and mailed`,
      description: `${subjectLabel(receipt.subject)}'s receipt on 80mm thermal paper, mailed within the US. Shipping included, tax added at checkout. Terms and refunds: ${origin}/terms/`,
      amountCents: PRINT_PRICE_CENTS,
      origin,
      returnPath: `/r/${id}/?order={CHECKOUT_SESSION_ID}`,
      cancelPath: `/r/${id}/`,
      expiresAt: checkoutExpiry(),
      express: body?.express === true,
      shipping: true,
      metadata: { receipt_id: String(id) },
    });
    await db.prepare('UPDATE print_orders SET checkout_id = ? WHERE id = ?').bind(checkout.checkoutId, order.id).run();
    return json(checkout.clientSecret ? { clientSecret: checkout.clientSecret, id: checkout.checkoutId } : { url: checkout.url, id: checkout.checkoutId });
  } catch (error) {
    console.error('shipped: print order checkout failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    await db.prepare(`UPDATE print_orders SET status = 'failed', note = ? WHERE id = ?`).bind(String(error).slice(0, 200), order.id).run();
    return json({ error: 'checkout-failed' }, 502);
  }
}

async function settleOrder(db: D1Database, env: ShippedEnv, order: OrderRow, paid: Extract<SponsorEvent, { type: 'paid' }>): Promise<void> {
  const ship = paid.shipping;
  const mismatch = paidAsAsked(paid, order.id, order.amount_cents) ?? (ship && ship.country !== 'US' ? `ships to ${ship.country}` : null);
  if (mismatch) {
    console.error(JSON.stringify({ shipped: 'pay-mismatch', order: order.id, mismatch }));
    const provider = sponsorProvider(env);
    const refund = provider && paid.orderId ? await provider.refund(paid.orderId, undefined, `order-${order.id}-full`) : { ok: false, error: 'no provider' };
    await db
      .prepare(`UPDATE print_orders SET status = ?, order_id = ?, paid_at = ?, note = ? WHERE id = ? AND status = 'checkout'`)
      .bind(refund.ok ? 'refunded' : 'failed', paid.orderId, Date.now(), `payment didn't match: ${mismatch}${refund.ok ? '' : `; refund failed: ${refund.error ?? ''}`}`.slice(0, 200), order.id)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE print_orders SET status = 'to_print', order_id = ?, paid_at = ?, tax_cents = ?, total_cents = ?, email = ?, ship_name = ?, ship_line1 = ?,
       ship_line2 = ?, ship_city = ?, ship_state = ?, ship_postal = ?, ship_country = ? WHERE id = ? AND status = 'checkout'`,
    )
    .bind(paid.orderId, Date.now(), paid.taxCents, paid.totalCents, paid.email, ship?.name ?? null, ship?.line1 ?? null, ship?.line2 ?? null, ship?.city ?? null, ship?.state ?? null, ship?.postal ?? null, ship?.country ?? null, order.id)
    .run();
}

/** One place where payments, expiries and refunds land, from a webhook or the buyer's return. */
async function applyEvent(db: D1Database, env: ShippedEnv, payEvent: SponsorEvent): Promise<void> {
  const now = Date.now();
  if (payEvent.type === 'paid') {
    if (payEvent.kind === SPONSOR_KIND) {
      const bid = await db.prepare('SELECT * FROM shipped_bids WHERE checkout_id = ?').bind(payEvent.checkoutId).first<BidRow>();
      if (bid && bid.status === 'checkout') await settleBid(db, env, bid, payEvent);
      return;
    }
    const order = await db.prepare('SELECT * FROM print_orders WHERE checkout_id = ?').bind(payEvent.checkoutId).first<OrderRow>();
    if (order && order.status === 'checkout') await settleOrder(db, env, order, payEvent);
  } else if (payEvent.type === 'expired') {
    await db.batch([
      db.prepare(`UPDATE shipped_bids SET status = 'failed', note = 'checkout expired' WHERE checkout_id = ? AND status = 'checkout' AND paid_at IS NULL`).bind(payEvent.checkoutId),
      db.prepare(`UPDATE print_orders SET status = 'failed', note = 'checkout expired' WHERE checkout_id = ? AND status = 'checkout'`).bind(payEvent.checkoutId),
    ]);
  } else if (payEvent.type === 'refunded') {
    // A full refund (from /admin or Stripe's dashboard) takes a bid down; its slot goes back to the house ad.
    await db
      .prepare(`UPDATE shipped_bids SET status = 'refunded', ended_at = COALESCE(ended_at, ?), seen_at_end = ${IMPRESSIONS_NOW} WHERE order_id = ? AND status = 'live'`)
      .bind(now, payEvent.orderId)
      .run();
    await db.prepare(`UPDATE print_orders SET status = 'refunded' WHERE order_id = ? AND status = 'to_print'`).bind(payEvent.orderId).run();
  } else if (payEvent.type === 'refund_failed') {
    await db.prepare(`UPDATE shipped_bids SET note = ? WHERE order_id = ?`).bind(payEvent.reason.slice(0, 200), payEvent.orderId).run();
  }
}

async function webhook(request: Request, env: ShippedEnv, providerId: string): Promise<Response> {
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider || provider.id !== providerId) return json({ error: 'not-found' }, 404);
  if (provider.id === 'stripe' && !env.STRIPE_SHIPPED_WEBHOOK_SECRET) return json({ error: 'not-configured' }, 503);
  if (Number(request.headers.get('content-length') ?? 0) > 512_000) return json({ error: 'too-big' }, 413);
  const payEvent = await provider.parseWebhook(request).catch(() => null);
  if (!payEvent) return json({ error: 'invalid-signature' }, 400);
  await applyEvent(db, env, payEvent);
  return json({ received: true, ignored: payEvent.type === 'ignored' || undefined });
}

/** After checkout (or the wallet sheet): asks Stripe where it stands, applies it, and says how it went. */
async function checkoutStatus(url: URL, env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const provider = sponsorProvider(env);
  if (!db || !provider) return json({ error: 'closed' }, 503);
  const checkoutId = url.searchParams.get('checkout') ?? '';
  if (!provider.checkoutId.test(checkoutId)) return json({ error: 'bad-request' }, 400);
  const readBid = () => db.prepare('SELECT * FROM shipped_bids WHERE checkout_id = ?').bind(checkoutId).first<BidRow>();
  const readOrder = () => db.prepare('SELECT * FROM print_orders WHERE checkout_id = ?').bind(checkoutId).first<OrderRow>();
  let bid = await readBid();
  let order = bid ? null : await readOrder();
  if (!bid && !order) return json({ error: 'not-found' }, 404);
  if ((bid?.status === 'checkout' || order?.status === 'checkout') && provider.confirm) {
    try {
      await applyEvent(db, env, await provider.confirm(checkoutId));
      bid = bid ? await readBid() : null;
      order = order ? await readOrder() : null;
    } catch (error) {
      console.error('shipped: confirm failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    }
  }
  if (bid) {
    return json({
      kind: 'bid',
      status: bid.status,
      slot: bid.slot,
      name: bid.name,
      cents: bid.amount_cents,
      refundCents: bid.refund_cents,
      logoPending: Boolean(bid.logo_key && !bid.logo_ok),
    });
  }
  return json({ kind: 'print', status: order!.status, receiptId: order!.receipt_id, city: order!.ship_city, state: order!.ship_state });
}

/** POST /api/shipped/checkout/cancel { checkout }: the wallet sheet closed without paying. */
async function cancelCheckout(request: Request, env: ShippedEnv): Promise<Response> {
  const why = refuseRequest(request, 1024);
  if (why) return refused(why);
  const db = await database(env);
  const provider = sponsorProvider(env);
  const body = await readJson(request);
  const checkoutId = String(body?.checkout ?? '');
  if (!db || !provider || !provider.checkoutId.test(checkoutId)) return json({ ok: false }, 400);
  const ours = await db.prepare(`SELECT 1 AS x FROM shipped_bids WHERE checkout_id = ? AND status = 'checkout' UNION ALL SELECT 1 AS x FROM print_orders WHERE checkout_id = ? AND status = 'checkout'`).bind(checkoutId, checkoutId).first();
  if (!ours) return json({ ok: false }, 404);
  await provider.expire?.(checkoutId);
  if (provider.confirm) await applyEvent(db, env, await provider.confirm(checkoutId)).catch(() => undefined);
  return json({ ok: true });
}

const redirect = (to: string) => {
  const headers = secure(new Headers({ location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': NOINDEX }));
  return new Response(null, { status: 302, headers });
};

/**
 * /q/<key>: a printed QR code. Counts the scan and sends it to that slot's link (house ads: h<slot>). The link is
 * checked again on the way out, and a slot that was taken down, refunded or switched off goes to the home page.
 */
export async function qrRedirect(env: ShippedEnv, key: string, ctx: ExecutionContext): Promise<Response> {
  env = withKeyAliases(env);
  const home = env.SHIPPED_HOST ? `https://${env.SHIPPED_HOST}/` : `${SHIPPED_URL}/`;
  const house = key.match(/^h(\d)$/);
  if (house && isSlot(Number(house[1]))) return redirect(HOUSE_SLOTS[Number(house[1])].url);
  const db = await database(env);
  const id = /^\d{1,9}$/.test(key) ? Number(key) : 0;
  if (!db || !id) return redirect(home);
  if ((await switchedOff(env, db)).has('sponsor-display')) return redirect(home);
  const bid = await db.prepare(`SELECT url, status FROM shipped_bids WHERE id = ?`).bind(id).first<{ url: string; status: string }>();
  const url = bid && (bid.status === 'live' || bid.status === 'outbid') ? checkSponsorUrl(bid.url) : null;
  if (!url) return redirect(home);
  ctx.waitUntil(db.prepare('UPDATE shipped_bids SET scans = scans + 1 WHERE id = ?').bind(id).run().catch(() => undefined));
  return redirect(url);
}

function png(body: BodyInit | null, cache: string): Response {
  const headers = secure(new Headers({ 'content-type': 'image/png', 'cache-control': cache, 'x-robots-tag': 'noindex' }));
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  return new Response(body, { headers });
}

async function publicLogo(env: ShippedEnv, id: number): Promise<Response> {
  const db = await database(env);
  if (!db || !env.SHIPPED) return new Response('Not found', { status: 404 });
  const bid = await db.prepare(`SELECT logo_key FROM shipped_bids WHERE id = ? AND logo_ok = 1 AND status IN ('live', 'outbid')`).bind(id).first<{ logo_key: string | null }>();
  const object = bid?.logo_key ? await env.SHIPPED.get(bid.logo_key) : null;
  if (!object) return new Response('Not found', { status: 404 });
  return png(object.body, 'public, max-age=300');
}

async function state(env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const off = await switchedOff(env, db);
  const generator = await generatorState(env, db, off);
  const provider = sponsorProvider(env);
  const window = await liveWindow(env, db);
  const closes = await slotClosesAt(db, window.closesAt);
  const anySlotOpen = closes.some((at) => takeoversOpen(window.now, at));
  const open = Boolean(provider) && (window.phase === 'open' || anySlotOpen);
  const payments = {
    open: Boolean(provider) && !off.has('sponsors') && anySlotOpen,
    prints: open && !off.has('prints') && window.phase === 'open',
    provider: provider?.id ?? null,
    live: provider?.live ?? false,
    wallet: Boolean(provider?.id === 'stripe' && env.STRIPE_PUBLISHABLE_KEY),
    printCents: PRINT_PRICE_CENTS,
    lockMinutes: BID_RULES.lockMinutes,
  };
  const base = { event: { name: EVENT_NAME, opensAt: window.opensAt, closesAt: window.closesAt, phase: window.phase, now: window.now }, payments };
  if (!db) return json({ ...base, printed: 0, shared: 0, piled: 0, recent: [], generator, sponsors: await sponsorBlock(null, env, off) });

  const [counts, recent, piled, sponsors] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS printed, COALESCE(SUM(shares), 0) AS shared FROM shipped_receipts').first<{ printed: number; shared: number }>(),
    db
      .prepare(`SELECT id, data FROM shipped_receipts WHERE listed = 1 AND hidden = 0 AND mode = ? ORDER BY id DESC LIMIT 12`)
      .bind(modeOf(generator.year))
      .all<{ id: number; data: string }>(),
    db.prepare('SELECT COUNT(*) AS n FROM shipped_receipts WHERE listed = 1 AND hidden = 0 AND mode = ?').bind(modeOf(generator.year)).first<{ n: number }>(),
    sponsorBlock(db, env, off),
  ]);
  return json(
    {
      ...base,
      generator,
      printed: counts?.printed ?? 0,
      shared: counts?.shared ?? 0,
      piled: piled?.n ?? 0,
      recent: recent.results.flatMap((row) => {
        const receipt = JSON.parse(row.data) as YearReceipt;
        return receipt.version === 2 ? [{ id: row.id, who: subjectLabel(receipt.subject), count: itemsShipped(receipt), potential: receipt.potential }] : [];
      }),
      sponsors,
    },
    200,
    'public, max-age=10',
  );
}

async function icon(env: ShippedEnv, hash: string): Promise<Response> {
  const object = ICON_HASH.test(hash) ? await env.SHIPPED?.get(iconKey(hash)) : null;
  if (!object) return new Response('Not found', { status: 404 });
  return png(object.body, 'public, max-age=31536000, immutable');
}

// ---- Share pages and images ------------------------------------------------------------------------

function logoResolver(env: ShippedEnv, db: D1Database | null): LogoResolver {
  return async (path) => {
    if (!path) return null;
    if (path.startsWith('/api/shipped/icon/')) return iconDataUri(path, env.SHIPPED);
    const id = path.match(/^\/api\/shipped\/logo\/(\d{1,9})\.png$/)?.[1];
    if (!id || !db || !env.SHIPPED) return null;
    const bid = await db.prepare('SELECT logo_key FROM shipped_bids WHERE id = ? AND logo_ok = 1').bind(Number(id)).first<{ logo_key: string | null }>();
    const object = bid?.logo_key ? await env.SHIPPED.get(bid.logo_key) : null;
    return object ? bytesDataUri(await object.arrayBuffer()) : null;
  };
}

type ImageKind = 'card' | 'tall' | 'rollo';

async function shareImage(request: Request, env: ShippedEnv, ctx: ExecutionContext, id: number, kind: ImageKind): Promise<Response> {
  const url = new URL(request.url);
  const db = await database(env);
  const receipt = db ? await loadReceipt(db, id) : null;
  if (!receipt) return kind === 'card' ? Response.redirect(new URL('/og-shipped.jpg', url).toString(), 302) : new Response('Not found', { status: 404 });
  const block = await sponsorBlock(db, env);
  const sponsors = block.slots.map((slot) => `${slot.qr}:${slot.logo ? 1 : 0}`).join(',');
  const cacheKey = `share/${id}/${kind}-v${IMAGE_VERSION}-${seedOf(sponsors).toString(36)}.png`;
  const download = url.searchParams.has('download');
  const respond = (body: BodyInit) => {
    const response = png(body, 'public, max-age=300');
    if (download) response.headers.set('content-disposition', `attachment; filename="shipped-${receipt.year}-${receiptNumber(id)}${kind === 'tall' ? '-receipt' : kind === 'rollo' ? '-rollo' : ''}.png"`);
    return response;
  };
  const stored = await env.SHIPPED?.get(cacheKey);
  if (stored) return respond(stored.body);
  const render = kind === 'card' ? yearCardPng : kind === 'rollo' ? yearRolloPng : yearTallPng;
  const image = await render(receipt, block, shippedOrigin(env, url), logoResolver(env, db));
  ctx.waitUntil(env.SHIPPED?.put(cacheKey, image, { httpMetadata: { contentType: 'image/png' } }) ?? Promise.resolve());
  return respond(image);
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
  headers.set('cache-control', 'public, max-age=60');
  if (!receipt || !db) {
    headers.set('cache-control', 'no-store');
    return new Response(shell.body, { status: 404, headers });
  }

  ctx.waitUntil(db.prepare('UPDATE shipped_receipts SET views = views + 1 WHERE id = ?').bind(id).run().catch(() => undefined));
  const sponsors = await sponsorBlock(db, env);
  // JSON inside a <script> data block: "<" escaped so nothing in a receipt can close the tag.
  const payload = JSON.stringify({ receipt, sponsors }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const who = subjectLabel(receipt.subject);
  const n = itemsShipped(receipt);
  const title = receipt.potential ? `${who}: shipped in ${receipt.year} (potential) | Shipped` : `${who} shipped ${n} thing${n === 1 ? '' : 's'} in ${receipt.year} | Shipped`;
  const description = `${shareText(receipt).replace(/:$/, '.')} Print yours at ${SHIPPED_HOST}.`;
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

/** /shipped/r/<id>/, its og.png, receipt.png and rollo.png. Anything else under /shipped/r/ is the static shell. Edge-cached briefly. */
export async function handleShippedPage(request: Request, env: ShippedEnv & { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
  env = withKeyAliases(env);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/shipped\/r\/(\d{1,9})(\/(og\.png|receipt\.png|rollo\.png)?)?$/);
  if (!match) return env.ASSETS.fetch(request);
  const id = Number(match[1]);
  if (!match[2]) return Response.redirect(new URL(RECEIPT_PATH(id), url).toString(), 301);
  if ((await switchedOff(env, env.DB ?? null)).has('site')) return outOfPaper();
  if (match[3] === 'og.png' || match[3] === 'receipt.png' || match[3] === 'rollo.png') {
    const kind = match[3] === 'og.png' ? 'card' : match[3] === 'rollo.png' ? 'rollo' : 'tall';
    if (url.searchParams.has('download')) return shareImage(request, env, ctx, id, kind);
    return cached(request, ctx, 300, () => shareImage(request, env, ctx, id, kind));
  }
  return cached(request, ctx, 60, () => sharePage(request, env, ctx, id));
}

/** The whole site switched off: one plain page, no app, no data. */
export function outOfPaper(): Response {
  const headers = secure(new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': NOINDEX }));
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Shipped 2026: out of paper</title><body style="font:16px ui-monospace,monospace;background:#121316;color:#f3ead8;display:grid;place-items:center;height:100vh;margin:0"><p>OUT OF PAPER. Back soon.</p></body>',
    { status: 503, headers },
  );
}

export async function handleShipped(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response | null> {
  env = withKeyAliases(env);
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/shipped/')) return null;
  const method = request.method;
  const hook = path.match(/^\/api\/shipped\/webhook\/([a-z0-9-]{1,20})$/);
  // Payment webhooks always land (refunds and expiries must be recorded even with the site switched off).
  if (hook && method === 'POST') return webhook(request, env, hook[1]);
  if (method === 'OPTIONS') return new Response(null, { status: 405, headers: secure(new Headers({ allow: 'GET, POST' })) });
  if ((await switchedOff(env, env.DB ?? null)).has('site') && path !== '/api/shipped/checkout') return json({ error: 'out-of-paper' }, 503);

  if (path === '/api/shipped/state' && method === 'GET') return cached(request, ctx, 10, () => state(env));
  if (path === '/api/shipped/challenge' && method === 'GET') return challenge(request, env);
  if (path === '/api/shipped/lookup' && method === 'POST') return lookup(request, env);
  if (path === '/api/shipped/print' && method === 'POST') return print(request, env, ctx);
  if (path === '/api/shipped/pile' && method === 'GET') return cached(request, ctx, 15, () => pile(url, env));
  if (path === '/api/shipped/pile' && method === 'POST') return tossOnPile(request, env);
  if (path === '/api/shipped/shared' && method === 'POST') return shared(request, env);
  if (path === '/api/shipped/seen' && method === 'POST') return seen(request, env);
  if (path === '/api/shipped/takedown' && method === 'POST') return takedown(request, env, ctx);
  if (path === '/api/shipped/bid' && method === 'POST') return createBid(request, env);
  if (path === '/api/shipped/print-order' && method === 'POST') return createPrintOrder(request, env);
  if (path === '/api/shipped/checkout' && method === 'GET') return checkoutStatus(url, env);
  if (path === '/api/shipped/checkout/cancel' && method === 'POST') return cancelCheckout(request, env);

  const receipt = path.match(/^\/api\/shipped\/receipts\/(\d{1,9})$/);
  if (receipt && method === 'GET') {
    return cached(request, ctx, 60, async () => {
      const db = await database(env);
      const found = db ? await loadReceipt(db, Number(receipt[1])) : null;
      if (!found || !db) return json({ error: 'not-found' }, 404);
      return json({ receipt: found, sponsors: await sponsorBlock(db, env) }, 200, 'public, max-age=60');
    });
  }
  const iconMatch = path.match(/^\/api\/shipped\/icon\/([a-f0-9]{24})\.png$/);
  if (iconMatch && method === 'GET') return icon(env, iconMatch[1]);
  const logo = path.match(/^\/api\/shipped\/logo\/(\d{1,9})\.png$/);
  if (logo && method === 'GET') return publicLogo(env, Number(logo[1]));

  return json({ error: 'not-found' }, 404);
}

/** GET /api/shipped/challenge: a proof-of-work puzzle for browsers when Turnstile isn't configured. */
async function challenge(request: Request, env: ShippedEnv): Promise<Response> {
  const human = humanCheck(env);
  if (human.kind !== 'pow') return json({ kind: 'turnstile' });
  const db = await database(env);
  if (db && (await overLimit(db, request, 'challenge'))) return json({ error: 'slow-down' }, 429);
  return json({ kind: 'pow', ...(await issueChallenge(env)) });
}

// ---- Scheduled: retention ------------------------------------------------------------------------------

/**
 * Keeps only what's needed: shipping addresses go 30 days after a print ships (or 60 after a refund/failure),
 * buyer emails 120 days after payment, old rate-limit windows and locks daily.
 */
export async function shippedCron(env: ShippedEnv): Promise<void> {
  const db = await database(env);
  if (!db) return;
  const now = Date.now();
  await settleOpenCheckouts(db, env, now);
  await db.batch([
    db
      .prepare(
        `UPDATE print_orders SET ship_name = NULL, ship_line1 = NULL, ship_line2 = NULL, ship_postal = NULL, email = NULL
         WHERE ship_line1 IS NOT NULL AND ((status = 'shipped' AND shipped_at < ?) OR (status IN ('refunded', 'failed') AND created_at < ?))`,
      )
      .bind(now - 30 * DAY, now - 60 * DAY),
    db.prepare('UPDATE shipped_bids SET email = NULL WHERE email IS NOT NULL AND paid_at < ?').bind(now - 120 * DAY),
    db.prepare(`UPDATE shipped_bids SET status = 'failed', note = 'checkout abandoned' WHERE status = 'checkout' AND paid_at IS NULL AND created_at < ?`).bind(now - 2 * DAY),
  ]);
  await sweepLimits(db, now);
}

/**
 * Checkouts still open after Stripe's shortest session: asks Stripe how each ended. Without the webhook secret a
 * buyer who paid and closed the tab would otherwise be swept as "abandoned" with their money taken.
 */
async function settleOpenCheckouts(db: D1Database, env: ShippedEnv, now: number): Promise<void> {
  const provider = sponsorProvider(env);
  if (!provider?.confirm) return;
  const since = now - 3 * DAY;
  const until = now - (BID_RULES.checkoutMinutes + 5) * 60_000;
  const [bids, orders] = await Promise.all([
    db.prepare(`SELECT checkout_id FROM shipped_bids WHERE status = 'checkout' AND checkout_id IS NOT NULL AND created_at BETWEEN ? AND ? LIMIT 25`).bind(since, until).all<{ checkout_id: string }>(),
    db.prepare(`SELECT checkout_id FROM print_orders WHERE status = 'checkout' AND checkout_id IS NOT NULL AND created_at BETWEEN ? AND ? LIMIT 25`).bind(since, until).all<{ checkout_id: string }>(),
  ]);
  for (const { checkout_id: checkoutId } of [...bids.results, ...orders.results]) {
    try {
      await applyEvent(db, env, await provider.confirm(checkoutId));
    } catch (error) {
      console.error('shipped: settle failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    }
  }
}

// ---- Admin (/admin, behind the password check in worker/metrics.ts) --------------------------------

async function hideReceipts(db: D1Database, env: ShippedEnv, key: string) {
  const { results } = await db.prepare('SELECT id FROM shipped_receipts WHERE login_key = ?').bind(key).all<{ id: number }>();
  await db.prepare('UPDATE shipped_receipts SET hidden = 1, listed = 0 WHERE login_key = ?').bind(key).run();
  await Promise.all(results.map((row) => purgeReceipt(env, row.id)));
}

export async function adminShipped(request: Request, env: ShippedEnv): Promise<Response> {
  env = withKeyAliases(env);
  const db = await database(env);
  if (!db) return json({ error: 'no-database' }, 503);
  const url = new URL(request.url);

  const logo = url.pathname.match(/^\/api\/admin\/shipped\/logo\/(\d{1,9})$/);
  if (logo) {
    const bid = await db.prepare('SELECT logo_key FROM shipped_bids WHERE id = ?').bind(Number(logo[1])).first<{ logo_key: string | null }>();
    const object = bid?.logo_key && env.SHIPPED ? await env.SHIPPED.get(bid.logo_key) : null;
    if (!object) return new Response('Not found', { status: 404 });
    return png(object.body, 'no-store');
  }
  if (url.pathname !== '/api/admin/shipped') return json({ error: 'not-found' }, 404);

  const provider = sponsorProvider(env);
  if (request.method === 'POST') {
    const body = await readJson(request);
    if (!body) return json({ error: 'bad-request' }, 400);
    const id = Number(body.id);
    const now = Date.now();

    if (body.action === 'switch') {
      if (!isSwitch(body.name)) return json({ error: 'bad-switch' }, 400);
      await setSwitch(db, body.name, body.off === true);
      return json({ ok: true });
    }
    if (body.action === 'hide-receipt' || body.action === 'show-receipt') {
      const hidden = body.action === 'hide-receipt' ? 1 : 0;
      await db.prepare('UPDATE shipped_receipts SET hidden = ? WHERE id = ?').bind(hidden, id).run();
      if (hidden) await purgeReceipt(env, id);
      return json({ ok: true });
    }
    if (body.action === 'remove-takedown' || body.action === 'dismiss-takedown') {
      const ask = await db.prepare(`SELECT * FROM shipped_takedowns WHERE id = ?`).bind(id).first<{ receipt_id: number; subject_key: string; status: string }>();
      if (!ask) return json({ error: 'not-found' }, 404);
      const removing = body.action === 'remove-takedown';
      await db.prepare('UPDATE shipped_takedowns SET status = ?, reviewed_at = ? WHERE id = ?').bind(removing ? 'removed' : 'dismissed', now, id).run();
      // Removing takes down every receipt for that name, handle or site, and stops new ones printing (the opt-out list).
      if (removing) await hideReceipts(db, env, ask.subject_key);
      else await db.prepare('UPDATE shipped_receipts SET hidden = 0 WHERE id = ? AND hidden = 1').bind(ask.receipt_id).run();
      return json({ ok: true });
    }
    if (body.action === 'block-subject') {
      const key = typeof body.key === 'string' ? body.key.trim().toLowerCase().slice(0, 120) : '';
      if (!/^(github|x|domain|name):.+$/.test(key)) return json({ error: 'bad-key' }, 400);
      await db.prepare(`INSERT INTO shipped_takedowns (receipt_id, subject_key, reason, status, created_at, reviewed_at) VALUES (0, ?, 'blocked from /admin', 'removed', ?, ?)`).bind(key, now, now).run();
      await hideReceipts(db, env, key);
      return json({ ok: true });
    }
    if (body.action === 'restock') {
      await db.batch([db.prepare(`DELETE FROM shipped_flags WHERE key = 'out-of-credit'`), db.prepare('UPDATE shipped_spend SET reserved_micros = 0 WHERE day = ?').bind(today())]);
      return json({ ok: true });
    }

    if (body.action === 'order-shipped') {
      await db.prepare(`UPDATE print_orders SET status = 'shipped', shipped_at = ? WHERE id = ? AND status = 'to_print'`).bind(now, id).run();
      return json({ ok: true });
    }
    if (body.action === 'order-refund') {
      const order = await db.prepare('SELECT * FROM print_orders WHERE id = ?').bind(id).first<OrderRow>();
      if (!order?.order_id || !provider || order.provider !== provider.id) return json({ error: 'not-refundable' }, 409);
      const refund = await provider.refund(order.order_id, undefined, `order-${order.id}-full`);
      if (refund.ok) await db.prepare(`UPDATE print_orders SET status = 'refunded' WHERE id = ?`).bind(id).run();
      return json({ ok: refund.ok, error: refund.ok ? undefined : refund.error });
    }

    const bid = await db.prepare('SELECT * FROM shipped_bids WHERE id = ?').bind(id).first<BidRow>();
    if (!bid) return json({ error: 'not-found' }, 404);
    if (body.action === 'logo-approve' || body.action === 'logo-reject') {
      const approve = body.action === 'logo-approve';
      await db.prepare('UPDATE shipped_bids SET logo_ok = ? WHERE id = ?').bind(approve ? 1 : 0, id).run();
      if (!approve && bid.logo_key) {
        await env.SHIPPED?.delete(bid.logo_key);
        await db.prepare('UPDATE shipped_bids SET logo_key = NULL WHERE id = ?').bind(id).run();
      }
      return json({ ok: true });
    }
    if (body.action === 'remove-bid') {
      // Instant kill: the slot goes back to the house ad at once and the sponsor gets everything back.
      const refund =
        bid.order_id && provider && provider.id === bid.provider ? await provider.refund(bid.order_id, undefined, `bid-${bid.id}-removed`) : { ok: !bid.order_id, error: `provider ${bid.provider} not available` };
      await db
        .prepare(`UPDATE shipped_bids SET status = 'removed', ended_at = ?, refund_cents = ?, note = ?, seen_at_end = CASE WHEN status = 'live' THEN ${IMPRESSIONS_NOW} ELSE seen_at_end END WHERE id = ?`)
        .bind(now, refund.ok ? (bid.total_cents ?? bid.amount_cents) : 0, refund.ok ? 'removed in review' : `removed; refund failed: ${refund.error ?? ''}`.slice(0, 200), id)
        .run();
      if (bid.logo_key) await env.SHIPPED?.delete(bid.logo_key);
      return json({ ok: refund.ok, error: refund.ok ? undefined : refund.error });
    }
    return json({ error: 'bad-action' }, 400);
  }

  const since = new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10);
  const off = await switchedOff(env, db);
  const [bids, orders, receipts, spend, totals, takedowns, credit, tinyfish] = await db.batch([
    db.prepare(`SELECT * FROM shipped_bids WHERE status NOT IN ('checkout', 'failed') ORDER BY id DESC LIMIT 80`),
    db.prepare(`SELECT id, receipt_id, status, amount_cents, total_cents, ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postal, paid_at, shipped_at, note FROM print_orders WHERE status IN ('to_print', 'shipped', 'refunded') ORDER BY CASE status WHEN 'to_print' THEN 0 ELSE 1 END, id DESC LIMIT 80`),
    db.prepare('SELECT id, login, login_key, mode, demo, hidden, listed, shares, views, model, searches, input_tokens, output_tokens, cost_micros, created_at FROM shipped_receipts ORDER BY id DESC LIMIT 40'),
    db.prepare('SELECT * FROM shipped_spend WHERE day >= ? ORDER BY day DESC').bind(since),
    db.prepare('SELECT COUNT(*) AS printed, COALESCE(SUM(shares), 0) AS shared, COALESCE(SUM(views), 0) AS views FROM shipped_receipts'),
    db.prepare(
      `SELECT t.id, t.receipt_id, t.subject_key, t.reason, t.created_at, r.login FROM shipped_takedowns t
       LEFT JOIN shipped_receipts r ON r.id = t.receipt_id WHERE t.status = 'open' ORDER BY t.id`,
    ),
    db.prepare(`SELECT set_at FROM shipped_flags WHERE key = 'out-of-credit'`),
    db.prepare('SELECT kind, n FROM shipped_tinyfish WHERE day = ?').bind(today()),
  ]);
  const t = totals.results[0] as { printed: number; shared: number; views: number } | undefined;
  return json({
    provider: provider ? { id: provider.id, live: provider.live } : null,
    generator: await generatorState(env, db, off),
    switches: Object.fromEntries((['site', 'generate', 'sponsors', 'prints', 'sponsor-display'] as Switch[]).map((name) => [name, off.has(name)])),
    forced: (env.SHIPPED_OFF ?? '').split(',').map((s) => s.trim()).filter(isSwitch),
    model: env.SHIPPED_MODEL || DEFAULT_MODEL,
    maxSearches: maxSearches(env),
    outOfCreditAt: (credit.results[0] as { set_at: number } | undefined)?.set_at ?? null,
    tinyfish: {
      enabled: Boolean(env.TINYFISH_API_KEY),
      today: Object.fromEntries((tinyfish.results as { kind: string; n: number }[]).map((row) => [row.kind, row.n])),
      daily: TINYFISH_DAILY,
    },
    capUsd: ((await cycleBudgetCap(db, env)) ?? 0) / 1_000_000,
    budget: await budgetUsed(db, budgetKey()),
    printed: t?.printed ?? 0,
    shared: t?.shared ?? 0,
    views: t?.views ?? 0,
    bids: bids.results,
    orders: orders.results,
    receipts: receipts.results,
    spend: spend.results,
    takedowns: takedowns.results,
    sponsors: await sponsorBlock(db, env, new Set()),
  });
}
