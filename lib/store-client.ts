import { useSyncExternalStore } from 'react';
import { merchVariant, MERCH_KEY_PREFIX } from './merch';
import { productById, type Availability, type Product } from './store';

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

// Starts loading a piece's first photos as soon as a finger lands on its card, so the sheet opens
// with them ready. AVIF first (what <picture> will choose), at the sheet's size.
const warmed = new Set<string>();
export function warmProduct(product: Product): void {
  if (warmed.has(product.id)) return;
  warmed.add(product.id);
  for (const image of product.images.slice(0, 2)) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.type = 'image/avif';
    link.setAttribute('imagesrcset', image.avif);
    link.setAttribute('imagesizes', '(min-width: 640px) 480px, 100vw');
    document.head.appendChild(link);
  }
}

// --- Bag (kept on this device) --------------------------------------------------------------

const BAG_KEY = 'bz.bag';
let bag: string[] | null = null;

function readBag(): string[] {
  if (bag) return bag;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BAG_KEY) ?? '[]');
    bag = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && Boolean(productById(id) || merchVariant(id))) : [];
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

// Scrapwrk pieces are 1 of 1 (in the bag once); a tee ("np:<variantId>") appears once per unit.
const MAX_TEE_UNITS = 10;
export const addToBag = (id: string) => {
  const current = readBag();
  if (id.startsWith(MERCH_KEY_PREFIX)) {
    if (current.filter((entry) => entry === id).length < MAX_TEE_UNITS) writeBag([...current, id]);
    return;
  }
  if (!current.includes(id)) writeBag([...current, id]);
};
export const removeFromBag = (id: string) => writeBag(readBag().filter((entry) => entry !== id));
export const removeOneFromBag = (id: string) => {
  const current = readBag();
  const index = current.lastIndexOf(id);
  if (index >= 0) writeBag([...current.slice(0, index), ...current.slice(index + 1)]);
};
// The bag as lines: each key once, with how many.
export function bagLines(keys: string[]): { key: string; quantity: number }[] {
  const lines: { key: string; quantity: number }[] = [];
  for (const key of keys) {
    const line = lines.find((entry) => entry.key === key);
    if (line) line.quantity += 1;
    else lines.push({ key, quantity: 1 });
  }
  return lines;
}
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
