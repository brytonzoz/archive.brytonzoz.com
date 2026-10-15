'use client';

// /shipped/lab/: PrintAndTear and ReceiptPile on one counter, wired the way the Shipped page would use them.
// Nothing connects them but thermal/toss.ts: the pile registers as the toss target, so the printer offers
// CRUMPLE & TOSS once the receipt is in your hands, and the ball it throws lands in the pile's 3D world.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReceiptPile } from '../../../components/shipped/pile';
import { PrintAndTear, type PrintAndTearHandle } from '../../../components/shipped/print';
import { sampleReceipt, sampleReceipts } from '../../../components/shipped/thermal/samples';
import { useSound } from '../../../components/shipped/thermal/sfx';
import styles from './CounterLab.module.css';

export function CounterLab() {
  const others = useMemo(() => sampleReceipts(18), []);
  const [n, setN] = useState(40);
  const receipt = useMemo(() => sampleReceipt(n), [n]);
  const [reduced, setReduced] = useState<boolean | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  const [sound, toggleSound] = useSound();
  const printer = useRef<PrintAndTearHandle | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('motion') === 'reduced') setReduced(true);
    setReady(true);
  }, []);

  return (
    <div className={styles.counter}>
      <nav className={styles.bar} aria-label="Counter lab">
        <span className={styles.plate} aria-hidden="true">
          COUNTER LAB
        </span>
        <button type="button" className={styles.key} onClick={() => setN((value) => value + 1)}>
          Next receipt
        </button>
        <button type="button" className={styles.key} aria-pressed={sound} onClick={toggleSound}>
          {sound ? 'SND ON' : 'SND OFF'}
        </button>
        <a className={styles.key} href="print/">
          Printer
        </a>
        <a className={styles.key} href="pile/">
          Pile
        </a>
        <span className={styles.status} aria-live="polite">
          {status}
        </span>
      </nav>

      <div className={styles.stage}>
        <section className={styles.printer} aria-label="Printer">
          <PrintAndTear
            key={ready ? 'live' : 'static'}
            ref={printer}
            autoStart={ready}
            receipt={receipt}
            reducedMotion={reduced}
            onPrinted={() => setStatus('PRINTED')}
            onTorn={() => setStatus('IN HAND')}
            onTossed={(landed) => setStatus(landed ? 'ON THE PILE' : 'MISSED')}
          />
        </section>
        <section className={styles.pile} aria-label="Everyone else's receipts">
          <ReceiptPile
            receipts={others}
            motion={reduced ? 'reduced' : 'auto'}
            label="Receipts other people printed (samples)"
            onToss={(tossed) => setStatus(`LANDED ${tossed.number}`)}
          />
        </section>
      </div>
    </div>
  );
}
