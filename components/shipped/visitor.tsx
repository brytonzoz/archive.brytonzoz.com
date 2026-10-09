'use client';

// A visitor's printed receipt, and what to do next with it: share it, get it mailed, or take it down.
import React, { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { receiptDate } from '../../lib/shipped';
import { money } from '../../lib/shipped-receipt';
import { isFirstRun, itemsForPrint, pickDeepCut, receiptBadges, receiptModules } from '../../lib/shipped-modules';
import {
  CARD_PATH,
  RECEIPT_PATH,
  ROLLO_PATH,
  TALL_PATH,
  itemDate,
  itemsShipped,
  receiptNumber,
  shareText,
  subjectLabel,
  type SponsorBlock,
  type YearReceipt as Printed,
} from '../../lib/shipped-year';
import { HumanCheck, type HumanCheckHandle } from './HumanCheck';
import { refreshShippedState, useShippedState } from './state';
import { YearReceipt } from './YearReceipt';

export type Loaded = { receipt: Printed; sponsors: SponsorBlock };

const KICKER: Record<Printed['subject']['kind'], string> = {
  github: 'GITHUB',
  x: 'X / TWITTER',
  domain: 'WEBSITE',
  name: 'NAME',
};

/** The token that proves this browser printed the receipt (it can toss it on the pile or remove it). */
const pileKey = (id: number) => `shipped:pile:${id}`;
export function rememberPile(id: number, token: string | undefined) {
  if (!token) return;
  try {
    localStorage.setItem(pileKey(id), token);
  } catch {
    // Private mode: the printer just can't self-remove later.
  }
}
export function pileTokenFor(id: number): string | null {
  try {
    return localStorage.getItem(pileKey(id));
  } catch {
    return null;
  }
}

export function VisitorReceipt({ receipt, sponsors }: Loaded) {
  const who = subjectLabel(receipt.subject);
  const kicker = receipt.subject.kind === 'github' && receipt.subject.display !== who ? `@${receipt.subject.id} · GITHUB` : KICKER[receipt.subject.kind];
  const ordered = itemsForPrint(receipt.potential ? [] : receipt.items);
  const cut = pickDeepCut(ordered);
  const modules = receiptModules({ receipt });
  const badges = receiptBadges(modules);
  return (
    <YearReceipt
      year={receipt.year}
      who={receipt.subject.kind === 'github' ? receipt.subject.display : who}
      kicker={kicker}
      date={receiptDate(receipt.printedAt)}
      number={receiptNumber(receipt.id)}
      items={(receipt.potential ? receipt.items : ordered).map((item, i) => ({
        key: `${i}-${item.name}`,
        name: item.name,
        status: item.status,
        date: itemDate(item.date),
        description: item.description,
        href: item.link,
        logo: item.logo ? { src: item.logo, width: 24, height: 24 } : null,
      }))}
      count={itemsShipped(receipt)}
      note={receipt.note}
      sponsors={sponsors}
      barcode={`SH${receiptNumber(receipt.id)}`}
      deepCut={cut ? { name: cut.name, why: `Sourced from ${cut.source}` } : null}
      badges={badges}
      firstRun={isFirstRun(receipt.id)}
      modules={modules.map((band) => ({ id: band.id, title: band.title, lines: band.lines }))}
      shipScore={receipt.shipScore}
      fine={
        <>
          <p>
            Made from public pages and APIs
            {receipt.demo ? ' (demo print: no AI on this server)' : ', itemized by AI'}. Every item links to its public source. Only public,
            professional work. Wrong? Remove or correct it.
          </p>
          <p className="mt-2 space-x-3">
            <a href={`/remove/?id=${receipt.id}`} className="shipped-link">
              Report, remove or correct
            </a>
            <a href="/#print" className="shipped-link">
              Print a friend&apos;s
            </a>
            <a href="/#sponsor" className="shipped-link">
              Sponsor a slot
            </a>
          </p>
        </>
      }
    />
  );
}

function beacon(id: number, how: string) {
  const body = new Blob([JSON.stringify({ id, how })], {
    type: 'application/json',
  });
  if (!navigator.sendBeacon?.('/api/shipped/shared', body))
    fetch('/api/shipped/shared', {
      method: 'POST',
      body,
      keepalive: true,
    }).catch(() => undefined);
  track({ type: 'share', release: 'shipped', detail: how });
}

const ORDER_ERRORS: Record<string, string> = {
  'orders-closed': 'Mailed prints are off right now.',
  closed: 'The printer is off for good. Prints are closed.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'Too many tries. Try again later.',
};

/** $5: this receipt on real thermal paper, mailed (US only). Stripe collects the address and the tax. */
function MailedPrint({ receipt }: { receipt: Printed }) {
  const state = useShippedState();
  const human = useRef<HumanCheckHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payments = state?.payments;
  if (!payments?.prints) return null;

  async function order() {
    if (!token) {
      setAsked(true);
      return setError('One second, checking you’re human…');
    }
    setBusy(true);
    setError(null);
    const response = await fetch('/api/shipped/print-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: receipt.id, token }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (response?.ok && result?.url) {
      track({ type: 'open', release: 'shipped', detail: 'print-order' });
      window.location.assign(result.url);
      return;
    }
    setError(ORDER_ERRORS[result?.error ?? ''] ?? 'Checkout didn’t open. Try again.');
    human.current?.reset();
    setBusy(false);
  }

  return (
    <div className="mt-3 text-center">
      <button type="button" className="shipped-button is-ghost w-full" onClick={order} disabled={busy}>
        {busy ? 'OPENING CHECKOUT…' : `MAIL ME THE REAL PRINT · ${money(payments.printCents)}`}
      </button>
      <p className="mt-1 text-[11px] text-[#f3ead8]/55">
        80mm thermal paper, mailed in the US. Shipping included, tax at checkout.{' '}
        <a href="/terms/#prints" className="underline">
          Terms
        </a>
      </p>
      <HumanCheck ref={human} check={state?.generator.human} onToken={setToken} theme="dark" appearance={asked ? 'always' : 'interaction-only'} />
      {error ? (
        <p className="mt-1 text-[12px] font-semibold text-[#f3ead8]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The browser that printed a receipt can take it down at once (no review, nothing else blocked). */
function RemoveMine({ receipt, onRemoved }: { receipt: Printed; onRemoved?: () => void }) {
  const [pile, setPile] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => setPile(pileTokenFor(receipt.id)), [receipt.id]);
  if (!pile) return null;
  if (state === 'done') {
    return (
      <p className="mt-2 text-center text-[11px] text-[#f3ead8]/70" role="status">
        Removed. Its page and images are gone.
      </p>
    );
  }
  async function remove() {
    setState('busy');
    const response = await fetch('/api/shipped/takedown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: receipt.id, pile }),
    }).catch(() => null);
    if (response?.ok) {
      setState('done');
      refreshShippedState();
      onRemoved?.();
    } else setState('error');
  }
  return (
    <p className="mt-2 text-center text-[11px] text-[#f3ead8]/55">
      {state === 'confirm' || state === 'busy' ? (
        <>
          Take it down for good?{' '}
          <button type="button" className="underline" onClick={remove} disabled={state === 'busy'}>
            Yes, remove it
          </button>{' '}
          ·{' '}
          <button type="button" className="underline" onClick={() => setState('idle')}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className="underline" onClick={() => setState('confirm')}>
          {state === 'error' ? 'Couldn’t remove it. Try again' : 'Remove my receipt'}
        </button>
      )}
    </p>
  );
}

/** Sharing is the obvious next step: one-tap image share, then X, save and copy-link. */
export function ShareBar({ receipt, onRemoved }: { receipt: Printed; onRemoved?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const url = typeof window === 'undefined' ? RECEIPT_PATH(receipt.id) : new URL(RECEIPT_PATH(receipt.id), window.location.origin).toString();
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(shareText(receipt))}&url=${encodeURIComponent(url)}`;

  async function shareImage() {
    setSharing(true);
    try {
      const imageUrl = new URL(`${TALL_PATH(receipt.id)}?download=1`, window.location.origin).toString();
      const blob = await fetch(imageUrl).then((response) => (response.ok ? response.blob() : null));
      const file = blob ? new File([blob], `shipped-${receipt.year}-${receiptNumber(receipt.id)}.png`, { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText(receipt), url });
        beacon(receipt.id, 'share');
        return;
      }
      if (navigator.share) {
        await navigator.share({ text: shareText(receipt), url });
        beacon(receipt.id, 'share');
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      beacon(receipt.id, 'copy');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="shipped-share" role="group" aria-label="Share your receipt">
      <button type="button" className="shipped-button is-big" onClick={shareImage} disabled={sharing}>
        {sharing ? 'SHARING…' : 'SHARE IMAGE'}
      </button>
      <a href={intent} target="_blank" rel="noopener noreferrer" className="shipped-button is-ghost" onClick={() => beacon(receipt.id, 'x')}>
        POST TO X
      </a>
      <div className="shipped-share-row">
        <a href={`${CARD_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save the share card image" onClick={() => beacon(receipt.id, 'card')}>
          SAVE CARD
        </a>
        <a href={`${TALL_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save the full receipt image" onClick={() => beacon(receipt.id, 'tall')}>
          SAVE FULL
        </a>
        <a href={`${ROLLO_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save a 4-inch Rollo print" onClick={() => beacon(receipt.id, 'rollo')}>
          4-IN ROLLO
        </a>
        <button
          type="button"
          className="shipped-button is-ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt('Copy this link', url);
            }
            beacon(receipt.id, 'copy');
          }}
        >
          {copied ? 'COPIED' : 'COPY LINK'}
        </button>
      </div>
      <MailedPrint receipt={receipt} />
      <RemoveMine receipt={receipt} onRemoved={onRemoved} />
    </div>
  );
}

type OrderStatus = { kind: 'print'; status: string; city: string | null; state: string | null };

const ORDER_STATUS: Record<string, string> = {
  to_print: 'Paid. Your receipt goes on the printer and in the mail within a week.',
  shipped: 'Your print is in the mail.',
  refunded: 'This print order was refunded in full.',
  checkout: 'Checking your payment…',
  failed: 'That checkout closed before it was paid. Nothing was charged.',
};

/** /r/<id>/?order=<checkout>: back from the $5 print checkout. */
export function OrderNotice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('order');
    if (!checkout || !/^[A-Za-z0-9_-]{6,200}$/.test(checkout)) return;
    setMessage(ORDER_STATUS.checkout);
    fetch(`/api/shipped/checkout?checkout=${encodeURIComponent(checkout)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<OrderStatus>) : null))
      .then((order) => {
        if (!order || order.kind !== 'print') return setMessage('Couldn’t find that order. If you paid, email the address on the terms page.');
        const where = order.city && order.state ? ` Shipping to ${order.city}, ${order.state}.` : '';
        setMessage((ORDER_STATUS[order.status] ?? ORDER_STATUS.failed) + (order.status === 'to_print' ? where : ''));
      })
      .catch(() => setMessage('Couldn’t check your payment. Reload to try again.'));
  }, []);
  if (!message) return null;
  return (
    <p className="mx-auto mb-4 max-w-md border border-dashed border-[#f3ead8]/40 p-3 text-center text-[12.5px] text-[#f3ead8]" role="status">
      {message}
    </p>
  );
}
