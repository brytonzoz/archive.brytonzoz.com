'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ditherLogo, type DitheredLogo } from '../../lib/dither';
import { money } from '../../lib/shipped-receipt';
import { SPONSOR_CONFIG, SPONSOR_TIERS, priceCents, validateSponsor, type SponsorTier } from '../../lib/shipped-sponsors';
import { Line, Rule, Ticket } from './paper';
import { refreshShippedState, useShippedState } from './state';
import { Turnstile, type TurnstileHandle } from './Turnstile';

const TEXT_LABEL: Record<SponsorTier, string> = {
  name: 'NAME ON THE LINE',
  logo: 'NAME BESIDE THE LOGO',
  header: 'SPONSORED BY',
};

const ERRORS: Record<string, string> = {
  'sponsors-closed': 'Sponsor lines are closed right now.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'Too many tries. Try again in an hour.',
  'checkout-failed': 'Checkout didn’t open. Try again.',
};

const pad = (n: number) => String(n).padStart(3, '0');

export function SponsorDesk() {
  const state = useShippedState();
  const sponsors = state?.sponsors;
  const [tier, setTier] = useState<SponsorTier>('name');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState<DitheredLogo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('sponsor');
    if (result === 'paid') setNotice('PAID. Your line prints as soon as Bryton approves it. If it isn’t approved, you’re refunded in full automatically.');
    if (result === 'cancelled') setNotice('Checkout cancelled. Nothing was charged.');
    if (result) refreshShippedState();
  }, []);

  useEffect(() => () => {
    if (logo) URL.revokeObjectURL(logo.url);
  }, [logo]);

  const roll = sponsors?.roll ?? 1;
  const offers = sponsors?.tiers ?? SPONSOR_TIERS.map((t) => ({ tier: t, ...SPONSOR_CONFIG.tiers[t], cents: priceCents(t, roll), available: false }));
  const offer = offers.find((o) => o.tier === tier) ?? offers[0];
  const open = Boolean(sponsors?.open);

  async function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return setLogo(null);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 8_000_000) return setError('Use a PNG, JPEG or WebP under 8 MB.');
    try {
      setLogo(await ditherLogo(file));
    } catch {
      setError('Couldn’t print that logo. Try a simpler or smaller image.');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const check = validateSponsor({ tier, text, url: offer.url ? url : null });
    if (!check.ok) return setError(check.error);
    if (offer.logo && !logo) return setError('Add a logo.');
    if (!token) return setError('One second, checking you’re human…');
    setBusy(true);
    const form = new FormData();
    form.set('tier', tier);
    form.set('text', check.text);
    if (check.url) form.set('url', check.url);
    if (offer.logo && logo) form.set('logo', logo.blob, 'logo.png');
    form.set('token', token);
    try {
      const response = await fetch('/api/shipped/sponsor', { method: 'POST', body: form });
      const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (response.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      setError(result.message ?? ERRORS[result.error ?? ''] ?? 'Something went wrong. Try again.');
    } catch {
      setError('Something went wrong. Try again.');
    }
    turnstile.current?.reset();
    setBusy(false);
  }

  return (
    <Ticket id="sponsor" label="Sponsor a line">
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SPONSOR DESK</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-none tracking-[0.2em]">BUY A LINE</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
          A printed line on this receipt, or a placement on every receipt people print here.
        </p>
      </header>
      <div className="mt-3 space-y-1 text-[12px]">
        <Line label={`ROLL ${pad(roll)}`} value={`${sponsors?.filled ?? 0}/${sponsors?.rollSize ?? SPONSOR_CONFIG.rollSize} LINES`} />
        <Line label="HEADER SLOTS LEFT" value={`${sponsors?.headerSlotsLeft ?? SPONSOR_CONFIG.headerSlots}/${SPONSOR_CONFIG.headerSlots}`} />
      </div>
      <div className="mt-2">
        <Rule />
      </div>

      {notice ? (
        <p className="mt-3 border border-dashed border-[#1c1917]/50 p-2.5 text-[12px] font-semibold leading-relaxed" role="status">
          {notice}
        </p>
      ) : null}

      <form className="mt-3 space-y-3" onSubmit={submit} noValidate>
        <fieldset>
          <legend className="sr-only">Line</legend>
          <div className="space-y-2">
            {offers.map((o) => (
              <label key={o.tier} className={`shipped-choice block text-left ${tier === o.tier ? 'is-on' : ''} ${o.available || !open ? '' : 'opacity-50'}`}>
                <input type="radio" name="tier" value={o.tier} checked={tier === o.tier} onChange={() => setTier(o.tier)} className="sr-only" disabled={open && !o.available} />
                <span className="shipped-lead text-[13px] font-semibold tracking-[0.14em]">
                  <span>{o.label}</span>
                  <span className="shipped-lead-fill" aria-hidden="true" />
                  <span className="tabular-nums">{money(o.cents)}</span>
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug opacity-75">
                  {o.blurb}
                  {open && !o.available ? ' Full right now.' : ''}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {open ? (
          <>
            <div>
              <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-text">
                {TEXT_LABEL[tier]}
              </label>
              <input
                id="sponsor-text"
                className="shipped-field mt-1 w-full px-2.5 py-2 text-[15px] outline-none"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={offer.maxText}
                autoComplete="off"
              />
              <p className="mt-1 text-right text-[10.5px] text-[#1c1917]/60">
                {text.trim().length}/{offer.maxText}
                {offer.url ? '' : ' · no links'}
              </p>
            </div>

            {offer.url ? (
              <div>
                <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-url">
                  LINK <span className="font-normal opacity-60">(optional, https://)</span>
                </label>
                <input
                  id="sponsor-url"
                  type="url"
                  inputMode="url"
                  className="shipped-field mt-1 w-full px-2.5 py-2 text-[14px] outline-none"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://"
                  maxLength={200}
                />
              </div>
            ) : null}

            {offer.logo ? (
              <div>
                <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-logo">
                  LOGO <span className="font-normal opacity-60">(printed in 1-bit)</span>
                </label>
                <input id="sponsor-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} className="mt-1 block w-full text-[12px]" />
                {logo ? (
                  <div className="mt-2 flex justify-center border border-dashed border-[#1c1917]/30 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo.url} width={logo.width} height={logo.height} alt="Your logo as it will print" className="shipped-logo max-h-20 w-auto" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {state?.generator.turnstileSiteKey ? <Turnstile ref={turnstile} siteKey={state.generator.turnstileSiteKey} onToken={setToken} /> : null}

            <button type="submit" className="shipped-button w-full" disabled={busy || !offer.available}>
              {busy ? 'OPENING CHECKOUT…' : `CHECKOUT · ${money(offer.cents)}`}
            </button>
            {error ? (
              <p className="text-center text-[12px] font-semibold" role="alert">
                {error}
              </p>
            ) : null}
            {sponsors?.provider === 'sandbox' ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Staging sandbox: checkout is a test page and no money moves.</p>
            ) : null}
          </>
        ) : (
          <p className="text-center text-[12.5px] font-semibold tracking-[0.12em]" role="status">
            {state === undefined ? '' : 'SPONSOR LINES OPEN SOON.'}
          </p>
        )}
      </form>

      <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[#1c1917]/60">
        You’re buying a printed line or placement, not a donation. Nothing prints until Bryton approves it; if it isn’t approved
        you’re refunded automatically. Prices step up with every roll of {SPONSOR_CONFIG.rollSize}.{' '}
        <Link href="/shipped/refunds/" className="shipped-link">
          Refund policy
        </Link>
      </p>
    </Ticket>
  );
}
