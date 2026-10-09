import React from 'react';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import { SHIPPED_APP_TITLE, SHIPPED_DESCRIPTION, SHIPPED_TITLE } from '../../lib/shipped-brand';
import { SHIPPED_OG_IMAGE } from '../../lib/shipped';
import { EVENT_NAME } from '../../lib/shipped-event';
import { SHIPPED_URL } from '../../lib/shipped-year';
import './receipt.css';

const uiSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});

const receiptMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-receipt',
});

// Own name, own preview, own home-screen title. The root layout's Bryton author / keywords / JSON-LD
// are overridden here (and stripped again on the Shipped host in worker/shipped-host.ts).
export const metadata: Metadata = {
  metadataBase: new URL(SHIPPED_URL),
  applicationName: SHIPPED_APP_TITLE,
  title: { absolute: SHIPPED_TITLE, default: SHIPPED_TITLE, template: '%s' },
  description: SHIPPED_DESCRIPTION,
  authors: [],
  creator: SHIPPED_APP_TITLE,
  publisher: SHIPPED_APP_TITLE,
  keywords: [],
  category: undefined,
  appleWebApp: {
    capable: true,
    title: SHIPPED_APP_TITLE,
    statusBarStyle: 'black-translucent',
  },
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
  openGraph: {
    title: SHIPPED_TITLE,
    description: SHIPPED_DESCRIPTION,
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
    title: SHIPPED_TITLE,
    description: SHIPPED_DESCRIPTION,
    images: [`${SHIPPED_URL}${SHIPPED_OG_IMAGE}`],
    creator: '',
    site: '',
  },
};

export default function ShippedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${uiSans.variable} ${receiptMono.variable} ${uiSans.className} shipped-page`}>
      <div className="shipped-stack">{children}</div>
    </div>
  );
}
