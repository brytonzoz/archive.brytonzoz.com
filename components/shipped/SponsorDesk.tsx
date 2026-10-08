'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ditherLogo, type DitheredLogo } from '../../lib/dither';
import { money } from '../../lib/shipped-receipt';
import { SPONSOR_CONFIG, SPONSOR_TIERS, priceCents, validateSponsor, type SponsorTier } from '../../lib/shipped-sponsors';
import { receiptDate } from '../../lib/shipped';
import { Line, Rule, Ticket } from './paper';
import { refreshShippedState, useShippedState } from './state';
import { Turnstile, type TurnstileHandle } from './Turnstile';

const TEXT_LABEL: Record<SponsorTier, string> = {
  name: 'NAME ON THE LINE',
  logo: 'NAME UNDER THE LOGO',
  header: 'PRESENTED BY …',
};

const ERRORS: Record<string, string> = {
  'sponsors-closed': 'Sponsor lines are closed right now.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'Too many tries. Try again in an hour.',
  'checkout-failed': 'Checkout didn’t open. Try again.',
};

type Bought = { status: string; text: string; totalCents: number | null; taxCents: number | null; receipt: string | null };

const BOUGHT: Record<string, string> = {
  pending: 'PAID. Your line joins the PAID FOR BY rotation as soon as Bryton approves it. If it isn’t approved, you’re refunded in full automatically.',
  printed: 'PAID AND APPROVED. Your line is in the PAID FOR BY rotation on shared receipts.',
  unpaid: 'Checkout didn’t finish, so nothing was charged.',
  closed: 'That checkout closed before it was paid. Nothing was charged.',
  refunded: 'This shout-out was refunded.',
  refunding: 'This shout-out is being refunded.',
};

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
  const [bought, setBought] = useState<Bought | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const result = query.get('sponsor');
    const checkout = query.get('checkout');
    if (result === 'cancelled') setNotice('Checkout cancelled. Nothing was charged.');
    if (result === 'paid' && checkout) {
      setNotice('Checking your payment…');
      fetch(`/api/shipped/sponsor/status?checkout=${encodeURIComponent(checkout)}`)
        .then((response) => (response.ok ? (response.json() as Promise<Bought>) : null))
        .then((line) => {
          setBought(line);
          setNotice(line ? (BOUGHT[line.status] ?? BOUGHT.closed) : 'Couldn’t find that checkout. If you paid, email the address on the refund policy.');
          refreshShippedState();
        })
        .catch(() => setNotice('Couldn’t check your payment. Reload to try again.'));
    } else if (result) refreshShippedState();
  }, []);

  useEffect(() => () => {
    if (logo) URL.revokeObjectURL(logo.url);
  }, [logo]);

  const offers = sponsors?.tiers ?? SPONSOR_TIERS.map((t) => ({ tier: t, ...SPONSOR_CONFIG.tiers[t], cents: priceCents(t), available: false }));
  const fmt = (n: number | undefined) => (n === undefined ? '······' : n.toLocaleString('en-US'));
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
    if (state?.generator.turnstileSiteKey && !token) return setError('One second, checking you’re human…');
    setBusy(true);
    const form = new FormData();
    form.set('tier', tier);
    form.set('text', check.text);
    if (check.url) form.set('url', check.url);
    if (offer.logo && logo) form.set('logo', logo.blob, 'logo.png');
    form.set('token', token ?? '');
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
    <Ticket id="sponsor" label="Buy a supporter shout-out">
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SUPPORTER DESK</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-none tracking-[0.2em]">SPONSOR THE RECEIPTS</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
          Your name or logo in the THIS RECEIPT PAID FOR BY block on the Shipped receipts people print and share, plus a downloadable
          supporter receipt.
        </p>
      </header>
      <div className="mt-3 space-y-1 text-[12px]">
        <Line label="RECEIPTS PRINTED SO FAR" value={fmt(state?.printed)} />
        <Line label="RECEIPTS SHARED SO FAR" value={fmt(state?.shared)} />
        <Line
          label="PRESENTED-BY SLOT"
          value={sponsors?.presentedNextOpen ? `TAKEN · OPENS ${receiptDate(new Date(sponsors.presentedNextOpen).toISOString())}` : 'OPEN'}
        />
      </div>
      <div className="mt-2">
        <Rule />
      </div>

      {notice ? (
        <div className="mt-3 border border-dashed border-[#1c1917]/50 p-2.5 text-[12px] leading-relaxed" role="status">
          <p className="font-semibold">{notice}</p>
          {bought?.receipt ? (
            <>
              {bought.totalCents !== null ? (
                <p className="mt-1 opacity-75">
                  Paid {money(bought.totalCents)}
                  {bought.taxCents ? `, including ${money(bought.taxCents)} tax` : ''}. Stripe emails the payment receipt.
                </p>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bought.receipt} alt={`Your supporter receipt for “${bought.text}”`} className="mx-auto mt-2 w-full max-w-[240px]" />
              <a href={bought.receipt} download="shipped-supporter-receipt.png" className="shipped-button mt-2 block w-full text-center">
                DOWNLOAD YOUR RECEIPT
              </a>
            </>
          ) : null}
        </div>
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
            {sponsors?.taxAtCheckout ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Plus sales tax where it applies, worked out at checkout. Paid securely with Stripe.</p>
            ) : null}
            {sponsors?.provider === 'stripe' && !sponsors.live ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Stripe test mode: use card 4242 4242 4242 4242. No real money moves.</p>
            ) : null}
            {sponsors?.provider === 'sandbox' ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Staging sandbox: checkout is a test page and no money moves.</p>
            ) : null}
          </>
        ) : (
          <p className="text-center text-[12.5px] font-semibold tracking-[0.12em]" role="status">
            {state === undefined ? '' : 'SHOUT-OUTS OPEN SOON.'}
          </p>
        )}
      </form>

      <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[#1c1917]/60">
        You’re buying a supporter shout-out: a place in the PAID FOR BY rotation on shared Shipped receipts (their pages and share
        images) for {SPONSOR_CONFIG.tiers.name.days} days, plus a downloadable receipt image. Not on Bryton’s own receipt. The counts above
        are what’s happened so far, not a promise: no traffic, clicks, views or impressions are guaranteed, and links are marked
        sponsored. Nothing runs until Bryton approves it; if it isn’t approved you’re refunded in full automatically.{' '}
        <Link href="/shipped/refunds/" className="shipped-link">
          Refund policy
        </Link>
      </p>
    </Ticket>
  );
}
