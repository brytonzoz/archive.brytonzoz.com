import React from 'react';
import type { Metadata } from 'next';
import { PrintLab } from './PrintLab';

export const dynamic = 'force-static';

// A bench for the printer: three receipts (two fictional samples and Bryton's long one), reprint, sound,
// ?motion=reduced, and a test catcher standing in for the receipt pile. Off the books like every /shipped page.
export const metadata: Metadata = {
  title: { absolute: 'Print lab — Shipped' },
  description: 'Bench for the Shipped receipt printer: feed, tear, toss.',
};

export default function PrintLabPage() {
  return <PrintLab />;
}
