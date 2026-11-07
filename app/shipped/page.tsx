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
    images: [{ url: '/og-shipped.jpg', width: 1200, height: 630, alt: 'Pocket Factory on Shipped: $2,724 revenue, 48 orders, 39 customers' }],
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
      {/* Without JavaScript nothing moves with the scroll, so the numbers show straight away, each scene
          and the totals carry their own background, every card sits at rest, and the dots go. */}
      <noscript>
        <style>{'.odo .odo-strip{transform:translate3d(0,calc(var(--stop) * -1em),0)!important}.shipped-nojs-bg{display:block!important}.scene-card{opacity:1!important;transform:none!important}#totals{background:#0a0a0b!important}.scene-dots{display:none!important}'}</style>
      </noscript>
      <ShippedScenes />
    </>
  );
}
