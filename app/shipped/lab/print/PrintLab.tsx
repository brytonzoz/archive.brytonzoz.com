'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PrintAndTear, type PrintAndTearHandle } from '../../../../components/shipped/print';
import { brytonThermal } from '../../../../components/shipped/thermal/bryton';
import { sampleReceipt } from '../../../../components/shipped/thermal/samples';
import type { ThermalReceipt } from '../../../../components/shipped/thermal/types';
import { useSound } from '../../../../components/shipped/thermal/sfx';
import { TossCatcher } from './TossCatcher';
import styles from './lab.module.css';

type Pick = 'short' | 'medium' | 'long';

/** The first fictional sample with `min..max` items (deterministic). */
function sampleWith(min: number, max: number): ThermalReceipt {
  for (let n = 0; n < 48; n++) {
    const receipt = sampleReceipt(n);
    if (receipt.items.length >= min && receipt.items.length <= max) return receipt;
  }
  return sampleReceipt(0);
}

const LABELS: Record<Pick, string> = { short: 'SHORT', medium: 'MEDIUM', long: 'LONG' };

export function PrintLab() {
  const receipts = useMemo<Record<Pick, ThermalReceipt>>(() => ({ short: sampleWith(1, 1), medium: sampleWith(4, 5), long: brytonThermal() }), []);
  const [pick, setPick] = useState<Pick>('short');
  const [motion, setMotion] = useState<boolean | undefined>(undefined);
  const [catcher, setCatcher] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [ready, setReady] = useState(false);
  const [sound, toggleSound] = useSound();
  const printer = useRef<PrintAndTearHandle | null>(null);
  const lines = useRef(0);
  const counter = useRef<HTMLSpanElement>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (entry: string) => setLog((prev) => [entry, ...prev].slice(0, 5));
  const resetCount = () => {
    lines.current = 0;
    if (counter.current) counter.current.textContent = '0';
  };
  // The handle is also left on window for automated checks of this bench (window.__printLab.tear() etc.).
  const setPrinter = useCallback((handle: PrintAndTearHandle | null) => {
    printer.current = handle;
    (window as unknown as { __printLab?: PrintAndTearHandle | null }).__printLab = handle;
  }, []);

  // Query overrides, read on the client (the page is a static export).
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const m = query.get('motion');
    if (m === 'reduced' || m === 'reduce') setMotion(true);
    else if (m === 'full') setMotion(false);
    if (query.get('catcher') === '0') setCatcher(false);
    const r = query.get('receipt');
    if (r === 'short' || r === 'medium' || r === 'long') setPick(r);
    const sp = Number(query.get('speed'));
    if (sp > 0 && sp <= 4) setSpeed(sp);
    setReady(true);
  }, []);

  const receipt = receipts[pick];

  return (
    <div className={styles.lab}>
      <header className={styles.head}>
        <p className={styles.title}>
          BZ-80 <span aria-hidden="true">·</span> PRINT LAB
        </p>
        <div className={styles.row} role="group" aria-label="Receipt to print">
          {(Object.keys(LABELS) as Pick[]).map((key) => (
            <button
              key={key}
              type="button"
              className={styles.key}
              aria-pressed={pick === key}
              onClick={() => {
                if (key !== pick) resetCount();
                setPick(key);
              }}
            >
              {LABELS[key]}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.key}
            onClick={() => {
              resetCount();
              printer.current?.print();
            }}
          >
            REPRINT
          </button>
          <button type="button" className={styles.key} aria-pressed={sound} onClick={toggleSound}>
            {sound ? 'SND ON' : 'SND OFF'}
          </button>
        </div>
        <p className={styles.meta} aria-live="off">
          {motion ? 'MOTION REDUCED · ' : ''}LINES <span ref={counter}>0</span>
          {log.length ? ` · ${log[0]}` : ''}
        </p>
      </header>

      {/* Server-rendered for the markup and the screen-reader text; printing starts once the query is read. */}
      <PrintAndTear
          key={ready ? 'live' : 'static'}
          ref={setPrinter}
          autoStart={ready}
          receipt={receipt}
          speed={speed}
          reducedMotion={motion}
          onLine={() => {
            lines.current += 1;
            if (counter.current) counter.current.textContent = String(lines.current);
          }}
          onPrinted={() => note('PRINTED')}
          onTorn={() => note('TORN')}
          onTossed={(landed) => note(landed ? 'TOSSED: ON PILE' : 'TOSSED: MISSED')}
        />

      {catcher ? <TossCatcher /> : null}
    </div>
  );
}
