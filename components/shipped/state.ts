'use client';

import { useEffect, useState } from 'react';
import type { SponsorTier, TierConfig } from '../../lib/shipped-sponsors';

export type TierOffer = TierConfig & { tier: SponsorTier; cents: number; available: boolean };

export type RecentReceipt = { id: number; who: string; count: number; potential: boolean };

export type ShippedState = {
  printed: number;
  shared: number;
  recent: RecentReceipt[];
  generator: { enabled: boolean; demo: boolean; reason: string | null; turnstileSiteKey: string | null; year: number; sources: string[] };
  sponsors: {
    open: boolean;
    reason: string | null;
    provider?: string | null;
    live?: boolean;
    taxAtCheckout?: boolean;
    presentedNextOpen?: number | null;
    tiers?: TierOffer[];
  };
};

let pending: Promise<ShippedState | null> | null = null;
const listeners = new Set<(state: ShippedState | null) => void>();

function load(): Promise<ShippedState | null> {
  pending ??= fetch('/api/shipped/state', { cache: 'no-store' })
    .then((response) => (response.ok ? (response.json() as Promise<ShippedState>) : null))
    .catch(() => null);
  return pending;
}

/** Re-read after a print or sponsor change; every island on the page updates. */
export function refreshShippedState() {
  pending = null;
  load().then((state) => listeners.forEach((listener) => listener(state)));
}

/** One shared fetch of /api/shipped/state for every island on /shipped/. undefined while loading. */
export function useShippedState(): ShippedState | null | undefined {
  const [state, setState] = useState<ShippedState | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const listener = (next: ShippedState | null) => live && setState(next);
    listeners.add(listener);
    load().then(listener);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return state;
}
