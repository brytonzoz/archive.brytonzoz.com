'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ShippedStage, type Opening } from './ShippedStage';
import type { Loaded } from './visitor';

function readInjected(): Loaded | null {
  const el = document.getElementById('shipped-receipt-data');
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as Loaded;
  } catch {
    return null;
  }
}

function idFromPath(): number | null {
  const match = window.location.pathname.match(/^\/shipped\/r\/(\d{1,9})\/?$/);
  return match ? Number(match[1]) : null;
}

/** /shipped/r/<id>/: the Worker injects the receipt into the page; fetched if it isn't there. */
export function PrintedReceiptView() {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    const injected = readInjected();
    if (injected) return setLoaded(injected);
    const id = idFromPath();
    if (!id) return setLoaded(null);
    fetch(`/api/shipped/receipts/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Loaded>) : null))
      .then(setLoaded)
      .catch(() => setLoaded(null));
  }, []);

  const opening = useMemo<Opening>(() => (loaded === undefined ? { kind: 'loading' } : loaded ? { kind: 'loaded', loaded } : { kind: 'missing' }), [loaded]);

  return (
    <>
      <ShippedStage opening={opening} title="Print your Shipped receipt" />
      <p className="text-center text-[12px] text-[#f3ead8]/60">
        <Link href="/shipped/" className="underline underline-offset-4">
          See Bryton’s receipt
        </Link>
      </p>
    </>
  );
}
