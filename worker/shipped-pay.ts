// Payments for sponsor lines, behind one small interface so the provider can change without touching
// the sponsor flow (worker/shipped.ts). Not Stripe: the Scrapwrk/NonParallel store keeps its own code.
//
// Only the sandbox provider exists so far. It is staging-only (never in production, whatever the
// config says) and moves no money: its "checkout" is /shipped/sandbox-pay/, which confirms the
// payment back here the way a provider's webhook would.

export type CheckoutRequest = {
  lineId: number;
  label: string;
  amountCents: number;
  origin: string;
};

export type PaidEvent = {
  checkoutId: string;
  orderId: string;
  amountCents: number;
};

export interface SponsorProvider {
  id: string;
  /** Moves real money (false: sandbox/test mode). */
  live: boolean;
  createCheckout(request: CheckoutRequest): Promise<{ checkoutId: string; url: string }>;
  /** Verifies the webhook's signature; null when it isn't a valid paid event. */
  parseWebhook(request: Request): Promise<PaidEvent | null>;
  refund(orderId: string, amountCents: number): Promise<{ ok: boolean; error?: string }>;
}

export interface PayEnv {
  SITE_ENV?: string;
  SPONSOR_PROVIDER?: string;
  SPONSOR_SANDBOX_SECRET?: string;
  ADMIN_PASSWORD?: string;
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

function sandboxProvider(env: PayEnv): SponsorProvider {
  const secret = env.SPONSOR_SANDBOX_SECRET || env.ADMIN_PASSWORD || 'staging-sandbox';
  return {
    id: 'sandbox',
    live: false,
    async createCheckout({ lineId, label, amountCents, origin }) {
      const checkoutId = `sbx_${crypto.randomUUID().replace(/-/g, '')}`;
      const url = new URL('/shipped/sandbox-pay/', origin);
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
      if (!/^sbx_[a-f0-9]{32}$/.test(checkoutId) || !Number.isInteger(amountCents) || typeof body.sig !== 'string') return null;
      if (!sameText(body.sig, await hmac(secret, `${checkoutId}.${amountCents}`))) return null;
      return { checkoutId, orderId: `sbx_order_${checkoutId.slice(4, 16)}`, amountCents };
    },
    async refund() {
      return { ok: true };
    },
  };
}

/** The configured provider, or null when sponsor checkout is closed. */
export function sponsorProvider(env: PayEnv): SponsorProvider | null {
  const wanted = (env.SPONSOR_PROVIDER || (isProduction(env) ? 'none' : 'sandbox')).toLowerCase();
  if (wanted === 'sandbox' && !isProduction(env)) return sandboxProvider(env);
  return null;
}
