'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { receiptPageTitle } from '../../lib/shipped-year';
import { followReceipt, isReceiptOpen } from './print-stream';
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
    const data = JSON.parse(el.textContent) as Loaded | null;
    return data && typeof data === 'object' && 'receipt' in data ? data : null;
  } catch {
    return null;
  }
}

function idFromPath(): number | null {
  const match = window.location.pathname.match(/^\/(?:shipped\/)?r\/(\d{1,9})\/?$/);
  return match ? Number(match[1]) : null;
}

function PrintedReceiptLive() {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    const injected = readInjected();
    if (injected) {
      setLoaded(injected);
      return;
    }
    let cancelled = false;
    const id = idFromPath();
    if (!id) {
      setLoaded(null);
      return;
    }
    fetch(`/api/shipped/receipts/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Loaded>) : null))
      .then((data) => {
        if (!cancelled) setLoaded(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded?.receipt) return;
    document.title = receiptPageTitle(loaded.receipt);
  }, [loaded]);

  const receiptId = loaded?.receipt.id;
  const waiting = Boolean(loaded && isReceiptOpen(loaded));
  useEffect(() => {
    if (!receiptId || !waiting) return;
    const watching = { cancelled: false };
    void followReceipt(
      receiptId,
      (next) => {
        if (!watching.cancelled) setLoaded(next);
      },
      watching,
    );
    return () => {
      watching.cancelled = true;
    };
  }, [receiptId, waiting]);

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

/** /r/<id>/: the Worker injects the receipt into the page; fetched if it isn't there.
 *  Mounted after the first paint so Worker title/meta rewrites cannot crash React hydrate (#329)
 *  when this tab already ran the printer at /. */
export function PrintedReceiptView() {
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  if (!live) return <div className="shipped-r-pending" aria-busy="true" />;
  return <PrintedReceiptLive />;
}
