// Payments for Shipped 2026 (sponsor bids and $5 mailed prints), behind one small interface so the provider
// can change without touching the flows in worker/shipped.ts.
//
// stripe: the site's own Stripe account and key (STRIPE_SECRET_KEY, the same one the store uses), with
//   Stripe Tax. Sessions carry metadata kind=shipped_sponsor or kind=shipped_print plus ref (the bid or
//   order id); the store never acts on them and this code ignores everything else. express: true makes an
//   embedded session (ui_mode elements) for the Apple Pay / Google Pay button on our own page. Payment is confirmed when the buyer lands back on /shipped (pulled
//   from Stripe, no webhook needed); the webhook (/api/shipped/webhook/stripe, signed with
//   STRIPE_SHIPPED_WEBHOOK_SECRET) adds async payments, expiries and refunds made in the dashboard.
// sandbox: staging-only stand-in that moves no money (/shipped/sandbox-pay/). Only when
//   SPONSOR_PROVIDER=sandbox is set explicitly, never in production.
import { stripe, verifySignature } from './store';

export const SPONSOR_KIND = 'shipped_sponsor';
export const PRINT_KIND = 'shipped_print';
export type PayKind = typeof SPONSOR_KIND | typeof PRINT_KIND;
/** Stripe Tax product codes: electronically supplied services (an ad slot) and printed matter (a mailed receipt). */
export const SPONSOR_TAX_CODE = 'txcd_10000000';
export const PRINT_TAX_CODE = 'txcd_99999999';

export type CheckoutRequest = {
  kind: PayKind;
  /** The bid or print order id, echoed back in metadata. */
  ref: string;
  label: string;
  description: string;
  amountCents: number;
  origin: string;
  /** Where the buyer lands afterwards; {CHECKOUT_SESSION_ID} is filled in by Stripe. */
  returnPath: string;
  cancelPath: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Embedded session for the wallet button (returns clientSecret instead of url). */
  express?: boolean;
  /** Collect a US shipping address (mailed prints). */
  shipping?: boolean;
  metadata?: Record<string, string>;
};

export type ShippingAddress = { name: string; line1: string; line2: string; city: string; state: string; postal: string; country: string };

export type SponsorEvent =
  | {
      type: 'paid';
      kind: PayKind;
      checkoutId: string;
      orderId: string;
      /** The bid or print order id we put in metadata, and the currency: both checked against our own row. */
      ref: string;
      currency: string;
      amountCents: number;
      taxCents: number;
      totalCents: number;
      email: string | null;
      shipping: ShippingAddress | null;
    }
  | { type: 'unpaid'; checkoutId: string }
  | { type: 'expired'; checkoutId: string }
  | { type: 'refunded'; orderId: string }
  | { type: 'refund_failed'; orderId: string; reason: string }
  | { type: 'ignored' };

export interface SponsorProvider {
  id: string;
  /** Moves real money (false: test mode or the sandbox). */
  live: boolean;
  createCheckout(request: CheckoutRequest): Promise<{ checkoutId: string; url: string | null; clientSecret: string | null }>;
  /** Verifies the webhook's signature; null when it isn't genuine (or no secret is configured). */
  parseWebhook(request: Request): Promise<SponsorEvent | null>;
  /** Asks the provider where a checkout stands (the buyer's return from checkout). */
  confirm?(checkoutId: string): Promise<SponsorEvent>;
  /** Money back to the way they paid: the given amount (tax-inclusive cents), or everything when omitted. `key` makes a retry a no-op. */
  refund(orderId: string, amountCents: number | undefined, key: string): Promise<{ ok: boolean; error?: string }>;
  /** Closes an unpaid checkout early (a wallet sheet the buyer walked away from). */
  expire?(checkoutId: string): Promise<void>;
  /** Shape of this provider's checkout ids, which double as the buyer's receipt token. */
  checkoutId: RegExp;
}

export interface PayEnv {
  SITE_ENV?: string;
  /** stripe | sandbox | none. Default: stripe when a usable key is set, otherwise closed. */
  SPONSOR_PROVIDER?: string;
  SPONSOR_SANDBOX_SECRET?: string;
  ADMIN_PASSWORD?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_SHIPPED_WEBHOOK_SECRET?: string;
  STRIPE_API_BASE?: string;
}

export const isProduction = (env: PayEnv) => env.SITE_ENV === 'production';

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SANDBOX_ID = /^sbx_[a-f0-9]{32}$/;

