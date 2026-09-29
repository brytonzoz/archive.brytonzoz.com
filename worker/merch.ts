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

type Variant = { productSlug: string; printifyId: string; variantId: number; name: string; title: string; color: string; size: string; price: number };

// Keys the browser sends for a tee: "np:<design>:<variantId>" (repeated for quantity). Printify's
// variant ids only name the blank's color and size, shared by every design, hence the design slug.
export const MERCH_PREFIX = 'np:';
export const VARIANTS = new Map<string, Variant>();
for (const product of merch.products as { slug: string; printifyId: string; name: string; title: string; colors: { name: string; sizes: { size: string; variantId: number; price: number }[] }[] }[]) {
  for (const color of product.colors) {
    for (const size of color.sizes) {
      VARIANTS.set(`${product.slug}:${size.variantId}`, {
        productSlug: product.slug, printifyId: product.printifyId, variantId: size.variantId, name: product.name, title: product.title, color: color.name, size: size.size, price: size.price,
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
          name: variant.title,
          description: [variant.color === 'Standard' ? '' : variant.color, variant.size === 'One size' ? '' : `Size ${variant.size}`, 'Printed to order'].filter(Boolean).join(' · '),
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

type PrintifyOrder = { id: string; status: string; external_id?: string; metadata?: { shop_order_id?: string | number } };
// Printify states once an order has been sent to print (or beyond).
const IN_PRODUCTION = new Set(['sending-to-production', 'in-production', 'partially-fulfilled', 'fulfilled', 'shipped', 'delivered']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// An order already made for this external id (a Stripe session or a manual row), so a retry never
// places a second one.
async function findOrder(env: MerchEnv, externalId: string): Promise<PrintifyOrder | undefined> {
  const list = await printify<{ data?: PrintifyOrder[] }>(env, 'GET', `/shops/${merch.shopId}/orders.json?limit=50`);
  return list.data?.find((order) => order.external_id === externalId || String(order.metadata?.shop_order_id ?? '') === externalId);
}

// A new Printify order is "pending" for a few seconds while Printify prices it, and can only be sent
// to print once it's "on-hold". Checks `tries` times, 2.5s apart; if it isn't ready yet, the
// scheduled job finishes it.
async function sendWhenReady(env: MerchEnv, orderId: string, tries = 6): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const order = await printify<PrintifyOrder>(env, 'GET', `/shops/${merch.shopId}/orders/${orderId}.json`);
    if (IN_PRODUCTION.has(order.status)) return true;
    if (order.status === 'on-hold') {
      await printify(env, 'POST', `/shops/${merch.shopId}/orders/${orderId}/send_to_production.json`);
      return true;
    }
    if (attempt < tries - 1) await sleep(2500);
  }
  return false;
}

// Sends a paid checkout's tees to Printify (once). Returns the stored status: "created" means the
// order exists and goes to print on the next scheduled run. The thank-you page doesn't wait
// (`wait: false`); the scheduled job does.
export async function fulfillMerch(env: MerchEnv & { DB: D1Database }, session: StripeSession, { wait = true } = {}): Promise<string | null> {
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
  const save = (status: string, orderId: string | null, error: string | null) =>
    env.DB.prepare('UPDATE merch_orders SET status = ?, printify_order_id = COALESCE(?, printify_order_id), error = ?, updated_at = ? WHERE session_id = ?')
      .bind(status, orderId, error, Date.now(), session.id).run();
  try {
    const order = await findOrder(env, session.id) ?? await printify<PrintifyOrder>(env, 'POST', `/shops/${merch.shopId}/orders.json`, {
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
    await save('created', order.id, null);
    // Straight into production: it's already paid for.
    const sent = await sendWhenReady(env, order.id, wait ? 6 : 1);
    if (sent) await save('sent', order.id, null);
    return sent ? 'sent' : 'created';
  } catch (error) {
    console.error('printify order failed', session.id, error);
    await save('failed', null, String(error).slice(0, 500));
    return 'failed';
  }
}

// Scheduled: every paid checkout with tees from the last three days has a Printify order, and
// every order Printify was still pricing has been sent to print.
export async function reconcileMerch(env: MerchEnv & { DB: D1Database }): Promise<void> {
  if (!env.STRIPE_SECRET_KEY || !env.PRINTIFY_ACCESS) return;
  const { results: waiting } = await env.DB.prepare("SELECT session_id, printify_order_id FROM merch_orders WHERE status = 'created' AND printify_order_id IS NOT NULL").all<{ session_id: string; printify_order_id: string }>();
  for (const row of waiting) {
    try {
      if (await sendWhenReady(env, row.printify_order_id)) {
        await env.DB.prepare("UPDATE merch_orders SET status = 'sent', error = NULL, updated_at = ? WHERE session_id = ?").bind(Date.now(), row.session_id).run();
      }
    } catch (error) {
      console.error('send to production failed', row.session_id, error);
    }
  }
  const since = Math.floor(Date.now() / 1000) - 3 * 86_400;
  const list = await stripe<{ data: StripeSession[] }>(env, 'GET', `checkout/sessions?limit=100&status=complete&created[gte]=${since}`);
  for (const session of list.data) {
    if (!session.metadata?.merch || !isPaid(session)) continue;
    const row = await env.DB.prepare('SELECT status, attempts FROM merch_orders WHERE session_id = ?').bind(session.id).first<{ status: string; attempts: number }>();
    if (row && (row.status !== 'failed' || row.attempts >= 5)) continue;
    await fulfillMerch(env, session);
  }
}

// For /admin: the latest merch orders and where they stand.
export async function merchOrders(db: D1Database) {
  const { results } = await db.prepare('SELECT session_id, status, printify_order_id, error, attempts, created_at FROM merch_orders ORDER BY created_at DESC LIMIT 20').all();
  return results;
}

type ManualOrder = {
  id: number; design: string; variant_id: number; name: string; address1: string; address2: string | null;
  city: string; region: string; zip: string; country: string; max_cents: number; status: string; printify_order_id: string | null;
};

// Scheduled: one-off orders at cost from D1 `manual_orders` (samples, added by hand). Each is quoted
// first and only ordered when tee + standard shipping is within its max_cents; one Printify is still
// pricing ("created") is sent to print on a later run.
export async function placeManualOrders(env: MerchEnv & { DB: D1Database }): Promise<void> {
  if (!env.PRINTIFY_ACCESS) return;
  const { results } = await env.DB.prepare("SELECT * FROM manual_orders WHERE status IN ('pending', 'created') ORDER BY id LIMIT 5").all<ManualOrder>();
  for (const row of results) {
    const claim = await env.DB.prepare("UPDATE manual_orders SET status = 'sending', updated_at = ? WHERE id = ? AND status = ?").bind(Date.now(), row.id, row.status).run();
    if (!claim.meta.changes) continue;
    const done = (status: string, fields: { quote?: number; order?: string; error?: string } = {}) =>
      env.DB.prepare('UPDATE manual_orders SET status = ?, quote_cents = COALESCE(?, quote_cents), printify_order_id = COALESCE(?, printify_order_id), error = ?, updated_at = ? WHERE id = ?')
        .bind(status, fields.quote ?? null, fields.order ?? null, fields.error ?? null, Date.now(), row.id).run();
    try {
      const externalId = `manual-${row.id}`;
      let orderId = row.printify_order_id ?? (await findOrder(env, externalId))?.id;
      if (!orderId) {
        const variant = VARIANTS.get(`${row.design}:${row.variant_id}`);
        if (!variant) throw new Error(`Unknown tee ${row.design}:${row.variant_id}`);
        const { first, last } = splitName(row.name);
        const address_to = {
          first_name: first, last_name: last, country: row.country || 'US', region: row.region,
          address1: row.address1, address2: row.address2 ?? '', city: row.city, zip: row.zip,
        };
        const line_items = [{ product_id: variant.printifyId, variant_id: variant.variantId, quantity: 1 }];
        const product = await printify<{ variants: { id: number; cost: number }[] }>(env, 'GET', `/shops/${merch.shopId}/products/${variant.printifyId}.json`);
        const cost = product.variants.find((entry) => entry.id === variant.variantId)?.cost ?? Infinity;
        const quote = await printify<{ standard: number }>(env, 'POST', `/shops/${merch.shopId}/orders/shipping.json`, { line_items, address_to });
        const total = cost + quote.standard;
        if (!(total <= row.max_cents)) {
          await done('over-budget', { quote: Number.isFinite(total) ? total : undefined, error: `Quote ${total} is over ${row.max_cents}` });
          continue;
        }
        const order = await printify<PrintifyOrder>(env, 'POST', `/shops/${merch.shopId}/orders.json`, {
          external_id: externalId, label: 'Sample for Bryton', line_items, shipping_method: 1, send_shipping_notification: false, address_to,
        });
        orderId = order.id;
        await done('created', { quote: total, order: orderId });
      }
      await done((await sendWhenReady(env, orderId)) ? 'sent' : 'created', { order: orderId });
    } catch (error) {
      console.error('manual order failed', row.id, error);
      await done('failed', { error: String(error).slice(0, 500) });
    }
  }
}
