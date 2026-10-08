'use client';

// The receipt printer at the top of /shipped/: it prints a receipt line by line (a stepped clip reveal,
// like a thermal print head), then the receipt tears off. While a visitor's receipt is being looked up it
// "feeds": a blank stub of paper twitches and the display cycles through the sources being searched.
// With prefers-reduced-motion it shows the finished, torn-off receipt straight away.
import React, { useEffect, useRef, useState } from 'react';

type Phase = 'feeding' | 'printing' | 'tearing' | 'torn';

export type MachineProps = {
  mode: 'feed' | 'print';
  label: string;
  /** Shown on the display while feeding, one after another. */
  ticker?: string[];
  /** Print time in ms. */
  duration?: number;
  onTorn?: () => void;
  children?: React.ReactNode;
};

const TEAR_MS = 520;

export function printDuration(items: number) {
  return Math.min(5200, 1400 + items * 260);
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function Machine({ mode, label, ticker = [], duration = 3600, onTorn, children }: MachineProps) {
  const [phase, setPhase] = useState<Phase>(mode === 'feed' ? 'feeding' : 'printing');
  const [tick, setTick] = useState(0);
  const torn = useRef(onTorn);
  torn.current = onTorn;

  useEffect(() => {
    if (mode === 'feed') {
      setPhase('feeding');
      if (ticker.length < 2 || reducedMotion()) return;
      const timer = window.setInterval(() => setTick((n) => n + 1), 1500);
      return () => window.clearInterval(timer);
    }
    if (reducedMotion()) {
      setPhase('torn');
      torn.current?.();
      return;
    }
    setPhase('printing');
    // Tears off when the print animation ends; the timer covers a page that hydrated after it finished.
    const tear = window.setTimeout(() => setPhase((p) => (p === 'printing' ? 'tearing' : p)), duration + 250);
    return () => window.clearTimeout(tear);
  }, [mode, duration, ticker.length]);

  useEffect(() => {
    if (phase !== 'tearing') return;
    const done = window.setTimeout(() => {
      setPhase('torn');
      torn.current?.();
    }, TEAR_MS);
    return () => window.clearTimeout(done);
  }, [phase]);

  const display =
    phase === 'feeding' ? (ticker.length ? ticker[tick % ticker.length] : 'FEEDING PAPER…') : phase === 'printing' ? 'PRINTING…' : 'TEAR HERE ✓';

  return (
    <div className={`shipped-machine is-${phase}`} role="group" aria-label={label}>
      <div className="shipped-machine-body" aria-hidden="true">
        <div className="shipped-machine-top">
          <span className="shipped-led" />
          <span className="shipped-machine-brand">BZ RECEIPT PRINTER</span>
          <span className="shipped-machine-display">{display}</span>
        </div>
        <div className="shipped-machine-slot" />
      </div>
      <div className="shipped-machine-out">
        {mode === 'feed' ? (
          <div className="shipped-machine-stub" aria-hidden="true" />
        ) : (
          <div
            className="shipped-machine-paper"
            style={{ '--print-ms': `${duration}ms` } as React.CSSProperties}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setPhase((p) => (p === 'printing' ? 'tearing' : p));
            }}
          >
            {children}
          </div>
        )}
      </div>
      <p className="sr-only" role="status">
        {phase === 'feeding' ? display : phase === 'torn' ? 'Receipt printed.' : ''}
      </p>
    </div>
  );
}
