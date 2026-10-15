'use client';

import React, { useState } from 'react';
import type { PileReceipt } from '../../../lib/shipped-pile';
import { ROLLO_PNG_PATH } from '../../../lib/shipped-year';
import styles from './ReceiptWall.module.css';

/** The same flat receipt image used for physical prints, with the wall's paper and fastener around it. */
export function WallSlip({ receipt, focused = false, onImageLoad }: {
  receipt: PileReceipt;
  focused?: boolean;
  onImageLoad?: (image: HTMLImageElement) => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  return (
    <article className={`shipped-wall-slip ${styles.slip}`} data-wall-artifact={status}>
      {/* This same-origin, variable-height print is already rendered and cached by the Worker. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ROLLO_PNG_PATH(receipt.id)}
        alt={focused ? `${receipt.who}'s printed receipt, ${receipt.count} items shipped` : ''}
        className={styles.receiptImage}
        loading={focused ? 'eager' : 'lazy'}
        draggable={false}
        onLoad={(event) => {
          setStatus('ready');
          onImageLoad?.(event.currentTarget);
        }}
        onError={() => setStatus('failed')}
      />
      {status !== 'ready' ? (
        <div className={styles.slipFallback}>
          <p className="shipped-wall-slip-kicker">SHIPPED</p>
          <h3 className="shipped-wall-slip-who">{receipt.who}</h3>
          <p className="shipped-wall-slip-meta">{receipt.potential ? 'POTENTIAL' : `${receipt.count} SHIPPED`}</p>
          <p className={styles.imageStatus}>{status === 'failed' ? 'Open receipt to view' : 'Loading receipt…'}</p>
        </div>
      ) : null}
      {focused && receipt.items.length ? (
        <ul className={styles.screenReaderText} aria-label="Receipt items">
          {receipt.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}: {item.status}</li>)}
        </ul>
      ) : null}
    </article>
  );
}

/** The crumple uses the actual print image too, retaining its full proportions and printed detail. */
export function paintWallSlip(ctx: CanvasRenderingContext2D, receipt: PileReceipt, width: number, height: number, image?: HTMLImageElement | null) {
  ctx.fillStyle = '#f2ead4';
  ctx.fillRect(0, 0, width, height);
  if (image?.complete && image.naturalWidth) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  ctx.fillStyle = '#1d1b19';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(width * 0.06)}px ui-monospace, monospace`;
  ctx.fillText('SHIPPED', width / 2, width * 0.1);
  ctx.font = `600 ${Math.round(width * 0.055)}px ui-monospace, monospace`;
  ctx.fillText(receipt.who.toUpperCase().slice(0, 26), width / 2, width * 0.24);
}
