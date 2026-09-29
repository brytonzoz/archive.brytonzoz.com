'use client';

import React from 'react';
import Link from 'next/link';
import { nonparallelAssets } from '../../lib/assets';
import * as merch from '../../lib/merch';
import { MerchProvider } from '../../lib/merch-client';
import { ResponsiveImage } from '../ResponsiveImage';
import { SiteFooter } from '../SiteFooter';
import { MerchShop } from './MerchShop';

// /nonparallel/: the whole shop (and /nonparallel/<piece>/, which opens that piece's sheet).
export function MerchPage({ initialProduct }: { initialProduct?: string }) {
  return (
    <div className="shop-section min-h-screen text-white">
      <div className="mx-auto max-w-[1120px] px-4 pt-6 sm:px-8 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/60 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>
        <div className="mt-6 sm:mt-10">
          {/* This page is the shop, so the catalog comes with it (the homepage loads it later). */}
          <MerchProvider value={merch}>
            <MerchShop
              headingLevel={1}
              initialProduct={initialProduct}
              title={(
                <div className="mb-3 w-[180px] sm:w-[220px]" style={{ aspectRatio: '466 / 216' }}>
                  <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="220px" priority draggable={false} className="h-full w-full object-contain" />
                </div>
              )}
            />
          </MerchProvider>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
