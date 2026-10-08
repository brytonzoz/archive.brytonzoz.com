// /shipped/ backend: "Print my receipt" (a visitor's public GitHub, itemized by Claude) and sponsor
// lines (paid, then approved by Bryton in /admin before anything shows).
//
//   GET  /api/shipped/state            counter, generator + sponsor status, approved sponsor lines
//   POST /api/shipped/print            { login, mode, token } -> { id }
//   GET  /api/shipped/receipts/<id>    a printed receipt + the sponsors shown on it
//   POST /api/shipped/sponsor          multipart { tier, text, url?, logo?, token } -> { url } (checkout)
//   GET  /api/shipped/sponsor/status?checkout=<id>        after checkout: confirms payment, where the line stands
//   GET  /api/shipped/sponsor/receipt.png?checkout=<id>   the supporter's downloadable receipt image
//   POST /api/shipped/webhook/<id>     payment provider webhook (worker/shipped-pay.ts; Stripe: /webhook/stripe)
//   GET  /api/shipped/logo/<id>.png    an approved sponsor's 1-bit logo
//   GET  /shipped/r/<id>/              share page: the static shell with this receipt's tags and data
//   GET  /shipped/r/<id>/og.png        its link-preview image (rendered once, kept in R2)
//   /api/admin/shipped*                moderation queue, behind the /admin password (worker/metrics.ts)
//
// Tables are created on first use (also listed in worker/schema.sql).
import { DEFAULT_MODEL, PrintError, demoDraft, fetchGithub, writeReceipt, type AiEnv } from './shipped-ai';
import { printedSvg, renderPng } from './shipped-og';
import { isProduction, sponsorProvider, type PayEnv, type SponsorEvent } from './shipped-pay';
import { receiptBarcodeUnits, receiptDate } from '../lib/shipped';
import { supporterReceiptSvg } from '../lib/receipt-svg';
import {
  GITHUB_USERNAME,
  RECEIPT_PATH,
  money,
  receiptNumber,
  shareText,
  type PrintMode,
  type PrintedReceipt,
  type PublicSponsor,
  type SponsorFeed,
} from '../lib/shipped-receipt';
import {
  LOGO_LIMITS,
  SPONSOR_CONFIG,
  SPONSOR_TIERS,
  isSponsorTier,
  priceCents,
  validateSponsor,
  type SponsorTier,
} from '../lib/shipped-sponsors';

