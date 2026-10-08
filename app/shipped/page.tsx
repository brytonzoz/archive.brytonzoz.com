import React from 'react';
import type { Metadata } from 'next';
import { BrytonReceipt } from '../../components/shipped/BrytonReceipt';
import { RecentStrip } from '../../components/shipped/RecentStrip';
import { Receipt } from '../../components/shipped/Receipt';
import { ShippedStage } from '../../components/shipped/ShippedStage';
import { SponsorDesk } from '../../components/shipped/SponsorDesk';
import { SHIPPED_OG_IMAGE } from '../../lib/shipped';
import { SITE_YEAR } from '../../lib/shipped-year';

export const dynamic = 'force-static';

const TITLE = `Shipped in ${SITE_YEAR}`;
const DESCRIPTION = `Everything Bryton Zoz shipped in ${SITE_YEAR}, itemized on a receipt. Print yours: everything you shipped this year, on one receipt.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} — Bryton Zoz` },
  description: DESCRIPTION,
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
    },
  },
  alternates: { canonical: '/shipped/' },
  openGraph: {
    title: `${TITLE} — Bryton Zoz`,
    description: DESCRIPTION,
    url: '/shipped/',
    siteName: 'Bryton Zoz',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: SHIPPED_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'A long printed receipt itemizing every business and app Bryton Zoz has started, by year',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@BrytonZoz',
    site: '@BrytonZoz',
    title: `${TITLE} — Bryton Zoz`,
    description: DESCRIPTION,
    images: [SHIPPED_OG_IMAGE],
  },
};

export default function ShippedPage() {
  return (
    <>
      <ShippedStage opening={{ kind: 'house', content: <BrytonReceipt /> }} title={`Shipped in ${SITE_YEAR}`} />
      <RecentStrip />
      <SponsorDesk />
      <Receipt />
    </>
  );
}
