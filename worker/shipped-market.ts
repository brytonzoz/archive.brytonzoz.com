// Shipped's public counters and the per-slot bidding clock. Everything here is a real count (rows and
// deduped events, never seeded or rounded up). Prices are pure bids (lib/shipped-sponsors.ts); there is
// no floor ladder. Takeovers are logged. A bid in the last 10 minutes of a slot extends that slot only.
import { SLOT_COUNT, extendClose } from '../lib/shipped-sponsors';

export type Counter = 'printed' | 'shared' | 'impressions' | 'views';
export type PriceKind = 'takeover';

/** Needs shipped_receipts (the seeds count it) and shipped_flags (worker/shipped-guard.ts). */
export const MARKET_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipped_price_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, slot INTEGER, kind TEXT NOT NULL,
    from_cents INTEGER, to_cents INTEGER, printed INTEGER NOT NULL, note TEXT)`,
  'CREATE TABLE IF NOT EXISTS shipped_counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)',
  // First run only: start from what's already there.
  `INSERT INTO shipped_counters (name, n) SELECT 'printed', COUNT(*) FROM shipped_receipts WHERE 1 ON CONFLICT(name) DO NOTHING`,
  `INSERT INTO shipped_counters (name, n) SELECT 'shared', COALESCE(SUM(shares), 0) FROM shipped_receipts WHERE 1 ON CONFLICT(name) DO NOTHING`,
  `INSERT INTO shipped_counters (name, n) SELECT 'views', COALESCE(SUM(views), 0) FROM shipped_receipts WHERE 1 ON CONFLICT(name) DO NOTHING`,
];

export const MARKET_COLUMNS = [
  // The impressions counter when a bid went live and when it ended: its own impressions are the difference.
  'ALTER TABLE shipped_bids ADD COLUMN seen_at_live INTEGER',
  'ALTER TABLE shipped_bids ADD COLUMN seen_at_end INTEGER',
];

const emptyCounts = (): Record<Counter, number> => ({ printed: 0, shared: 0, impressions: 0, views: 0 });

/** Next global sponsor number (SPONSOR #001…). Gaps are fine if a promote races and loses. House ads never take a number. */
export async function nextSponsorSerial(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`INSERT INTO shipped_counters (name, n) VALUES ('sponsors', 1) ON CONFLICT(name) DO UPDATE SET n = n + 1 RETURNING n`)
    .first<{ n: number }>();
  return row?.n ?? 1;
}

export async function bump(db: D1Database, name: Counter, by = 1): Promise<number> {
  const row = await db
    .prepare('INSERT INTO shipped_counters (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + excluded.n RETURNING n')
    .bind(name, by)
    .first<{ n: number }>();
  return row?.n ?? by;
}

export async function counters(db: D1Database): Promise<Record<Counter, number>> {
  const { results } = await db.prepare('SELECT name, n FROM shipped_counters').all<{ name: Counter; n: number }>();
  const out = emptyCounts();
  for (const row of results) if (row.name in out) out[row.name] = row.n;
  return out;
}

/** The impressions counter right now, as a sub-select (for stamping seen_at_live / seen_at_end in the same statement). */
export const IMPRESSIONS_NOW = `COALESCE((SELECT n FROM shipped_counters WHERE name = 'impressions'), 0)`;

const SLOT_CLOSE_KEY = (slot: number) => `slot-close:${slot}`;

/** Each slot's close: the event close, or later if this slot was anti-sniped. */
export async function slotClosesAt(db: D1Database | null, eventClosesAt: number): Promise<number[]> {
  const closes = Array.from({ length: SLOT_COUNT }, () => eventClosesAt);
  if (!db) return closes;
  try {
    const { results } = await db.prepare(`SELECT key, value FROM shipped_flags WHERE key LIKE 'slot-close:%'`).all<{ key: string; value: string }>();
    for (const row of results) {
      const slot = Number(row.key.slice('slot-close:'.length));
      const stored = Number(row.value);
      if (Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT && Number.isFinite(stored) && stored > closes[slot]) closes[slot] = stored;
    }
  } catch {
    return closes;
  }
  return closes;
}

/** Slide this slot's close forward by the anti-snipe window. Later writers cannot move it backwards. */
export async function bumpSlotClose(db: D1Database, slot: number, currentClosesAt: number, now = Date.now()): Promise<number> {
  const next = extendClose(currentClosesAt);
  await db
    .prepare(
      `INSERT INTO shipped_flags (key, value, set_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_at = excluded.set_at
       WHERE CAST(shipped_flags.value AS INTEGER) < excluded.value`,
    )
    .bind(SLOT_CLOSE_KEY(slot), String(next), now)
    .run();
  return next;
}

export type Market = { counts: Record<Counter, number> };

export async function market(db: D1Database | null): Promise<Market> {
  if (!db) return { counts: emptyCounts() };
  return { counts: await counters(db) };
}

const logStatement = (db: D1Database, entry: { at: number; slot: number | null; kind: PriceKind; from: number | null; to: number | null; printed: number; note: string | null }) =>
  db
    .prepare('INSERT INTO shipped_price_log (at, slot, kind, from_cents, to_cents, printed, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(entry.at, entry.slot, entry.kind, entry.from, entry.to, entry.printed, entry.note);

export const logTakeover = (db: D1Database, slot: number, from: number, to: number, printed: number, bidId: number, now = Date.now()) =>
  logStatement(db, { at: now, slot, kind: 'takeover', from, to, printed, note: `bid #${bidId}` }).run();

export type PriceChange = { at: number; slot: number | null; kind: PriceKind; from: number | null; to: number | null; printed: number; note: string | null };

export async function priceLog(db: D1Database, limit = 40): Promise<PriceChange[]> {
  const { results } = await db
    .prepare('SELECT at, slot, kind, from_cents, to_cents, printed, note FROM shipped_price_log WHERE kind = ? ORDER BY id DESC LIMIT ?')
    .bind('takeover', limit)
    .all<{ at: number; slot: number | null; kind: PriceKind; from_cents: number | null; to_cents: number | null; printed: number; note: string | null }>();
  return results.map((row) => ({ at: row.at, slot: row.slot, kind: row.kind, from: row.from_cents, to: row.to_cents, printed: row.printed, note: row.note }));
}

export type SlotHistory = { lastOutbid: number | null; holders: number; seenAtEnd: number | null };

/** Per slot: when a holder was last taken over, how many paid sponsors have held it, and the impressions count when the last one ended. */
export async function slotHistory(db: D1Database): Promise<Map<number, SlotHistory>> {
  const { results } = await db
    .prepare(
      `SELECT slot, MAX(CASE WHEN status = 'outbid' THEN ended_at END) AS last_outbid, COUNT(live_at) AS holders,
       MAX(CASE WHEN status != 'live' THEN seen_at_end END) AS seen_at_end FROM shipped_bids GROUP BY slot`,
    )
    .all<{ slot: number; last_outbid: number | null; holders: number; seen_at_end: number | null }>();
  return new Map(results.map((row) => [row.slot, { lastOutbid: row.last_outbid, holders: row.holders, seenAtEnd: row.seen_at_end }]));
}
