'use client';

// The sponsor sheet: ten fixed-price slots at the foot of every receipt. Pick a slot, see its one posted
// price, write a name and a line, add an https link (and maybe a logo), and pay that price to take it. The
// Worker sets every price and re-checks everything; the checks here are only there to answer as you type.
import React, { useEffect, useRef, useState } from 'react';
import { ditherLogo, type DitheredLogo } from '../../lib/dither';
import { closingLabel } from '../../lib/shipped-event';
import { money } from '../../lib/shipped-receipt';
import { BID_RULES, HERO_SLOT, limitsFor, slotLabel, validateBid } from '../../lib/shipped-sponsors';
import type { SponsorSlot } from '../../lib/shipped-year';
import { HumanCheck, type HumanCheckHandle } from './HumanCheck';
import { Line, Rule, Ticket } from './paper';
import { closeSponsor, openSponsor, useSponsorPick } from './sponsor-pick';
import { refreshShippedState, useShippedState } from './state';

const ERRORS: Record<string, string> = {
  'sponsors-closed': 'Sponsor slots are closed right now.',
  closed: 'The printer is off. The sponsor block is final.',
  locked: 'Slots stopped changing hands an hour before close.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'Too many tries. Try again in an hour.',
  'checkout-failed': 'Checkout didn’t open. Try again.',
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

export function SponsorDesk() {
  const state = useShippedState();
  const pick = useSponsorPick();
  const block = state?.sponsors;
  const payments = state?.payments;
  const [slot, setSlot] = useState(HERO_SLOT);
  const [name, setName] = useState('');
  const [cta, setCta] = useState('');
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState<DitheredLogo | null>(null);
  const [terms, setTerms] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const human = useRef<HumanCheckHandle>(null);

  useEffect(() => {
    if (pick.open) setSlot(pick.slot);
  }, [pick.open, pick.slot]);

  useEffect(() => {
    if (!pick.open) return;
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

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const checkout = query.get('bid');
    if (!checkout || !/^[A-Za-z0-9_-]{6,200}$/.test(checkout)) return;
    setNotice(TAKEN.checkout);
    openSponsor(HERO_SLOT);
    fetch(`/api/shipped/checkout?checkout=${encodeURIComponent(checkout)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<Taken>) : null))
      .then((taken) => {
        if (!taken || taken.kind !== 'bid') return setNotice('Couldn’t find that checkout. If you paid, email the address on the terms page.');
        const extra = taken.status === 'live' && taken.logoPending ? ' Your logo shows once it’s approved; your name prints until then.' : '';
        setNotice(`${slotLabel(taken.slot)} · ${taken.name} · ${money(taken.cents)}. ${TAKEN[taken.status] ?? TAKEN.failed}${extra}`);
        openSponsor(taken.slot);
        refreshShippedState();
      })
      .catch(() => setNotice('Couldn’t check your payment. Reload to try again.'));
  }, []);

  useEffect(
    () => () => {
      if (logo) URL.revokeObjectURL(logo.url);
    },
    [logo],
  );

  const slots = block?.slots ?? [];
  const picked: SponsorSlot | undefined = slots.find((s) => s.slot === slot);
  const limits = limitsFor(slot);
  const open = Boolean(payments?.open) && !block?.frozen;
  const soldOut = picked ? picked.next > BID_RULES.maxCents : false;

  async function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return setLogo(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8_000_000) return setError({ field: 'logo', message: 'Use a PNG, JPEG or WebP under 8 MB.' });
    try {
      setLogo(await ditherLogo(file));
    } catch {
      setError({ field: 'logo', message: 'Couldn’t print that logo. Try a simpler or smaller image.' });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!picked) return;
    setError(null);
    const check = validateBid({ slot, name, cta, url });
    if (!check.ok) return setError({ field: check.field, message: check.error });
    if (!terms) return setError({ field: 'terms', message: 'Please accept the sponsor terms.' });
    if (!token) return setError({ field: 'form', message: 'One second, checking you’re human…' });
    setBusy(true);
    const form = new FormData();
    form.set('slot', String(slot));
    form.set('name', check.name);
    form.set('cta', check.cta);
    form.set('url', check.url);
    form.set('cents', String(picked.next));
    form.set('terms', '1');
    form.set('token', token);
    if (logo) form.set('logo', logo.blob, 'logo.png');
    try {
      const response = await fetch('/api/shipped/bid', { method: 'POST', body: form });
      const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string; field?: string; message?: string; price?: number };
      if (response.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      if (result.error === 'price-changed') refreshShippedState();
      setError({ field: result.field ?? 'form', message: result.message ?? ERRORS[result.error ?? ''] ?? 'Something went wrong. Try again.' });
    } catch {
      setError({ field: 'form', message: 'Something went wrong. Try again.' });
    }
    human.current?.reset();
    setBusy(false);
  }

  const fieldError = (field: string) =>
    error?.field === field ? (
      <p className="mt-1 text-[11.5px] font-semibold" role="alert">
        {error.message}
      </p>
    ) : null;

  if (!pick.open) return null;

  return (
    <div className="shipped-sheet" role="dialog" aria-modal="true" aria-labelledby="sponsor-sheet-title">
      <button type="button" className="shipped-sheet-backdrop" aria-label="Close sponsor desk" onClick={closeSponsor} />
      <Ticket id="sponsor" label="Sponsor a slot" className="shipped-sheet-ticket">
      <header className="text-center">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SPONSOR DESK</p>
          <button type="button" className="text-[11px] font-semibold tracking-[0.16em] underline underline-offset-4" onClick={closeSponsor}>
            CLOSE
          </button>
        </div>
        <h2 id="sponsor-sheet-title" className="mt-2 text-[20px] font-semibold leading-none tracking-[0.2em]">TAKE A SLOT</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
          Ten slots at the foot of every receipt, share image and mailed print, each with its own QR code. One fixed price per slot:
          what the holder paid plus {money(BID_RULES.incrementCents)}. Pay it and the slot is yours until someone pays the next price.
          Taken over? You’re refunded for the time you lose. At close, whoever holds a slot keeps it forever.
        </p>
      </header>
      <div className="mt-3 space-y-1 text-[12px]">
        <Line label="RECEIPTS PRINTED SO FAR" value={state ? state.printed.toLocaleString('en-US') : '······'} />
        <Line label="SLOTS FREEZE" value={state ? closingLabel(state.event.closesAt - BID_RULES.lockMinutes * 60_000) : '······'} />
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
          <legend className="text-[11px] font-semibold tracking-[0.16em]">PICK A SLOT</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {slots.map((s) => (
              <label key={s.slot} className={`shipped-choice block text-left ${s.slot === HERO_SLOT ? 'col-span-2' : ''} ${slot === s.slot ? 'is-on' : ''}`}>
                <input type="radio" name="slot" value={s.slot} checked={slot === s.slot} onChange={() => setSlot(s.slot)} className="sr-only" />
                <span className="shipped-lead text-[12px] font-semibold tracking-[0.1em]">
                  <span>{slotLabel(s.slot)}</span>
                  <span className="shipped-lead-fill" aria-hidden="true" />
                  <span className="tabular-nums">{s.next > BID_RULES.maxCents ? 'MAXED' : money(s.next)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] opacity-70">{s.house ? 'House ad · open' : `Held by ${s.name}`}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {open && picked ? (
          <>
            <div>
              <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-name">
                NAME
              </label>
              <input
                id="sponsor-name"
                className="shipped-field mt-1 w-full px-2.5 py-2 text-[15px] outline-none"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={limits.name}
                autoComplete="organization"
              />
              <p className="mt-1 text-right text-[10.5px] text-[#1c1917]/60">
                {name.trim().length}/{limits.name}
              </p>
              {fieldError('name')}
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-cta">
                ONE LINE <span className="font-normal opacity-60">(no links)</span>
              </label>
              <input
                id="sponsor-cta"
                className="shipped-field mt-1 w-full px-2.5 py-2 text-[14px] outline-none"
                value={cta}
                onChange={(event) => setCta(event.target.value)}
                maxLength={limits.cta}
                autoComplete="off"
              />
              <p className="mt-1 text-right text-[10.5px] text-[#1c1917]/60">
                {cta.trim().length}/{limits.cta}
              </p>
              {fieldError('cta')}
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-url">
                LINK <span className="font-normal opacity-60">(https, your own site)</span>
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
              {fieldError('url')}
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="sponsor-logo">
                LOGO <span className="font-normal opacity-60">(optional, 1-bit, shown after review)</span>
              </label>
              <input id="sponsor-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} className="mt-1 block w-full text-[12px]" />
              {logo ? (
                <div className="mt-2 flex justify-center border border-dashed border-[#1c1917]/30 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo.url} width={logo.width} height={logo.height} alt="Your logo as it will print" className="shipped-logo max-h-16 w-auto" />
                </div>
              ) : null}
              {fieldError('logo')}
            </div>

            <label className="flex items-start gap-2 text-[11.5px] leading-snug">
              <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-0.5" />
              <span>
                I’ve read the{' '}
                <a href="/terms/#sponsors" className="shipped-link" target="_blank" rel="noopener noreferrer">
                  sponsor rules and refunds
                </a>
                . No traffic or scans are promised.
              </span>
            </label>
            {fieldError('terms')}

            <HumanCheck ref={human} check={state?.generator.human} onToken={setToken} />

            <button type="submit" className="shipped-button w-full" disabled={busy || soldOut}>
              {busy ? 'OPENING CHECKOUT…' : soldOut ? 'THIS SLOT IS MAXED' : `TAKE ${slotLabel(slot)} · ${money(picked.next)}`}
            </button>
            {fieldError('form')}
            <p className="text-center text-[11px] text-[#1c1917]/65">Plus sales tax where it applies, worked out at checkout. Paid securely with Stripe.</p>
            {payments?.provider === 'stripe' && !payments.live ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Stripe test mode: use card 4242 4242 4242 4242. No real money moves.</p>
            ) : null}
            {payments?.provider === 'sandbox' ? <p className="text-center text-[11px] text-[#1c1917]/65">Staging sandbox: checkout is a test page and no money moves.</p> : null}
          </>
        ) : (
          <p className="text-center text-[12.5px] font-semibold tracking-[0.12em]" role="status">
            {state === undefined ? '' : block?.frozen || state?.event.phase === 'closed' ? 'THE SPONSOR BLOCK IS FINAL.' : 'SLOTS ARE CLOSED RIGHT NOW.'}
          </p>
        )}
      </form>
    </Ticket>
    </div>
  );
}
