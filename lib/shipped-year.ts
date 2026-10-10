// "Shipped 2026": one receipt per person or brand, one line per thing they shipped this year.
// Shared by the Worker (worker/shipped.ts builds and stores receipts, worker/shipped-og.ts draws the
// share images) and the pages (components/shipped/).

/** The year on the tape. Workers evaluate Date at isolate start as 1970 — never use that. */
export const EVENT_YEAR = 2026;

/** The year being itemized: SHIPPED_YEAR (Worker) / NEXT_PUBLIC_SHIPPED_YEAR (build), else this year. */
export function shippedYear(value?: string | number | null): number {
  const year = Number(value);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  const now = new Date().getUTCFullYear();
  return now >= 2000 && now <= 2100 ? now : EVENT_YEAR;
}
export const SITE_YEAR = shippedYear(process.env.NEXT_PUBLIC_SHIPPED_YEAR);

export type ItemStatus = 'LIVE' | 'SHIPPED' | 'LAUNCHED' | 'RELEASED' | 'BETA' | 'ACTIVE' | 'PROTOTYPE' | 'IN PROGRESS' | 'HIATUS' | 'DECEASED' | 'PRE-ORDER';
export const ITEM_STATUSES: ItemStatus[] = ['LIVE', 'SHIPPED', 'LAUNCHED', 'RELEASED', 'BETA', 'ACTIVE', 'PROTOTYPE', 'IN PROGRESS', 'HIATUS', 'DECEASED', 'PRE-ORDER'];

export type ItemSource = 'github' | 'appstore' | 'hn' | 'npm' | 'producthunt' | 'site' | 'web' | 'x' | 'changelog' | 'company' | 'bryton' | 'none';

export type YearItem = {
  name: string;
  /** One line, plain text. */
  description: string;
  /** "2026-03" or "2026-03-14", or null when unknown. */
  date: string | null;
  status: ItemStatus;
  /** Only links that came from a source (never invented by the model). */
  link: string | null;
  /** Same-origin URL of a 1-bit logo, or null. */
  logo: string | null;
  source: ItemSource;
  /** "via OpenAI · Codex" when the line is a company/product ship. */
  via?: string | null;
  /** is_real_ship × in_2026 (Decisions API, or a heuristic fallback). */
  confidence?: number;
  isRealShip?: number;
  inYear?: number;
  /** Probability-weighted significance 0–4 (minor … landmark). */
  significance?: number;
};

export type SubjectKind = 'github' | 'x' | 'domain' | 'name';

export type Subject = {
  kind: SubjectKind;
  /** github login, x handle (no @), bare domain, or the name as typed. */
  id: string;
  /** What the receipt is made out to. */
  display: string;
  /** Resolved X handle (no @), when a source already knew it. Never invented. */
  x?: string | null;
};

export type YearReceipt = {
  id: number;
  version: 2;
  year: number;
  subject: Subject;
  printedAt: string;
  items: YearItem[];
  /** The cashier's one-liner at the bottom. */
  note: string;
  /** Proven count lines (e.g. "7 launches · 3 on Product Hunt"), when the tape has them. */
  stats?: string[];
  /** Nothing public was found: the receipt itemizes potential instead. */
  potential: boolean;
  /** Printed without the AI (no key): free sources only, a canned note. */
  demo: boolean;
  /** On the wall. Default true; the printer can keep it off. */
  listed: boolean;
  /** Print order of the 12 modules (ids only; content is always derived). */
  layout?: string[];
  /** 0–100 from sourced public work on this tape. Never engagement. */
  shipScore?: number;
  /** Paid deep pass already ran. */
  full?: boolean;
  /** Settled payment, reprint in flight. */
  upgrading?: boolean;
  /** First tape is incomplete; more items will arrive. */
  provisional?: boolean;
  pending?: boolean;
  /** Honest upsell from the free pass. Absent or offer:false when complete or already full. */
  upgrade?: { offer: boolean; teaser: string | null };
};

export type Candidate = Subject & { detail: string };

