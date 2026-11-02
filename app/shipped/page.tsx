import React from 'react';
import type { Metadata } from 'next';
import { ShippedScenes } from '../../components/shipped/ShippedScenes';

const DESCRIPTION =
  'What Bryton Zoz has built and shipped: Pocket Factory, NFC tap cards for businesses, and Mopkin, a free AI cleaning app for iPhone. Each one live, with its real numbers.';

export const metadata: Metadata = {
  title: 'Shipped',
  description: DESCRIPTION,
  alternates: { canonical: '/shipped/' },
  openGraph: {
    title: 'Shipped - Bryton Zoz',
    description: DESCRIPTION,
    url: 'https://brytonzoz.com/shipped/',
    siteName: 'Bryton Zoz',
    type: 'website',
    // A render of the first scene (re-render it when the numbers change).
    images: [{ url: '/og-shipped.jpg', width: 1200, height: 630, alt: 'Pocket Factory on Shipped: $1,987 revenue, 38 orders, 33 customers' }],
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@BrytonZoz',
    title: 'Shipped - Bryton Zoz',
    description: DESCRIPTION,
    images: ['/og-shipped.jpg'],
  },
};

// The homepage's scene format for the technical work: one product per screen, its numbers under it,
// everything added up below. Content and numbers: lib/shipped.ts.
export default function ShippedPage() {
  return (
    <>
      {/* Without JavaScript the counters can't roll and the backgrounds can't cross-fade, so the numbers
          show straight away and each scene carries its own background. */}
      <noscript>
        <style>{'.odo .odo-strip{transform:translate3d(0,calc(var(--stop) * -1em),0)!important}.shipped-nojs-bg{display:block!important}'}</style>
      </noscript>
      <ShippedScenes />
    </>
  );
}
