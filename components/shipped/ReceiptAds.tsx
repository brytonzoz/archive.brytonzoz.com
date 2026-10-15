'use client';

import React, { useEffect, useState } from 'react';
import { qr } from '../../lib/shipped-qr';
import { moneyShort } from '../../lib/shipped-receipt';
import { HERO_SLOT, SLOT_COUNT, bidRange } from '../../lib/shipped-sponsors';
import { QR_PATH, type SponsorBlock, type SponsorSlot } from '../../lib/shipped-year';

/** The wire format retains `house` for compatibility; it now means an empty advertisement slot. */
export const EMPTY_ADS: SponsorSlot[] = Array.from({ length: SLOT_COUNT }, (_, slot) => ({
  slot, name: '', cta: '', url: '', qr: '', logo: null, house: true, cents: 0,
  next: bidRange(0).min, maxNext: bidRange(0).max, impressions: 0, since: null,
  lastOutbid: null, holders: 0, serial: null, cooldownUntil: null, closesAt: 0,
}));

export function adLabel(slot: number) { return slot === HERO_SLOT ? 'Wide ad' : `Ad slot ${slot}`; }

export type AdDraft = { slot: number; name: string; cta: string; url: string; logo: string | null };

function previewUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.includes('.') ? url.href : null; }
  catch { return null; }
}

function QrCode({ text, label }: { text: string; label: string }) {
  const code = qr(text);
  return <svg viewBox={`-2 -2 ${code.size + 4} ${code.size + 4}`} className="shipped-qr" role="img" aria-label={label}>
    <path d={code.path} fill="currentColor" shapeRendering="crispEdges" />
  </svg>;
}

/** Shared by the printed receipt, placement picker and live advertiser proof. */
export function SponsorBlockView({ block, selectedSlot, onSelect, draft, showHeading = true }: {
  block: SponsorBlock | null;
  selectedSlot?: number;
  onSelect?: (slot: number) => void;
  draft?: AdDraft;
  showHeading?: boolean;
}) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!block?.slots.length) return null;

  function slotView(slot: SponsorSlot) {
    const isDraft = draft?.slot === slot.slot;
    const empty = slot.house && !isDraft;
    const name = isDraft ? draft.name.trim() || 'YOUR NAME' : slot.name;
    const cta = isDraft ? draft.cta.trim() || 'Your message here' : slot.cta;
    const logo = isDraft ? draft.logo : slot.logo;
    const destination = isDraft ? previewUrl(draft.url) : origin && slot.qr ? new URL(QR_PATH(slot.qr), origin).href : null;
    const classes = `shipped-ad-slot${slot.slot === HERO_SLOT ? ' is-wide' : ''}${empty ? ' is-empty' : ''}${selectedSlot === slot.slot ? ' is-selected' : ''}`;
    const content = empty ? <>
      <span className="shipped-ad-number">{adLabel(slot.slot)}</span>
      <span className="shipped-ad-empty">EMPTY</span>
      <span className="shipped-ad-price">{moneyShort(slot.next)}</span>
    </> : <>
      <span className="shipped-ad-copy">
        {/* Uploaded monochrome blobs and approved sponsor assets retain their exact pixels. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img key={logo} src={logo} onError={event => { event.currentTarget.hidden = true; }} alt={`${name} logo`} className="shipped-logo shipped-ad-logo" /> : null}
        <strong>{name}</strong><span>{cta}</span>
      </span>
      <span className="shipped-ad-code">
        {destination ? <QrCode text={destination} label={`QR code for ${name}`} /> : <span className="shipped-ad-qr-placeholder">QR</span>}
      </span>
    </>;
    const label = `${adLabel(slot.slot)} — ${slot.house ? 'Empty' : slot.name} — ${moneyShort(slot.next)}`;
    if (onSelect) return <button key={slot.slot} type="button" className={classes} data-ad-slot={slot.slot} aria-label={label} aria-pressed={selectedSlot === slot.slot} onClick={() => onSelect(slot.slot)}>{content}</button>;
    if (empty) return <a key={slot.slot} className={classes} data-ad-slot={slot.slot} href="/#board" aria-label={`${label}. Advertise on receipts`}>{content}</a>;
    return <a key={slot.slot} className={classes} data-ad-slot={slot.slot} href={QR_PATH(slot.qr)} target="_blank" rel="sponsored nofollow noopener noreferrer">{content}</a>;
  }

  return <section className="shipped-paidby" aria-label="Advertisements">
    {showHeading ? <p className="shipped-paidby-head">ADVERTISEMENT SLOTS{block.frozen ? ' · FINAL' : ''}</p> : null}
    <div className="shipped-ad-grid">{[...block.slots].sort((a, b) => a.slot - b.slot).map(slotView)}</div>
  </section>;
}
