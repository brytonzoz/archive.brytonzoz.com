/** Ticker interpolation: ease toward a confirmed whole number in a finite time, never showing more than it. */

/** UI-length roll (Emil: keep UI under ~300ms). Long enough to read as a count-up, short enough to land. */
export const TICKER_MS = 320;

export function wholeCount(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Round toward the confirmed count, never above it. */
export function displayCount(value: number, target: number): number {
  const confirmed = wholeCount(target);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(confirmed, Math.max(0, Math.round(value)));
}

/** Strong ease-out (same curve as --ease-out). */
function easeOut(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Value at `elapsed` seconds from `from` toward the confirmed whole `target`.
 * Finite duration: at t ≥ duration it is exactly the confirmed number.
 */
export function stepCount(from: number, target: number, elapsed: number, duration = TICKER_MS / 1000): number {
  const confirmed = wholeCount(target);
  const start = Number.isFinite(from) && from > 0 ? from : 0;
  if (confirmed <= start) return confirmed;
  if (!(duration > 0) || elapsed >= duration) return confirmed;
  if (elapsed <= 0) return start;
  return start + (confirmed - start) * easeOut(elapsed / duration);
}
