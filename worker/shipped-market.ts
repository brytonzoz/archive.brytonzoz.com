// Shipped's snowball: the more people print, share and order, the more a sponsor slot is worth. Everything here
// is a real count (rows and deduped events, never seeded or rounded up), and every price change is logged.
//
//   counters     printed (new receipt rows), shared (share actions, one per visitor/receipt/way/day),
//                impressions (the sponsor block on screen, one per visitor/receipt/day)
//   floors       no slot sells below the floor for the receipts printed so far (lib/shipped-sponsors.ts ladder);
//                the ladder is /admin's (D1 flag "ladder"), else SHIPPED_PRICE_LADDER, else DEFAULT_LADDER
//   price log    floor steps, takeovers and ladder edits, public at /api/shipped/prices
import { DEFAULT_LADDER, HERO_SLOT, floorsAt, parseLadder, type Floors, type LadderStep } from '../lib/shipped-sponsors';

export interface MarketEnv {
  /** JSON ladder ([{ at, hero, slot }], cents); /admin's ladder wins over it. */
  SHIPPED_PRICE_LADDER?: string;
}

export type Counter = 'printed' | 'shared' | 'impressions';
export type PriceKind = 'floor' | 'takeover' | 'ladder';
export type LadderSource = 'admin' | 'env' | 'default';

