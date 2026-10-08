import React from 'react';
import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './receipt.css';

const receiptMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

// Every /shipped page is off the books for search (public/_headers adds X-Robots-Tag too).
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
};

export default function ShippedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${receiptMono.className} shipped-page`}>
      <div className="shipped-stack">{children}</div>
    </div>
  );
}
