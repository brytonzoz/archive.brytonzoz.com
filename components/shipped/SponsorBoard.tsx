'use client';

import React from 'react';
import { moneyShort } from '../../lib/shipped-receipt';
import { SponsorBlockView, EMPTY_ADS } from './ReceiptAds';
import { openSponsor } from './sponsor-pick';
import { useShippedState } from './state';

/** A little piece of receipt paper on the desk, with the real advertising positions. */
export function SponsorBoard() {
  const state = useShippedState();
  const block = state?.sponsors.slots.length ? state.sponsors : { slots: EMPTY_ADS, frozen: false };
  const empty = block.slots.filter(slot => slot.house).length;
  const from = moneyShort(Math.min(...block.slots.map(slot => slot.next)));
  return <section className="shipped-board shipped-ad-board" id="board" aria-label="Advertisement slots">
    <div className="shipped-ad-board-label"><span>ADVERTISE ON RECEIPTS</span><span>↙</span></div>
    <div className="shipped-ad-board-paper">
      <p className="shipped-ad-board-price">{empty === block.slots.length ? '$1 each to start.' : `From ${from}.`}</p>
      <p className="shipped-ad-board-description">Your logo + QR code.<br />At the foot of every receipt.</p>
      <SponsorBlockView block={block} showHeading={false} onSelect={slot => openSponsor(slot)} />
      <p className="shipped-ad-board-hint">{block.frozen ? 'Final placements' : `${empty} empty ${empty === 1 ? 'slot' : 'slots'} · tap a space to preview`}</p>
    </div>
  </section>;
}
