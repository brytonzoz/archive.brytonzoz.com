// Hidden /shipped/ receipt: software Bryton actually put in the world.
// Linked from X only — not nav, sitemap, llms.txt, or the artist story.

export type ShippedStatus = 'LIVE' | 'PROTOTYPE';

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
  stack: string[];
  links: ShippedLink[];
  version?: string;
  /** App Store rating, only when looked up from Apple's API. */
  rating?: { average: string; count: number };
  /** Status still needs a nod from Bryton (not invented as live). */
  confirmStatus?: boolean;
};

/** Day the live URLs and App Store ratings were checked. */
export const SHIPPED_CHECKED_ON = '2026-10-08';

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    name: 'Mopkin',
    blurb: 'AI Cleaning Buddy. Snap a photo of a messy space and get one small next step.',
    status: 'LIVE',
    version: '1.1.0',
    rating: { average: '5.0', count: 2 },
    stack: ['SwiftUI (iOS 26)', 'widget', 'Cloudflare Worker', 'OpenAI', 'App Attest', 'CI to TestFlight'],
    links: [
      { label: 'App Store', href: 'https://apps.apple.com/us/app/id6792544692' },
      { label: 'mopkin.app', href: 'https://mopkin.app' },
    ],
  },
  {
    name: 'Habituize',
    blurb: 'Habit tracker for people who miss days, with an AI coach called Guide.',
    status: 'LIVE',
    version: '2.0.2',
    rating: { average: '5.0', count: 5 },
    stack: ['Native SwiftUI', 'rebuilt from React Native/Expo', 'Firebase', 'RevenueCat'],
    links: [
      { label: 'App Store', href: 'https://apps.apple.com/us/app/id6755977455' },
      { label: 'habituize.app', href: 'https://habituize.app' },
    ],
  },
  {
    name: 'Pocket Factory',
    blurb: 'Custom NFC tap cards for businesses (Google reviews and the rest).',
    status: 'LIVE',
    stack: ['Shopify Online Store 2.0 theme', 'Cloudflare Workers'],
    links: [{ label: 'getpocketfactory.com', href: 'https://getpocketfactory.com' }],
  },
  {
    name: 'brytonzoz.com',
    blurb: 'Artist site: self-hosted music streaming, a Stripe/Apple Pay store with automated Printify fulfillment, and a metrics dashboard.',
    status: 'LIVE',
    stack: ['Next.js', 'Cloudflare Workers', 'R2', 'D1'],
    links: [{ label: 'brytonzoz.com', href: '/', internal: true }],
  },
  {
    name: 'PostBalloon',
    blurb: 'Managed social content service. Your content department, handled.',
    status: 'LIVE',
    stack: ['Next.js', 'Firebase App Hosting/Auth', 'Cloudflare R2', 'Stripe', 'Resend', 'PostHog'],
    links: [{ label: 'postballoon.com', href: 'https://postballoon.com' }],
  },
  {
    name: 'LiveCaps',
    blurb: 'Real-time captioning app, plus a website with auth and Stripe Pro subscriptions.',
    status: 'PROTOTYPE',
    confirmStatus: true,
    stack: ['captioning app', 'web auth', 'Stripe Pro'],
    links: [],
  },
  {
    name: 'WellnessBuddy',
    blurb: 'SwiftUI habit app with on-device CoreML personalization.',
    status: 'PROTOTYPE',
    confirmStatus: true,
    stack: ['SwiftUI', 'on-device CoreML'],
    links: [],
  },
];

export function shippedCounts(items: ShippedItem[] = SHIPPED_ITEMS) {
  return {
    items: items.length,
    live: items.filter((item) => item.status === 'LIVE').length,
    prototype: items.filter((item) => item.status === 'PROTOTYPE').length,
  };
}

/** 2026-10-08 → 08 OCT 2026, receipt-style. */
export function receiptDate(iso: string = SHIPPED_CHECKED_ON): string {
  const [year, month, day] = iso.split('-').map(Number);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(day).padStart(2, '0')} ${months[month - 1]} ${year}`;
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
