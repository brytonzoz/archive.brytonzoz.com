'use client';

import React, { useEffect, useState } from 'react';
import { money } from '../../lib/shipped-receipt';
import { Line, Rule, Ticket } from './paper';

type Params = { checkout: string; line: string; amount: number; label: string; sig: string };

/** Staging-only stand-in for a payment provider's checkout (worker/shipped-pay.ts). */
export function SandboxPay() {
  const [params, setParams] = useState<Params | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const checkout = q.get('checkout');
    const sig = q.get('sig');
    const amount = Number(q.get('amount'));
    setParams(checkout && sig && Number.isInteger(amount) ? { checkout, sig, amount, line: q.get('line') ?? '', label: q.get('label') ?? 'SPONSOR LINE' } : null);
  }, []);

  async function pay() {
    if (!params) return;
    setBusy(true);
    setError(null);
    const response = await fetch('/api/shipped/webhook/sandbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkout: params.checkout, amount: params.amount, sig: params.sig }),
    }).catch(() => null);
    if (response?.ok) {
      window.location.assign(`/?sponsor=paid&checkout=${encodeURIComponent(params.checkout)}#sponsor`);
      return;
    }
    setError('The sandbox didn’t accept that payment (it only runs on staging).');
    setBusy(false);
  }

  return (
    <Ticket label="Test checkout">
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">STAGING SANDBOX</p>
        <h1 className="mt-2 text-[20px] font-semibold tracking-[0.2em]">TEST CHECKOUT</h1>
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
          Stands in for the payment provider while none is connected. No card, no real money.
        </p>
      </header>
      <div className="mt-3">
        <Rule />
      </div>
      {params === null ? (
        <p className="py-6 text-center text-[12.5px]">This checkout link is incomplete.</p>
      ) : params ? (
        <>
          <div className="mt-3 space-y-1 text-[12.5px]">
            <Line label={params.label} value={money(params.amount)} />
            <Line label="LINE #" value={params.line} />
          </div>
          <div className="mt-2">
            <Rule heavy />
          </div>
          <div className="mt-2 text-[14px] font-semibold">
            <Line label="TOTAL (TEST)" value={money(params.amount)} />
          </div>
          <div className="mt-4 grid gap-2">
            <button type="button" className="shipped-button" onClick={pay} disabled={busy}>
              {busy ? 'PAYING…' : 'PAY (TEST)'}
            </button>
            <a href="/?sponsor=cancelled#sponsor" className="shipped-button is-ghost">
              CANCEL
            </a>
          </div>
          {error ? (
            <p className="mt-3 text-center text-[12px] font-semibold" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </Ticket>
  );
}
