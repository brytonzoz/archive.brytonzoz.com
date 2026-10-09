import React from 'react';
import type { Metadata } from 'next';
import { HouseSlip } from '../../components/shipped/HouseSlip';
import { RecentStrip } from '../../components/shipped/RecentStrip';
import { ShippedStage } from '../../components/shipped/ShippedStage';
import { SponsorDesk } from '../../components/shipped/SponsorDesk';
import { SHIPPED_OG_IMAGE } from '../../lib/shipped';
import { EVENT_NAME } from '../../lib/shipped-event';
import { SHIPPED_URL, SITE_YEAR } from '../../lib/shipped-year';

export const dynamic = 'force-static';

const TITLE = `${EVENT_NAME}: the public receipt printer`;
const DESCRIPTION = `Print a free receipt of everything you publicly shipped in ${SITE_YEAR}: apps, launches, repos, releases, sites. Two weeks only.`;

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
      <ShippedStage opening={{ kind: 'house', content: <HouseSlip /> }} title={`Shipped in ${SITE_YEAR}`} />
      <RecentStrip />
      <SponsorDesk />
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
