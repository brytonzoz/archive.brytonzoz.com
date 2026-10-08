'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Machine, printDuration } from './Machine';
import { Ticket } from './paper';
import { PrintYours } from './PrintYours';
import { ShareBar, VisitorReceipt, type Loaded } from './visitor';

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
  const [torn, setTorn] = useState(false);

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

  if (loaded === undefined) return <Machine mode="feed" label="Loading receipt" />;
  if (!loaded) {
    return (
      <>
        <Ticket label="Receipt not found">
          <div className="py-10 text-center">
            <h1 className="text-[18px] font-semibold tracking-[0.2em]">NO SUCH RECEIPT</h1>
            <p className="mt-2 text-[12px] text-[#1c1917]/70">It may have been taken down.</p>
          </div>
        </Ticket>
        <PrintYours />
      </>
    );
  }
  return (
    <>
      <Machine mode="print" label="Shipped receipt" duration={printDuration(loaded.receipt.items.length)} onTorn={() => setTorn(true)}>
        <VisitorReceipt {...loaded} heading="h1" />
      </Machine>
      <div className={`shipped-after ${torn ? 'is-ready' : ''}`}>
        <ShareBar receipt={loaded.receipt} />
      </div>
      <PrintYours ready={torn} />
      <p className="text-center text-[12px] text-[#f3ead8]/70">
        <Link href="/shipped/" className="underline">
          See Bryton’s receipt
        </Link>
      </p>
    </>
  );
}
