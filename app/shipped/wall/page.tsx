import React from 'react';
import type { Metadata } from 'next';
import { Ticker } from '../../../components/shipped/Ticker';
import { ReceiptWall } from '../../../components/shipped/wall';
import { SHIPPED_URL } from '../../../lib/shipped-year';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'The wall | Shipped' },
  description: 'Receipts people pinned to the wall. Print yours at shipped.brytonzoz.com.',
  alternates: { canonical: `${SHIPPED_URL}/wall/` },
};

export default function WallPage() {
  return (
    <>
      <div className="shipped-ticker-pin">
        <Ticker />
      </div>
      <ReceiptWall page />
    </>
  );
}
