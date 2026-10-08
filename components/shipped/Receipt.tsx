import React from 'react';
import Link from 'next/link';
import {
  SHIPPED_BARCODE_VALUE,
  SHIPPED_ITEMS,
  receiptBarcodeUnits,
  receiptDate,
  shippedCounts,
  type ShippedItem,
} from '../../lib/shipped';

const COUNTS = shippedCounts();
const CHECKED = receiptDate();

function Rule({ heavy = false }: { heavy?: boolean }) {
  return (
    <p className="shipped-rule" aria-hidden="true">
      {(heavy ? '=' : '-').repeat(64)}
    </p>
  );
}

function Serration({ flip = false }: { flip?: boolean }) {
  const teeth = 28;
  const points = Array.from({ length: teeth + 1 }, (_, i) => {
    const x = (i / teeth) * 400;
    const y = i % 2 === 0 ? 10 : 0;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg
      className={`shipped-serration${flip ? ' rotate-180' : ''}`}
      viewBox="0 0 400 10"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={`0,10 ${points} 400,10`} fill="currentColor" />
    </svg>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="shipped-lead">
      <span>{label}</span>
      <span className="shipped-lead-fill" aria-hidden="true" />
      <span className="tabular-nums tracking-wide">{value}</span>
    </div>
  );
}

function ItemLink({ item }: { item: ShippedItem }) {
  const primary = item.links[0];
  const className = 'shipped-link font-semibold';
  if (!primary) return <span className="font-semibold">{item.name}</span>;
  if (primary.internal) {
    return (
      <Link href={primary.href} className={className}>
        {item.name}
      </Link>
    );
  }
  return (
    <a href={primary.href} target="_blank" rel="noopener noreferrer" className={className}>
      {item.name}
    </a>
  );
}

function Item({ item }: { item: ShippedItem }) {
  return (
    <li className="border-b border-dashed border-[#1c1917]/20 py-2.5 last:border-b-0">
      <div className="shipped-lead">
        <h2 className="min-w-0 text-[15px] font-semibold leading-snug">
          <ItemLink item={item} />
        </h2>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <p className="shrink-0 text-[13px] font-semibold tracking-[0.14em]">
          <span className="sr-only">Status: </span>
          {item.status}
        </p>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#1c1917]/80">{item.blurb}</p>
      {item.version || item.rating ? (
        <p className="mt-1 text-[12px] text-[#1c1917]/70">
          {item.version ? `v${item.version}` : null}
          {item.version && item.rating ? ' · ' : null}
          {item.rating
            ? `${item.rating.average} stars from ${item.rating.count} rating${item.rating.count === 1 ? '' : 's'}`
            : null}
        </p>
      ) : null}
      {item.links.length > 1 ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          {item.links.map((link) =>
            link.internal ? (
              <Link key={link.href} href={link.href} className="shipped-link">
                {link.label}
              </Link>
            ) : (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="shipped-link">
                {link.label}
              </a>
            ),
          )}
        </p>
      ) : null}
      <p className="mt-1 text-[11.5px] leading-relaxed tracking-[0.01em] text-[#1c1917]/65">{item.stack.join(' · ')}</p>
    </li>
  );
}

function Barcode() {
  const units = receiptBarcodeUnits(SHIPPED_BARCODE_VALUE);
  return (
    <div className="mt-3">
      <div className="shipped-barcode" aria-hidden="true">
        {units.map((unit, index) => (
          <span
            key={index}
            style={{
              width: `${+(unit * 1.6).toFixed(1)}px`,
              background: index % 2 === 0 ? '#1c1917' : 'transparent',
            }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-center text-[10px] tracking-[0.28em] text-[#1c1917]/70">{SHIPPED_BARCODE_VALUE}</p>
    </div>
  );
}

export function Receipt() {
  return (
    <div className="shipped-page">
      <div className="shipped-ticket">
        <Serration />
        <article className="shipped-paper font-medium">
          <header className="text-center">
            <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">STORE RECEIPT</p>
            <p className="mt-2 text-[13px] font-semibold tracking-[0.22em]">BRYTON ZOZ</p>
            <p className="mt-0.5 text-[11px] tracking-[0.18em] text-[#1c1917]/75">NEW YORK · ARTIST / BUILDER</p>
            <h1 className="mt-3 text-[22px] font-semibold leading-none tracking-[0.28em]">SHIPPED</h1>
          </header>

          <div className="mt-4 space-y-1 text-[12px] tracking-[0.04em]">
            <Line label="DATE" value={CHECKED} />
            <Line label="ORDER" value="#BZ-SHIPPED" />
          </div>

          <div className="mt-3">
            <Rule />
          </div>

          <p className="shipped-lead mt-2 text-[10px] tracking-[0.16em] text-[#1c1917]/55">
            <span>ITEM</span>
            <span className="shipped-lead-fill" aria-hidden="true" />
            <span>STATUS</span>
          </p>

          <ol className="mt-1">
            {SHIPPED_ITEMS.map((item) => (
              <Item key={item.name} item={item} />
            ))}
          </ol>

          <div className="mt-1">
            <Rule />
          </div>
          <div className="mt-2 space-y-1 text-[12.5px]">
            <Line label="ITEMS" value={String(COUNTS.items)} />
            <Line label="LIVE" value={String(COUNTS.live)} />
            <Line label="PROTOTYPE" value={String(COUNTS.prototype)} />
          </div>
          <div className="mt-2">
            <Rule heavy />
          </div>
          <div className="mt-2 text-[14px] font-semibold">
            <Line label="TOTAL LIVE" value={String(COUNTS.live)} />
          </div>
          <div className="mt-2">
            <Rule heavy />
          </div>

          <footer className="mt-5 text-center text-[12px] leading-relaxed">
            <p className="tracking-[0.14em]">THANK YOU FOR LOOKING</p>
            <p className="mt-1 text-[#1c1917]/70">Proof over hype. Ratings as of {CHECKED}.</p>
            <p className="mt-3 text-[12.5px] leading-relaxed">
              An artist who builds his own tools.{' '}
              <Link href="/" className="shipped-link">
                brytonzoz.com
              </Link>
            </p>
            <Barcode />
          </footer>
        </article>
        <Serration flip />
      </div>
    </div>
  );
}
