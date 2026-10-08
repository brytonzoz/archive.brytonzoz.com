// Shipped 2026 is a two-week event. While it runs anyone can print, toss their receipt on the pile, order a
// mailed print or bid on a sponsor slot. When the printer shuts off, all of that closes for good: the pile
// and the sponsor block freeze as a permanent archive, and whoever holds each slot (the hero included)
// keeps it forever. The Worker is the source of truth (SHIPPED_OPENS_AT / SHIPPED_CLOSES_AT vars in
// wrangler.jsonc); these defaults only cover the first paint before /api/shipped/state answers.

export const EVENT_NAME = 'Shipped 2026';
export const EVENT_DAYS = 14;
/** Launch: Monday Oct 12 2026, noon in New York. */
export const DEFAULT_OPENS_AT = Date.UTC(2026, 9, 12, 16, 0, 0);
/** Two weeks later: Monday Oct 26 2026, noon in New York. */
export const DEFAULT_CLOSES_AT = DEFAULT_OPENS_AT + EVENT_DAYS * 86_400_000;

export type EventPhase = 'open' | 'closed';
export type EventWindow = { opensAt: number; closesAt: number; phase: EventPhase; now: number };

function readTime(value: string | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The window from the Worker's vars. Printing is open from deploy until closesAt (opensAt is the advertised launch). */
export function eventWindow(env: { SHIPPED_OPENS_AT?: string; SHIPPED_CLOSES_AT?: string }, now = Date.now()): EventWindow {
  const opensAt = readTime(env.SHIPPED_OPENS_AT, DEFAULT_OPENS_AT);
  const closesAt = readTime(env.SHIPPED_CLOSES_AT, opensAt === DEFAULT_OPENS_AT ? DEFAULT_CLOSES_AT : opensAt + EVENT_DAYS * 86_400_000);
  return { opensAt, closesAt, phase: now >= closesAt ? 'closed' : 'open', now };
}

/** "13d 4h", "4h 12m", "12m 05s": the two largest units left, never rounded up. */
export function countdown(ms: number): string {
  if (ms <= 0) return '0m 00s';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "OCT 26, 12:00 PM ET": the close time as printed on receipts and in the fine print. */
export function closingLabel(closesAt: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(new Date(closesAt));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${MONTHS[Number(get('month')) - 1]} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()} ET`;
}
