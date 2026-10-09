'use client';

import React, { useEffect, useState } from 'react';
import { money } from '../../lib/shipped-receipt';
import { Line, Rule, Ticket } from './paper';

type Params = { checkout: string; kind: string; ref: string; amount: number; label: string; back: string; sig: string };

/** Only same-site paths: the return link comes from the query string. */
const safeBack = (value: string | null) => (value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/');

/** Staging-only stand-in for a payment provider's checkout (worker/shipped-pay.ts). */
export function SandboxPay() {
  const [params, setParams] = useState<Params | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const checkout = q.get('checkout');
    const sig = q.get('sig');
    const ref = q.get('ref');
    const amount = Number(q.get('amount'));
    setParams(
      checkout && sig && ref && Number.isInteger(amount)
        ? { checkout, sig, ref, amount, kind: q.get('kind') ?? '', label: q.get('label') ?? 'TEST ORDER', back: safeBack(q.get('back')) }
        : null,
    );
  }, []);

  async function pay() {
    if (!params) return;
    setBusy(true);
    setError(null);
    const response = await fetch('/api/shipped/webhook/sandbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkout: params.checkout, kind: params.kind, ref: params.ref, amount: params.amount, sig: params.sig }),
    }).catch(() => null);
    if (response?.ok) {
      window.location.assign(params.back);
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
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">Stands in for Stripe on staging. No card, no real money.</p>
      </header>
      <div className="mt-3">
        <Rule />
      </div>
      {params === null ? (
        <p className="py-6 text-center text-[12.5px]">This checkout link is incomplete.</p>
      ) : params ? (
        <>
          <div className="mt-3 space-y-1 text-[12.5px]">
            <p className="font-semibold">{params.label}</p>
            <Line label="ORDER #" value={params.ref} />
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
            <a href={params.kind === 'shipped_print' ? params.back.replace(/\?.*$/, '') : '/#sponsor'} className="shipped-button is-ghost">
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