/** Needs shipped_receipts (the seeds count it) and shipped_flags (worker/shipped-guard.ts). */
export const MARKET_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipped_price_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, slot INTEGER, kind TEXT NOT NULL,
    from_cents INTEGER, to_cents INTEGER, printed INTEGER NOT NULL, note TEXT)`,
  'CREATE TABLE IF NOT EXISTS shipped_counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)',
  // First run only: start from what's already there.
  `INSERT INTO shipped_counters (name, n) SELECT 'printed', COUNT(*) FROM shipped_receipts WHERE 1 ON CONFLICT(name) DO NOTHING`,
  `INSERT INTO shipped_counters (name, n) SELECT 'shared', COALESCE(SUM(shares), 0) FROM shipped_receipts WHERE 1 ON CONFLICT(name) DO NOTHING`,
];

export const MARKET_COLUMNS = [
  // The impressions counter when a bid went live and when it ended: its own impressions are the difference.
  'ALTER TABLE shipped_bids ADD COLUMN seen_at_live INTEGER',
  'ALTER TABLE shipped_bids ADD COLUMN seen_at_end INTEGER',
];

export async function bump(db: D1Database, name: Counter, by = 1): Promise<number> {
  const row = await db
    .prepare('INSERT INTO shipped_counters (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + excluded.n RETURNING n')
    .bind(name, by)
    .first<{ n: number }>();
  return row?.n ?? by;
}

export async function counters(db: D1Database): Promise<Record<Counter, number>> {
  const { results } = await db.prepare('SELECT name, n FROM shipped_counters').all<{ name: Counter; n: number }>();
  const out: Record<Counter, number> = { printed: 0, shared: 0, impressions: 0 };
  for (const row of results) if (row.name in out) out[row.name] = row.n;
  return out;
}

/** The impressions counter right now, as a sub-select (for stamping seen_at_live / seen_at_end in the same statement). */
export const IMPRESSIONS_NOW = `COALESCE((SELECT n FROM shipped_counters WHERE name = 'impressions'), 0)`;

export async function ladderFor(db: D1Database | null, env: MarketEnv): Promise<{ ladder: LadderStep[]; source: LadderSource }> {
  const row = db ? await db.prepare(`SELECT value FROM shipped_flags WHERE key = 'ladder'`).first<{ value: string }>() : null;
  const admin = row ? parseLadder(row.value) : null;
  if (admin) return { ladder: admin, source: 'admin' };
  const fromEnv = env.SHIPPED_PRICE_LADDER ? parseLadder(env.SHIPPED_PRICE_LADDER) : null;
  if (fromEnv) return { ladder: fromEnv, source: 'env' };
  return { ladder: DEFAULT_LADDER, source: 'default' };
}

/** Sets /admin's ladder (validated), or clears it with null. False when the ladder isn't valid. */
export async function setLadder(db: D1Database, raw: unknown, now = Date.now()): Promise<boolean> {
  if (raw === null) {
    await db.prepare(`DELETE FROM shipped_flags WHERE key = 'ladder'`).run();
    return true;
  }
  const ladder = parseLadder(raw);
  if (!ladder) return false;
  await db
    .prepare(`INSERT INTO shipped_flags (key, value, set_at) VALUES ('ladder', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at`)
    .bind(JSON.stringify(ladder), now)
    .run();
  return true;
}

const logStatement = (db: D1Database, entry: { at: number; slot: number | null; kind: PriceKind; from: number | null; to: number | null; printed: number; note: string | null }) =>
  db
    .prepare('INSERT INTO shipped_price_log (at, slot, kind, from_cents, to_cents, printed, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(entry.at, entry.slot, entry.kind, entry.from, entry.to, entry.printed, entry.note);

type Stored = { hero: number; slot: number };

function readStored(value: string | undefined): Stored | null {
  try {
    const parsed = value ? (JSON.parse(value) as Stored) : null;
    return parsed && Number.isSafeInteger(parsed.hero) && Number.isSafeInteger(parsed.slot) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The floors for `printed` receipts. When they differ from the last ones recorded, exactly one caller wins the
 * compare-and-swap on the "floors" flag and logs the change (hero as slot 0, the nine small slots as slot null).
 */
export async function syncFloors(db: D1Database, ladder: LadderStep[], printed: number, kind: 'floor' | 'ladder' = 'floor', now = Date.now()): Promise<Floors> {
  const floors = floorsAt(ladder, printed);
  const value = JSON.stringify({ hero: floors.hero, slot: floors.slot } satisfies Stored);
  const row = await db.prepare(`SELECT value FROM shipped_flags WHERE key = 'floors'`).first<{ value: string }>();
  if (row?.value === value) return floors;
  const won = await db
    .prepare(
      `INSERT INTO shipped_flags (key, value, set_at) VALUES ('floors', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at WHERE shipped_flags.value = ? RETURNING key`,
    )
    .bind(value, now, row?.value ?? null)
    .first();
  if (!won) return floors;
  const before = readStored(row?.value);
  const note = !before ? 'opening floors' : kind === 'ladder' ? 'price ladder changed' : `${floors.at.toLocaleString('en-US')} receipts printed`;
  const entries = [
    { slot: HERO_SLOT, from: before?.hero ?? null, to: floors.hero },
    { slot: null, from: before?.slot ?? null, to: floors.slot },
  ].filter((entry) => entry.from !== entry.to);
  if (entries.length) await db.batch(entries.map((entry) => logStatement(db, { at: now, kind, printed, note, ...entry })));
  return floors;
}

export type Market = { ladder: LadderStep[]; source: LadderSource; floors: Floors; counts: Record<Counter, number> };

/** Counters, the ladder and the floors in force (recording a step if one was just passed). */
export async function market(db: D1Database | null, env: MarketEnv): Promise<Market> {
  const { ladder, source } = await ladderFor(db, env);
  if (!db) return { ladder, source, floors: floorsAt(ladder, 0), counts: { printed: 0, shared: 0, impressions: 0 } };
  const counts = await counters(db);
  return { ladder, source, floors: await syncFloors(db, ladder, counts.printed), counts };
}

export const logTakeover = (db: D1Database, slot: number, from: number, to: number, printed: number, bidId: number, now = Date.now()) =>
  logStatement(db, { at: now, slot, kind: 'takeover', from, to, printed, note: `bid #${bidId}` }).run();

export const logLadderEdit = (db: D1Database, printed: number, note: string, now = Date.now()) =>
  logStatement(db, { at: now, slot: null, kind: 'ladder', from: null, to: null, printed, note: note.slice(0, 200) }).run();

export type PriceChange = { at: number; slot: number | null; kind: PriceKind; from: number | null; to: number | null; printed: number; note: string | null };

export async function priceLog(db: D1Database, limit = 40): Promise<PriceChange[]> {
  const { results } = await db
    .prepare('SELECT at, slot, kind, from_cents, to_cents, printed, note FROM shipped_price_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ at: number; slot: number | null; kind: PriceKind; from_cents: number | null; to_cents: number | null; printed: number; note: string | null }>();
  return results.map((row) => ({ at: row.at, slot: row.slot, kind: row.kind, from: row.from_cents, to: row.to_cents, printed: row.printed, note: row.note }));
}

export type SlotHistory = { lastOutbid: number | null; holders: number; seenAtEnd: number | null };

/** Per slot: when a holder was last taken over, how many have held it, and the impressions count when the last one ended. */
export async function slotHistory(db: D1Database): Promise<Map<number, SlotHistory>> {
  const { results } = await db
    .prepare(
      `SELECT slot, MAX(CASE WHEN status = 'outbid' THEN ended_at END) AS last_outbid, COUNT(live_at) AS holders,
       MAX(CASE WHEN status != 'live' THEN seen_at_end END) AS seen_at_end FROM shipped_bids GROUP BY slot`,
    )
    .all<{ slot: number; last_outbid: number | null; holders: number; seen_at_end: number | null }>();
  return new Map(results.map((row) => [row.slot, { lastOutbid: row.last_outbid, holders: row.holders, seenAtEnd: row.seen_at_end }]));
}
