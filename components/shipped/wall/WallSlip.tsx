'use client';

import React from 'react';
import type { PileReceipt } from '../../../lib/shipped-pile';

/** Mini thermal face for a pinned receipt. Ink only — the pin/tape live on the card around it. */
export function WallSlip({ receipt }: { receipt: PileReceipt }) {
  const items = receipt.items.slice(0, 5);
  return (
    <article className="shipped-wall-slip">
      <p className="shipped-wall-slip-kicker">SHIPPED 2026</p>
      <h3 className="shipped-wall-slip-who">{receipt.who}</h3>
      <p className="shipped-wall-slip-meta">{receipt.potential ? 'POTENTIAL' : `${receipt.count} SHIPPED`}</p>
      <ul className="shipped-wall-slip-items">
        {items.map((item) => (
          <li key={item.name}>
            <span>{item.name}</span>
            <span>{item.status}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Offscreen texture for the local crumple — same words the slip shows. */
export function paintWallSlip(ctx: CanvasRenderingContext2D, receipt: PileReceipt, width: number, height: number) {
  ctx.fillStyle = '#f2eee6';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1d1b19';
  ctx.textBaseline = 'top';
  const pad = width * 0.08;
  let y = pad;
  ctx.font = `600 ${Math.round(width * 0.045)}px "Fragment Mono", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('SHIPPED 2026', width / 2, y);
  y += width * 0.08;
  ctx.font = `600 ${Math.round(width * 0.09)}px "Fragment Mono", ui-monospace, monospace`;
  ctx.fillText(receipt.who.toUpperCase().slice(0, 18), width / 2, y);
  y += width * 0.12;
  ctx.font = `500 ${Math.round(width * 0.04)}px "Fragment Mono", ui-monospace, monospace`;
  ctx.globalAlpha = 0.6;
  ctx.fillText(receipt.potential ? 'POTENTIAL' : `${receipt.count} SHIPPED`, width / 2, y);
  ctx.globalAlpha = 1;
  y += width * 0.1;
  ctx.textAlign = 'left';
  ctx.font = `600 ${Math.round(width * 0.042)}px "Fragment Mono", ui-monospace, monospace`;
  for (const item of receipt.items.slice(0, 5)) {
    ctx.fillText(item.name.toUpperCase().slice(0, 22), pad, y);
    y += width * 0.07;
    if (y > height - pad) break;
  }
}