/** One slot of the sponsor block as printed on a receipt: the paying holder, or the house ad. */
export type SponsorSlot = {
  slot: number;
  name: string;
  cta: string;
  /** Destination of the slot's link and QR code. */
  url: string;
  /** Key of the short QR link, printed as <origin>/q/<key> (counts scans, then redirects to url). */
  qr: string;
  /** Same-origin URL of an approved 1-bit logo, or null. */
  logo: string | null;
  house: boolean;
  /** What the holder paid (0 for a house ad). House ads are not bids. */
  cents: number;
  /** Lowest legal bid to take it (holder + $1, or $1 for a house ad). */
  next: number;
  /** Highest legal bid to take it (holder + max($5, 10% of current), or $1 for a house ad). */
  maxNext: number;
  /** Times the sponsor block was on screen while this holder had it (house ad: since the slot was last held). */
  impressions: number;
  /** When the holder went live (null for a house ad). */
  since: number | null;
  /** When a holder of this slot was last taken over, or null. */
  lastOutbid: number | null;
  /** How many paid sponsors have held it (house ads never count). */
  holders: number;
  /** Global serial of this paid holder (1 = SPONSOR #001). Null for a house ad. */
  serial: number | null;
  /** When the per-slot cooldown lifts (null if the spot can be taken now). */
  cooldownUntil: number | null;
  /** When this slot stops changing hands (event close, plus any anti-snipe extensions for this slot). */
  closesAt: number;
};
/** The 10-slot block (hero first). frozen: the event is over and these holders keep their slots forever. */
export type SponsorBlock = { slots: SponsorSlot[]; frozen: boolean };

export const receiptNumber = (id: number) => String(id).padStart(6, '0');
/** Shipped lives at the root of its own host; brytonzoz.com/shipped/* redirects there (worker/index.ts). */
export const SHIPPED_HOST = 'shipped.brytonzoz.com';
export const SHIPPED_URL = `https://${SHIPPED_HOST}`;
export const RECEIPT_PATH = (id: number) => `/r/${id}/`;
export const CARD_PATH = (id: number) => `/r/${id}/og.png`;
export const QR_PATH = (key: string) => `/q/${key}`;
export const TALL_PATH = (id: number) => `/r/${id}/receipt.png`;
export const ROLLO_PATH = (id: number) => `/r/${id}/rollo.pdf`;
export const ROLLO_PNG_PATH = (id: number) => `/r/${id}/rollo.png`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-03-14" -> "MAR 14", "2026-03" -> "MAR 2026". */
export function itemDate(date: string | null): string | null {
  const match = date?.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return match[3] ? `${month} ${Number(match[3])}` : `${month} ${match[1]}`;
}

export const itemsShipped = (receipt: Pick<YearReceipt, 'items' | 'potential'>) => (receipt.potential ? 1 : receipt.items.length);

const MONTHS_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

export const SIGNIFICANCE_LABELS = ['MINOR FIX', 'FEATURE', 'NOTABLE LAUNCH', 'MAJOR PRODUCT', 'LANDMARK'] as const;

/** Group a long tape by Decisions significance (landmark first). */
export function groupItemsBySignificance<T extends { significance?: number }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const band = Math.max(0, Math.min(4, Math.round(item.significance ?? 0)));
    const list = buckets.get(band) ?? [];
    list.push(item);
    buckets.set(band, list);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => b - a)
    .map((band) => ({ key: String(band), label: SIGNIFICANCE_LABELS[band], items: buckets.get(band) ?? [] }));
}

/** Group a long tape by month (undated last). */
export function groupItemsByMonth<T extends { date: string | null }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const match = item.date?.match(/^(\d{4})-(\d{2})/);
    const key = match ? `${match[1]}-${match[2]}` : 'undated';
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b)));
  return keys.map((key) => {
    if (key === 'undated') return { key, label: 'UNDATED', items: buckets.get(key) ?? [] };
    const month = MONTHS_LONG[Number(key.slice(5, 7)) - 1] ?? key;
    return { key, label: `${month} ${key.slice(0, 4)}`, items: buckets.get(key) ?? [] };
  });
}

