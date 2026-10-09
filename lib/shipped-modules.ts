// Modular receipt: twelve bands we can print, share or drop. Every band is derived from a real
// YearReceipt (sources, dates, the serial). Nothing unsourced is invented. Badges and rarity are
// honest labels (FIRST RUN, a sourced deep-cut), never fake ranks.

import { itemDate, itemsShipped, receiptNumber, type ItemSource, type YearItem, type YearReceipt } from './shipped-year';

export type Rarity = 'first-run' | 'rare' | 'uncommon' | 'common';

export type ReceiptModule = {
  id: ModuleId;
  title: string;
  lines: string[];
  rarity: Rarity;
  /** Compact chip on the badge row. */
  badge: string | null;
};

export type ModuleId =
  | 'deep-cut'
  | 'items'
  | 'first-last'
  | 'busiest-month'
  | 'platforms'
  | 'still-running'
  | 'serial'
  | 'cashier'
  | 'sources'
  | 'volume'
  | 'friend'
  | 'stamp';

/** The twelve we ship first. Catalog order; a receipt may rearrange them. */
export const MODULE_ORDER: ModuleId[] = [
  'deep-cut',
  'items',
  'first-last',
  'busiest-month',
  'platforms',
  'still-running',
  'serial',
  'cashier',
  'sources',
  'volume',
  'friend',
  'stamp',
];

const MODULE_IDS = new Set<string>(MODULE_ORDER);

/** Always on the tape. The AI may reorder them; it cannot drop them. */
export const REQUIRED_MODULES: ModuleId[] = ['items', 'serial', 'cashier', 'stamp'];

export const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && MODULE_IDS.has(value);

