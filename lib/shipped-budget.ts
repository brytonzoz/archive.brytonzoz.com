// Shipped's AI budget: $180 per cycle (UTC, resets on the 8th of each month, from 8 Oct 2026), plus
// 80% of each settled sale this cycle (sponsor slots + mailed prints) after Stripe's US card fee,
// refunds, and an optional print/postage cost. Holds (unpaid checkouts) do not count. A sales-ledger
// read error counts as $0 of sales (the $180 base still stands). Claude errors still fail closed.

export const CYCLE_RESET_DAY = 8;
export const CYCLE_BASE_USD = 180;
export const CYCLE_SALES_SHARE = 0.8;
/** Stripe's published US card fee, same as merch: 2.9% + 30¢. */
export const stripeFeeCents = (cents: number) => Math.round(Math.max(0, cents) * 0.029) + 30;
export const BUDGET_ALERTS = [50, 80, 100] as const;
export type BudgetAlert = (typeof BUDGET_ALERTS)[number];

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

/** Cap in micros: base dollars + 80% of this cycle's settled net cents. */
export function cycleCapMicros(baseUsd: number, settledNetCents: number): number {
  const base = Math.max(0, Math.round(baseUsd * 1_000_000));
  const carry = Math.max(0, Math.floor(settledNetCents * CYCLE_SALES_SHARE)) * 10_000;
  return base + carry;
}

/** One sale's net cents after Stripe's fee and any refund. Never negative. */
export function saleNetCents(amountCents: number, refundCents = 0): number {
  return Math.max(0, Math.max(0, amountCents) - stripeFeeCents(amountCents) - Math.max(0, refundCents));
}

/**
 * Optional print/postage cost in cents. Unset / empty / invalid → null (do not invent a number).
 * When set, that many cents come off each settled $5 mailed print before the 80% carry.
 */
export function parsePrintPostageCents(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return n;
}

/** Highest 50/80/100 alert the spend has reached, or 0. */
export function budgetAlertLevel(spentMicros: number, capMicros: number): 0 | BudgetAlert {
  if (capMicros <= 0) return 100;
  const pct = (spentMicros / capMicros) * 100;
  if (pct >= 100) return 100;
  if (pct >= 80) return 80;
  if (pct >= 50) return 50;
  return 0;
}
