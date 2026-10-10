import React from 'react';
import type { Metadata } from 'next';
import { HouseSlip } from '../../components/shipped/HouseSlip';
import { ShippedStage } from '../../components/shipped/ShippedStage';
import { ReceiptWall } from '../../components/shipped/wall';
import { SponsorBoard } from '../../components/shipped/SponsorBoard';
import { SponsorDesk } from '../../components/shipped/SponsorDesk';
import { SHIPPED_OG_IMAGE } from '../../lib/shipped';
import { SHIPPED_DESCRIPTION, SHIPPED_TITLE } from '../../lib/shipped-brand';
import { EVENT_NAME } from '../../lib/shipped-event';
import { SHIPPED_URL } from '../../lib/shipped-year';

export const dynamic = 'force-static';

const TITLE = SHIPPED_TITLE;
const DESCRIPTION = SHIPPED_DESCRIPTION

export const metadata: Metadata = {
  title: { absolute: TITLE },
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
  alternates: { canonical: `${SHIPPED_URL}/` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SHIPPED_URL}/`,
    siteName: EVENT_NAME,
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: `${SHIPPED_URL}${SHIPPED_OG_IMAGE}`,
        width: 1200,
        height: 630,
        alt: `A thermal receipt printer printing a ${EVENT_NAME} receipt`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SHIPPED_URL}${SHIPPED_OG_IMAGE}`],
  },
};

export default function ShippedPage() {
  return (
    <>
      <ShippedStage opening={{ kind: 'house', content: <HouseSlip /> }} title="Print yours" />
      <SponsorBoard />
      <SponsorDesk />
      <ReceiptWall />
      <p className="pb-8 text-center text-[11px] text-[#f3ead8]/45">
        A free public offering by{' '}
        <a href="https://brytonzoz.com/about/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          Bryton Zoz
        </a>{' '}
        ·{' '}
        <a href="/terms/" className="underline underline-offset-4">
          Terms &amp; privacy
        </a>
      </p>
    </>
  );
}
