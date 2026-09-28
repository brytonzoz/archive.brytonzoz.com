// Scrapwrk checkout: Stripe Checkout sessions for one-of-a-kind pieces.
// - Prices come from lib/store-catalog.json, never from the browser.
// - Every piece is 1 of 1: starting checkout holds it for that session (until Stripe expires the
//   session), paying marks it sold, and an abandoned or cancelled checkout releases it. Holds are
//   settled against Stripe itself, so no webhook is required (one is supported if configured).
// Secrets: STRIPE_SECRET_KEY (and optionally STRIPE_WEBHOOK_SECRET), set by the deploy workflows.
import catalog from '../lib/store-catalog.json';
import shareImages from '../lib/share-images.json';
import { encodeMerch, fulfillMerch, MERCH_PREFIX, merchLineItems, merchOrders, parseMerch, type MerchEnv } from './merch';

export interface StoreEnv {
  DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Local testing only (.dev.vars): point at a mock of Stripe's API. */
  STRIPE_API_BASE?: string;
}

type Status = 'available' | 'held' | 'sold';
type Row = { product_id: string; status: Status; session_id: string | null; held_until: number | null };
export type ShippingDetails = {
  name?: string | null;
  address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
};
export type StripeSession = {
  id: string;
  url?: string | null;
  status?: 'open' | 'complete' | 'expired';
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total?: number | null;
  currency?: string | null;
  created?: number;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  shipping_details?: ShippingDetails | null;
  collected_information?: { shipping_details?: ShippingDetails | null } | null;
  metadata?: Record<string, string> | null;
};

