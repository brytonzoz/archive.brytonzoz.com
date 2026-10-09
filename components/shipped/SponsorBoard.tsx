'use client';

// The first thing on /: a live outbid-style board. Hero on top, 3×3 under it. Each slot shows who
// holds it (logo or name), what they paid (HOUSE AD · $0 until someone buys), and a take button at
// the posted price. Tapping opens the bid sheet. The printer sits directly under this.
import React, { useEffect, useState } from 'react';
import { countdown } from '../../lib/shipped-event';
import { moneyShort } from '../../lib/shipped-receipt';
import { BID_RULES, DEFAULT_LADDER, HERO_SLOT, HOUSE_SLOTS, floorFor, floorsAt, slotLabel, slotPrice, sponsorTag } from '../../lib/shipped-sponsors';
import type { SponsorSlot } from '../../lib/shipped-year';
import { openSponsor } from './sponsor-pick';
import { useShippedState } from './state';

function housePreview(slot: number): SponsorSlot {
  const floors = floorsAt(DEFAULT_LADDER, 0);
  const floor = floorFor(slot, floors);
  const ad = HOUSE_SLOTS[slot];
  return {
    slot,
    name: ad.name,
    cta: ad.cta,
    url: ad.url,
    qr: `h${slot}`,
    logo: null,
    house: true,
    cents: 0,
    next: slotPrice(0, floor),
    floor,
    impressions: 0,
    since: null,
    lastOutbid: null,
    holders: 0,
    serial: null,
    cooldownUntil: null,
  };
}

const PREVIEW = HOUSE_SLOTS.map((_, slot) => housePreview(slot));

function takeCopy(cents: number) {
  return `Take this spot for ${moneyShort(cents)}`;
}

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
        {slot.house ? 'HOUSE AD · $0' : `${slot.serial ? `${sponsorTag(slot.serial)} · ` : ''}${moneyShort(slot.cents)}`}
      </p>
    </div>
  );
}

function TakeButton({ slot, open, frozen, now }: { slot: SponsorSlot; open: boolean; frozen: boolean; now: number | null }) {
  const maxed = slot.next > BID_RULES.maxCents;
  const cooling = Boolean(now && slot.cooldownUntil && now < slot.cooldownUntil);
  const disabled = !open || frozen || maxed || cooling;
  const wait = cooling && now && slot.cooldownUntil ? Math.max(1, Math.ceil((slot.cooldownUntil - now) / 1000)) : 0;
  const label = frozen
    ? 'Board is final'
    : maxed
      ? 'This spot is maxed'
      : cooling
        ? `Just taken · ${wait}s`
        : takeCopy(slot.next);
  return (
    <button type="button" className="shipped-board-take" disabled={disabled} onClick={() => openSponsor(slot.slot)}>
      {label}
    </button>
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
          {state && now !== null ? (
            <>
              {' · '}
              {closed ? 'printer is off' : `printer shuts off in ${countdown(left)}`}
            </>
          ) : null}
        </p>
      </header>

      <article className="shipped-board-hero" aria-label={slotLabel(hero.slot)}>
        <p className="shipped-board-slot">HERO</p>
        <SlotFace slot={hero} hero />
        <TakeButton slot={hero} open={open} frozen={frozen} now={now} />
      </article>

      <ul className="shipped-board-grid">
        {rest.map((slot) => (
          <li key={slot.slot} className="shipped-board-cell">
            <p className="shipped-board-slot">{slotLabel(slot.slot)}</p>
            <SlotFace slot={slot} hero={false} />
            <TakeButton slot={slot} open={open} frozen={frozen} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
