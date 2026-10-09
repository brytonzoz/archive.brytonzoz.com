'use client';

// Collapsed by default: one rail (“Sponsors · 10 spots · from $1”) with a row of marks.
// Opens into a compact list — logo, name, price, one Bid — with a height spring.
import React, { useEffect, useId, useState } from 'react';
import { countdown } from '../../lib/shipped-event';
import { moneyShort } from '../../lib/shipped-receipt';
import { BID_RULES, HERO_SLOT, HOUSE_SLOTS, SLOT_COUNT, bidRange, houseMarkPath, monogram, slotLabel, sponsorTag, takeoversOpen } from '../../lib/shipped-sponsors';
import type { SponsorSlot } from '../../lib/shipped-year';
import { press } from './feel';
import { chooseSponsor, closeSponsor, openSponsor, useSponsorPick } from './sponsor-pick';
import { useShippedClock } from './state';

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

function Mark({ slot }: { slot: SponsorSlot }) {
  const [failed, setFailed] = useState(false);
  const src = slot.logo ?? (slot.house ? houseMarkPath(slot.slot) : null);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        className={`shipped-mark-logo${slot.house ? '' : ' is-ink'}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="shipped-mark" aria-hidden>
      {monogram(slot.name)}
    </span>
  );
}

function BidButton({ slot, open, frozen, now }: { slot: SponsorSlot; open: boolean; frozen: boolean; now: number | null }) {
  const maxed = slot.next > BID_RULES.maxCents;
  const cooling = Boolean(now && slot.cooldownUntil && now < slot.cooldownUntil);
  const slotClosed = Boolean(now && slot.closesAt && !takeoversOpen(now, slot.closesAt));
  const disabled = !open || frozen || maxed || cooling || slotClosed;
  const wait = cooling && now && slot.cooldownUntil ? Math.max(1, Math.ceil((slot.cooldownUntil - now) / 1000)) : 0;
  let label = 'Bid';
  if (frozen || slotClosed) label = 'Final';
  else if (maxed) label = 'Maxed';
  else if (cooling) label = `${wait}s`;
  return (
    <button
      type="button"
      className="shipped-slot-bid"
      disabled={disabled}
      onPointerDown={press}
      onClick={() => chooseSponsor(slot.slot)}
    >
      {label}
    </button>
  );
}

function SlotRow({ slot, open, frozen, now }: { slot: SponsorSlot; open: boolean; frozen: boolean; now: number | null }) {
  const hero = slot.slot === HERO_SLOT;
  const price = slot.house ? moneyShort(slot.next) : moneyShort(slot.cents);
  return (
    <li className={`shipped-slot-row${hero ? ' is-hero' : ''}`}>
      <Mark slot={slot} />
      <div className="shipped-slot-meta">
        <p className="shipped-slot-name">
          {hero ? <span className="shipped-slot-kicker">Hero</span> : null}
          {slot.name}
        </p>
        <p className="shipped-slot-price">
          {slot.house ? `from ${price}` : slot.serial ? `${sponsorTag(slot.serial)} · ${price}` : price}
        </p>
      </div>
      <BidButton slot={slot} open={open} frozen={frozen} now={now} />
    </li>
  );
}

function BidChoose({ slots }: { slots: SponsorSlot[] }) {
  const pick = useSponsorPick();
  const slot = slots.find((s) => s.slot === pick.slot) ?? slots[0];
  useEffect(() => {
    if (pick.open !== 'choose') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSponsor();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [pick.open]);
  if (pick.open !== 'choose' || !slot) return null;
  const same = slot.next === slot.maxNext;
  return (
    <div className="shipped-sheet shipped-sheet-choose" role="dialog" aria-modal="true" aria-labelledby="shipped-bid-choose-title">
      <button type="button" className="shipped-sheet-backdrop" aria-label="Close" onClick={closeSponsor} />
      <div className="shipped-choose">
        <p className="shipped-choose-kicker">{slotLabel(slot.slot)}</p>
        <h2 id="shipped-bid-choose-title" className="shipped-choose-title">
          {slot.name}
        </h2>
        <p className="shipped-choose-cta">{slot.cta}</p>
        <div className="shipped-choose-actions">
          {same ? (
            <button type="button" className="shipped-choose-go" onPointerDown={press} onClick={() => openSponsor(slot.slot, slot.next)}>
              Bid {moneyShort(slot.next)}
            </button>
          ) : (
            <>
              <button type="button" className="shipped-choose-go" onPointerDown={press} onClick={() => openSponsor(slot.slot, slot.next)}>
                Lowest {moneyShort(slot.next)}
              </button>
              <button type="button" className="shipped-choose-go is-quiet" onPointerDown={press} onClick={() => openSponsor(slot.slot, slot.maxNext)}>
                Highest {moneyShort(slot.maxNext)}
              </button>
            </>
          )}
        </div>
        <button type="button" className="shipped-choose-cancel" onClick={closeSponsor}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SponsorBoard() {
  const { state, now, left, closed } = useShippedClock();
  const slots = state?.sponsors.slots.length ? state.sponsors.slots : PREVIEW;
  const frozen = Boolean(state?.sponsors.frozen);
  const paymentsOpen = Boolean(state?.payments.open) && !frozen;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const from = moneyShort(Math.min(...slots.map((s) => s.next)));

  return (
    <section className={`shipped-board${open ? ' is-open' : ''}`} id="board">
      <p className="shipped-board-proof">
        {left !== null ? (closed ? 'printer is off' : `shuts off in ${countdown(left)}`) : '··'}
      </p>

      <button
        type="button"
        className="shipped-board-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={press}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="shipped-board-toggle-copy">
          <span className="shipped-board-toggle-lead">Sponsors · {SLOT_COUNT} spots</span>
          <span className="shipped-board-toggle-from">from {from}</span>
        </span>
        <span className="shipped-board-marks" aria-hidden>
          {slots.map((slot) => (
            <Mark key={slot.slot} slot={slot} />
          ))}
        </span>
        <span className="shipped-board-chevron" aria-hidden />
      </button>

      <div className="shipped-board-panel" id={panelId}>
        <div className="shipped-board-panel-inner">
          <ul className="shipped-slot-list">
            {slots.map((slot) => (
              <SlotRow key={slot.slot} slot={slot} open={paymentsOpen} frozen={frozen} now={now} />
            ))}
          </ul>
        </div>
      </div>
      <BidChoose slots={slots} />
    </section>
  );
}
