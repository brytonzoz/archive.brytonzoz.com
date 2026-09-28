import { useSyncExternalStore } from 'react';
import { productById, type Availability } from './store';

// Browser side of the store: which pieces are still available, the bag, and checkout.

// --- Availability (every piece is 1 of 1) ---------------------------------------------------

let availability: Record<string, Availability> = {};
let availabilityRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function refreshAvailability(): Promise<void> {
  availabilityRequest ??= fetch('/api/store', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { items?: Record<string, Availability> } | null) => {
      if (body?.items) {
        availability = body.items;
        emit();
      }
    })
    .catch(() => {})
    .finally(() => {
      availabilityRequest = null;
    });
  return availabilityRequest;
}

// --- Bag (kept on this device) --------------------------------------------------------------

const BAG_KEY = 'bz.bag';
let bag: string[] | null = null;

function readBag(): string[] {
  if (bag) return bag;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BAG_KEY) ?? '[]');
    bag = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && Boolean(productById(id))) : [];
  } catch {
    bag = [];
  }
  return bag;
}

function writeBag(next: string[]) {
  bag = next;
  try {
    window.localStorage.setItem(BAG_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the bag lasts until the page closes.
  }
  emit();
}

export const addToBag = (id: string) => {
  if (!readBag().includes(id)) writeBag([...readBag(), id]);
};
export const removeFromBag = (id: string) => writeBag(readBag().filter((entry) => entry !== id));
export const clearBag = () => writeBag([]);

const EMPTY: string[] = [];
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== BAG_KEY) return;
    bag = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const useBag = () => useSyncExternalStore(subscribe, readBag, () => EMPTY);
export const useAvailability = (id: string): Availability =>
  useSyncExternalStore(subscribe, () => availability[id] ?? 'available', () => 'available');

// --- Checkout -------------------------------------------------------------------------------

const CHECKOUT_KEY = 'bz.checkout';
export type CheckoutResult = { url: string } | { error: 'unavailable'; unavailable: string[] } | { error: string };

// Sends the buyer to Stripe Checkout. The session id is remembered so coming back without paying
// releases the hold straight away (see cancelCheckout).
export async function startCheckout(ids: string[]): Promise<CheckoutResult> {
  let previous: string | undefined;
  try {
    previous = JSON.parse(window.sessionStorage.getItem(CHECKOUT_KEY) ?? 'null')?.id;
  } catch {
    // No earlier checkout on record.
  }
  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: ids, previous }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && typeof body.url === 'string') {
      try {
        window.sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ id: body.id, items: ids }));
      } catch {
        // The hold then simply runs out on its own.
      }
      return { url: body.url };
    }
    if (Array.isArray(body.unavailable)) {
      refreshAvailability();
      return { error: 'unavailable', unavailable: body.unavailable };
    }
    return { error: typeof body.error === 'string' ? body.error : 'failed' };
  } catch {
    return { error: 'network' };
  }
}

export function hasPendingCheckout(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(CHECKOUT_KEY));
  } catch {
    return false;
  }
}

export async function cancelCheckout(): Promise<void> {
  let id: string | undefined;
  try {
    id = JSON.parse(window.sessionStorage.getItem(CHECKOUT_KEY) ?? 'null')?.id;
    window.sessionStorage.removeItem(CHECKOUT_KEY);
  } catch {
    // Nothing stored.
  }
  if (id) {
    await fetch('/api/checkout/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: id }) }).catch(() => {});
  }
  await refreshAvailability();
}

export function finishCheckout(ids: string[]): void {
  try {
    window.sessionStorage.removeItem(CHECKOUT_KEY);
  } catch {
    // Nothing stored.
  }
  writeBag(readBag().filter((id) => !ids.includes(id)));
}