/** The name a receipt is made out to: the real name when a source gave one, else the @handle. */
export function subjectLabel(subject: Subject): string {
  if (subject.kind === 'x') return `@${subject.id}`;
  if (subject.kind === 'github') return subject.display && subject.display !== `@${subject.id}` ? subject.display : `@${subject.id}`;
  return subject.display;
}

/** What "Post to X" and Web Share prefill: first person, the image carries the rest. */
export function shareText(receipt: Pick<YearReceipt, 'items' | 'potential' | 'subject' | 'year' | 'id'>): string {
  if (receipt.potential) return `I shipped nothing public in ${receipt.year} — the receipt itemized my potential instead. Print yours:`;
  const n = receipt.items.length;
  return `I shipped ${n} thing${n === 1 ? '' : 's'} in ${receipt.year}. Receipt attached.`;
}

/** X handle already on the receipt (typed as X, or persisted from a source). Never guessed. */
export function xHandle(receipt: Pick<YearReceipt, 'subject'>): string | null {
  const { subject } = receipt;
  if (subject.kind === 'x' && isXHandle(subject.id)) return subject.id;
  if (subject.x && isXHandle(subject.x)) return subject.x;
  return null;
}

/** POST TO X prefills this. Tags the person when the receipt has a resolved handle. */
export function shareTweet(receipt: Pick<YearReceipt, 'items' | 'potential' | 'subject' | 'year'>): string {
  const n = itemsShipped(receipt);
  const things = receipt.potential ? 'nothing public' : `${n} thing${n === 1 ? '' : 's'}`;
  const handle = xHandle(receipt);
  const who = handle ? `@${handle}` : subjectLabel(receipt.subject);
  return `${who} shipped ${things} in ${receipt.year} 🧾`;
}

/** Browser tab / og:title for a printed receipt. Crawlers read this; the printer sets document.title after hydrate. */
export function receiptPageTitle(receipt: Pick<YearReceipt, 'items' | 'potential' | 'subject' | 'year'>): string {
  const who = subjectLabel(receipt.subject);
  const n = itemsShipped(receipt);
  return receipt.potential
    ? `${who}: shipped in ${receipt.year} (potential) | Shipped`
    : `${who} shipped ${n} thing${n === 1 ? '' : 's'} in ${receipt.year} | Shipped`;
}

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const X_HANDLE = /^[a-z0-9_]{1,15}$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

/** What a visitor typed, read as best we can: a domain, an @handle, a bare username, or a name. */
export function readQuery(raw: string): { kind: 'domain' | 'handle' | 'name'; value: string } | null {
  const text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim();
  if (text.length < 2 || text.length > 80) return null;
  const xUrl = text.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([a-z0-9_]{1,15})\/?$/i);
  if (xUrl) return { kind: 'handle', value: xUrl[1] };
  const ghUrl = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-z\d-]{1,39})\/?$/i);
  if (ghUrl && GITHUB_LOGIN.test(ghUrl[1])) return { kind: 'handle', value: ghUrl[1] };
  const bare = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/\s/.test(text) && DOMAIN.test(bare)) return { kind: 'domain', value: bare };
  const handle = text.replace(/^@/, '');
  if (!/\s/.test(handle) && (X_HANDLE.test(handle) || GITHUB_LOGIN.test(handle))) return { kind: 'handle', value: handle };
  if (/^[A-Za-z0-9\u00C0-\u024F .'&-]{2,60}$/.test(text)) return { kind: 'name', value: text.replace(/\s+/g, ' ') };
  return null;
}

export const isGithubLogin = (value: string) => GITHUB_LOGIN.test(value);
export const isXHandle = (value: string) => X_HANDLE.test(value);
export const isDomain = (value: string) => DOMAIN.test(value);

/** Cache and takedown key: the same subject maps to the same key whatever case was typed. */
export const subjectKey = (subject: Pick<Subject, 'kind' | 'id'>) => `${subject.kind}:${subject.id.toLowerCase()}`;
