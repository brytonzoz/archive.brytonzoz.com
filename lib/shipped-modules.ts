// Modular receipt: a short thermal tape. Only the bands a real receipt needs print.
// Older stored layouts and leftover AI ids are dropped, never shown.

import { receiptNumber, type ItemSource, type YearItem, type YearReceipt } from './shipped-year';

export type Rarity = 'first-run' | 'rare' | 'uncommon' | 'common';

export type ReceiptModule = {
  id: ModuleId;
  title: string;
  lines: string[];
  rarity: Rarity;
  badge: string | null;
};

export type ModuleId = 'items' | 'cashier' | 'stamp' | DroppedId;

type DroppedId =
  | 'deep-cut'
  | 'first-last'
  | 'busiest-month'
  | 'platforms'
  | 'still-running'
  | 'serial'
  | 'sources'
  | 'volume'
  | 'friend';

/** What actually prints, in order. */
export const KEEP_MODULES: Exclude<ModuleId, DroppedId>[] = ['items', 'cashier', 'stamp'];

/** Catalog ids the AI used to pick from. Kept so stored layouts sanitize cleanly. */
export const MODULE_ORDER: ModuleId[] = [
  'items',
  'cashier',
  'stamp',
  'deep-cut',
  'first-last',
  'busiest-month',
  'platforms',
  'still-running',
  'serial',
  'sources',
  'volume',
  'friend',
];

const DROPPED = new Set<ModuleId>([
  'deep-cut',
  'first-last',
  'busiest-month',
  'platforms',
  'still-running',
  'serial',
  'sources',
  'volume',
  'friend',
]);

const MODULE_IDS = new Set<string>(MODULE_ORDER);

/** Always on the tape. The AI cannot drop them, and filler ids never print. */
export const REQUIRED_MODULES: ModuleId[] = ['items', 'cashier', 'stamp'];

export const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && MODULE_IDS.has(value);

export const PRINT_LAYOUT: ModuleId[] = [...KEEP_MODULES];

/**
 * Known ids only, no HTML, no dupes. Filler bands from old layouts and model replies are dropped.
 * Missing required bands are appended. Garbage input falls back to the short tape.
 */
export function sanitizeLayout(raw: unknown, seed: number, _opts?: { hasDeepCut?: boolean }): ModuleId[] {
  const seen = new Set<ModuleId>();
  const out: ModuleId[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string' || /[<>{}`\\]/.test(entry)) continue;
      const id = entry.trim().toLowerCase();
      if (!isModuleId(id) || seen.has(id) || DROPPED.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  if (!out.length) return seededLayout(seed);
  for (const id of REQUIRED_MODULES) {
    if (!seen.has(id)) out.push(id);
  }
  return REQUIRED_MODULES.filter((id) => out.includes(id));
}

/** The short tape, always the same order. Seed kept so callers stay stable. */
export function seededLayout(_seed: number, _opts?: { hasDeepCut?: boolean }): ModuleId[] {
  return [...PRINT_LAYOUT];
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

/** Date order as gathered. Deep-cut is not hoisted; it is not a printed band. */
export function itemsForPrint(items: YearItem[]): YearItem[] {
  return items;
}

export type ModuleContext = {
  receipt: YearReceipt;
  printed?: number;
};

export function catalogModules({ receipt, printed }: ModuleContext): ReceiptModule[] {
  const items = receipt.potential ? [] : receipt.items;
  const firstRun = isFirstRun(receipt.id);
  const serial = receiptNumber(receipt.id);
  const of = printed && printed >= receipt.id ? ` of ${printed.toLocaleString('en-US')}` : '';
  const score = receipt.shipScore ?? shipScore(receipt);
  const stamp = receipt.printedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  const keep: ReceiptModule[] = [
    {
      id: 'items',
      title: 'ITEMS',
      lines: items.length ? items.map((item) => `${item.name} · ${item.status}`) : ['YOUR POTENTIAL'],
      rarity: 'common',
      badge: null,
    },
    {
      id: 'cashier',
      title: "CASHIER'S NOTE",
      lines: [receipt.note],
      rarity: 'common',
      badge: null,
    },
    {
      id: 'stamp',
      title: 'STAMP',
      lines: [`#${serial}${of}${firstRun ? ' FIRST RUN' : ''} · ${stamp}`, `SCORE ${score}`],
      rarity: firstRun ? 'first-run' : 'common',
      badge: null,
    },
  ];
  return keep;
}

/** The bands this receipt actually prints. Filler from stored layouts never comes back. */
export function receiptModules(ctx: ModuleContext): ReceiptModule[] {
  const catalog = catalogModules(ctx);
  const layout = sanitizeLayout(ctx.receipt.layout, ctx.receipt.id || 1);
  return layout.map((id) => catalog.find((band) => band.id === id)).filter((band): band is ReceiptModule => Boolean(band));
}

/** Badge chips were filler on the tape. Keep the helper so callers compile; it prints nothing. */
export function receiptBadges(_modules: ReceiptModule[]): string[] {
  return [];
}