const PRODUCTS = new Map(catalog.products.map((product) => [product.id, product]));
const SQUARE_IMAGES = shareImages.store as Record<string, { square: string }>;
// Stripe's minimum session lifetime; the hold lasts a little longer so a payment finishing at
// the last second is never released to someone else.
const SESSION_SECONDS = 30 * 60;
const HOLD_GRACE_MS = 2 * 60 * 1000;
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// Stripe's API takes form-encoded bodies with bracketed keys for nested values.
function form(data: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') form(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export async function stripe<T>(env: StoreEnv, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${env.STRIPE_API_BASE ?? 'https://api.stripe.com'}/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? form(body) : undefined,
  });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Stripe ${response.status}`);
  return data;
}

export const isPaid = (session: StripeSession) =>
  session.status === 'complete' && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');

async function ensureRows(db: D1Database) {
  await db.batch(catalog.products.map((product) =>
    db.prepare("INSERT OR IGNORE INTO store_items (product_id, status, updated_at) VALUES (?, 'available', ?)").bind(product.id, Date.now())));
}

const markSold = (db: D1Database, sessionId: string) =>
  db.prepare("UPDATE store_items SET status = 'sold', sold_at = ?, held_until = NULL, updated_at = ? WHERE session_id = ? AND status != 'sold'")
    .bind(Date.now(), Date.now(), sessionId).run();

const release = (db: D1Database, sessionId: string) =>
  db.prepare("UPDATE store_items SET status = 'available', session_id = NULL, held_until = NULL, updated_at = ? WHERE session_id = ? AND status = 'held'")
    .bind(Date.now(), sessionId).run();

// Current state of every piece. A hold whose checkout has run out is settled with Stripe:
// paid -> sold, otherwise released.
async function inventory(env: StoreEnv & { DB: D1Database }): Promise<Record<string, Status>> {
  await ensureRows(env.DB);
  const { results } = await env.DB.prepare('SELECT product_id, status, session_id, held_until FROM store_items').all<Row>();
  const now = Date.now();
  const stale = [...new Set(results.filter((row) => row.status === 'held' && (row.held_until ?? 0) < now && row.session_id).map((row) => row.session_id as string))];
  for (const sessionId of stale) {
    let paid = false;
    if (env.STRIPE_SECRET_KEY && !sessionId.startsWith('pending_')) {
      try {
        paid = isPaid(await stripe<StripeSession>(env, 'GET', `checkout/sessions/${sessionId}`));
      } catch {
        continue; // Stripe unreachable: keep the hold and try again next time.
      }
    }
    if (paid) await markSold(env.DB, sessionId);
    else await release(env.DB, sessionId);
    for (const row of results) {
      if (row.session_id === sessionId) row.status = paid ? 'sold' : 'available';
    }
  }
  const items: Record<string, Status> = {};
  for (const product of catalog.products) items[product.id] = results.find((row) => row.product_id === product.id)?.status ?? 'available';
  return items;
}

async function cancelSession(env: StoreEnv & { DB: D1Database }, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) return;
  try {
    const session = await stripe<StripeSession>(env, 'GET', `checkout/sessions/${sessionId}`);
    if (isPaid(session)) {
      await markSold(env.DB, sessionId);
      return;
    }
    if (session.status === 'open') await stripe(env, 'POST', `checkout/sessions/${sessionId}/expire`, {});
  } catch {
    // Already expired or unknown: releasing below is still right.
  }
  await release(env.DB, sessionId);
}

async function checkout(request: Request, env: StoreEnv & { DB: D1Database }): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'not-configured' }, 503);
  let body: { items?: unknown; previous?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const keys = Array.isArray(body.items) ? body.items.filter((id): id is string => typeof id === 'string') : [];
  // Scrapwrk pieces (each 1 of 1) and NonParallel tees ("np:<design>:<variantId>", repeated per unit).
  const ids = [...new Set(keys.filter((key) => !key.startsWith(MERCH_PREFIX)))];
  const merchCounts = parseMerch(keys.filter((key) => key.startsWith(MERCH_PREFIX)));
  if ((!ids.length && !merchCounts?.size) || !merchCounts || ids.length > PRODUCTS.size || ids.some((id) => !PRODUCTS.has(id))) {
    return json({ error: 'bad-request' }, 400);
  }

  // Coming back to checkout (e.g. after pressing back on Stripe's page) replaces the earlier session.
  if (typeof body.previous === 'string') await cancelSession(env, body.previous);

  const current = await inventory(env);
  const unavailable = ids.filter((id) => current[id] !== 'available');
  if (unavailable.length) return json({ error: 'unavailable', unavailable }, 409);

  // Hold first (atomically per piece), then create the session, so two people can't both pay.
  const now = Date.now();
  const expiresAt = Math.floor(now / 1000) + SESSION_SECONDS;
  const holdUntil = expiresAt * 1000 + HOLD_GRACE_MS;
  const token = `pending_${crypto.randomUUID()}`;
  const held = ids.length
    ? await env.DB.batch(ids.map((id) =>
      env.DB.prepare("UPDATE store_items SET status = 'held', session_id = ?, held_until = ?, updated_at = ? WHERE product_id = ? AND status = 'available'")
        .bind(token, holdUntil, now, id)))
    : [];
  const lost = ids.filter((_, i) => !held[i].meta.changes);
  if (lost.length) {
    await release(env.DB, token);
    return json({ error: 'unavailable', unavailable: lost }, 409);
  }

  const origin = new URL(request.url).origin;
  try {
    const session = await stripe<StripeSession>(env, 'POST', 'checkout/sessions', {
      mode: 'payment',
      success_url: `${origin}/scrapwrk/order/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${ids.length ? 'scrapwrk' : 'nonparallel'}/?checkout=cancelled`,
      expires_at: expiresAt,
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: catalog.shipping.countries },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: catalog.shipping.label,
          fixed_amount: { amount: 0, currency: catalog.currency },
        },
      }],
      submit_type: 'pay',
      metadata: { source: 'brytonzoz.com', product_ids: ids.join(','), merch: merchCounts.size ? encodeMerch(merchCounts) : undefined },
      payment_intent_data: { metadata: { product_ids: ids.join(','), merch: merchCounts.size ? encodeMerch(merchCounts) : undefined } },
      line_items: [...ids.map((id) => {
        const product = PRODUCTS.get(id)!;
        const image = SQUARE_IMAGES[product.slug]?.square;
        return {
          quantity: 1,
          price_data: {
            currency: catalog.currency,
            unit_amount: product.price,
            product_data: {
              name: `SCRAPWRK ${product.number}: ${product.name.toUpperCase()}`,
              description: `1 of 1 · ${product.material} · Size ${product.size}`,
              images: image ? [`${origin}${image}`] : undefined,
              metadata: { product_id: id },
            },
          },
        };
      }), ...merchLineItems(merchCounts, origin)],
    });
    await env.DB.prepare('UPDATE store_items SET session_id = ? WHERE session_id = ?').bind(session.id, token).run();
    return json({ url: session.url, id: session.id });
  } catch (error) {
    await release(env.DB, token);
    console.error('checkout failed', error);
    return json({ error: 'stripe-error' }, 502);
  }
}

// The order confirmation page: only what the buyer needs to see, looked up by session id.
async function order(url: URL, env: MerchEnv & { DB: D1Database }): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'not-configured' }, 503);
  const sessionId = url.searchParams.get('session_id') ?? '';
  if (!SESSION_ID.test(sessionId)) return json({ error: 'bad-request' }, 400);
  let session: StripeSession;
  try {
    session = await stripe<StripeSession>(env, 'GET', `checkout/sessions/${sessionId}`);
  } catch {
    return json({ error: 'not-found' }, 404);
  }
  const paid = isPaid(session);
  if (paid) await markSold(env.DB, sessionId);
  const merchStatus = paid ? await fulfillMerch(env, session, { wait: false }) : null;
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details;
  return json({
    paid,
    status: session.status,
    items: (session.metadata?.product_ids ?? '').split(',').filter((id) => PRODUCTS.has(id)),
    merch: session.metadata?.merch ?? null,
    merchStatus,
    amountTotal: session.amount_total ?? null,
    email: session.customer_details?.email ?? null,
    name: shipping?.name ?? session.customer_details?.name ?? null,
    city: [shipping?.address?.city, shipping?.address?.state].filter(Boolean).join(', ') || null,
  });
}

// Optional: Stripe webhook (checkout.session.completed / .expired) for instant updates.
async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`)));
  const expected = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

