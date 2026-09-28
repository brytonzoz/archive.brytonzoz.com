'use client';

import React from 'react';
import Link from 'next/link';
import { SiteFooter } from '../SiteFooter';
import { StoreExperience } from './StoreExperience';

// /scrapwrk/ (and /scrapwrk/<piece>/, which opens that piece's sheet).
export function StorePage({ initialProduct }: { initialProduct?: string }) {
  return (
    <div className="store-page min-h-screen text-white">
      <div className="mx-auto max-w-[560px] px-5 pt-6 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>
        <div className="mt-8 sm:mt-12">
          <StoreExperience
            active
            initialProduct={initialProduct}
            sizes="(min-width: 600px) 270px, 46vw"
            headerClassName="mb-3"
            intro={<p className="store-caption">One-of-one pieces, reworked by hand. Once one sells, it’s gone.</p>}
            title={<h1 className="text-[34px] font-bold leading-none tracking-[-0.03em] sm:text-[44px]">Scrapwrk</h1>}
          />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
