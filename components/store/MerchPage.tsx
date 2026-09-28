'use client';

import React from 'react';
import Link from 'next/link';
import { nonparallelAssets } from '../../lib/assets';
import { ResponsiveImage } from '../ResponsiveImage';
import { SiteFooter } from '../SiteFooter';
import { MerchExperience } from './MerchExperience';

// /nonparallel/ (and /nonparallel/<tee>/, which opens that tee's sheet).
export function MerchPage({ initialProduct }: { initialProduct?: string }) {
  return (
    <div className="np-page min-h-screen text-white">
      <div className="mx-auto max-w-[560px] px-5 pt-6 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/60 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>
        <div className="np-scene mt-6 sm:mt-10" style={{ width: '100%' }}>
          <MerchExperience
            active
            initialProduct={initialProduct}
            sizes="(min-width: 600px) 270px, 46vw"
            headerClassName="np-scene-header"
            title={(
              <h1 className="np-scene-logo">
                <span className="sr-only">NonParallel</span>
                <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="(min-width: 600px) 260px, 46vw" priority draggable={false} className="h-full w-full object-contain" />
              </h1>
            )}
            intro={<p className="store-caption">The label and company behind all of this. A tee is a way to support it: you get something to wear, and it keeps the work going.</p>}
          />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
