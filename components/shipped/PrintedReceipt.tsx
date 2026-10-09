'use client';

import React, { useEffect, useMemo, useState } from 'react';
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

  // After paint, and not in the same turn as hydration recovery: the Worker rewrites <title>
  // so /r/ always hits React #418/#423. Applying the receipt in that turn crashed the root (#329).
  useEffect(() => {
    let cancelled = false;
    const apply = (value: Loaded | null) => {
      if (!cancelled) setLoaded(value);
    };
    const start = () => {
      if (cancelled) return;
      const injected = readInjected();
      if (injected) {
        apply(injected);
        return;
      }
      const id = idFromPath();
      if (!id) {
        apply(null);
        return;
      }
      fetch(`/api/shipped/receipts/${id}`)
        .then((response) => (response.ok ? (response.json() as Promise<Loaded>) : null))
        .then((data) => apply(data ?? null))
        .catch(() => apply(null));
    };
    const timer = window.setTimeout(start, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const opening = useMemo<Opening>(() => (loaded === undefined ? { kind: 'loading' } : loaded ? { kind: 'loaded', loaded } : { kind: 'missing' }), [loaded]);
  const stageKey = opening.kind === 'loaded' ? `r${opening.loaded.receipt.id}` : opening.kind;

  return (
    <>
      <OrderNotice />
      <ShippedStage key={stageKey} opening={opening} title="Print your Shipped receipt" />
      <p className="pb-8 text-center text-[11px] text-[#f3ead8]/45">
        <a href="/terms/" className="underline underline-offset-4">
          Terms &amp; privacy
        </a>
      </p>
    </>
  );
}
