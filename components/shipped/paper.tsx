// Thermal-receipt building blocks shared by /shipped/'s receipts and forms: torn paper, dotted leaders,
// rules and the barcode. Every strip of paper tears differently, but the same strip always tears the same.
import React from 'react';
import { receiptBarcodeUnits } from '../../lib/shipped';
import { paperClip, tornEdge } from './physics';

export function Rule({ heavy = false }: { heavy?: boolean }) {
  return (
    <p className={`shipped-rule${heavy ? ' is-heavy' : ''}`} aria-hidden="true">
      {(heavy ? '=' : '-').repeat(64)}
    </p>
  );
}

export function Line({ label, value, className = '' }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`shipped-lead is-pair ${className}`}>
      <span className="shipped-lead-k">{label}</span>
      <span className="shipped-lead-fill" aria-hidden="true" />
      <span className="shipped-lead-v">{value}</span>
    </div>
  );
}

/** ESC/POS double height: the same glyphs, stretched, the way receipt printers do headings. */
export function Tall({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`shipped-tall ${className}`}>{children}</span>;
}

export function Barcode({ value }: { value: string }) {
  const units = receiptBarcodeUnits(value);
  return (
    <div className="mt-3">
      <div className="shipped-barcode" aria-hidden="true">
        {units.map((unit, index) => (
          <span key={index} style={{ width: `${+(unit * 1.6).toFixed(1)}px`, background: index % 2 === 0 ? 'currentColor' : 'transparent' }} />
        ))}
      </div>
      <p className="mt-1.5 text-center text-[10px] tracking-[0.2em] opacity-70">{value}</p>
    </div>
  );
}

export type TicketProps = {
  children: React.ReactNode;
  id?: string;
  label?: string;
  /** Picks the shape of the tears. Defaults to the label. */
  seed?: string;
  /** Which edges are torn (a strip still in the printer has a clean top). */
  torn?: { top?: boolean; bottom?: boolean };
  className?: string;
  /** A narrower slip (forms, errors) instead of a full receipt. */
  slip?: boolean;
};

/** One strip of thermal paper. */
export function Ticket({ children, id, label, seed, torn = { top: true, bottom: true }, className = '', slip = false }: TicketProps) {
  const key = seed ?? label ?? id ?? 'paper';
  const clip = paperClip(torn.top ? tornEdge(`${key}:top`) : null, torn.bottom ? tornEdge(`${key}:bottom`) : null);
  return (
    <section className={`shipped-ticket${slip ? ' is-slip' : ''} ${className}`} id={id} aria-label={label}>
      <div className="shipped-paper" style={{ clipPath: clip, WebkitClipPath: clip }}>
        <div className="shipped-ink">{children}</div>
      </div>
    </section>
  );
}

export function ExternalLink({ href, children, sponsored = false, className = 'shipped-link' }: { href: string; children: React.ReactNode; sponsored?: boolean; className?: string }) {
  return (
    <a href={href} target="_blank" rel={sponsored ? 'sponsored nofollow noopener noreferrer' : 'noopener noreferrer'} className={className}>
      {children}
    </a>
  );
}
