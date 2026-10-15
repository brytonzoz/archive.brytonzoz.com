'use client';

// /shipped/lab/pile/: the pile filling the counter, twenty sample receipts on it and one in your hand.
// The keys are plain links (each reloads the page with its override): 3D, 2D (?mode=2d), reduced motion
// (?motion=reduced) and the crumple review (?crumple=0.15 / 0.5 / 0.9 freezes every receipt there). THROW IN
// tosses a ball through the same bus the printer uses (thermal/toss.ts), from the key toward the pile.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReceiptPile } from '../../../../components/shipped/pile';
import { sampleReceipt, sampleReceipts } from '../../../../components/shipped/thermal/samples';
import { useSound } from '../../../../components/shipped/thermal/sfx';
import { useCrumpleToss } from '../../../../components/shipped/thermal/toss';
import styles from './PileLab.module.css';

const KEYS = [
  { href: '?', label: '3D', match: '' },
  { href: '?mode=2d', label: '2D', match: 'mode=2d' },
  { href: '?motion=reduced', label: 'Reduced', match: 'motion=reduced' },
  { href: '?crumple=0.15', label: 'C .15', match: 'crumple=0.15' },
  { href: '?crumple=0.5', label: 'C .50', match: 'crumple=0.5' },
  { href: '?crumple=0.9', label: 'C .90', match: 'crumple=0.9' },
];

export function PileLab() {
  const receipts = useMemo(() => sampleReceipts(20), []);
  const own = useMemo(() => sampleReceipt(21), []);
  const [query, setQuery] = useState<string | null>(null);
  const [sound, toggleSound] = useSound();
  const [last, setLast] = useState('');
  const toss = useCrumpleToss();
  const thrown = useRef(30);
  const throwIn = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const receipt = sampleReceipt(thrown.current++);
    const ok = toss.toss({
      receipt,
      from: { x: box.left + box.width / 2 - 20, y: box.bottom + 10, width: 40, height: 40 },
      velocity: { x: 120, y: 900 },
      crumple: 1,
      spin: 9,
    });
    setLast(ok ? `THROWN ${receipt.number}` : 'NO PILE');
  };

  useEffect(() => setQuery(window.location.search.replace(/^\?/, '')), []);

  return (
    <div className={styles.lab}>
      <nav className={styles.bar} aria-label="Pile lab">
        <span className={styles.plate} aria-hidden="true">
          PILE LAB
        </span>
        {KEYS.map((key) => (
          <a key={key.label} href={key.href} className={styles.key} aria-current={query === key.match ? 'page' : undefined}>
            {key.label}
          </a>
        ))}
        <button type="button" className={styles.key} onClick={throwIn} disabled={!toss.available}>
          Throw in
        </button>
        <button type="button" className={styles.key} aria-pressed={sound} onClick={toggleSound}>
          {sound ? 'SND ON' : 'SND OFF'}
        </button>
        <span className={styles.status} aria-live="polite">
          {last}
        </span>
      </nav>
      <ReceiptPile
        className={styles.pile}
        style={{ height: 'auto' }}
        receipts={receipts}
        own={own}
        label="Sample receipts"
        onOpen={(receipt) => setLast(receipt ? `OPEN ${receipt.number}` : '')}
        onToss={(receipt) => setLast(`LANDED ${receipt.number}`)}
      />
    </div>
  );
}