export interface ShippedEnv extends AiEnv, PayEnv {
  DB?: D1Database;
  SHIPPED?: R2Bucket;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Daily Claude budget in USD (default 3); printing pauses for the day once reached. */
  SHIPPED_DAILY_CAP_USD?: string;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const PRINT_LIMIT_PER_HOUR = 10;
const SPONSOR_LIMIT_PER_HOUR = 6;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipped_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, login_key TEXT NOT NULL, day TEXT NOT NULL,
    mode TEXT NOT NULL, data TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_micros INTEGER, created_at INTEGER NOT NULL)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS shipped_receipts_daily ON shipped_receipts (login_key, day, mode)',
  `CREATE TABLE IF NOT EXISTS shipped_spend (
    day TEXT PRIMARY KEY, receipts INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros INTEGER NOT NULL DEFAULT 0)`,
  'CREATE TABLE IF NOT EXISTS shipped_limits (key TEXT PRIMARY KEY, win INTEGER NOT NULL, count INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS sponsor_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, text TEXT NOT NULL, url TEXT, logo_key TEXT,
    status TEXT NOT NULL, roll INTEGER NOT NULL, line_no INTEGER, amount_cents INTEGER NOT NULL, provider TEXT NOT NULL,
    checkout_id TEXT, order_id TEXT, note TEXT, created_at INTEGER NOT NULL, paid_at INTEGER, reviewed_at INTEGER,
    starts_at INTEGER, ends_at INTEGER, tax_cents INTEGER, total_cents INTEGER)`,
  'CREATE INDEX IF NOT EXISTS sponsor_lines_status ON sponsor_lines (status, tier)',
  'CREATE UNIQUE INDEX IF NOT EXISTS sponsor_lines_checkout ON sponsor_lines (checkout_id)',
  'CREATE INDEX IF NOT EXISTS sponsor_lines_order ON sponsor_lines (order_id)',
];
// Columns added after the table first shipped; "duplicate column" means it's already there.
const COLUMNS = ['ALTER TABLE sponsor_lines ADD COLUMN tax_cents INTEGER', 'ALTER TABLE sponsor_lines ADD COLUMN total_cents INTEGER'];

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

function json(data: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache, 'x-robots-tag': 'noindex, nofollow, noarchive' },
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const capMicros = (env: ShippedEnv) => Math.round((Number(env.SHIPPED_DAILY_CAP_USD) || 3) * 1_000_000);

// Cloudflare's published always-pass test keys: staging works before real Turnstile keys exist.
const TEST_TURNSTILE = { site: '1x00000000000000000000AA', secret: '1x0000000000000000000000000000000AA' };

function turnstileKeys(env: ShippedEnv): { site: string; secret: string; test: boolean } | null {
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) return { site: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET_KEY, test: false };
  return isProduction(env) ? null : { ...TEST_TURNSTILE, test: true };
}

async function verifyTurnstile(env: ShippedEnv, token: unknown, ip: string): Promise<boolean> {
  const keys = turnstileKeys(env);
  if (!keys || typeof token !== 'string' || !token || token.length > 2048) return false;
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

type GeneratorState = { enabled: boolean; demo: boolean; reason: string | null; turnstileSiteKey: string | null };

async function generatorState(env: ShippedEnv, db: D1Database | null): Promise<GeneratorState> {
  const keys = turnstileKeys(env);
  const off = (reason: string): GeneratorState => ({ enabled: false, demo: false, reason, turnstileSiteKey: keys?.site ?? null });
  if (!db) return off('no-database');
  if (!keys) return off('no-turnstile');
  const demo = !env.ANTHROPIC_API_KEY;
  if (demo && isProduction(env)) return off('no-ai');
  if (!demo) {
    const spend = await db.prepare('SELECT cost_micros FROM shipped_spend WHERE day = ?').bind(today()).first<{ cost_micros: number }>();
    if ((spend?.cost_micros ?? 0) >= capMicros(env)) return off('out-of-paper');
  }
  return { enabled: true, demo, reason: null, turnstileSiteKey: keys.site };
}

async function recordSpend(db: D1Database, ok: boolean, input: number, output: number, cost: number) {
  await db
    .prepare(
      `INSERT INTO shipped_spend (day, receipts, failures, input_tokens, output_tokens, cost_micros) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET receipts = receipts + excluded.receipts, failures = failures + excluded.failures,
       input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
       cost_micros = cost_micros + excluded.cost_micros`,
    )
    .bind(today(), ok ? 1 : 0, ok ? 0 : 1, input, output, cost)
    .run();
}

type ReceiptRow = { id: number; data: string; hidden: number };

async function loadReceipt(db: D1Database, id: number): Promise<PrintedReceipt | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = await db.prepare('SELECT id, data, hidden FROM shipped_receipts WHERE id = ?').bind(id).first<ReceiptRow>();
  if (!row || row.hidden) return null;
  return { ...(JSON.parse(row.data) as Omit<PrintedReceipt, 'id'>), id: row.id };
}

async function print(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response> {
  const db = await database(env);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const login = String(body.login ?? '').trim().replace(/^@/, '');
  if (!GITHUB_USERNAME.test(login)) return json({ error: 'invalid-username' }, 400);
  const mode: PrintMode = body.mode === 'roast' ? 'roast' : 'flex';

  const state = await generatorState(env, db);
  if (!state.enabled || !db) return json({ error: state.reason ?? 'offline' }, 503);
  if (!(await verifyTurnstile(env, body.token, request.headers.get('cf-connecting-ip') ?? ''))) return json({ error: 'turnstile' }, 403);
  if (!(await allow(db, `print:${await ipKey(request)}`, PRINT_LIMIT_PER_HOUR, HOUR))) return json({ error: 'slow-down' }, 429);
  if (Math.random() < 0.02) ctx.waitUntil(db.prepare('DELETE FROM shipped_limits WHERE win < ?').bind(Math.floor(Date.now() / HOUR) - 48).run());

  const key = login.toLowerCase();
  const day = today();
  const taken = await db.prepare('SELECT 1 AS x FROM shipped_receipts WHERE login_key = ? AND hidden = 1 LIMIT 1').bind(key).first();
  if (taken) return json({ error: 'taken-down' }, 410);
  const cached = await db
    .prepare('SELECT id FROM shipped_receipts WHERE login_key = ? AND day = ? AND mode = ?')
    .bind(key, day, mode)
    .first<{ id: number }>();
  if (cached) return json({ id: cached.id, cached: true });

  try {
    const profile = await fetchGithub(login, env);
    let model: string | null = null;
    let usage = { input: 0, output: 0, cost: 0 };
    let draft;
    if (state.demo) {
      draft = demoDraft(profile);
    } else {
      try {
        const result = await writeReceipt(profile, mode, env);
        draft = result;
        model = result.model;
        usage = { input: result.inputTokens, output: result.outputTokens, cost: result.costMicros };
      } catch (error) {
        const spent = error as { costMicros?: number; inputTokens?: number; outputTokens?: number };
        ctx.waitUntil(recordSpend(db, false, spent.inputTokens ?? 0, spent.outputTokens ?? 0, spent.costMicros ?? 0));
        throw error;
      }
    }
    const receipt: Omit<PrintedReceipt, 'id'> = {
      login: profile.login,
      mode,
      printedAt: new Date().toISOString(),
      headline: draft.headline,
      verdict: draft.verdict,
      items: draft.items,
      charges: draft.charges,
      stats: { publicRepos: profile.publicRepos, followers: profile.followers, since: profile.createdYear },
      demo: state.demo,
    };
    const inserted = await db
      .prepare(
        `INSERT INTO shipped_receipts (login, login_key, day, mode, data, demo, model, input_tokens, output_tokens, cost_micros, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(login_key, day, mode) DO NOTHING RETURNING id`,
      )
      .bind(profile.login, key, day, mode, JSON.stringify(receipt), state.demo ? 1 : 0, model, usage.input, usage.output, usage.cost, Date.now())
      .first<{ id: number }>();
    if (!state.demo) ctx.waitUntil(recordSpend(db, true, usage.input, usage.output, usage.cost));
    const id =
      inserted?.id ??
      (await db.prepare('SELECT id FROM shipped_receipts WHERE login_key = ? AND day = ? AND mode = ?').bind(key, day, mode).first<{ id: number }>())?.id;
    if (!id) return json({ error: 'jammed' }, 500);
    if (inserted) ctx.waitUntil(storeOg(env, { ...receipt, id }).catch((error) => console.error('shipped: og render failed', error)));
    return json({ id });
  } catch (error) {
    if (error instanceof PrintError) return json({ error: error.code }, error.status);
    console.error('shipped: print failed', error);
    return json({ error: 'jammed' }, 500);
  }
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
const OCCUPIED = `(status IN ('paid_pending_review', 'approved') OR (status = 'checkout' AND created_at > ?))`;

const toPublic = (row: LineRow): PublicSponsor => ({
  id: row.id,
  tier: row.tier,
  text: row.text,
  url: row.url,
  logo: row.tier === 'logo' && row.logo_key ? `/api/shipped/logo/${row.id}.png` : null,
  roll: row.roll,
  lineNo: row.line_no ?? 0,
});

async function rollStatus(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT roll, COUNT(*) AS n FROM sponsor_lines WHERE ${OCCUPIED} GROUP BY roll`)
    .bind(holding())
    .all<{ roll: number; n: number }>();
  const used = new Map(results.map((row) => [row.roll, row.n]));
  let roll = 1;
  while ((used.get(roll) ?? 0) >= SPONSOR_CONFIG.rollSize) roll += 1;
  return { roll, filled: used.get(roll) ?? 0, archived: Array.from({ length: roll - 1 }, (_, i) => i + 1) };
}

