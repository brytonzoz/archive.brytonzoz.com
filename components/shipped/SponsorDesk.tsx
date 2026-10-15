'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ditherLogo, type DitheredLogo } from '../../lib/dither';
import { closingLabel } from '../../lib/shipped-event';
import { money, moneyShort } from '../../lib/shipped-receipt';
import { BID_RULES, HERO_SLOT, limitsFor, slotLabel, takeoversOpen, validateBid } from '../../lib/shipped-sponsors';
import { FALLBACK_HUMAN, HumanCheck, type HumanCheckHandle } from './HumanCheck';
import { Barcode, Line, Ticket } from './paper';
import { SponsorBlockView, EMPTY_ADS, adLabel } from './ReceiptAds';
import { closeSponsor, openSponsor, useSponsorPick } from './sponsor-pick';
import { refreshShippedState, useShippedClock } from './state';

const ERRORS: Record<string, string> = {
  'sponsors-closed': 'Sponsor slots are closed right now.',
  closed: 'The printer is off. The sponsor block is final.',
  locked: 'This slot is no longer changing hands.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'Too many tries. Try again in an hour.',
  'checkout-failed': 'Checkout didn’t open. Try again.',
  cooldown: 'This slot just changed hands. Wait a moment and try again.',
  'cross-origin': 'Use shipped.brytonzoz.com.',
  'browser-only': 'Use a browser.',
};

type Taken = { kind: 'bid'; status: string; slot: number; name: string; cents: number; refundCents: number | null; logoPending: boolean };

const TAKEN: Record<string, string> = {
  live: 'PAID. The slot is yours: it’s on every receipt now.',
  checkout: 'Checking your payment…',
  failed: 'That checkout closed before it was paid. Nothing was charged.',
  lost: 'Someone else took that price first (or it moved). You’ve been refunded in full.',
  outbid: 'Someone took this slot at the next price. Your prorated refund is on its way.',
  removed: 'This slot was taken down in review and refunded in full.',
  refunded: 'This slot was refunded.',
};

type FieldError = { field: string; message: string } | null;

const receiveToken = () => {};

