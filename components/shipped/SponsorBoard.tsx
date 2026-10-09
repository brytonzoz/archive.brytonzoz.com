'use client';

// The first thing on /: a live bidding board. Hero on top, 3×3 under it. Each slot shows who
// holds it (logo or name), HOUSE AD · $0 · bid $1 until someone pays, then the holder's bid, and
// Lowest bid / Highest bid buttons. Tapping opens the bid sheet. The printer sits under this.
import React, { useEffect, useState } from 'react';
import { countdown } from '../../lib/shipped-event';
import { moneyShort } from '../../lib/shipped-receipt';
import { BID_RULES, HERO_SLOT, HOUSE_SLOTS, bidRange, slotLabel, sponsorTag, takeoversOpen } from '../../lib/shipped-sponsors';
import type { SponsorSlot } from '../../lib/shipped-year';
import { openSponsor } from './sponsor-pick';
import { useShippedState } from './state';

function housePreview(slot: number): SponsorSlot {
  const ad = HOUSE_SLOTS[slot];
  const range = bidRange(0);
  return {
    slot,
    name: ad.name,
    cta: ad.cta,
    url: ad.url,
    qr: `h${slot}`,
    logo: null,
    house: true,
    cents: 0,
    next: range.min,
    maxNext: range.max,
    impressions: 0,
    since: null,
    lastOutbid: null,
    holders: 0,
    serial: null,
    cooldownUntil: null,
    closesAt: 0,
  };
}

const PREVIEW = HOUSE_SLOTS.map((_, slot) => housePreview(slot));

function SlotFace({ slot, hero }: { slot: SponsorSlot; hero: boolean }) {
  return (
    <div className={`shipped-board-face${hero ? ' is-hero' : ''}`}>
      {slot.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.logo} alt="" className="shipped-board-logo" />
      ) : (
        <p className="shipped-board-name">{slot.name}</p>
      )}
      <p className="shipped-board-cta">{slot.cta}</p>
      <p className="shipped-board-held">
        {slot.house
          ? `HOUSE AD · ${moneyShort(0)} · bid ${moneyShort(slot.next)}`
          : `${slot.serial ? `${sponsorTag(slot.serial)} · ` : ''}${moneyShort(slot.cents)}`}
      </p>
    </div>
  );
}

function BidButtons({ slot, open, frozen, now }: { slot: SponsorSlot; open: boolean; frozen: boolean; now: number | null }) {
  const maxed = slot.next > BID_RULES.maxCents;
  const cooling = Boolean(now && slot.cooldownUntil && now < slot.cooldownUntil);
  const slotClosed = Boolean(now && slot.closesAt && !takeoversOpen(now, slot.closesAt));
  const disabled = !open || frozen || maxed || cooling || slotClosed;
  const wait = cooling && now && slot.cooldownUntil ? Math.max(1, Math.ceil((slot.cooldownUntil - now) / 1000)) : 0;
  const same = slot.next === slot.maxNext;
  if (frozen || slotClosed) {
    return (
      <button type="button" className="shipped-board-take" disabled>
        Board is final
      </button>
    );
  }
  if (maxed) {
    return (
      <button type="button" className="shipped-board-take" disabled>
        This spot is maxed
      </button>
    );
  }
  if (cooling) {
    return (
      <button type="button" className="shipped-board-take" disabled>
        Just taken · {wait}s
      </button>
    );
  }
  return (
    <div className="shipped-board-bids">
      <button type="button" className="shipped-board-take" disabled={disabled} onClick={() => openSponsor(slot.slot, slot.next)}>
        {same ? `Bid ${moneyShort(slot.next)}` : `Lowest bid ${moneyShort(slot.next)}`}
      </button>
      {same ? null : (
        <button type="button" className="shipped-board-take is-high" disabled={disabled} onClick={() => openSponsor(slot.slot, slot.maxNext)}>
          Highest bid {moneyShort(slot.maxNext)}
        </button>
      )}
    </div>
  );
}

export function SponsorBoard() {
  const state = useShippedState();
  const slots = state?.sponsors.slots.length ? state.sponsors.slots : PREVIEW;
  const hero = slots.find((s) => s.slot === HERO_SLOT) ?? PREVIEW[0];
  const rest = slots.filter((s) => s.slot !== HERO_SLOT);
  const frozen = Boolean(state?.sponsors.frozen);
  const open = Boolean(state?.payments.open) && !frozen;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const skew = state.event.now - Date.now();
    setNow(Date.now() + skew);
    const timer = window.setInterval(() => setNow(Date.now() + skew), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const left = state && now !== null ? state.event.closesAt - now : 0;
  const closed = Boolean(state && (state.event.phase === 'closed' || left <= 0));

  return (
    <section className="shipped-board" id="board" aria-labelledby="shipped-board-title">
      <header className="shipped-board-head">
        <p className="shipped-board-eyebrow">SHIPPED 2026</p>
        <h1 id="shipped-board-title" className="shipped-board-title">
          The public receipt printer
        </h1>
        <p className="shipped-board-pitch">Pay and your logo is on every receipt printed.</p>
        <p className="shipped-board-proof">
          {state ? `${state.printed.toLocaleString('en-US')} printed` : '·· printed'}
          {state ? ` · ${state.shared.toLocaleString('en-US')} shared` : null}
          {state && now !== null ? (
            <>
              {' · '}
              {closed ? 'printer is off' : `printer shuts off in ${countdown(left)}`}
            </>
          ) : null}
        </p>
        {state?.recent.length ? (
          <p className="shipped-board-ticker" aria-label="Recently printed">
            {state.recent
              .slice(0, 8)
              .map((row) => `${row.who.toUpperCase()} · ${row.potential ? 'POTENTIAL' : `${row.count} SHIPPED`}`)
              .join('  ·  ')}
          </p>
        ) : null}
      </header>

      <article className="shipped-board-hero" aria-label={slotLabel(hero.slot)}>
        <p className="shipped-board-slot">HERO</p>
        <SlotFace slot={hero} hero />
        <BidButtons slot={hero} open={open} frozen={frozen} now={now} />
      </article>

      <ul className="shipped-board-grid">
        {rest.map((slot) => (
          <li key={slot.slot} className="shipped-board-cell">
            <p className="shipped-board-slot">{slotLabel(slot.slot)}</p>
            <SlotFace slot={slot} hero={false} />
            <BidButtons slot={slot} open={open} frozen={frozen} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
