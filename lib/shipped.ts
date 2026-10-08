// Hidden /shipped/ receipt: businesses and software Bryton actually put in the world.
// Linked from X only — not nav, sitemap, llms.txt, or the artist story.
// Add a line by appending to SHIPPED_ITEMS; the receipt sorts itself by start year.

export type ShippedStatus = 'LIVE' | 'ACTIVE' | 'IN PROGRESS' | 'PROTOTYPE' | 'HIATUS' | 'INACTIVE' | 'RIP';

export const SHIPPED_STATUSES: ShippedStatus[] = ['LIVE', 'ACTIVE', 'IN PROGRESS', 'PROTOTYPE', 'HIATUS', 'INACTIVE', 'RIP'];

/** Statuses that count toward TOTAL LIVE. */
export const LIVE_STATUSES: ReadonlySet<ShippedStatus> = new Set<ShippedStatus>(['LIVE', 'ACTIVE']);

export type ShippedLink = {
  label: string;
  href: string;
  /** Same-origin path — use next/link so the music player keeps going. */
  internal?: boolean;
};

export type ShippedItem = {
  name: string;
  blurb: string;
  status: ShippedStatus;
  /** Year it started (App Store release, domain registration or first commit when not told otherwise). */
  start: number;
  /** Year it stopped; omit while it's still going. */
  end?: number;
  stack?: string[];
  links?: ShippedLink[];
  version?: string;
  /** App Store rating, only when looked up from Apple's API. */
  rating?: { average: string; count: number };
  /** Status still needs a nod from Bryton (not invented as live). */
  confirmStatus?: boolean;
  /** Start year is a placeholder until Bryton confirms it. */
  confirmYear?: boolean;
};

/** Day the live URLs and App Store ratings were checked. */
export const SHIPPED_CHECKED_ON = '2026-10-08';

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    name: 'Habituize',
    blurb: 'Habit tracker for people who miss days, with an AI coach called Guide.',
    status: 'LIVE',
    start: 2025,
    version: '2.0.2',
    rating: { average: '5.0', count: 5 },
    stack: ['Native SwiftUI', 'rebuilt from React Native/Expo', 'Firebase', 'RevenueCat'],
    links: [
      { label: 'App Store', href: 'https://apps.apple.com/us/app/id6755977455' },
      { label: 'habituize.app', href: 'https://habituize.app' },
    ],
  },
  {
    name: 'brytonzoz.com',
    blurb: 'Artist site: self-hosted music streaming, a Stripe/Apple Pay store with automated Printify fulfillment, and a metrics dashboard.',
    status: 'LIVE',
    start: 2025,
    stack: ['Next.js', 'Cloudflare Workers', 'R2', 'D1'],
    links: [{ label: 'brytonzoz.com', href: '/', internal: true }],
  },
  {
    name: 'Mopkin',
    blurb: 'AI Cleaning Buddy. Snap a photo of a messy space and get one small next step.',
    status: 'LIVE',
    start: 2026,
    version: '1.1.0',
    rating: { average: '5.0', count: 2 },
    stack: ['SwiftUI (iOS 26)', 'widget', 'Cloudflare Worker', 'OpenAI', 'App Attest', 'CI to TestFlight'],
    links: [
      { label: 'App Store', href: 'https://apps.apple.com/us/app/id6792544692' },
      { label: 'mopkin.app', href: 'https://mopkin.app' },
    ],
  },
  {
    name: 'PostBalloon',
    blurb: 'Managed social content service. Your content department, handled.',
    status: 'LIVE',
    start: 2026,
    stack: ['Next.js', 'Firebase App Hosting/Auth', 'Cloudflare R2', 'Stripe', 'Resend', 'PostHog'],
    links: [{ label: 'postballoon.com', href: 'https://postballoon.com' }],
  },
  {
    name: 'Pocket Factory',
    blurb: 'Custom NFC tap cards for businesses (Google reviews and the rest).',
    status: 'LIVE',
    start: 2026,
    stack: ['Shopify Online Store 2.0 theme', 'Cloudflare Workers'],
    links: [{ label: 'getpocketfactory.com', href: 'https://getpocketfactory.com' }],
  },
  {
    name: 'LiveCaps',
    blurb: 'Real-time captioning app, plus a website with auth and Stripe Pro subscriptions.',
    status: 'PROTOTYPE',
    start: 2026,
    confirmStatus: true,
    confirmYear: true,
    stack: ['captioning app', 'web auth', 'Stripe Pro'],
  },
  {
    name: 'WellnessBuddy',
    blurb: 'SwiftUI habit app with on-device CoreML personalization.',
    status: 'PROTOTYPE',
    start: 2026,
    confirmStatus: true,
    confirmYear: true,
    stack: ['SwiftUI', 'on-device CoreML'],
  },
];

/** Oldest first, like a receipt; ties keep the order they were added in. */
export function chronological(items: ShippedItem[] = SHIPPED_ITEMS): ShippedItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.start - b.item.start || a.index - b.index)
    .map(({ item }) => item);
}

/** "2025–" while running, "2019–2022" once it ended, "2024" for a one-year run. */
export function yearSpan(item: Pick<ShippedItem, 'start' | 'end'>): string {
  if (item.end === undefined) return `${item.start}–`;
  return item.end === item.start ? String(item.start) : `${item.start}–${item.end}`;
}

/** Shown in place of a price. */
export function statusLabel(status: ShippedStatus): string {
  return status === 'RIP' ? 'R.I.P.' : status;
}

export function shippedCounts(items: ShippedItem[] = SHIPPED_ITEMS) {
  const byStatus = Object.fromEntries(SHIPPED_STATUSES.map((status) => [status, 0])) as Record<ShippedStatus, number>;
  for (const item of items) byStatus[item.status] += 1;
  return {
    items: items.length,
    live: items.filter((item) => LIVE_STATUSES.has(item.status)).length,
    byStatus,
  };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 2026-10-08 → 08 OCT 2026, receipt-style. */
export function receiptDate(iso: string = SHIPPED_CHECKED_ON): string {
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