async function headerTaken(db: D1Database): Promise<{ taken: number; nextOpen: number | null }> {
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(CASE WHEN status = 'approved' THEN ends_at END) AS next FROM sponsor_lines WHERE tier = 'header' AND (
        (status = 'approved' AND ends_at > ?) OR status = 'paid_pending_review' OR (status = 'checkout' AND created_at > ?))`,
    )
    .bind(now, holding())
    .first<{ n: number; next: number | null }>();
  return { taken: row?.n ?? 0, nextOpen: row?.next ?? null };
}

async function sponsorFeed(db: D1Database, seed: number): Promise<SponsorFeed> {
  const now = Date.now();
  const [header, logos] = await db.batch<LineRow>([
    db
      .prepare(`SELECT * FROM sponsor_lines WHERE tier = 'header' AND status = 'approved' AND ends_at > ? ORDER BY starts_at LIMIT ?`)
      .bind(now, SPONSOR_CONFIG.headerSlots),
    db.prepare(`SELECT * FROM sponsor_lines WHERE tier = 'logo' AND status = 'approved' ORDER BY id`),
  ]);
  const pool = logos.results;
  const footer: LineRow[] = [];
  // Rotates by receipt and by hour, so every logo sponsor gets its turn.
  const start = pool.length ? (seed + Math.floor(now / HOUR)) % pool.length : 0;
  for (let i = 0; i < Math.min(SPONSOR_CONFIG.footerRotation, pool.length); i++) footer.push(pool[(start + i) % pool.length]);
  return { header: header.results.map(toPublic), footer: footer.map(toPublic) };
}

async function state(env: ShippedEnv): Promise<Response> {
  const db = await database(env);
  const generator = await generatorState(env, db);
  const provider = sponsorProvider(env);
  if (!db) return json({ printed: 0, generator, sponsors: { open: false, reason: 'no-database' }, lines: [], header: [] });

  const [printed, rolls, header, lines, feed] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM shipped_receipts').first<{ n: number }>(),
    rollStatus(db),
    headerTaken(db),
    db.prepare(`SELECT * FROM sponsor_lines WHERE status = 'approved' ORDER BY roll, line_no`).all<LineRow>(),
    sponsorFeed(db, 0),
  ]);
  const open = Boolean(provider && env.SHIPPED);
  const headerLeft = Math.max(0, SPONSOR_CONFIG.headerSlots - header.taken);
  return json(
    {
      printed: printed?.n ?? 0,
      generator,
      sponsors: {
        open,
        reason: open ? null : provider ? 'no-storage' : 'no-provider',
        provider: provider?.id ?? null,
        live: provider?.live ?? false,
        taxAtCheckout: provider?.id === 'stripe',
        roll: rolls.roll,
        rollSize: SPONSOR_CONFIG.rollSize,
        filled: rolls.filled,
        archived: rolls.archived,
        headerSlotsLeft: headerLeft,
        headerNextOpen: headerLeft ? null : header.nextOpen,
        headerDays: SPONSOR_CONFIG.headerDays,
        tiers: SPONSOR_TIERS.map((tier) => ({
          tier,
          ...SPONSOR_CONFIG.tiers[tier],
          cents: priceCents(tier, rolls.roll),
          available: open && (tier !== 'header' || headerLeft > 0),
        })),
      },
      lines: lines.results.map(toPublic),
      header: feed.header,
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
  if (!(await allow(db, `sponsor:${await ipKey(request)}`, SPONSOR_LIMIT_PER_HOUR, HOUR))) return json({ error: 'slow-down' }, 429);

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

  const rolls = await rollStatus(db);
  if (tier === 'header' && (await headerTaken(db)).taken >= SPONSOR_CONFIG.headerSlots) {
    return json({ error: 'invalid', message: 'All header slots are taken right now.' }, 409);
  }
  const amount = priceCents(tier, rolls.roll);
  const line = await db
    .prepare(
      `INSERT INTO sponsor_lines (tier, text, url, status, roll, amount_cents, provider, created_at)
       VALUES (?, ?, ?, 'checkout', ?, ?, ?, ?) RETURNING id`,
    )
    .bind(tier, check.text, check.url, rolls.roll, amount, provider.id, Date.now())
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
      label: `Supporter shout-out: ${config.label} · ROLL ${String(rolls.roll).padStart(3, '0')}`,
      description: `"${check.text}" printed on the receipt at brytonzoz.com/shipped once approved, plus a downloadable receipt image. Refunded in full if not approved.`,
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
    // Any refund (from /admin or the Stripe dashboard) takes the line off the receipt.
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
    roll: line.roll,
    lineNo: line.status === 'approved' ? line.line_no : null,
    amountCents: line.amount_cents,
    taxCents: line.tax_cents,
    totalCents: line.total_cents,
    receipt: PAID.has(line.status) ? `/api/shipped/sponsor/receipt.png?checkout=${encodeURIComponent(checkoutId)}` : null,
  });
}

const pad3 = (n: number) => String(n).padStart(3, '0');

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
      { label: 'ROLL', value: pad3(line.roll) },
      { label: 'LINE', value: line.status === 'approved' && line.line_no ? `#${pad3(line.line_no)}` : 'IN REVIEW' },
      ...(line.tier === 'header' && line.ends_at ? [{ label: 'RUNS UNTIL', value: receiptDate(new Date(line.ends_at).toISOString()) }] : []),
    ],
    charges: [
      { label: 'SUPPORTER SHOUT-OUT', value: money(line.amount_cents) },
      { label: 'TAX', value: money(tax) },
    ],
    total: money(line.total_cents ?? line.amount_cents + tax),
    status: line.status === 'approved' ? 'PRINTED ON THE RECEIPT' : 'PAID · PRINTS ONCE APPROVED',
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