async function webhook(request: Request, env: MerchEnv & { DB: D1Database }): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'not-configured' }, 503);
  const payload = await request.text();
  if (!(await verifySignature(payload, request.headers.get('stripe-signature') ?? '', env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'bad-signature' }, 400);
  }
  const event = JSON.parse(payload) as { type: string; data: { object: StripeSession } };
  const session = event.data.object;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (isPaid(session)) {
      await markSold(env.DB, session.id);
      await fulfillMerch(env, session, { wait: false });
    }
  } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    await release(env.DB, session.id);
  }
  return json({ received: true });
}

// /api/admin/store (password checked by the caller): list, or mark a piece available/sold
// (e.g. after a refund, or when it sold somewhere else).
export async function adminStore(request: Request, env: MerchEnv & { DB: D1Database }): Promise<Response> {
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as { productId?: string; status?: string };
    if (!body.productId || !PRODUCTS.has(body.productId) || (body.status !== 'available' && body.status !== 'sold')) {
      return json({ error: 'bad-request' }, 400);
    }
    await ensureRows(env.DB);
    await env.DB.prepare('UPDATE store_items SET status = ?, session_id = NULL, held_until = NULL, sold_at = ?, updated_at = ? WHERE product_id = ?')
      .bind(body.status, body.status === 'sold' ? Date.now() : null, Date.now(), body.productId).run();
  }
  return json({
    items: await inventory(env),
    checkout: Boolean(env.STRIPE_SECRET_KEY),
    mode: env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : env.STRIPE_SECRET_KEY ? 'test' : null,
    merch: { printify: Boolean(env.PRINTIFY_ACCESS), orders: await merchOrders(env.DB) },
  });
}

export async function handleStore(request: Request, env: MerchEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const routes: Record<string, string> = {
    '/api/store': 'GET',
    '/api/checkout': 'POST',
    '/api/checkout/cancel': 'POST',
    '/api/order': 'GET',
    '/api/stripe/webhook': 'POST',
  };
  const method = routes[url.pathname];
  if (!method) return null;
  if (request.method !== method) return new Response('Method not allowed', { status: 405, headers: { allow: method } });
  if (!env.DB) return json({ error: 'no-database' }, 503);
  const storeEnv = env as MerchEnv & { DB: D1Database };

  switch (url.pathname) {
    case '/api/store':
      return json({ items: await inventory(storeEnv), checkout: Boolean(env.STRIPE_SECRET_KEY) });
    case '/api/checkout':
      return checkout(request, storeEnv);
    case '/api/checkout/cancel': {
      const body = await request.json().catch(() => ({})) as { session?: string };
      if (env.STRIPE_SECRET_KEY && typeof body.session === 'string') await cancelSession(storeEnv, body.session);
      return json({ items: await inventory(storeEnv) });
    }
    case '/api/order':
      return order(url, storeEnv);
    default:
      return webhook(request, storeEnv);
  }
}
