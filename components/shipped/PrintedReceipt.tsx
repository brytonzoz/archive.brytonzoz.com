'use client';

import React, { useLayoutEffect, useMemo, useState } from 'react';
import { ShippedStage, type Opening } from './ShippedStage';
import { OrderNotice, type Loaded } from './visitor';

declare global {
  interface Window {
    __SHIPPED_RECEIPT__?: Loaded;
  }
}

function readInjected(): Loaded | null {
  if (typeof window !== 'undefined' && window.__SHIPPED_RECEIPT__) return window.__SHIPPED_RECEIPT__;
  const el = document.getElementById('shipped-receipt-data');
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as Loaded;
  } catch {
    return null;
  }
}

function idFromPath(): number | null {
  const match = window.location.pathname.match(/^\/(?:shipped\/)?r\/(\d{1,9})\/?$/);
  return match ? Number(match[1]) : null;
}

/** /r/<id>/: the Worker injects the receipt into the page; fetched if it isn't there. */
export function PrintedReceiptView() {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);

  // Layout effect: apply the injected receipt before paint so the first visit never hangs on LOADING.
  // Hydration still sees `undefined` (same as SSR). The Worker also assigns window.__SHIPPED_RECEIPT__
  // so a later React head reconcile can't drop the JSON.
  useLayoutEffect(() => {
    const injected = readInjected();
    if (injected) {
      setLoaded(injected);
      return;
    }
    const id = idFromPath();
    if (!id) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/shipped/receipts/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Loaded>) : null))
      .then((data) => {
        if (!cancelled) setLoaded(data);
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const opening = useMemo<Opening>(() => (loaded === undefined ? { kind: 'loading' } : loaded ? { kind: 'loaded', loaded } : { kind: 'missing' }), [loaded]);

  return (
    <>
      <OrderNotice />
      <ShippedStage opening={opening} title="Print your Shipped receipt" />
      <p className="pb-8 text-center text-[11px] text-[#f3ead8]/45">
        <a href="/terms/" className="underline underline-offset-4">
          Terms &amp; privacy
        </a>
      </p>
    </>
  );
}
