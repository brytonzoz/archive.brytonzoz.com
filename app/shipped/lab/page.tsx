import React from 'react';
import type { Metadata } from 'next';
import { CounterLab } from './CounterLab';

export const dynamic = 'force-static';

// The whole counter: the printer prints a receipt, you tear it off, ball it up and throw it on the pile of
// other people's receipts. Fictional sample receipts only (every kicker says SAMPLE). Off the books like every
// /shipped page; /lab/print/ and /lab/pile/ are the benches for each piece.
export const metadata: Metadata = {
  title: { absolute: 'Counter lab | Shipped' },
  description: 'The Shipped printer and the receipt pile together: print, tear, crumple, toss.',
};

export default function CounterLabPage() {
  return <CounterLab />;
}
