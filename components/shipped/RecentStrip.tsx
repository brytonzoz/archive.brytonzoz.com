'use client';

// "Recently printed": receipts whose printers ticked the opt-in box. Nothing shows without it.
import React from 'react';
import { RECEIPT_PATH } from '../../lib/shipped-year';
import { useShippedState } from './state';

export function RecentStrip() {
  const state = useShippedState();
  const recent = state?.recent ?? [];
  if (!recent.length) return null;
  return (
    <section className="shipped-recent" aria-label="Recently printed receipts">
      <h2 className="text-center text-[11px] font-semibold tracking-[0.3em] text-[#f3ead8]/70">RECENTLY PRINTED</h2>
      <ul className="shipped-recent-list">
        {recent.map((receipt) => (
          <li key={receipt.id}>
            {/* Share pages are served by the Worker, so this is a full page load on purpose. */}
            <a href={RECEIPT_PATH(receipt.id)} className="shipped-recent-stub">
              <span className="block truncate text-[12px] font-semibold tracking-[0.08em]">{receipt.who.toUpperCase()}</span>
              <span className="block text-[10.5px] tracking-[0.14em] opacity-70">
                {receipt.full ? 'FULL · ' : ''}
                {receipt.potential ? 'POTENTIAL' : `${receipt.count} SHIPPED`}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
