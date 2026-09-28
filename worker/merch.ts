// NonParallel merch: made-to-order tees printed and shipped by Printify.
// - Checkout sells them next to Scrapwrk pieces (worker/store.ts); prices come from
//   lib/merch-catalog.json, never from the browser.
// - Once a checkout is paid, the order goes to Printify with the buyer's address (fulfillMerch).
//   It runs when the buyer reaches the thank-you page, and a scheduled check every few minutes
//   catches anyone who closed the tab (reconcileMerch). D1 `merch_orders` makes it happen once.
// Secret: PRINTIFY_ACCESS (copied to the production Worker by the deploy workflow).
import merch from '../lib/merch-catalog.json';
import shareImages from '../lib/share-images.json';
import { isPaid, stripe, type StoreEnv, type StripeSession } from './store';

export interface MerchEnv extends StoreEnv {
  PRINTIFY_ACCESS?: string;
  /** Local testing only (.dev.vars): point at a mock of Printify's API. */
  PRINTIFY_API_BASE?: string;
}

type Variant = { productSlug: string; printifyId: string; variantId: number; name: string; color: string; size: string; price: number };

// Keys the browser sends for a tee: "np:<design>:<variantId>" (repeated for quantity). Printify's
// variant ids only name the blank's color and size, shared by every design, hence the design slug.
export const MERCH_PREFIX = 'np:';
export const VARIANTS = new Map<string, Variant>();
for (const product of merch.products as { slug: string; printifyId: string; name: string; colors: { name: string; sizes: { size: string; variantId: number; price: number }[] }[] }[]) {
  for (const color of product.colors) {
    for (const size of color.sizes) {
      VARIANTS.set(`${product.slug}:${size.variantId}`, {
        productSlug: product.slug, printifyId: product.printifyId, variantId: size.variantId, name: product.name, color: color.name, size: size.size, price: size.price,
      });
    }
  }
}
const MAX_MERCH_UNITS = 20;
const MERCH_IMAGES = (shareImages as { merch?: Record<string, string> }).merch ?? {};

// Counts tees in the cart: "design:variantId" -> quantity. Null when a key is unknown or the cart is too big.
export function parseMerch(keys: string[]): Map<string, number> | null {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const line = key.slice(MERCH_PREFIX.length);
    if (!VARIANTS.has(line)) return null;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const units = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return units <= MAX_MERCH_UNITS ? counts : null;
}

export function merchLineItems(counts: Map<string, number>, origin: string) {
  return [...counts].map(([line, quantity]) => {
    const variant = VARIANTS.get(line)!;
    const image = MERCH_IMAGES[`${variant.productSlug}/${variant.color.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`];
    return {
      quantity,
      price_data: {
        currency: merch.currency,
        unit_amount: variant.price,
        product_data: {
          name: `NonParallel Tee — ${variant.name}`,
          description: `${variant.color} · Size ${variant.size} · Printed to order`,
          images: image ? [`${origin}${image}`] : undefined,
          metadata: { tee: line },
        },
      },
    };
  });
}

// Stored on the Stripe session so fulfilment needs nothing else: "design:variantId:qty,…".
export const encodeMerch = (counts: Map<string, number>) => [...counts].map(([line, n]) => `${line}:${n}`).join(',');

export function decodeMerch(value: string | undefined | null): { variant: Variant; quantity: number }[] {
  if (!value) return [];
  return value.split(',').flatMap((part) => {
    const [design, id, n] = part.split(':');
    const variant = VARIANTS.get(`${design}:${id}`);
    const quantity = Number(n);
    return variant && quantity > 0 ? [{ variant, quantity }] : [];
  });
}

