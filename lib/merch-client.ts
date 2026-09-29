'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

// The NonParallel catalog (lib/merch.ts: every product, color, size and photo) is its own download.
// The homepage fetches it in the background once the page is up, so the first screen doesn't wait
// for the shop; the /nonparallel/ pages hand it over directly (MerchProvider) so they render at once.
type MerchModule = typeof import('./merch');

let loaded: MerchModule | null = null;
let pending: Promise<MerchModule> | null = null;
const listeners = new Set<() => void>();

export function loadMerch(): Promise<MerchModule> {
  pending ??= import('./merch').then((catalog) => {
    loaded = catalog;
    listeners.forEach((listener) => listener());
    return catalog;
  });
  pending.catch(() => { pending = null; });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const MerchContext = createContext<MerchModule | null>(null);
export const MerchProvider = MerchContext.Provider;

/** The catalog, or null while it's still on its way (`load: false` waits without fetching it). */
export function useMerch(load = true): MerchModule | null {
  const provided = useContext(MerchContext);
  const catalog = useSyncExternalStore(subscribe, () => loaded, () => null);
  useEffect(() => {
    if (!provided && load) loadMerch();
  }, [provided, load]);
  return provided ?? catalog;
}
