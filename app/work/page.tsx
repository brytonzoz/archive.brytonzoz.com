import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '../../components/SiteFooter';
import { ARTIST } from '../../lib/artist';

export const metadata: Metadata = {
  title: 'Work with me',
  description: 'For collaborations, licensing and business inquiries with Bryton Zoz.',
  alternates: { canonical: '/work/' },
};

export default function WorkPage() {
  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      <div className="mx-auto max-w-4xl px-5 pb-24 pt-6 sm:px-8 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>

        <h1 className="mt-8 text-[34px] font-bold leading-none tracking-[-0.03em] sm:mt-12 sm:text-[44px]">
          Work with me
        </h1>
        <p className="mt-5 text-[17px] text-white/60">For collaborations, licensing and business inquiries.</p>
        <a
          href={`mailto:${ARTIST.email}`}
          className="mt-8 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-transform hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          {ARTIST.email}
        </a>
      </div>
      <SiteFooter />
    </main>
  );
}
