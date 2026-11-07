import type { SlideBackground } from '../components/scenes/kit';

// /shipped: the technical projects, in page order, and the numbers under each one. Every number
// here is real and dated (`SHIPPED_AS_OF`), with where it came from in `source`; only add or change
// one from the product's own data (Shopify, App Store, analytics) or when Bryton confirms it.
// The scene art for each project is in components/shipped/ShippedScenes.tsx.

export type ShippedStatFormat = 'count' | 'usd' | 'rating';

export type ShippedStat = {
  label: string;
  value: number;
  format: ShippedStatFormat;
  // Where the number came from, for whoever updates it next (not shown on the page).
  source: string;
};

export type ShippedProject = {
  slug: string;
  name: string;
  kind: string;
  year: number;
  url: string;
  action: { label: string; href: string; icon: 'arrow' | 'apple' };
  tone: 'light' | 'dark';
  // The product's own colour, for its share of the totals.
  accent: string;
  background: SlideBackground;
  // Up to three numbers under the card.
  stats: ShippedStat[];
  // What this product adds to the totals below the scenes: revenue in USD, and the people who paid
  // for it or use it. Use numbers the card shows, so the totals add up from the page itself.
  totals: { revenue: number; people: number; source: string };
};

export const SHIPPED_AS_OF = '2026-11-07';

export const SHIPPED_PROJECTS: ShippedProject[] = [
  {
    slug: 'pocket-factory',
    name: 'Pocket Factory',
    kind: 'NFC tap cards',
    year: 2026,
    url: 'https://getpocketfactory.com',
    action: { label: 'Visit site', href: 'https://getpocketfactory.com', icon: 'arrow' },
    // Its own paper, ink and lime (getpocketfactory.com: --paper #f5f2eb, --ink #15170f, --acid #d6f753).
    tone: 'dark',
    accent: '#D6F753',
    background: {
      base: 'linear-gradient(160deg, #F8F6F0 0%, #EFEEE3 40%, #DFE7AE 76%, #CCDC74 100%)',
      overlay: 'radial-gradient(circle at 50% 100%, rgba(214, 247, 83, 0.55), transparent 46%), radial-gradient(circle at 12% 8%, rgba(255, 255, 255, 0.95), transparent 34%)',
      topGlow: 'rgba(255, 255, 255, 0.55)',
      bottomGlow: 'rgba(214, 247, 83, 0.42)',
      edgeGlow: 'rgba(21, 23, 15, 0.06)',
    },
    stats: [
      {
        label: 'Revenue',
        value: 2724.15,
        format: 'usd',
        source: 'Shopify net sales (after discounts, before shipping and tax), all orders Sep 15 - Nov 7, 2026: FROM sales SHOW net_sales',
      },
      {
        label: 'Orders',
        value: 48,
        format: 'count',
        source: 'Shopify ordersCount status:any (0 test, 0 cancelled, 0 refunded), Nov 7, 2026',
      },
      {
        label: 'Customers',
        value: 39,
        format: 'count',
        source: 'Shopify distinct customers with an order: FROM sales SHOW customers, all time to Nov 7, 2026',
      },
    ],
    totals: { revenue: 2724.15, people: 39, source: 'The Revenue and Customers numbers above' },
  },
  {
    slug: 'mopkin',
    name: 'Mopkin',
    kind: 'iPhone app',
    year: 2026,
    url: 'https://mopkin.app',
    action: { label: 'App Store', href: 'https://apps.apple.com/us/app/mopkin-ai-cleaning-buddy/id6792544692', icon: 'apple' },
    // Its App Store washes: deep indigo into violet, warming to apricot (mopkin.app --violet #6e5eec).
    tone: 'light',
    accent: '#7B6BF2',
    background: {
      base: 'linear-gradient(165deg, #1F1A5C 0%, #3B2DB0 38%, #4F3FD2 66%, #6A4CC6 86%, #E58C74 116%)',
      overlay: 'radial-gradient(circle at 18% 14%, rgba(165, 138, 247, 0.32), transparent 30%), radial-gradient(circle at 84% 98%, rgba(253, 185, 122, 0.42), transparent 28%)',
      topGlow: 'rgba(140, 118, 255, 0.28)',
      bottomGlow: 'rgba(253, 131, 119, 0.13)',
      edgeGlow: 'rgba(255, 255, 255, 0.05)',
    },
    stats: [
      {
        label: 'Monthly users',
        value: 272,
        format: 'count',
        source: 'PostHog project "Mopkin": distinct people with any in-app event ($lib posthog-ios) in the 30 days to Nov 7, 2026 00:25 UTC, iOS Simulator runs ($is_emulator) and the test cohort excluded (136 in the last 7 days)',
      },
      {
        label: 'Tasks done',
        value: 2277,
        format: 'count',
        source: 'PostHog project "Mopkin": "task completed" events from real devices (posthog-ios, iOS Simulator excluded), all time to Nov 7, 2026 00:25 UTC',
      },
      {
        label: 'Rating',
        value: 5,
        format: 'rating',
        source: 'App Store: 5.0 from 11 ratings, all five stars (iTunes lookup id 6792544692, US, Nov 7, 2026)',
      },
    ],
    // Free, no in-app purchases (App Store, Nov 7, 2026).
    // The totals add up what the cards show, so Mopkin counts its monthly users.
    totals: { revenue: 0, people: 272, source: 'The Monthly users number above' },
  },
];

export function formatStat(stat: Pick<ShippedStat, 'value' | 'format'>): string {
  if (stat.format === 'usd') return `$${Math.round(stat.value).toLocaleString('en-US')}`;
  if (stat.format === 'rating') return stat.value.toFixed(1);
  return Math.round(stat.value).toLocaleString('en-US');
}

export function shippedTotal(key: 'revenue' | 'people'): number {
  return SHIPPED_PROJECTS.reduce((sum, project) => sum + project.totals[key], 0);
}

export function formatAsOf(date: string, month: 'long' | 'short' = 'long'): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
