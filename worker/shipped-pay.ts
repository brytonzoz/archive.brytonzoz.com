// Payments for /shipped supporter shout-outs, behind one small interface so the provider can change
// without touching the sponsor flow (worker/shipped.ts).
//
// stripe: the site's own Stripe account and key (STRIPE_SECRET_KEY, the same one the store uses), with
//   Stripe Tax. Sessions carry metadata kind=shipped_sponsor; the store never acts on them and this
//   code ignores everything else. Payment is confirmed when the buyer lands back on /shipped (pulled
//   from Stripe, no webhook needed); the webhook (/api/shipped/webhook/stripe, signed with
//   STRIPE_SHIPPED_WEBHOOK_SECRET) adds async payments, expiries and refunds made in the dashboard.
// sandbox: staging-only stand-in that moves no money (/shipped/sandbox-pay/). Only when
//   SPONSOR_PROVIDER=sandbox is set explicitly, never in production.
import { stripe, verifySignature } from './store';

export const SPONSOR_KIND = 'shipped_sponsor';
/** Stripe Tax product code: General - Electronically Supplied Services (a printed shout-out plus a receipt image). */
export const SPONSOR_TAX_CODE = 'txcd_10000000';

export type CheckoutRequest = {
  lineId: number;
  tier: string;
  label: string;
  description: string;
  amountCents: number;
  origin: string;
  /** Unix seconds; the checkout must close before the line stops being held. */
  expiresAt: number;
};

export type SponsorEvent =
  | { type: 'paid'; checkoutId: string; orderId: string; amountCents: number; taxCents: number; totalCents: number }
  | { type: 'unpaid'; checkoutId: string }
  | { type: 'expired'; checkoutId: string }
  | { type: 'refunded'; orderId: string }
  | { type: 'refund_failed'; orderId: string; reason: string }
  | { type: 'ignored' };

export interface SponsorProvider {
  id: string;
  /** Moves real money (false: test mode or the sandbox). */
  live: boolean;
  createCheckout(request: CheckoutRequest): Promise<{ checkoutId: string; url: string }>;
  /** Verifies the webhook's signature; null when it isn't genuine (or no secret is configured). */
  parseWebhook(request: Request): Promise<SponsorEvent | null>;
  /** Asks the provider where a checkout stands (the buyer's return from checkout). */
  confirm?(checkoutId: string): Promise<SponsorEvent>;
  /** The full payment back, tax included. */
  refund(orderId: string, amountCents: number): Promise<{ ok: boolean; error?: string }>;
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
    async createCheckout({ lineId, label, amountCents, origin }) {
      const checkoutId = `sbx_${crypto.randomUUID().replace(/-/g, '')}`;
      const url = new URL('/sandbox-pay/', origin);
      url.searchParams.set('checkout', checkoutId);
      url.searchParams.set('line', String(lineId));
      url.searchParams.set('amount', String(amountCents));
      url.searchParams.set('label', label);
      url.searchParams.set('sig', await hmac(secret, `${checkoutId}.${amountCents}`));
      return { checkoutId, url: url.toString() };
    },
    async parseWebhook(request) {
      let body: { checkout?: unknown; amount?: unknown; sig?: unknown };
      try {
        body = await request.json();
      } catch {
        return null;
      }
      const checkoutId = typeof body.checkout === 'string' ? body.checkout : '';
      const amountCents = Number(body.amount);
      if (!SANDBOX_ID.test(checkoutId) || !Number.isInteger(amountCents) || typeof body.sig !== 'string') return null;
      if (!sameText(body.sig, await hmac(secret, `${checkoutId}.${amountCents}`))) return null;
      return { type: 'paid', checkoutId, orderId: `sbx_order_${checkoutId.slice(4, 16)}`, amountCents, taxCents: 0, totalCents: amountCents };
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
};
type StripeCharge = { payment_intent?: string | null; refunded?: boolean; amount_refunded?: number };
type StripeRefund = { payment_intent?: string | null; status?: string; failure_reason?: string | null };

const intentId = (value: SponsorSession['payment_intent']) => (typeof value === 'string' ? value : value?.id ?? '');

function sessionEvent(session: SponsorSession): SponsorEvent {
  if (session.metadata?.kind !== SPONSOR_KIND) return { type: 'ignored' };
  if (session.status === 'expired') return { type: 'expired', checkoutId: session.id };
  if (session.status !== 'complete' || session.payment_status !== 'paid') return { type: 'unpaid', checkoutId: session.id };
  const total = session.amount_total ?? 0;
  const tax = session.total_details?.amount_tax ?? 0;
  return {
    type: 'paid',
    checkoutId: session.id,
    orderId: intentId(session.payment_intent),
    amountCents: session.amount_subtotal ?? total - tax,
    taxCents: tax,
    totalCents: total,
  };
}

function stripeProvider(env: PayEnv, live: boolean): SponsorProvider {
  return {
    id: 'stripe',
    live,
    checkoutId: /^cs_(test|live)_[A-Za-z0-9]{10,200}$/,
    async createCheckout({ lineId, tier, label, description, amountCents, origin, expiresAt }) {
      const metadata = { kind: SPONSOR_KIND, line_id: String(lineId), tier, source: 'shipped.brytonzoz.com' };
      const session = await stripe<SponsorSession>(env, 'POST', 'checkout/sessions', {
        mode: 'payment',
        submit_type: 'pay',
        automatic_tax: { enabled: true },
        // Stripe Tax needs the buyer's location; for a digital good that's the billing address.
        billing_address_collection: 'required',
        expires_at: expiresAt,
        success_url: `${origin}/?sponsor=paid&checkout={CHECKOUT_SESSION_ID}#sponsor`,
        cancel_url: `${origin}/?sponsor=cancelled#sponsor`,
        metadata,
        payment_intent_data: { metadata, description: `shipped.brytonzoz.com: ${label}` },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amountCents,
              tax_behavior: 'exclusive',
              product_data: { name: label, description, tax_code: SPONSOR_TAX_CODE, metadata },
            },
          },
        ],
      });
      if (!session.url) throw new Error('Stripe returned no checkout URL');
      return { checkoutId: session.id, url: session.url };
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
        case 'charge.refunded': {
          const charge = event.data.object as StripeCharge;
          return charge.payment_intent ? { type: 'refunded', orderId: charge.payment_intent } : { type: 'ignored' };
        }
        case 'refund.created':
        case 'refund.updated':
        case 'refund.failed': {
          const refund = event.data.object as StripeRefund;
          if (!refund.payment_intent) return { type: 'ignored' };
          if (refund.status === 'failed' || refund.status === 'canceled') {
            return { type: 'refund_failed', orderId: refund.payment_intent, reason: `refund ${refund.status}${refund.failure_reason ? `: ${refund.failure_reason}` : ''}` };
          }
          return { type: 'refunded', orderId: refund.payment_intent };
        }
        default:
          return { type: 'ignored' };
      }
    },
    async confirm(checkoutId) {
      return sessionEvent(await stripe<SponsorSession>(env, 'GET', `checkout/sessions/${checkoutId}`));
    },
    async refund(orderId) {
      try {
        await stripe(env, 'POST', 'refunds', { payment_intent: orderId, reason: 'requested_by_customer', metadata: { kind: SPONSOR_KIND } });
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
