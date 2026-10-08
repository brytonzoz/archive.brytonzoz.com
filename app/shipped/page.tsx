import React from 'react';
import type { Metadata } from 'next';
import { PrintForm } from '../../components/shipped/PrintForm';
import { Receipt } from '../../components/shipped/Receipt';
import { SponsorDesk } from '../../components/shipped/SponsorDesk';
import { SHIPPED_OG_IMAGE } from '../../lib/shipped';

export const dynamic = 'force-static';

const TITLE = 'Shipped';
const DESCRIPTION =
  'Every business, app and site Bryton Zoz has started since 2020, itemized on one receipt: what is live, what is a prototype, and what died.';

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
      <Receipt />
      <PrintForm />
      <SponsorDesk />
    </>
  );
}