async function printify<T>(env: MerchEnv, method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${env.PRINTIFY_API_BASE ?? 'https://api.printify.com'}/v1${route}`, {
    method,
    headers: {
      authorization: `Bearer ${env.PRINTIFY_ACCESS}`,
      'user-agent': 'brytonzoz.com-site',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Printify ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') || parts[0] || '' };
}

// Sends a paid checkout's tees to Printify (once). Returns the stored status.
export async function fulfillMerch(env: MerchEnv & { DB: D1Database }, session: StripeSession): Promise<string | null> {
  const lines = decodeMerch(session.metadata?.merch);
  if (!lines.length || !isPaid(session)) return null;
  if (!env.PRINTIFY_ACCESS) return 'not-configured';

  // Claim the order; a second caller (page reload, scheduled check) sees it and stops.
  const now = Date.now();
  const claim = await env.DB.prepare(
    "INSERT INTO merch_orders (session_id, status, attempts, created_at, updated_at) VALUES (?, 'sending', 1, ?, ?) ON CONFLICT(session_id) DO UPDATE SET status = 'sending', attempts = attempts + 1, updated_at = excluded.updated_at WHERE merch_orders.status = 'failed' AND merch_orders.attempts < 5",
  ).bind(session.id, now, now).run();
  if (!claim.meta.changes) {
    const row = await env.DB.prepare('SELECT status FROM merch_orders WHERE session_id = ?').bind(session.id).first<{ status: string }>();
    return row?.status ?? null;
  }

  const shipping = session.collected_information?.shipping_details ?? session.shipping_details;
  const address = shipping?.address;
  const { first, last } = splitName(shipping?.name ?? session.customer_details?.name ?? 'Customer');
  try {
    const order = await printify<{ id: string }>(env, 'POST', `/shops/${merch.shopId}/orders.json`, {
      external_id: session.id,
      label: 'brytonzoz.com',
      line_items: lines.map(({ variant, quantity }) => ({ product_id: variant.printifyId, variant_id: variant.variantId, quantity })),
      shipping_method: 1,
      send_shipping_notification: true,
      address_to: {
        first_name: first,
        last_name: last,
        email: session.customer_details?.email ?? undefined,
        phone: session.customer_details?.phone ?? undefined,
        country: address?.country ?? 'US',
        region: address?.state ?? '',
        address1: address?.line1 ?? '',
        address2: address?.line2 ?? '',
        city: address?.city ?? '',
        zip: address?.postal_code ?? '',
      },
    });
    // Straight into production: it's already paid for.
    await printify(env, 'POST', `/shops/${merch.shopId}/orders/${order.id}/send_to_production.json`);
    await env.DB.prepare("UPDATE merch_orders SET status = 'sent', printify_order_id = ?, error = NULL, updated_at = ? WHERE session_id = ?")
      .bind(order.id, Date.now(), session.id).run();
    return 'sent';
  } catch (error) {
    console.error('printify order failed', session.id, error);
    await env.DB.prepare("UPDATE merch_orders SET status = 'failed', error = ?, updated_at = ? WHERE session_id = ?")
      .bind(String(error).slice(0, 500), Date.now(), session.id).run();
    return 'failed';
  }
}

// Scheduled: every paid checkout with tees from the last three days has a Printify order.
export async function reconcileMerch(env: MerchEnv & { DB: D1Database }): Promise<void> {
  if (!env.STRIPE_SECRET_KEY || !env.PRINTIFY_ACCESS) return;
  const since = Math.floor(Date.now() / 1000) - 3 * 86_400;
  const list = await stripe<{ data: StripeSession[] }>(env, 'GET', `checkout/sessions?limit=100&status=complete&created[gte]=${since}`);
  for (const session of list.data) {
    if (!session.metadata?.merch || !isPaid(session)) continue;
    const row = await env.DB.prepare('SELECT status, attempts FROM merch_orders WHERE session_id = ?').bind(session.id).first<{ status: string; attempts: number }>();
    if (row && (row.status === 'sent' || row.status === 'sending' || row.attempts >= 5)) continue;
    await fulfillMerch(env, session);
  }
}

// For /admin: the latest merch orders and where they stand.
export async function merchOrders(db: D1Database) {
  const { results } = await db.prepare('SELECT session_id, status, printify_order_id, error, attempts, created_at FROM merch_orders ORDER BY created_at DESC LIMIT 20').all();
  return results;
}
