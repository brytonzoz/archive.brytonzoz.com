// Thermal-receipt building blocks shared by /shipped/'s master receipt, printed receipts and forms.
import React from 'react';
import { receiptBarcodeUnits } from '../../lib/shipped';

export function Rule({ heavy = false }: { heavy?: boolean }) {
  return (
    <p className="shipped-rule" aria-hidden="true">
      {(heavy ? '=' : '-').repeat(64)}
    </p>
  );
}

export function Serration({ flip = false }: { flip?: boolean }) {
  const teeth = 28;
  const points = Array.from({ length: teeth + 1 }, (_, i) => `${(i / teeth) * 400},${i % 2 === 0 ? 10 : 0}`).join(' ');
  return (
    <svg className={`shipped-serration${flip ? ' rotate-180' : ''}`} viewBox="0 0 400 10" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,10 ${points} 400,10`} fill="currentColor" />
    </svg>
  );
}

export function Line({ label, value, className = '' }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`shipped-lead ${className}`}>
      <span className="min-w-0">{label}</span>
      <span className="shipped-lead-fill" aria-hidden="true" />
      <span className="shrink-0 tabular-nums tracking-wide">{value}</span>
    </div>
  );
}

export function Barcode({ value }: { value: string }) {
  const units = receiptBarcodeUnits(value);
  return (
    <div className="mt-3">
      <div className="shipped-barcode" aria-hidden="true">
        {units.map((unit, index) => (
          <span key={index} style={{ width: `${+(unit * 1.6).toFixed(1)}px`, background: index % 2 === 0 ? '#1c1917' : 'transparent' }} />
        ))}
      </div>
      <p className="mt-1.5 text-center text-[10px] tracking-[0.28em] text-[#1c1917]/70">{value}</p>
    </div>
  );
}

/** One strip of paper with torn edges. */
export function Ticket({ children, id, label }: { children: React.ReactNode; id?: string; label?: string }) {
  return (
    <section className="shipped-ticket" id={id} aria-label={label}>
      <Serration />
      <div className="shipped-paper font-medium">{children}</div>
      <Serration flip />
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
