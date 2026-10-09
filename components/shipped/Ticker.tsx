'use client';

// Compact live counters under the printer: printed first, then shared / mailed / views. They start at 0
// and only ever show numbers the Worker has confirmed. Tap to open the proof sheet.
import React, { useEffect, useRef, useState } from 'react';
import { moneyShort } from '../../lib/shipped-receipt';
import { slotLabel } from '../../lib/shipped-sponsors';
import { stepCount, wholeCount } from '../../lib/shipped-ticker';
import { Line, Rule, Ticket } from './paper';
import { useShippedState } from './state';

export type TickerCounts = { printed: number; shared: number; shipped: number; views: number };

const LABELS: { key: keyof TickerCounts; label: string }[] = [
  { key: 'printed', label: 'PRINTED' },
  { key: 'shared', label: 'SHARED' },
  { key: 'shipped', label: 'SHIPPED' },
  { key: 'views', label: 'VIEWS' },
];

/** Ease toward `target`, never showing more than the confirmed number. Reduced motion snaps. */
function useConfirmedCount(target: number): number {
  const confirmed = wholeCount(target);
  const value = useRef(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || confirmed <= value.current) {
      value.current = confirmed;
      setShown(confirmed);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = value.current;
      if (cur >= confirmed) {
        value.current = confirmed;
        setShown(confirmed);
        return;
      }
      value.current = stepCount(cur, confirmed, dt);
      setShown(Math.min(confirmed, wholeCount(value.current)));
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

function Count({ value }: { value: number }) {
  return <span className="shipped-ticker-n tabular-nums">{fmt(useConfirmedCount(value))}</span>;
}

export function Ticker() {
  const state = useShippedState();
  const [open, setOpen] = useState(false);
  const printed = state?.printed ?? 0;
  const shared = state?.shared ?? 0;
  const shipped = state?.shipped ?? 0;
  const views = state?.views ?? 0;

  return (
    <>
      <button
        type="button"
        className="shipped-ticker"
        aria-label={`Printed ${printed}, shared ${shared}, shipped ${shipped}, views ${views}. Open proof.`}
        onClick={() => setOpen(true)}
      >
        <Count value={printed} />
        <span className="shipped-ticker-k">printed</span>
        <span className="shipped-ticker-rest">
          · <Count value={shared} /> shared · <Count value={shipped} /> mailed · <Count value={views} /> views
        </span>
      </button>
      {open ? <ProofSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