function sandboxProvider(env: PayEnv): SponsorProvider {
  const secret = env.SPONSOR_SANDBOX_SECRET || env.ADMIN_PASSWORD || 'staging-sandbox';
  return {
    id: 'sandbox',
    live: false,
    checkoutId: SANDBOX_ID,
    async createCheckout({ kind, ref, label, amountCents, origin, returnPath }) {
      const checkoutId = `sbx_${crypto.randomUUID().replace(/-/g, '')}`;
      const url = new URL('/sandbox-pay/', origin);
      url.searchParams.set('checkout', checkoutId);
      url.searchParams.set('kind', kind);
      url.searchParams.set('ref', ref);
      url.searchParams.set('amount', String(amountCents));
      url.searchParams.set('label', label);
      url.searchParams.set('back', returnPath.replace('{CHECKOUT_SESSION_ID}', checkoutId));
      url.searchParams.set('sig', await hmac(secret, `${checkoutId}.${kind}.${ref}.${amountCents}`));
      return { checkoutId, url: url.toString(), clientSecret: null };
    },
    async parseWebhook(request) {
      let body: { checkout?: unknown; kind?: unknown; ref?: unknown; amount?: unknown; sig?: unknown };
      try {
        body = await request.json();
      } catch {
        return null;
      }
      const checkoutId = typeof body.checkout === 'string' ? body.checkout : '';
      const kind = body.kind === PRINT_KIND ? PRINT_KIND : SPONSOR_KIND;
      const ref = typeof body.ref === 'string' && /^\d{1,9}$/.test(body.ref) ? body.ref : '';
      const amountCents = Number(body.amount);
      if (!SANDBOX_ID.test(checkoutId) || !ref || !Number.isInteger(amountCents) || typeof body.sig !== 'string') return null;
      if (!sameText(body.sig, await hmac(secret, `${checkoutId}.${kind}.${ref}.${amountCents}`))) return null;
      const shipping =
        kind === PRINT_KIND ? { name: 'SANDBOX BUYER', line1: '1 TEST ST', line2: '', city: 'NEW YORK', state: 'NY', postal: '10001', country: 'US' } : null;
      return { type: 'paid', kind, checkoutId, orderId: `sbx_order_${checkoutId.slice(4, 16)}`, ref, currency: 'usd', amountCents, taxCents: 0, totalCents: amountCents, email: null, shipping };
    },
    async refund() {
      return { ok: true };
    },
  };
}

type SponsorSession = {
  id: string;
  url?: string | null;
  status?: 'open' | 'complete' | 'expired';
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_subtotal?: number | null;
  amount_total?: number | null;
  total_details?: { amount_tax?: number | null } | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  currency?: string | null;
  client_secret?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  collected_information?: { shipping_details?: StripeShipping | null } | null;
  shipping_details?: StripeShipping | null;
};
type StripeShipping = {
  name?: string | null;
  address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
};
type StripeCharge = { payment_intent?: string | null; refunded?: boolean; amount_refunded?: number };
type StripeRefund = { payment_intent?: string | null; status?: string; failure_reason?: string | null };

const intentId = (value: SponsorSession['payment_intent']) => (typeof value === 'string' ? value : value?.id ?? '');

function readShipping(session: SponsorSession): ShippingAddress | null {
  const details = session.collected_information?.shipping_details ?? session.shipping_details;
  const address = details?.address;
  if (!address?.line1) return null;
  return {
    name: details?.name ?? session.customer_details?.name ?? '',
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    postal: address.postal_code ?? '',
    country: address.country ?? '',
  };
}

function sessionEvent(session: SponsorSession): SponsorEvent {
  const kind = session.metadata?.kind;
  if (kind !== SPONSOR_KIND && kind !== PRINT_KIND) return { type: 'ignored' };
  if (session.status === 'expired') return { type: 'expired', checkoutId: session.id };
  if (session.status !== 'complete' || session.payment_status !== 'paid') return { type: 'unpaid', checkoutId: session.id };
  const total = session.amount_total ?? 0;
  const tax = session.total_details?.amount_tax ?? 0;
  return {
    type: 'paid',
    kind,
    checkoutId: session.id,
    orderId: intentId(session.payment_intent),
    ref: session.metadata?.ref ?? '',
    currency: (session.currency ?? '').toLowerCase(),
    amountCents: session.amount_subtotal ?? total - tax,
    taxCents: tax,
    totalCents: total,
    email: session.customer_details?.email ?? null,
    shipping: readShipping(session),
  };
}

