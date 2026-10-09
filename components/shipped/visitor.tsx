'use client';

// A visitor's printed receipt, and what to do next with it: share it, get it mailed, or take it down.
import React, { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { receiptDate } from '../../lib/shipped';
import { money } from '../../lib/shipped-receipt';
import { isFirstRun } from '../../lib/shipped-modules';
import {
  RECEIPT_PATH,
  ROLLO_PATH,
  SHIPPED_URL,
  TALL_PATH,
  itemDate,
  itemsShipped,
  receiptNumber,
  shareText,
  subjectLabel,
  type SponsorBlock,
  type YearReceipt as Printed,
} from '../../lib/shipped-year';
import { press, tap } from './feel';
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
  return (
    <YearReceipt
      year={receipt.year}
      who={receipt.subject.kind === 'github' ? receipt.subject.display : who}
      kicker={kicker}
      date={receiptDate(receipt.printedAt)}
      number={receiptNumber(receipt.id)}
      printedAt={receipt.printedAt}
      items={receipt.items.map((item, i) => ({
        key: `${i}-${item.name}`,
        name: item.name,
        status: item.status,
        date: itemDate(item.date),
        description: item.description,
        href: item.link,
        logo: item.logo ? { src: item.logo, width: 24, height: 24 } : null,
        via: item.via ?? null,
        confidence: item.confidence,
        significance: item.significance,
      }))}
      count={itemsShipped(receipt)}
      note={receipt.note}
      sponsors={sponsors}
      barcode={`SH${receiptNumber(receipt.id)}`}
      firstRun={isFirstRun(receipt.id)}
      shipScore={receipt.shipScore}
      full={receipt.full}
      teaser={receipt.full ? null : receipt.upgrade?.teaser ?? null}
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
  'already-full': 'This receipt already ran the full pass.',
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

  // Stripe is a same-tab navigation. Coming back (bfcache, tab restore, or a hung request)
  // must never leave MAIL ME stuck as OPENING CHECKOUT….
  useEffect(() => {
    const reset = () => {
      setBusy(false);
      setAsked(false);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') reset();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setAsked(false);
    }, 14_000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  if (!payments?.prints) return null;

  async function order() {
    setBusy(true);
    setError(null);
    const humanToken = token ?? (await human.current?.execute()) ?? null;
    if (!humanToken) {
      setBusy(false);
      setAsked(true);
      return setError(ORDER_ERRORS.turnstile);
    }
    const response = await fetch('/api/shipped/print-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: receipt.id, token: humanToken }),
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
      <button
        type="button"
        className={`shipped-button is-ghost w-full${busy ? ' is-busy' : ''}`}
        onPointerDown={press}
        onClick={() => void order()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'OPENING CHECKOUT…' : `MAIL ME THE REAL PRINT · ${money(payments.printCents)}`}
      </button>
      <p className="mt-1 text-[11px] text-[#f3ead8]/55">
        80mm thermal paper, mailed in the US. Shipping included, tax at checkout.{' '}
        <a href="/terms/#prints" className="underline">
          Terms
        </a>
      </p>
      <HumanCheck ref={human} check={state?.generator.human} onToken={setToken} theme="dark" appearance={asked ? 'always' : 'execute'} />
      {error ? (
        <p className="mt-1 text-[12px] font-semibold text-[#f3ead8]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** $3 full receipt or $7 bundle. Same checkout pattern as the mailed print. */
function UpgradePay({ receipt, kind }: { receipt: Printed; kind: 'full' | 'bundle' }) {
  const state = useShippedState();
  const human = useRef<HumanCheckHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payments = state?.payments;
  const cents = kind === 'bundle' ? payments?.bundleCents ?? 700 : payments?.fullCents ?? 300;

  useEffect(() => {
    const reset = () => {
      setBusy(false);
      setAsked(false);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (!payments?.prints || receipt.full) return null;

  async function order() {
    setBusy(true);
    setError(null);
    const humanToken = token ?? (await human.current?.execute()) ?? null;
    if (!humanToken) {
      setBusy(false);
      setAsked(true);
      return setError(ORDER_ERRORS.turnstile);
    }
    const response = await fetch('/api/shipped/upgrade', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: receipt.id, kind, token: humanToken }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (response?.ok && result?.url) {
      track({ type: 'open', release: 'shipped', detail: `upgrade-${kind}` });
      window.location.assign(result.url);
      return;
    }
    setError(ORDER_ERRORS[result?.error ?? ''] ?? 'Checkout didn’t open. Try again.');
    human.current?.reset();
    setBusy(false);
  }

  return (
    <div className="mt-3 text-center">
      <button
        type="button"
        className={`shipped-button ${kind === 'full' ? '' : 'is-ghost'} w-full${busy ? ' is-busy' : ''}`}
        onPointerDown={press}
        onClick={() => void order()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'OPENING CHECKOUT…' : kind === 'bundle' ? `FULL + MAILED PRINT · ${money(cents)}` : `FULL RECEIPT · ${money(cents)}`}
      </button>
      {kind === 'full' ? (
        <p className="mt-1 text-[11px] text-[#f3ead8]/55">Deep pass: more X posts, company harvest, extra web. Tax at checkout.</p>
      ) : null}
      <HumanCheck ref={human} check={state?.generator.human} onToken={setToken} theme="dark" appearance={asked ? 'always' : 'execute'} />
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

/** Sharing is the obvious next step: one-tap image share, then X, copy and mail. */
function pageUrl(id: number): string {
  const path = RECEIPT_PATH(id);
  return typeof window === 'undefined' ? `${SHIPPED_URL}${path}` : `${window.location.origin}${path}`;
}

/** Floating pill after a print. Collapsed it never covers the tape; open it is a compact action card. */
export function SharePill({
  receipt,
  onPrintAnother,
  onRemoved,
}: {
  receipt: Printed;
  onPrintAnother: () => void;
  onRemoved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; last: number; vy: number } | null>(null);
  const path = RECEIPT_PATH(receipt.id);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const intent = origin
    ? `https://x.com/intent/post?text=${encodeURIComponent(shareText(receipt))}&url=${encodeURIComponent(`${origin}${path}`)}`
    : `https://x.com/intent/post?text=${encodeURIComponent(shareText(receipt))}`;

  const close = () => {
    setOpen(false);
    if (panel.current) panel.current.style.transform = '';
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function shareImage() {
    setSharing(true);
    const link = pageUrl(receipt.id);
    try {
      const imageUrl = new URL(`${TALL_PATH(receipt.id)}?download=1`, window.location.origin).toString();
      const blob = await fetch(imageUrl).then((response) => (response.ok ? response.blob() : null));
      const file = blob ? new File([blob], `shipped-${receipt.year}-${receiptNumber(receipt.id)}.png`, { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText(receipt), url: link });
        beacon(receipt.id, 'share');
        return;
      }
      if (navigator.share) {
        await navigator.share({ text: shareText(receipt), url: link });
        beacon(receipt.id, 'share');
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      beacon(receipt.id, 'copy');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    } finally {
      setSharing(false);
    }
  }

  async function copyLink() {
    const link = pageUrl(receipt.id);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      tap(12);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
    beacon(receipt.id, 'copy');
  }

  function onHandleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!open || event.button > 0) return;
    drag.current = { y: event.clientY, last: event.clientY, vy: 0 };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onHandleMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !panel.current) return;
    const y = event.clientY;
    d.vy = y - d.last;
    d.last = y;
    const dy = Math.max(0, y - d.y);
    panel.current.style.transform = `translate3d(0, ${dy}px, 0)`;
  }

  function onHandleUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    const dy = Math.max(0, d.last - d.y);
    if (dy > 56 || d.vy > 10) {
      close();
      return;
    }
    panel.current.style.transform = '';
  }

  return (
    <div className={`shipped-pill-root${open ? ' is-open' : ''}`}>
      {open ? <button type="button" className="shipped-pill-scrim" aria-label="Close share" onClick={close} /> : null}
      <div className="shipped-pill-slot">
        <button type="button" className="shipped-print-another" onPointerDown={press} onClick={onPrintAnother}>
          Print another
        </button>
        <div
          ref={panel}
          className={`shipped-pill${open ? ' is-open' : ''}`}
          role={open ? 'dialog' : 'group'}
          aria-label={open ? 'Share your receipt' : undefined}
        >
          {open ? (
            <>
              <div
                className="shipped-pill-handle"
                aria-hidden="true"
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              />
              <div className="shipped-pill-head">
                <p className="shipped-pill-kicker">Share</p>
                <button type="button" className="shipped-pill-x" aria-label="Close" onPointerDown={press} onClick={close}>
                  ×
                </button>
              </div>
              <div className="shipped-share">
                <button type="button" className="shipped-button is-big" onPointerDown={press} onClick={shareImage} disabled={sharing}>
                  {sharing ? 'SHARING…' : 'SHARE IMAGE'}
                </button>
                <a href={intent} target="_blank" rel="noopener noreferrer" className="shipped-button is-ghost" onPointerDown={press} onClick={() => beacon(receipt.id, 'x')}>
                  POST TO X
                </a>
                <div className="shipped-share-row">
                  <button type="button" className={`shipped-button is-ghost${copied ? ' is-copied' : ''}`} onPointerDown={press} onClick={() => void copyLink()}>
                    {copied ? 'COPIED' : 'COPY LINK'}
                  </button>
                  <a href={`${ROLLO_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save a 4-inch Rollo PDF" onClick={() => beacon(receipt.id, 'rollo')}>
                    4-IN ROLLO
                  </a>
                </div>
                {receipt.full ? (
                  <p className="mt-2 text-center text-[11px] font-semibold tracking-[0.18em]" style={{ color: '#c9a227' }}>
                    VERIFIED FULL RUN
                  </p>
                ) : (
                  <>
                    <UpgradePay receipt={receipt} kind="full" />
                    <UpgradePay receipt={receipt} kind="bundle" />
                  </>
                )}
                <MailedPrint receipt={receipt} />
                <RemoveMine receipt={receipt} onRemoved={onRemoved} />
              </div>
            </>
          ) : (
            <button type="button" className="shipped-pill-hit" onPointerDown={press} onClick={() => setOpen(true)}>
              <span aria-hidden="true">↗</span> {receipt.full ? 'Share · FULL' : 'Share · full $3'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type OrderStatus = {
  kind: 'print' | 'full' | 'bundle' | 'bid';
  sale?: string;
  status: string;
  city: string | null;
  state: string | null;
  full?: boolean;
  upgrading?: boolean;
};

const ORDER_STATUS: Record<string, string> = {
  to_print: 'Paid. Your receipt goes on the printer and in the mail within a week.',
  paid: 'Paid. The full receipt is reprinting now — reload in a minute.',
  shipped: 'Your print is in the mail.',
  refunded: 'This order was refunded in full.',
  checkout: 'Checking your payment…',
  failed: 'That checkout closed before it was paid. Nothing was charged.',
};

/** /r/<id>/?order=<checkout>: back from print / full / bundle checkout. */
export function OrderNotice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('order');
    if (!checkout || !/^[A-Za-z0-9_-]{6,200}$/.test(checkout)) return;
    setMessage(ORDER_STATUS.checkout);
    fetch(`/api/shipped/checkout?checkout=${encodeURIComponent(checkout)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<OrderStatus>) : null))
      .then((order) => {
        if (!order || order.kind === 'bid') return setMessage('Couldn’t find that order. If you paid, email the address on the terms page.');
        const where = order.city && order.state ? ` Shipping to ${order.city}, ${order.state}.` : '';
        if (order.kind === 'full' || order.sale === 'full') {
          if (order.full) return setMessage('Paid. This is the verified full run.');
          if (order.status === 'paid' || order.upgrading) return setMessage(ORDER_STATUS.paid);
        }
        if (order.kind === 'bundle' || order.sale === 'bundle') {
          const reprint = order.full ? ' The full tape is ready.' : order.upgrading || order.status === 'to_print' ? ' The full tape is reprinting now.' : '';
          return setMessage((ORDER_STATUS[order.status] ?? ORDER_STATUS.failed) + (order.status === 'to_print' ? where : '') + reprint);
        }
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
