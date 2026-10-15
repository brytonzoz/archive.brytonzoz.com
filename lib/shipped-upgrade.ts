// Paid FULL RECEIPT ($3) and BUNDLE ($7 = full + mailed print).
// Free tapes stay on the cheap pipeline. These prices are what Stripe Checkout charges
// (same account and hold/settle rules as the $5 print). Never invent a leftover count.

export const PRINT_PRICE_CENTS = 500;
export const FULL_PRICE_CENTS = 300;
export const BUNDLE_PRICE_CENTS = 700;

/** Per-sale xAI/web allowance for a paid full run. Not the free monthly cap. */
export const FULL_SALE_ALLOWANCE_USD = 0.3;

export const FULL_KIND = 'shipped_full';
export const BUNDLE_KIND = 'shipped_bundle';

export type SaleKind = 'print' | 'full' | 'bundle';

export const SALE_PRICE_CENTS: Record<SaleKind, number> = {
  print: PRINT_PRICE_CENTS,
  full: FULL_PRICE_CENTS,
  bundle: BUNDLE_PRICE_CENTS,
};

export const SALE_LABEL: Record<SaleKind, string> = {
  print: 'mailed thermal print',
  full: 'full receipt',
  bundle: 'full receipt + mailed print',
};

export function isSaleKind(value: unknown): value is SaleKind {
  return value === 'print' || value === 'full' || value === 'bundle';
}

export function saleNeedsShipping(kind: SaleKind): boolean {
  return kind === 'print' || kind === 'bundle';
}

export function saleIsMailed(kind: SaleKind): boolean {
  return saleNeedsShipping(kind);
}

export function saleTriggersFull(kind: SaleKind): boolean {
  return kind === 'full' || kind === 'bundle';
}

/** Real signals from the free pass. A missing leftover is 0, never a guess. */
export type UpgradeSignals = {
  full?: boolean;
  /** Candidates we actually saw and did not print. 0 when unknown. */
  leftover: number;
  leftoverKnown: boolean;
  /** Hit a real cap (posts, items, or company slice). */
  capped: boolean;
  /** Decisions confidence or harvest gaps say the tape is incomplete. */
  incomplete: boolean;
};

export type UpgradeOffer = {
  offer: boolean;
  teaser: string | null;
  reason: 'capped' | 'incomplete' | null;
};

export function upgradeOffer(signals: UpgradeSignals, fullCents = FULL_PRICE_CENTS): UpgradeOffer {
  if (signals.full) return { offer: false, teaser: null, reason: null };
  const leftover = Number.isFinite(signals.leftover) ? Math.max(0, Math.floor(signals.leftover)) : 0;
  const reason: UpgradeOffer['reason'] = signals.capped ? 'capped' : signals.incomplete ? 'incomplete' : leftover > 0 ? 'incomplete' : null;
  if (!reason) return { offer: false, teaser: null, reason: null };
  const dollars = (fullCents / 100).toFixed(0);
  const teaser =
    signals.leftoverKnown && leftover > 0
      ? `+ ${leftover} more ship${leftover === 1 ? '' : 's'} likely found · run the full receipt $${dollars}`
      : `+ more ships likely found · run the full receipt $${dollars}`;
  return { offer: true, teaser, reason };
}