function stripeProvider(env: PayEnv, live: boolean): SponsorProvider {
  return {
    id: 'stripe',
    live,
    checkoutId: /^cs_(test|live)_[A-Za-z0-9]{10,200}$/,
    async createCheckout(request) {
      const { kind, ref, label, description, amountCents, origin, returnPath, cancelPath, expiresAt, express, shipping } = request;
      const metadata = { ...request.metadata, kind, ref, source: new URL(origin).host };
      const returnUrl = `${origin}${returnPath}`;
      const session = await stripe<SponsorSession>(env, 'POST', 'checkout/sessions', {
        mode: 'payment',
        ...(express ? { ui_mode: 'elements', return_url: returnUrl } : { success_url: returnUrl, cancel_url: `${origin}${cancelPath}`, submit_type: 'pay' }),
        automatic_tax: { enabled: true },
        // Stripe Tax needs the buyer's location: the shipping address for a print, the billing address otherwise.
        billing_address_collection: shipping ? 'auto' : 'required',
        ...(shipping
          ? {
              shipping_address_collection: { allowed_countries: ['US'] },
              shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: 'USPS First-Class, included', fixed_amount: { amount: 0, currency: 'usd' }, tax_behavior: 'exclusive' } }],
            }
          : {}),
        expires_at: expiresAt,
        metadata,
        payment_intent_data: { metadata, description: `${new URL(origin).host}: ${label}` },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amountCents,
              tax_behavior: 'exclusive',
              product_data: { name: label, description, tax_code: kind === PRINT_KIND ? PRINT_TAX_CODE : SPONSOR_TAX_CODE, metadata },
            },
          },
        ],
      }, `shipped-${kind}-${ref}`);
      if (express ? !session.client_secret : !session.url) throw new Error('Stripe returned no checkout');
      return { checkoutId: session.id, url: session.url ?? null, clientSecret: express ? (session.client_secret ?? null) : null };
    },
    async parseWebhook(request) {
      const secret = env.STRIPE_SHIPPED_WEBHOOK_SECRET;
      if (!secret) return null;
      const payload = await request.text();
      if (!(await verifySignature(payload, request.headers.get('stripe-signature') ?? '', secret))) return null;
      const event = JSON.parse(payload) as { type: string; data: { object: unknown } };
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired': {
          const result = sessionEvent(event.data.object as SponsorSession);
          return event.type === 'checkout.session.async_payment_failed' && result.type !== 'ignored'
            ? { type: 'expired', checkoutId: (event.data.object as SponsorSession).id }
            : result;
        }
        // Only a full refund takes a bid down: outbid sponsors get partial (prorated) refunds and keep their history.
        case 'charge.refunded': {
          const charge = event.data.object as StripeCharge;
          return charge.payment_intent && charge.refunded ? { type: 'refunded', orderId: charge.payment_intent } : { type: 'ignored' };
        }
        case 'refund.created':
        case 'refund.updated':
        case 'refund.failed': {
          const refund = event.data.object as StripeRefund;
          if (!refund.payment_intent) return { type: 'ignored' };
          if (refund.status === 'failed' || refund.status === 'canceled') {
            return { type: 'refund_failed', orderId: refund.payment_intent, reason: `refund ${refund.status}${refund.failure_reason ? `: ${refund.failure_reason}` : ''}` };
          }
          return { type: 'ignored' };
        }
        default:
          return { type: 'ignored' };
      }
    },
    async confirm(checkoutId) {
      return sessionEvent(await stripe<SponsorSession>(env, 'GET', `checkout/sessions/${checkoutId}`));
    },
    async expire(checkoutId) {
      await stripe(env, 'POST', `checkout/sessions/${checkoutId}/expire`, {}).catch(() => undefined);
    },
    async refund(orderId, amountCents, key) {
      if (amountCents !== undefined && amountCents <= 0) return { ok: true };
      try {
        await stripe(env, 'POST', 'refunds', { payment_intent: orderId, amount: amountCents, reason: 'requested_by_customer', metadata: { source: 'shipped', key } }, `shipped-refund-${key}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'refund failed' };
      }
    },
  };
}

/** The store's own key in each environment. Production must be live; staging takes whichever the store has. */
function stripeMode(env: PayEnv): 'live' | 'test' | null {
  const key = env.STRIPE_SECRET_KEY ?? '';
  const live = /^(sk|rk)_live_/.test(key);
  const test = /^(sk|rk)_test_/.test(key);
  if (isProduction(env)) return live ? 'live' : null;
  return test ? 'test' : live ? 'live' : null;
}

/** The configured provider, or null when sponsor checkout is closed. */
export function sponsorProvider(env: PayEnv): SponsorProvider | null {
  const wanted = (env.SPONSOR_PROVIDER || 'stripe').toLowerCase();
  if (wanted === 'sandbox') return isProduction(env) ? null : sandboxProvider(env);
  if (wanted !== 'stripe') return null;
  const mode = stripeMode(env);
  return mode ? stripeProvider(env, mode === 'live') : null;
}