// ---- Share pages ---------------------------------------------------------------------------------

const ogKey = (id: number) => `og/${id}.png`;

async function storeOg(env: ShippedEnv, receipt: PrintedReceipt): Promise<Uint8Array> {
  const png = await renderPng(printedSvg(receipt));
  await env.SHIPPED?.put(ogKey(receipt.id), png, { httpMetadata: { contentType: 'image/png' } });
  return png;
}

async function ogImage(request: Request, env: ShippedEnv, id: number): Promise<Response> {
  const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'x-robots-tag': 'noindex' };
  const stored = await env.SHIPPED?.get(ogKey(id));
  if (stored) return new Response(stored.body, { headers });
  const db = await database(env);
  const receipt = db ? await loadReceipt(db, id) : null;
  if (!receipt) return Response.redirect(new URL('/og-shipped.jpg', request.url).toString(), 302);
  return new Response(await storeOg(env, receipt), { headers });
}

const attr = (value: string) => ({ element: (el: Element) => void el.setAttribute('content', value) });

async function sharePage(request: Request, env: ShippedEnv & { ASSETS: Fetcher }, id: number): Promise<Response> {
  const url = new URL(request.url);
  const shell = await env.ASSETS.fetch(new Request(new URL('/shipped/r/', url)));
  const db = await database(env);
  const receipt = db ? await loadReceipt(db, id) : null;
  const headers = new Headers(shell.headers);
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('cache-control', 'public, max-age=60');
  if (!receipt || !db) return new Response(shell.body, { status: 404, headers });

  const sponsors = await sponsorFeed(db, receipt.id);
  const payload = JSON.stringify({ receipt, sponsors }).replace(/</g, '\\u003c');
  const title = `Receipt #${receiptNumber(receipt.id)} — @${receipt.login} | Shipped`;
  const description = `${shareText(receipt)} Printed at brytonzoz.com/shipped.`;
  const page = new URL(RECEIPT_PATH(receipt.id), url).toString();
  const image = new URL(`${RECEIPT_PATH(receipt.id)}og.png`, url).toString();
  const alt = `A printed receipt itemizing @${receipt.login}'s GitHub repositories`;

  const rewritten = new HTMLRewriter()
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
  return rewritten;
}

