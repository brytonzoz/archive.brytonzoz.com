import React from 'react';
import type { Metadata } from 'next';
import { PrintedReceiptView } from '../../../components/shipped/PrintedReceipt';
import { SHIPPED_OG_IMAGE } from '../../../lib/shipped';
import { SHIPPED_URL } from '../../../lib/shipped-year';

export const dynamic = 'force-static';

// The shell for every /r/<id>/ page. worker/shipped.ts serves it with this receipt's title,
// description, preview image and data swapped in, so every tag below needs to exist to be rewritten.
const TITLE = 'A printed receipt | Shipped';
const DESCRIPTION = 'Everything they shipped this year, itemized. Printed at shipped.brytonzoz.com.';
const ALT = 'A printed receipt: what someone shipped this year, one line per item';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SHIPPED_URL}/r/` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SHIPPED_URL}/r/`,
    siteName: 'Shipped 2026',
    type: 'website',
    images: [{ url: `${SHIPPED_URL}${SHIPPED_OG_IMAGE}`, width: 1200, height: 675, alt: ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: `${SHIPPED_URL}${SHIPPED_OG_IMAGE}`, alt: ALT }],
  },
};

export default function PrintedReceiptPage() {
  return (
    <>
      {/* Worker fills this with the receipt. suppressHydrationWarning: the text is rewritten per id. */}
      <script id="shipped-receipt-data" type="application/json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: 'null' }} />
      <PrintedReceiptView />
    </>
  );
}
