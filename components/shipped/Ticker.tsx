'use client';

// Mechanical counters pinned above the printer: printed first (odometer), then shared / mailed / views.
// They start at 0 and only ever show numbers the Worker has confirmed. Tap to open the proof sheet.
import React, { useEffect, useRef, useState } from 'react';
import { moneyShort } from '../../lib/shipped-receipt';
import { slotLabel } from '../../lib/shipped-sponsors';
import { displayCount, stepCount, wholeCount } from '../../lib/shipped-ticker';
import { Line, Rule, Ticket } from './paper';
import { countdown } from '../../lib/shipped-event';
import { useShippedClock, useShippedState } from './state';

export type TickerCounts = { printed: number; shared: number; shipped: number; views: number };

const LABELS: { key: keyof TickerCounts; label: string }[] = [
  { key: 'printed', label: 'PRINTED' },
  { key: 'shared', label: 'SHARED' },
  { key: 'shipped', label: 'MAILED' },
  { key: 'views', label: 'VIEWS' },
];

/** Ease toward `target` in a finite time, never showing more than the confirmed number. Reduced motion snaps. */
function useConfirmedCount(target: number): number {
  const confirmed = wholeCount(target);
  const value = useRef(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = value.current;
    if (reduced || confirmed <= from) {
      value.current = confirmed;
      setShown(confirmed);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      value.current = stepCount(from, confirmed, (now - start) / 1000);
      setShown(displayCount(value.current, confirmed));
      if (value.current < confirmed) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [confirmed]);

  return Math.min(shown, confirmed);
}

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

type ProofRow = { n: number; how: string };
type Proof = {
  asOf: number;
  printed: ProofRow;
  shared: ProofRow;
  shipped: ProofRow;
  views: ProofRow;
  takeovers: { at: number; slot: number | null; from: number | null; to: number | null; printed: number; note: string | null }[];
};

function ProofSheet({ onClose }: { onClose: () => void }) {
  const [proof, setProof] = useState<Proof | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    fetch('/api/shipped/proof', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<Proof>) : null))
      .then((data) => live && setProof(data))
      .catch(() => live && setProof(null));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="shipped-sheet" role="dialog" aria-modal="true" aria-labelledby="shipped-proof-title">
      <button type="button" className="shipped-sheet-backdrop" aria-label="Close proof" onClick={onClose} />
      <Ticket id="proof" label="Proof" className="shipped-sheet-ticket">
        <header className="text-center">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">PROOF</p>
            <button type="button" className="text-[11px] font-semibold tracking-[0.16em] underline underline-offset-4" onClick={onClose}>
              CLOSE
            </button>
          </div>
          <h2 id="shipped-proof-title" className="mt-2 text-[20px] font-semibold leading-none tracking-[0.2em]">
            COUNTERS
          </h2>
          <ProofClock />
          <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
            Real rows only. Nothing is seeded, rounded up, or estimated. The ticker never shows a number the server has not confirmed.
          </p>
        </header>
        <div className="mt-2">
          <Rule />
        </div>
        {proof === 'loading' ? (
          <p className="mt-3 text-center text-[12px]">Loading…</p>
        ) : !proof ? (
          <p className="mt-3 text-center text-[12px]">Couldn’t load the counters. Try again.</p>
        ) : (
          <>
            <div className="mt-3 space-y-3 text-[12px]">
              {LABELS.map(({ key, label }) => (
                <div key={key}>
                  <Line label={label} value={fmt(proof[key].n)} />
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#1c1917]/65">{proof[key].how}</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Rule />
            </div>
            <p className="mt-3 text-[11px] font-semibold tracking-[0.16em]">TAKEOVERS</p>
            {proof.takeovers.length ? (
              <div className="mt-1.5 space-y-1 text-[12px]">
                {proof.takeovers.map((row, index) => (
                  <Line
                    key={`${row.at}-${index}`}
                    label={row.slot === null ? '—' : slotLabel(row.slot)}
                    value={`${row.from === 0 || row.from === null ? 'HOUSE' : moneyShort(row.from)} → ${row.to ? moneyShort(row.to) : '—'}`}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[12px] text-[#1c1917]/70">None yet. House ads are not bids.</p>
            )}
          </>
        )}
      </Ticket>
    </div>
  );
}

function ProofClock() {
  const { left, closed } = useShippedClock();
  if (left === null) return <p className="mt-2 text-[12px] tabular-nums text-[#1c1917]/75">··</p>;
  return (
    <p className="mt-2 text-[12px] tabular-nums text-[#1c1917]/75">
      {closed || left <= 0 ? 'THE PRINTER IS OFF' : `shuts off in ${countdown(left)}`}
    </p>
  );
}

function Digit({ n }: { n: number }) {
  return (
    <span className="shipped-odo-cell">
      <span className="shipped-odo-strip" style={{ transform: `translate3d(0, ${-n * 10}%, 0)` }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </span>
    </span>
  );
}

function Odometer({ value, places, size = 'md' }: { value: number; places: number; size?: 'md' | 'sm' }) {
  const padded = String(Math.max(0, Math.floor(value))).padStart(places, '0').slice(-places);
  return (
    <span className={`shipped-odo is-${size}`} aria-hidden="true">
      {padded.split('').map((d, i) => (
        <Digit key={i} n={Number(d)} />
      ))}
    </span>
  );
}

export function Ticker({ compact = false }: { compact?: boolean }) {
  const state = useShippedState();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  const printed = useConfirmedCount(live ? (state?.printed ?? 0) : 0);
  const shared = useConfirmedCount(live ? (state?.shared ?? 0) : 0);
  const shipped = useConfirmedCount(live ? (state?.shipped ?? 0) : 0);
  const views = useConfirmedCount(live ? (state?.views ?? 0) : 0);
  const places = Math.max(4, String(Math.max(0, printed)).length);

  return (
    <>
      <button
        type="button"
        className={`shipped-ticker${compact ? ' is-slim' : ''}`}
        aria-label={live && state ? `Printed ${fmt(printed)}, shared ${fmt(shared)}, mailed ${fmt(shipped)}, views ${fmt(views)}. Open proof.` : 'Open proof.'}
        onClick={() => setOpen(true)}
      >
        <span className="shipped-ticker-primary">
          <Odometer value={printed} places={places} />
          <span className="shipped-ticker-k">printed</span>
        </span>
        {compact ? null : (
          <span className="shipped-ticker-rest">
            <span>
              <Odometer value={shared} places={3} size="sm" /> shared
            </span>
            <span>
              <Odometer value={shipped} places={3} size="sm" /> mailed
            </span>
            <span>
              <Odometer value={views} places={3} size="sm" /> views
            </span>
          </span>
        )}
      </button>
      {open ? <ProofSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