/** /shipped/r/<id>/ and /shipped/r/<id>/og.png. Anything else under /shipped/r/ is the static shell. */
export async function handleShippedPage(request: Request, env: ShippedEnv & { ASSETS: Fetcher }): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/shipped\/r\/(\d{1,9})(\/(og\.png)?)?$/);
  if (!match) return env.ASSETS.fetch(request);
  const id = Number(match[1]);
  if (!match[2]) return Response.redirect(new URL(RECEIPT_PATH(id), url).toString(), 301);
  if (match[3]) return ogImage(request, env, id);
  return sharePage(request, env, id);
}

export async function handleShipped(request: Request, env: ShippedEnv, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/shipped/')) return null;
  const method = request.method;

  if (path === '/api/shipped/state' && method === 'GET') return state(env);
  if (path === '/api/shipped/print' && method === 'POST') return print(request, env, ctx);
  if (path === '/api/shipped/sponsor' && method === 'POST') return createSponsor(request, env);
  if (path === '/api/shipped/sponsor/status' && method === 'GET') return sponsorStatus(url, env);
  if (path === '/api/shipped/sponsor/receipt.png' && method === 'GET') return supporterReceipt(url, env);

  const receipt = path.match(/^\/api\/shipped\/receipts\/(\d{1,9})$/);
  if (receipt && method === 'GET') {
    const db = await database(env);
    const found = db ? await loadReceipt(db, Number(receipt[1])) : null;
    if (!found || !db) return json({ error: 'not-found' }, 404);
    return json({ receipt: found, sponsors: await sponsorFeed(db, found.id) }, 200, 'public, max-age=60');
  }
  const hook = path.match(/^\/api\/shipped\/webhook\/([a-z0-9-]{1,20})$/);
  if (hook && method === 'POST') return webhook(request, env, hook[1]);
  const logo = path.match(/^\/api\/shipped\/logo\/(\d{1,9})\.png$/);
  if (logo && method === 'GET') return publicLogo(env, Number(logo[1]));

  return json({ error: 'not-found' }, 404);
}

