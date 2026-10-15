import React from 'react';
import type { Metadata } from 'next';
import { PileLab } from './PileLab';

export const dynamic = 'force-static';

// A bench for the receipt pile: fictional sample receipts only (every kicker says SAMPLE).
export const metadata: Metadata = {
  title: { absolute: 'Pile lab | Shipped' },
  description: 'The receipt pile on its own, with sample receipts.',
};

export default function PileLabPage() {
  return <PileLab />;
}
