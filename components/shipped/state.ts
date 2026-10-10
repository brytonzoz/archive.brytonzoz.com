'use client';

import { useEffect, useRef, useState } from 'react';
import type { SponsorBlock } from '../../lib/shipped-year';
import type { EventPhase } from '../../lib/shipped-event';
import type { HumanCheckConfig } from './HumanCheck';

export type RecentReceipt = { id: number; who: string; count: number; potential: boolean; full?: boolean };

export type ShippedState = {
  event: { name: string; opensAt: number; closesAt: number; phase: EventPhase; now: number };
  payments: {
    open: boolean;
    prints: boolean;
    provider: string | null;
    live: boolean;
    wallet: boolean;
    printCents: number;
    fullCents?: number;
    bundleCents?: number;
    lockMinutes: number;
  };
  printed: number;
  shared: number;
  shipped: number;
  views: number;
  piled: number;
  recent: RecentReceipt[];
  generator: { enabled: boolean; demo: boolean; reason: string | null; turnstileSiteKey: string | null; human: HumanCheckConfig; year: number; sources: string[] };
  sponsors: SponsorBlock;
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

/** One shared fetch of /api/shipped/state for every island on the page. undefined while loading. */
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

/** One clock for the page, the sponsor rail, and the proof sheet: Worker's closesAt minus skewed now. */
export function useShippedClock(): { state: ShippedState | null | undefined; now: number | null; left: number | null; closed: boolean } {
  const state = useShippedState();
  const [now, setNow] = useState<number | null>(null);
  const skew = useRef(0);
  useEffect(() => {
    if (!state) return;
    skew.current = state.event.now - Date.now();
    setNow(Date.now() + skew.current);
    const timer = window.setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  const left = state && now !== null ? state.event.closesAt - now : null;
  const closed = Boolean(state && (state.event.phase === 'closed' || (left !== null && left <= 0)));
  return { state, now, left, closed };
}