// ---- Admin (/admin, behind the password check in worker/metrics.ts) --------------------------------

export async function adminShipped(request: Request, env: ShippedEnv): Promise<Response> {
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
    let body: { action?: string; id?: number };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const id = Number(body.id);
    const now = Date.now();

    if (body.action === 'hide-receipt' || body.action === 'show-receipt') {
      const hidden = body.action === 'hide-receipt' ? 1 : 0;
      await db.prepare('UPDATE shipped_receipts SET hidden = ? WHERE id = ?').bind(hidden, id).run();
      if (hidden) await env.SHIPPED?.delete(ogKey(id));
      return json({ ok: true });
    }

    const line = await db.prepare('SELECT * FROM sponsor_lines WHERE id = ?').bind(id).first<LineRow>();
    if (!line) return json({ error: 'not-found' }, 404);

    if (body.action === 'approve') {
      if (line.status !== 'paid_pending_review') return json({ error: 'not-pending' }, 409);
      const next = await db
        .prepare(`SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM sponsor_lines WHERE roll = ? AND status = 'approved'`)
        .bind(line.roll)
        .first<{ n: number }>();
      const header = line.tier === 'header';
      await db
        .prepare(`UPDATE sponsor_lines SET status = 'approved', line_no = ?, reviewed_at = ?, starts_at = ?, ends_at = ? WHERE id = ?`)
        .bind(next?.n ?? 1, now, header ? now : null, header ? now + SPONSOR_CONFIG.headerDays * DAY : null, id)
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
      return json({ ok: refund.ok, error: refund.ok ? undefined : refund.error });
    }

    return json({ error: 'bad-action' }, 400);
  }

  const since = new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10);
  const [pending, lines, receipts, spend, printed] = await db.batch([
    db.prepare(`SELECT * FROM sponsor_lines WHERE status = 'paid_pending_review' ORDER BY paid_at`),
    db.prepare(`SELECT * FROM sponsor_lines WHERE status NOT IN ('checkout', 'paid_pending_review', 'failed') ORDER BY id DESC LIMIT 60`),
    db.prepare(
      'SELECT id, login, mode, demo, hidden, model, input_tokens, output_tokens, cost_micros, created_at FROM shipped_receipts ORDER BY id DESC LIMIT 40',
    ),
    db.prepare('SELECT * FROM shipped_spend WHERE day >= ? ORDER BY day DESC').bind(since),
    db.prepare('SELECT COUNT(*) AS n FROM shipped_receipts'),
  ]);
  return json({
    provider: provider ? { id: provider.id, live: provider.live } : null,
    generator: await generatorState(env, db),
    model: env.SHIPPED_MODEL || DEFAULT_MODEL,
    capUsd: capMicros(env) / 1_000_000,
    printed: (printed.results[0] as { n: number } | undefined)?.n ?? 0,
    pending: pending.results,
    lines: lines.results,
    receipts: receipts.results,
    spend: spend.results,
  });
}
