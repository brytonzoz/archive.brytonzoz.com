// Hidden /shipped/ receipt: every business, app and site Bryton started, oldest first.
// Linked from X only — not nav, sitemap, llms.txt, or the artist story.
// The single source of truth is data/shipped/businesses.json (lib/shipped-data.ts loads it). This file
// only has types and helpers, so Node scripts and tests can pass the data in themselves.

export type ShippedStatus = 'LIVE' | 'ACTIVE' | 'IN PROGRESS' | 'PROTOTYPE' | 'HIATUS' | 'INACTIVE' | 'DECEASED';

export const SHIPPED_STATUSES: ShippedStatus[] = ['LIVE', 'ACTIVE', 'IN PROGRESS', 'PROTOTYPE', 'HIATUS', 'INACTIVE', 'DECEASED'];

/** Statuses that count toward STILL RUNNING. */
export const RUNNING_STATUSES: ReadonlySet<ShippedStatus> = new Set<ShippedStatus>(['LIVE', 'ACTIVE']);

/** One entry of data/shipped/businesses.json, as written. */
export type ShippedEntry = {
  name: string;
  start: number | null;
  end: number | null;
  status: string;
  description: string;
  note: string | null;
  url: string | null;
  app_store: string | null;
  stack: string | null;
  logo: string | null;
};

export type ShippedData = { meta: { updated: string }; entries: ShippedEntry[] };

/** lib/shipped-logos.json: original filename → dithered print (scripts/build-shipped-logos.mjs). */
export type ShippedLogos = Record<string, { src: string; width: number; height: number }>;

export type ShippedLink = {
  href: string;
  /** Same-origin path — use next/link so the music player keeps going. */
  internal: boolean;
};

export type ShippedItem = {
  name: string;
  status: ShippedStatus;
  /** Null when the start year isn't known; those print last, under UNDATED. */
  start: number | null;
  end: number | null;
  description: string;
  note: string | null;
  stack: string | null;
  logo: { src: string; width: number; height: number } | null;
  /** The entry's own site. Never set for DECEASED entries. */
  link: ShippedLink | null;
  appStore: string | null;
};

const SITE_HOSTS = new Set(['brytonzoz.com', 'www.brytonzoz.com']);

function toLink(url: string): ShippedLink {
  const parsed = new URL(url);
  if (SITE_HOSTS.has(parsed.hostname)) return { href: parsed.pathname || '/', internal: true };
  return { href: url, internal: false };
}

function isStatus(value: string): value is ShippedStatus {
  return (SHIPPED_STATUSES as string[]).includes(value);
}

/** Receipt lines in the data's own (timeline) order. Throws on an unknown status or a missing logo. */
export function toItems(data: ShippedData, logos: ShippedLogos): ShippedItem[] {
  return data.entries.map((entry) => {
    if (!isStatus(entry.status)) throw new Error(`shipped: ${entry.name} has unknown status ${entry.status}`);
    const logo = entry.logo ? logos[entry.logo] : null;
    if (entry.logo && !logo) throw new Error(`shipped: no print of ${entry.logo}; run npm run media`);
    const deceased = entry.status === 'DECEASED';
    return {
      name: entry.name,
      status: entry.status,
      start: entry.start,
      end: entry.end,
      description: entry.description,
      note: entry.note,
      stack: entry.stack,
      logo: logo ?? null,
      link: !deceased && entry.url ? toLink(entry.url) : null,
      appStore: !deceased ? entry.app_store : null,
    };
  });
}

export type YearGroup = { label: string; items: ShippedItem[] };

/** Consecutive runs of the same start year: 2020, 2021, … then UNDATED. */
export function yearGroups(items: ShippedItem[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const item of items) {
    const label = item.start === null ? 'UNDATED' : String(item.start);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function shippedCounts(items: ShippedItem[]) {
  const byStatus = Object.fromEntries(SHIPPED_STATUSES.map((status) => [status, 0])) as Record<ShippedStatus, number>;
  for (const item of items) byStatus[item.status] += 1;
  const years = items.map((item) => item.start).filter((year): year is number => year !== null);
  return {
    items: items.length,
    running: items.filter((item) => RUNNING_STATUSES.has(item.status)).length,
    byStatus,
    first: years.length ? Math.min(...years) : null,
    last: years.length ? Math.max(...years) : null,
  };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 2026-10-08 → 08 OCT 2026, receipt-style. */
export function receiptDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

/** Decorative bar widths (not a real barcode symbology). */
export function receiptBarcodeUnits(value: string): number[] {
  const units: number[] = [2, 1, 1, 1];
  for (const ch of value) {
    const n = ch.charCodeAt(0);
    units.push((n % 3) + 1, 1, ((n >> 2) % 2) + 1, 1, ((n >> 3) % 3) + 1, 1);
  }
  units.push(1, 1, 2);
  return units;
}

export const SHIPPED_OG_IMAGE = '/og-shipped.jpg';
export const SHIPPED_BARCODE_VALUE = 'BRYTONZOZ/SHIPPED';
