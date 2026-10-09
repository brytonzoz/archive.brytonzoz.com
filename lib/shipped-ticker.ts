/** Ticker interpolation: ease toward a confirmed whole number, never showing more than it. */

export function wholeCount(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** One interpolation step. Never returns more than the confirmed whole number. */
export function stepCount(current: number, target: number, dt: number): number {
  const confirmed = wholeCount(target);
  const cur = Number.isFinite(current) && current > 0 ? current : 0;
  if (confirmed <= cur) return confirmed;
  const next = cur + (confirmed - cur) * (1 - Math.exp(-Math.max(0, dt) * 6));
  return next >= confirmed - 0.02 ? confirmed : Math.min(confirmed, next);
}