function rng(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Known ids only, no HTML, no dupes. Missing required bands are appended.
 * Garbage input falls back to a seeded layout so a bad model reply still prints.
 */
export function sanitizeLayout(raw: unknown, seed: number, opts?: { hasDeepCut?: boolean }): ModuleId[] {
  const seen = new Set<ModuleId>();
  const out: ModuleId[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string' || /[<>{}`\\]/.test(entry)) continue;
      const id = entry.trim().toLowerCase();
      if (!isModuleId(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  if (!out.length) return seededLayout(seed, opts);
  for (const id of REQUIRED_MODULES) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/** Deterministic pick-and-order of the twelve. Same seed, same tape. */
export function seededLayout(seed: number, opts?: { hasDeepCut?: boolean }): ModuleId[] {
  const rand = rng(seed);
  const optional = MODULE_ORDER.filter((id) => !REQUIRED_MODULES.includes(id) && (id !== 'deep-cut' || opts?.hasDeepCut !== false));
  for (let i = optional.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = optional[i];
    optional[i] = optional[j];
    optional[j] = swap;
  }
  const keep = optional.filter((id) => id === 'deep-cut');
  const droppable = optional.filter((id) => id !== 'deep-cut');
  const drop = Math.floor(rand() * 3);
  const picked = [...keep, ...droppable.slice(0, Math.max(2, droppable.length - drop))];
  const rest = picked.filter((id) => id !== 'deep-cut');
  const head: ModuleId[] = picked.includes('deep-cut') ? ['deep-cut'] : [];
  return [...head, 'items', ...rest, 'serial', 'cashier', 'stamp'];
}

/**
 * Honest 0–100 from what is actually on the tape (count, sourced links, dates, platforms, still-running).
 * Never views, bids, or made-up ranks. Potential receipts score 0.
 */
export function shipScore(receipt: Pick<YearReceipt, 'items' | 'potential'>): number {
  if (receipt.potential) return 0;
  const items = receipt.items;
  const sourced = items.filter((item) => item.source !== 'none' && item.link).length;
  const dated = items.filter((item) => item.date).length;
  const platforms = new Set(items.map((item) => item.source).filter((source) => source !== 'none')).size;
  const running = items.filter((item) => item.status === 'LIVE' || item.status === 'ACTIVE' || item.status === 'BETA').length;
  const n =
    Math.min(40, items.length * 4) +
    Math.min(25, sourced * 5) +
    Math.min(15, dated * 3) +
    Math.min(10, platforms * 3) +
    Math.min(10, running * 3);
  return Math.max(0, Math.min(100, n));
}

/** Seed / first-day receipts. Honest: the serial itself is the proof. */
export const FIRST_RUN_THROUGH = 250;

export const isFirstRun = (id: number) => Number.isInteger(id) && id > 0 && id <= FIRST_RUN_THROUGH;

const SOURCE_SURPRISE: Record<ItemSource, number> = {
  hn: 6,
  producthunt: 6,
  appstore: 5,
  npm: 4,
  site: 3,
  web: 3,
  bryton: 2,
  github: 1,
  none: 0,
};

const SOURCE_LABEL: Record<ItemSource, string> = {
  github: 'GitHub',
  appstore: 'App Store',
  hn: 'Show HN',
  npm: 'npm',
  producthunt: 'Product Hunt',
  site: 'their site',
  web: 'the web',
  bryton: 'a public page',
  none: 'a public page',
};

/** The sourced line most likely to make someone say "how did it know?" — never an unsourced item. */
export function pickDeepCut(items: YearItem[]): YearItem | null {
  const pool = items.filter((item) => item.source && item.source !== 'none' && item.link);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const surprise = (SOURCE_SURPRISE[b.source] ?? 0) - (SOURCE_SURPRISE[a.source] ?? 0);
    if (surprise) return surprise;
    return (b.description?.length ?? 0) - (a.description?.length ?? 0);
  })[0];
}

/** Items with the deep-cut first, then the rest in their original (date) order. */
export function itemsForPrint(items: YearItem[]): YearItem[] {
  const cut = pickDeepCut(items);
  if (!cut) return items;
  return [cut, ...items.filter((item) => item !== cut)];
}

function monthKey(date: string | null): string | null {
  const match = date?.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function busiestMonth(items: YearItem[]): string | null {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = monthKey(item.date);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  let best: string | null = null;
  let n = 0;
  const keys = Object.keys(counts);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const count = counts[key];
    if (count > n) {
      best = key;
      n = count;
    }
  }
  return best && n > 1 ? itemDate(`${best}-01`)?.replace(/ 1$/, '') ?? best : best ? itemDate(`${best}-01`) : null;
}

function volumeLine(count: number, potential: boolean): { line: string; rarity: Rarity; badge: string } {
  if (potential || count < 1) return { line: 'Nothing public yet. This tape itemized potential.', rarity: 'common', badge: 'POTENTIAL' };
  if (count === 1) return { line: 'One public thing. A short tape.', rarity: 'common', badge: 'ONE SHIPPED' };
  if (count < 5) return { line: `${count} public things. A short list.`, rarity: 'common', badge: `${count} SHIPPED` };
  if (count < 10) return { line: `${count} public things. A full page.`, rarity: 'uncommon', badge: `${count} SHIPPED` };
  return { line: `${count} public things. A long tape.`, rarity: 'rare', badge: `${count} SHIPPED` };
}

export type ModuleContext = {
  receipt: YearReceipt;
  /** Live printed count, for "receipt #N of M". */
  printed?: number;
};

export function catalogModules({ receipt, printed }: ModuleContext): ReceiptModule[] {
  const items = receipt.potential ? [] : receipt.items;
  const count = itemsShipped(receipt);
  const cut = pickDeepCut(items);
  const dated = items.filter((item) => item.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const platforms = items
    .map((item) => item.source)
    .filter((source, index, all) => source !== 'none' && all.indexOf(source) === index);
  const running = items.filter((item) => item.status === 'LIVE' || item.status === 'ACTIVE' || item.status === 'BETA').length;
  const firstRun = isFirstRun(receipt.id);
  const volume = volumeLine(count, receipt.potential);
  const serial = receiptNumber(receipt.id);
  const of = printed && printed >= receipt.id ? ` of ${printed.toLocaleString('en-US')}` : '';
  const score = receipt.shipScore ?? shipScore(receipt);

  const modules: ReceiptModule[] = [
    {
      id: 'deep-cut',
      title: 'HOW DID IT KNOW?',
      lines: cut
        ? [cut.name, [cut.description, itemDate(cut.date)].filter(Boolean).join('  '), `Sourced from ${SOURCE_LABEL[cut.source]}.`]
        : ['Nothing sourced beyond the list.'],
      rarity: cut && (SOURCE_SURPRISE[cut.source] ?? 0) >= 4 ? 'rare' : cut ? 'uncommon' : 'common',
      badge: cut ? 'DEEP CUT' : null,
    },
    {
      id: 'items',
      title: 'ITEMS',
      lines: items.length ? items.map((item) => `${item.name} · ${item.status}`) : ['YOUR POTENTIAL'],
      rarity: 'common',
      badge: null,
    },
    {
      id: 'first-last',
      title: 'FIRST / LAST',
      lines:
        dated.length >= 2
          ? [`First ${itemDate(dated[0].date)} · Last ${itemDate(dated[dated.length - 1].date)}`]
          : dated.length === 1
            ? [`Dated ${itemDate(dated[0].date)}`]
            : ['No public dates this year.'],
      rarity: dated.length >= 2 ? 'uncommon' : 'common',
      badge: dated.length >= 2 ? 'DATED' : null,
    },
    {
      id: 'busiest-month',
      title: 'BUSIEST MONTH',
      lines: [busiestMonth(items) ?? 'Even spread, or undated.'],
      rarity: busiestMonth(items) && items.length >= 3 ? 'uncommon' : 'common',
      badge: busiestMonth(items) && items.length >= 3 ? 'STREAK' : null,
    },
    {
      id: 'platforms',
      title: 'PLATFORMS',
      lines: [platforms.length ? platforms.map((source) => SOURCE_LABEL[source]).join(' · ') : 'Public pages only.'],
      rarity: platforms.length >= 3 ? 'uncommon' : 'common',
      badge: platforms.length >= 3 ? `${platforms.length} SOURCES` : null,
    },
    {
      id: 'still-running',
      title: 'STILL RUNNING',
      lines: [running ? `${running} still live, active or in beta.` : 'None marked live.'],
      rarity: running >= 3 ? 'uncommon' : 'common',
      badge: running ? `${running} LIVE` : null,
    },
    {
      id: 'serial',
      title: 'SERIAL',
      lines: [`#${serial}${of}`, firstRun ? 'FIRST RUN' : 'CUSTOMER COPY', `Ship score ${score}`],
      rarity: firstRun ? 'first-run' : 'common',
      badge: firstRun ? 'FIRST RUN' : `#${serial}`,
    },
    {
      id: 'cashier',
      title: "CASHIER'S NOTE",
      lines: [receipt.note],
      rarity: 'common',
      badge: null,
    },
    {
      id: 'sources',
      title: 'HOW IT KNEW',
      lines: [
        items.length
          ? `Every line links to a public source (${platforms.map((source) => SOURCE_LABEL[source]).join(', ') || 'public pages'}). Nothing unsourced printed.`
          : 'No public items. Potential only.',
      ],
      rarity: 'common',
      badge: items.length ? 'SOURCED' : null,
    },
    {
      id: 'volume',
      title: 'TAPE',
      lines: [volume.line],
      rarity: volume.rarity,
      badge: volume.badge,
    },
    {
      id: 'friend',
      title: 'PRINT A FRIEND',
      lines: ["Type someone else's @handle. Their receipt is a separate print."],
      rarity: 'common',
      badge: null,
    },
    {
      id: 'stamp',
      title: 'STAMP',
      lines: [receipt.printedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')],
      rarity: 'common',
      badge: null,
    },
  ];

  return MODULE_ORDER.map((id) => modules.find((band) => band.id === id)!);
}

/** The bands this receipt actually prints, in the stored or seeded order. */
export function receiptModules(ctx: ModuleContext): ReceiptModule[] {
  const catalog = catalogModules(ctx);
  const hasDeepCut = catalog.some((band) => band.id === 'deep-cut' && band.badge === 'DEEP CUT');
  const seed = ctx.receipt.id || 1;
  const layout = ctx.receipt.layout?.length ? sanitizeLayout(ctx.receipt.layout, seed, { hasDeepCut }) : seededLayout(seed, { hasDeepCut });
  return layout.map((id) => catalog.find((band) => band.id === id)).filter((band): band is ReceiptModule => Boolean(band));
}

export function receiptBadges(modules: ReceiptModule[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const band of modules) {
    if (band.badge && !seen.has(band.badge)) {
      seen.add(band.badge);
      out.push(band.badge);
    }
  }
  return out.slice(0, 6);
}
