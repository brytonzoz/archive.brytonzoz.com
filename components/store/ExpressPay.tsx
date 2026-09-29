'use client';

import React, { useEffect, useRef } from 'react';
import { track } from '../../lib/analytics';

// Apple Pay / Google Pay / Link as the buy button: Stripe's Express Checkout Element, mounted on our
// own page, so the buyer pays with a double-click of the side button and never sees a checkout form.
// It only ever shows on a device that has a wallet; `onAvailable(false)` tells the caller to keep its
// normal "Buy now" (hosted checkout). Printed-to-order pieces only, see worker/store.ts.
const STRIPE_JS = 'https://js.stripe.com/dahlia/stripe.js';

type Elements = {
  createExpressCheckoutElement: (options?: Record<string, unknown>) => {
    mount: (target: HTMLElement) => void;
    destroy: () => void;
    on: (event: string, handler: (payload: any) => void) => void;
  };
  loadActions: () => Promise<{ type: string; actions?: { confirm: (options: Record<string, unknown>) => Promise<{ type: string; error?: { message?: string } }> } }>;
};
type StripeFn = (key: string) => { initCheckoutElementsSdk: (options: Record<string, unknown>) => Elements };

let stripePromise: Promise<ReturnType<StripeFn>> | null = null;

function loadStripe(): Promise<ReturnType<StripeFn>> {
  stripePromise ??= (async () => {
    const config = await fetch('/api/checkout/config', { cache: 'no-store' }).then((response) => response.json()).catch(() => ({}));
    if (typeof config.publishableKey !== 'string') throw new Error('no-key');
    await new Promise<void>((resolve, reject) => {
      if ((window as unknown as { Stripe?: unknown }).Stripe) return resolve();
      const script = document.createElement('script');
      script.src = STRIPE_JS;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('stripe.js'));
      document.head.appendChild(script);
    });
    return (window as unknown as { Stripe: StripeFn }).Stripe(config.publishableKey);
  })();
  stripePromise.catch(() => { stripePromise = null; });
  return stripePromise;
}

// Cheap guess before any session exists: Apple Pay needs Safari with a card in Wallet, Google Pay
// needs Chrome on Android. Anything else skips the whole thing (no session, no script).
function walletLikely(): boolean {
  try {
    const apple = (window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } }).ApplePaySession;
    if (apple?.canMakePayments?.()) return true;
    return /Android/i.test(navigator.userAgent) && /Chrome\//.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export function ExpressPay({
  keys,
  height = 56,
  radius = 28,
  theme = 'black',
  onAvailable,
}: {
  /** Bag keys to pay for; null while nothing is chosen yet (no size picked). */
  keys: string[] | null;
  height?: number;
  radius?: number;
  /** Button color: black on light sheets, white on dark ones. */
  theme?: 'black' | 'white';
  onAvailable: (available: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onAvailable);
  report.current = onAvailable;
  const signature = keys ? keys.join('|') : '';

  useEffect(() => {
    const target = box.current;
    report.current(false);
    if (!keys || !target || !walletLikely()) return;
    let cancelled = false;
    let sessionId: string | null = null;
    let element: ReturnType<Elements['createExpressCheckoutElement']> | null = null;
    // Wait a beat: flicking through sizes shouldn't create a session for each.
    const timer = window.setTimeout(async () => {
      try {
        const stripe = await loadStripe();
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: keys, express: true }),
        });
        const body = await response.json();
        if (!response.ok || typeof body.clientSecret !== 'string') throw new Error(body.error ?? 'session');
        sessionId = body.id;
        if (cancelled) return;
        const checkout = stripe.initCheckoutElementsSdk({
          clientSecret: body.clientSecret,
          elementsOptions: { appearance: { variables: { borderRadius: `${radius}px` } } },
        });
        element = checkout.createExpressCheckoutElement({
          buttonHeight: height,
          buttonType: { applePay: 'buy', googlePay: 'buy' },
          buttonTheme: { applePay: theme, googlePay: theme === 'white' ? 'white' : 'black' },
          layout: { maxColumns: 1, maxRows: 1, overflow: 'never' },
        });
        element.on('availablepaymentmethodschange', ({ paymentMethods }: { paymentMethods?: Record<string, boolean> | null }) => {
          if (!cancelled) report.current(Boolean(paymentMethods && Object.values(paymentMethods).some(Boolean)));
        });
        element.on('click', () => track({ type: 'checkout', detail: `express:${keys.join(',')}`.slice(0, 200) }));
        const loaded = await checkout.loadActions();
        if (cancelled || loaded.type !== 'success' || !loaded.actions) return;
        element.on('confirm', async (event: unknown) => {
          const result = await loaded.actions!.confirm({ expressCheckoutConfirmEvent: event });
          // Only reached without a redirect when the payment failed; Stripe's sheet shows the error.
          if (result.type === 'error') console.error('express checkout', result.error?.message);
        });
        element.mount(target);
      } catch {
        if (!cancelled) report.current(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      try { element?.destroy(); } catch { /* already gone */ }
      // The unpaid session would just expire on its own; expiring it now keeps Stripe's list tidy.
      if (sessionId) {
        fetch('/api/checkout/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: sessionId }), keepalive: true }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, height, radius, theme]);

  return <div ref={box} className="express-pay" style={{ minHeight: height }} />;
}
