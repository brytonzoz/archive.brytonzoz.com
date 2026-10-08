'use client';

// A visitor's printed receipt on Bryton's template, and what to do next with it: share it.
import React, { useState } from 'react';
import { track } from '../../lib/analytics';
import { receiptDate } from '../../lib/shipped';
import {
  CARD_PATH,
  RECEIPT_PATH,
  TALL_PATH,
  itemDate,
  itemsShipped,
  receiptNumber,
  shareText,
  subjectLabel,
  type PaidFor,
  type YearReceipt as Printed,
} from '../../lib/shipped-year';
import { YearReceipt } from './YearReceipt';

export type Loaded = { receipt: Printed; paidFor: PaidFor };

const KICKER: Record<Printed['subject']['kind'], string> = {
  github: 'GITHUB',
  x: 'X / TWITTER',
  domain: 'WEBSITE',
  name: 'NAME',
};

export function VisitorReceipt({ receipt, paidFor }: Loaded) {
  const who = subjectLabel(receipt.subject);
  const kicker = receipt.subject.kind === 'github' && receipt.subject.display !== who ? `@${receipt.subject.id} · GITHUB` : KICKER[receipt.subject.kind];
  return (
    <YearReceipt
      year={receipt.year}
      who={receipt.subject.kind === 'github' ? receipt.subject.display : who}
      kicker={kicker}
      date={receiptDate(receipt.printedAt)}
      number={receiptNumber(receipt.id)}
      items={receipt.items.map((item, i) => ({
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
      paidFor={paidFor}
      barcode={`BZ${receiptNumber(receipt.id)}`}
      fine={
        <>
          <p>
            Made from public pages and APIs
            {receipt.demo ? ' (demo print: no AI on this server)' : ', itemized by AI'}. Only public, professional work.
          </p>
          <p className="mt-2 space-x-3">
            <a href={`/remove/?id=${receipt.id}`} className="shipped-link">
              Not you? Remove this receipt
            </a>
            <a href="/#sponsor" className="shipped-link">
              Sponsor this receipt
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

/** Sharing is the obvious next step: post to X first, then the images and the link. */
export function ShareBar({ receipt }: { receipt: Printed }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? RECEIPT_PATH(receipt.id) : new URL(RECEIPT_PATH(receipt.id), window.location.origin).toString();
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(shareText(receipt))}&url=${encodeURIComponent(url)}`;
  return (
    <div className="shipped-share" role="group" aria-label="Share your receipt">
      <a href={intent} target="_blank" rel="noopener noreferrer" className="shipped-button is-big" onClick={() => beacon(receipt.id, 'x')}>
        POST TO X
      </a>
      <div className="shipped-share-row">
        <a href={`${CARD_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save the share card image" onClick={() => beacon(receipt.id, 'card')}>
          SAVE CARD
        </a>
        <a href={`${TALL_PATH(receipt.id)}?download=1`} download className="shipped-button is-ghost" aria-label="Save the full receipt image" onClick={() => beacon(receipt.id, 'tall')}>
          SAVE FULL
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
    </div>
  );
}