export function SponsorDesk() {
  const { state, now } = useShippedClock();
  const pick = useSponsorPick();
  const block = state?.sponsors;
  const payments = state?.payments;
  const [slot, setSlot] = useState(HERO_SLOT);
  const [cents, setCents] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [cta, setCta] = useState('');
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState<DitheredLogo | null>(null);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const human = useRef<HumanCheckHandle>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const proof = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const serverOffset = useRef(0);
  useEffect(() => { if (state) serverOffset.current = state.event.now - Date.now(); }, [state]);
  const uploadRound = useRef(0);
  const uploading = useRef(false);

  useEffect(() => {
    if (pick.open === 'form') {
      setSlot(pick.slot);
      setCents(pick.cents);
      setError(null);
    }
  }, [pick.open, pick.slot, pick.cents]);

  useEffect(() => {
    if (pick.open !== 'form') return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) closeSponsor();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]') ?? []).filter(el => el.tabIndex >= 0 && el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [pick.open]);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('bid');
    if (!checkout || !/^[A-Za-z0-9_-]{6,200}$/.test(checkout)) return;
    setNotice(TAKEN.checkout);
    openSponsor(HERO_SLOT);
    fetch(`/api/shipped/checkout?checkout=${encodeURIComponent(checkout)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<Taken> : null)
      .then(taken => {
        if (!taken || taken.kind !== 'bid') return setNotice('Couldn’t find that checkout. If you paid, email the address on the terms page.');
        const extra = taken.status === 'live' && taken.logoPending ? ' Your logo shows once it’s approved; your name prints until then.' : '';
        setNotice(`${slotLabel(taken.slot)} · ${taken.name} · ${money(taken.cents)}. ${TAKEN[taken.status] ?? TAKEN.failed}${extra}`);
        openSponsor(taken.slot);
        refreshShippedState();
      })
      .catch(() => setNotice('Couldn’t check your payment. Reload to try again.'));
  }, []);

  useEffect(() => () => { if (logo) URL.revokeObjectURL(logo.url); }, [logo]);

  const slots = block?.slots.length ? block.slots : EMPTY_ADS;
  const picked = block?.slots.find(s => s.slot === slot);
  const limits = limitsFor(slot);
  const cooling = Boolean(picked?.cooldownUntil && now && now < picked.cooldownUntil);
  const open = Boolean(payments?.open && picked && now && !block?.frozen && !cooling && takeoversOpen(now, picked.closesAt || state?.event.closesAt || 0));
  const soldOut = Boolean(picked && picked.next > BID_RULES.maxCents);
  const bid = picked ? cents === picked.maxNext ? picked.maxNext : picked.next : BID_RULES.minCents;
  const closesAt = picked?.closesAt || state?.event.closesAt || 0;
  const availability = useRef({ open, soldOut, slot, bid, closesAt });
  availability.current = { open, soldOut, slot, bid, closesAt };

  function selectSlot(value: number) {
    if (inFlight.current) return;
    setSlot(value); setCents(null); setError(null);
  }

  async function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const round = ++uploadRound.current;
    setError(null); setLogo(null);
    if (!file) { uploading.current = false; setPreparing(false); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8_000_000) {
      uploading.current = false; setPreparing(false);
      return setError({ field: 'logo', message: 'Use a PNG, JPEG or WebP under 8 MB.' });
    }
    uploading.current = true; setPreparing(true);
    try {
      const result = await ditherLogo(file);
      if (round !== uploadRound.current) URL.revokeObjectURL(result.url);
      else setLogo(result);
    } catch {
      if (round === uploadRound.current) setError({ field: 'logo', message: 'Couldn’t print that logo. Try a simpler or smaller image.' });
    } finally {
      if (round === uploadRound.current) { uploading.current = false; setPreparing(false); }
    }
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (inFlight.current || uploading.current || !picked || !open || soldOut || !takeoversOpen(Date.now() + serverOffset.current, closesAt)) return;
    setError(null);
    const check = validateBid({ slot, name, cta, url });
    if (!check.ok) {
      setError({ field: check.field, message: check.error });
      document.getElementById(`sponsor-${check.field}`)?.focus();
      return;
    }
    if (!terms) return setError({ field: 'terms', message: 'Please accept the sponsor terms.' });
    inFlight.current = true; setBusy(true);
    try {
      const token = await human.current?.execute();
      if (!token) { setError({ field: 'form', message: 'Couldn’t check you’re human. Try again; your ad is saved here.' }); return; }
      const current = availability.current;
      if (!current.open || current.soldOut || current.slot !== slot || current.bid !== bid || !takeoversOpen(Date.now() + serverOffset.current, current.closesAt)) {
        setError({ field: 'form', message: 'This slot changed while you were editing. Check its current price before continuing.' });
        return;
      }
      const form = new FormData();
      form.set('slot', String(slot)); form.set('name', check.name); form.set('cta', check.cta);
      form.set('url', check.url); form.set('cents', String(bid)); form.set('terms', '1'); form.set('token', token);
      if (logo) form.set('logo', logo.blob, 'logo.png');
      const response = await fetch('/api/shipped/bid', { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string; field?: string; message?: string };
      if (response.ok && result.url) { window.location.assign(result.url); return; }
      if (result.error === 'price-changed') refreshShippedState();
      setError({ field: result.field ?? 'form', message: result.message ?? ERRORS[result.error ?? ''] ?? 'Checkout didn’t open. Your ad is saved here; try again.' });
    } catch {
      setError({ field: 'form', message: 'Checkout didn’t open. Your ad is saved here; try again.' });
    } finally {
      human.current?.reset(); inFlight.current = false; setBusy(false);
    }
  }

  const fieldError = (field: string) => error?.field === field ? <p id={`sponsor-${field}-error`} className="shipped-ad-error" role="alert">{error.message}</p> : null;
  const invalid = (field: string) => ({ 'aria-invalid': error?.field === field || undefined, 'aria-describedby': error?.field === field ? `sponsor-${field}-error` : undefined });
  if (pick.open !== 'form') return null;

  return <div className="shipped-sheet shipped-ad-sheet" role="dialog" aria-modal="true" aria-labelledby="sponsor-sheet-title" ref={dialog} tabIndex={-1}>
    <button type="button" className="shipped-sheet-backdrop" aria-label="Close sponsor desk" disabled={busy} onClick={closeSponsor} tabIndex={-1} />
    <div className="shipped-ad-workbench">
      <header className="shipped-ad-header">
        <div><p>ADVERTISEMENT DESK</p><h2 id="sponsor-sheet-title">Your ad, on the receipt</h2></div>
        <button type="button" onClick={closeSponsor} disabled={busy} aria-label="Close advertisement desk">Close ×</button>
      </header>
      {notice ? <p className="shipped-ad-notice" role="status">{notice}</p> : null}
      <div className="shipped-ad-editor">
        <div className="shipped-ad-proof" ref={proof}>
          <p className="shipped-ad-step">01 / PICK YOUR SPACE</p>
          <p className="shipped-ad-caption">Tap a slot below. This is where your ad prints.</p>
          <Ticket label="Receipt placement preview" seed="advertisement-proof" className="shipped-ad-preview">
            <div className="shipped-ad-receipt-context" aria-hidden="true">
              <p>SHIPPED {state?.generator.year ?? 2026}</p>
              <span className="shipped-ad-context-lines"><i /><i /><i /></span>
              <Line label="TOTAL SHIPPED" value="…" />
              <p className="shipped-ad-context-note">Receipt items & cashier’s note above</p>
            </div>
            <SponsorBlockView block={{ slots, frozen: Boolean(block?.frozen) }} selectedSlot={slot} onSelect={selectSlot} draft={{ slot, name, cta, url, logo: logo?.url ?? null }} />
            <Barcode value="YOUR AD PRINTS HERE" />
          </Ticket>
          <p className="shipped-ad-preview-note"><span /> {adLabel(slot)} selected · preview updates as you type</p>
          <p className="shipped-ad-caption">On receipts, shared images and mailed prints.<br />QR codes open your website.</p>
        </div>
        <form className="shipped-ad-form" onSubmit={event => void submit(event)} noValidate>
          <p className="shipped-ad-step">02 / MAKE IT YOURS</p>
          <div className="shipped-ad-selection"><strong>{adLabel(slot)}</strong><span>{picked?.house ? `Empty · starts at ${moneyShort(picked.next)}` : picked ? `Held by ${picked.name}` : 'Loading availability…'}</span></div>
          <button type="button" className="shipped-ad-mobile-preview" onClick={() => proof.current?.scrollIntoView({ behavior: 'auto', block: 'start' })}>See your ad on the receipt ↑</button>
          <fieldset disabled={busy} className="shipped-ad-fields">
            <label htmlFor="sponsor-name">Brand or project name</label>
            <input id="sponsor-name" className="shipped-field" value={name} onChange={event => setName(event.target.value)} maxLength={limits.name} autoComplete="organization" placeholder="Your name on the paper" {...invalid('name')} />
            {fieldError('name')}
            <label htmlFor="sponsor-cta">One line <small>{cta.length}/{limits.cta}</small></label>
            <input id="sponsor-cta" className="shipped-field" value={cta} onChange={event => setCta(event.target.value)} maxLength={limits.cta} placeholder="Tell people what you make" {...invalid('cta')} />
            {fieldError('cta')}
            <label htmlFor="sponsor-url">Website for your QR code</label>
            <input id="sponsor-url" type="url" inputMode="url" className="shipped-field" value={url} onChange={event => setUrl(event.target.value)} maxLength={200} placeholder="https://your-site.com" {...invalid('url')} />
            <p className="shipped-ad-help">Your QR code is generated automatically.</p>{fieldError('url')}
            <label htmlFor="sponsor-logo">Upload logo <small>optional</small></label>
            <input id="sponsor-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} {...invalid('logo')} />
            <p className="shipped-ad-help">PNG, JPEG or WebP · up to 8 MB. Printed in black & white.</p>
            {preparing ? <p role="status">Preparing your logo…</p> : null}
            {logo ? <button type="button" className="shipped-ad-text-button" onClick={() => { setLogo(null); const input = document.getElementById('sponsor-logo') as HTMLInputElement | null; if (input) input.value = ''; }}>Remove logo</button> : null}
            {fieldError('logo')}
          </fieldset>
          <p className="shipped-ad-help">Your name and QR appear when payment is confirmed. Your logo appears after review.</p>
          <details className="shipped-ad-rules"><summary>How pricing & refunds work</summary><p>Every empty slot starts at $1. Once occupied, the next bid is at least $1 higher and at most $5 or 10% higher, whichever is larger. You cannot raise your own slot. Outbid? You receive a refund for the time you lose. A bid in the last {BID_RULES.antiSnipeMinutes} minutes extends that slot by {BID_RULES.antiSnipeMinutes} minutes. The final holder stays on the receipts.</p><p>{state ? `Slots close ${closingLabel(picked?.closesAt || state.event.closesAt)}.` : ''} No traffic or scans are promised.</p></details>
          {picked && picked.next !== picked.maxNext && !soldOut ? <fieldset className="shipped-ad-bids" disabled={busy}><legend>Choose your bid</legend>{[picked.next, picked.maxNext].map((value, index) => <label key={value}><input type="radio" name="bid" checked={bid === value} onChange={() => setCents(value)} />{index === 0 ? 'Lowest' : 'Highest'} {moneyShort(value)}</label>)}</fieldset> : null}
          <label className="shipped-ad-terms"><input type="checkbox" checked={terms} disabled={busy} onChange={event => { setTerms(event.target.checked); if (error?.field === 'terms') setError(null); }} /><span>I agree to the <a href="/terms/#sponsors" target="_blank" rel="noopener noreferrer">advertising rules and refunds</a>.</span></label>
          {fieldError('terms')}
          <HumanCheck ref={human} check={state?.generator.human ?? FALLBACK_HUMAN} onToken={receiveToken} />
          <button type="submit" className="shipped-button shipped-ad-checkout" disabled={busy || preparing || !open || soldOut} aria-busy={busy}>{busy ? 'Opening checkout…' : `Continue to checkout — ${money(bid)}`}</button>
          {fieldError('form')}
          {!open || soldOut ? <p role="status" className="shipped-ad-help">{!state ? 'Checking availability…' : block?.frozen ? 'These placements are final.' : soldOut ? 'This slot has reached its maximum bid.' : cooling ? 'This slot just changed hands. Available again in a moment.' : 'Advertising is closed right now.'}</p> : null}
          <p className="shipped-ad-help shipped-ad-payment-note">One payment, plus any applicable tax. Pay securely at checkout.</p>
          {payments?.provider === 'stripe' && !payments.live ? <p className="shipped-ad-help">Stripe test mode. No real money moves.</p> : null}
          {payments?.provider === 'sandbox' ? <p className="shipped-ad-help">Staging sandbox. No real money moves.</p> : null}
        </form>
      </div>
    </div>
  </div>;
}
