import React from 'react';
import type { Metadata } from 'next';
import { PrintedReceiptView } from '../../../components/shipped/PrintedReceipt';
import { SHIPPED_OG_IMAGE } from '../../../lib/shipped';

export const dynamic = 'force-static';

// The shell for every /shipped/r/<id>/ page. worker/shipped.ts serves it with this receipt's title,
// description, preview image and data swapped in, so every tag below needs to exist to be rewritten.
const TITLE = 'A printed receipt | Shipped';
const DESCRIPTION = 'A GitHub profile, itemized. Printed at brytonzoz.com/shipped.';
const ALT = 'A printed receipt itemizing a GitHub profile';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/shipped/r/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/shipped/r/',
    siteName: 'Bryton Zoz',
    type: 'website',
    images: [{ url: SHIPPED_OG_IMAGE, width: 1200, height: 630, alt: ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@BrytonZoz',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: SHIPPED_OG_IMAGE, alt: ALT }],
  },
};

export default function PrintedReceiptPage() {
  return <PrintedReceiptView />;
}
