// Shipped's AI budget: $180 per cycle (UTC, resets on the 8th), plus 80% of the previous cycle's
// net settled sales (sponsor slots + mailed prints, after refunds). The Worker fails closed: if the
// cap cannot be computed, printing says out of paper.

export const CYCLE_RESET_DAY = 8;
export const CYCLE_BASE_USD = 180;
export const CYCLE_SALES_SHARE = 0.8;

export type CycleBounds = { start: string; end: string; startMs: number; endMs: number };

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The cycle that contains `now`: [8th 00:00 UTC, next 8th). */
export function cycleBounds(now: number, resetDay = CYCLE_RESET_DAY): CycleBounds {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startMs = date.getUTCDate() >= resetDay ? Date.UTC(year, month, resetDay) : Date.UTC(year, month - 1, resetDay);
  const start = new Date(startMs);
  const endMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, resetDay);
  return { start: utcDay(startMs), end: utcDay(endMs), startMs, endMs };
}

export const previousCycleBounds = (now: number, resetDay = CYCLE_RESET_DAY) => cycleBounds(cycleBounds(now, resetDay).startMs - 1, resetDay);

/** Spend row key for this cycle (`c:2026-10-08`), so reservations don't reset at midnight. */
export const cycleRowKey = (now: number, resetDay = CYCLE_RESET_DAY) => `c:${cycleBounds(now, resetDay).start}`;

/** Cap in micros: base dollars + 80% of last cycle's net cents. */
export function cycleCapMicros(baseUsd: number, previousNetCents: number): number {
  const base = Math.max(0, Math.round(baseUsd * 1_000_000));
  const carry = Math.max(0, Math.floor(previousNetCents * CYCLE_SALES_SHARE)) * 10_000;
  return base + carry;
}
