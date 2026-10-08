// "Shipped in <year>": one receipt per person or brand, one line per thing they shipped this year.
// Shared by the Worker (worker/shipped.ts builds and stores receipts, worker/shipped-og.ts draws the
// share images) and the pages (components/shipped/). Bryton's own receipt on /shipped is the template.

/** The year being itemized: SHIPPED_YEAR (Worker) / NEXT_PUBLIC_SHIPPED_YEAR (build), else this year. */
export function shippedYear(value?: string | number | null): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getUTCFullYear();
}
export const SITE_YEAR = shippedYear(process.env.NEXT_PUBLIC_SHIPPED_YEAR);

export type ItemStatus = 'LIVE' | 'SHIPPED' | 'LAUNCHED' | 'RELEASED' | 'BETA' | 'ACTIVE' | 'PROTOTYPE' | 'IN PROGRESS' | 'HIATUS' | 'DECEASED' | 'PRE-ORDER';
export const ITEM_STATUSES: ItemStatus[] = ['LIVE', 'SHIPPED', 'LAUNCHED', 'RELEASED', 'BETA', 'ACTIVE', 'PROTOTYPE', 'IN PROGRESS', 'HIATUS', 'DECEASED', 'PRE-ORDER'];

export type ItemSource = 'github' | 'appstore' | 'hn' | 'npm' | 'producthunt' | 'site' | 'web' | 'bryton' | 'none';

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
};

export type SubjectKind = 'github' | 'x' | 'domain' | 'name';

export type Subject = {
  kind: SubjectKind;
  /** github login, x handle (no @), bare domain, or the name as typed. */
  id: string;
  /** What the receipt is made out to. */
  display: string;
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
  /** Nothing public was found: the receipt itemizes potential instead. */
  potential: boolean;
  /** Printed without the AI (no key): free sources only, a canned note. */
  demo: boolean;
  /** Listed in "recently printed" (the printer opted in). */
  listed: boolean;
};

export type Candidate = Subject & { detail: string };

/** An approved sponsor (or a house line) as printed in a receipt's PAID FOR BY block. */
export type PaidBy = {
  key: string;
  tier: 'name' | 'logo' | 'header' | 'house';
  text: string;
  url: string | null;
  logo: string | null;
};
export type PaidFor = { presented: PaidBy | null; lines: PaidBy[] };

export const receiptNumber = (id: number) => String(id).padStart(6, '0');
export const RECEIPT_PATH = (id: number) => `/shipped/r/${id}/`;
export const CARD_PATH = (id: number) => `/shipped/r/${id}/og.png`;
export const TALL_PATH = (id: number) => `/shipped/r/${id}/receipt.png`;

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

export function subjectLabel(subject: Subject): string {
  if (subject.kind === 'github' || subject.kind === 'x') return `@${subject.id}`;
  return subject.display;
}

/** What "Post to X" prefills. */
export function shareText(receipt: Pick<YearReceipt, 'items' | 'potential' | 'subject' | 'year'>): string {
  const who = receipt.subject.kind === 'x' ? `@${receipt.subject.id}` : receipt.subject.display;
  if (receipt.potential) return `${who}'s ${receipt.year} receipt: ITEMS SHIPPED: 1 (POTENTIAL). Print yours:`;
  const n = receipt.items.length;
  return `${who} shipped ${n} thing${n === 1 ? '' : 's'} in ${receipt.year}. Itemized receipt:`;
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
