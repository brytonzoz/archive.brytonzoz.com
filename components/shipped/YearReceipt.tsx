// The "SHIPPED IN <year>" receipt layout. Bryton's own receipt on /shipped/ is drawn with it, and so is
// every visitor's, so his is the template theirs follow (the share images in lib/receipt-svg.ts match it).
import React from 'react';
import Link from 'next/link';
import type { PaidBy, PaidFor } from '../../lib/shipped-year';
import { Barcode, ExternalLink, Line, Rule } from './paper';

export type ViewItem = {
  key: string;
  name: string;
  status: string;
  /** "MAR 14", "MAR 2026", or null. */
  date: string | null;
  description: string;
  href: string | null;
  /** Same-origin page: next/link keeps the music playing. */
  internal?: boolean;
  logo: { src: string; width: number; height: number } | null;
};

export type YearReceiptProps = {
  year: number;
  who: string;
  kicker?: string | null;
  date: string;
  number: string;
  items: ViewItem[];
  count: number;
  note: string;
  paidFor: PaidFor;
  barcode: string;
  /** Printed after the items, before the total (Bryton's earlier years). */
  after?: React.ReactNode;
  /** Small print under the barcode. */
  fine?: React.ReactNode;
  heading?: 'h1' | 'h2';
};

function ItemName({ item }: { item: ViewItem }) {
  if (!item.href) return <>{item.name}</>;
  if (item.internal) {
    return (
      <Link href={item.href} className="shipped-link">
        {item.name}
      </Link>
    );
  }
  return <ExternalLink href={item.href}>{item.name}</ExternalLink>;
}

function Sponsor({ entry }: { entry: PaidBy }) {
  return entry.url ? (
    <ExternalLink href={entry.url} sponsored>
      {entry.text}
    </ExternalLink>
  ) : (
    <>{entry.text}</>
  );
}

/** "THIS RECEIPT PAID FOR BY:" — on Bryton's receipt and every visitor's. */
export function PaidForBlock({ paidFor }: { paidFor: PaidFor }) {
  return (
    <section className="mt-4 text-center" aria-label="This receipt paid for by">
      <p className="text-[10.5px] tracking-[0.2em] text-[#1c1917]/60">THIS RECEIPT PAID FOR BY:</p>
      {paidFor.presented ? (
        <p className="mt-1.5 text-[12.5px] font-semibold tracking-[0.12em]">
          PRESENTED BY <Sponsor entry={paidFor.presented} />
        </p>
      ) : null}
      <ul className="mt-1.5 space-y-1.5">
        {paidFor.lines.map((entry) => (
          <li key={entry.key} className="text-[12px] font-semibold tracking-[0.08em]">
            {entry.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.logo} alt="" loading="lazy" className="shipped-logo mx-auto mb-1 max-h-12 w-auto max-w-[70%]" />
            ) : null}
            <Sponsor entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function YearReceipt(props: YearReceiptProps) {
  const Heading = props.heading ?? 'h2';
  return (
    <article>
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">STORE RECEIPT</p>
        <Heading className="mt-2 text-[21px] font-semibold leading-none tracking-[0.2em]">SHIPPED IN {props.year}</Heading>
        <p className="mt-2 break-words text-[13.5px] font-semibold tracking-[0.18em]">{props.who.toUpperCase()}</p>
        {props.kicker ? <p className="mt-0.5 text-[11px] tracking-[0.16em] text-[#1c1917]/70">{props.kicker}</p> : null}
      </header>

      <div className="mt-4 space-y-1 text-[12px] tracking-[0.04em]">
        <Line label="DATE" value={props.date} />
        <Line label="RECEIPT" value={`#${props.number}`} />
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
        {props.items.map((item) => (
          <li key={item.key} className="shipped-year-item border-b border-dashed border-[#1c1917]/20 py-2 last:border-b-0">
            {item.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.logo.src} width={item.logo.width} height={item.logo.height} alt="" loading="lazy" decoding="async" className="shipped-item-logo shipped-logo mb-1" />
            ) : null}
            <div className="shipped-lead">
              <h3 className="min-w-0 break-words text-[14px] font-semibold leading-snug">
                <ItemName item={item} />
              </h3>
              <span className="shipped-lead-fill" aria-hidden="true" />
              <p className="shrink-0 text-[12px] font-semibold tracking-[0.12em]">
                <span className="sr-only">Status: </span>
                {item.status}
              </p>
            </div>
            {item.date || item.description ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#1c1917]/78">
                {item.date ? <span className="tracking-[0.08em] text-[#1c1917]/60">{item.date}</span> : null}
                {item.date && item.description ? ' · ' : null}
                {item.description}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {props.after}

      <div className="mt-1">
        <Rule heavy />
      </div>
      <div className="mt-2 text-[15px] font-semibold">
        <Line label="ITEMS SHIPPED" value={String(props.count)} />
      </div>
      <div className="mt-2">
        <Rule heavy />
      </div>

      <p className="mt-4 text-center text-[12.5px] italic leading-relaxed text-[#1c1917]/85">“{props.note}”</p>

      <PaidForBlock paidFor={props.paidFor} />

      <footer className="mt-4 text-center text-[11px] leading-relaxed">
        <p className="tracking-[0.18em]">
          PRINTED AT{' '}
          <Link href="/shipped/" className="shipped-link font-semibold">
            BRYTONZOZ.COM/SHIPPED
          </Link>
        </p>
        <Barcode value={props.barcode} />
        {props.fine ? <div className="mt-3 text-[10.5px] leading-relaxed text-[#1c1917]/60">{props.fine}</div> : null}
      </footer>
    </article>
  );
}
