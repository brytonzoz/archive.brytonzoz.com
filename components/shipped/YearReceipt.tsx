// The "SHIPPED IN <year>" receipt. Bryton's own receipt on /shipped/ is printed with it, and so is every
// visitor's, so his is the template theirs follow (the share images in lib/receipt-svg.ts match it).
// Set like a real ESC/POS print: no letter-spacing, double-height for the store and the customer, one
// inverse band, dotted leaders, and the PAID FOR BY box at the foot.
import React from 'react';
import Link from 'next/link';
import type { PaidBy, PaidFor } from '../../lib/shipped-year';
import { Barcode, ExternalLink, Line, Rule, Tall } from './paper';

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

/** "THIS RECEIPT WAS PAID FOR BY": on Bryton's receipt and every visitor's. */
export function PaidForBlock({ paidFor }: { paidFor: PaidFor }) {
  return (
    <section className="shipped-paidby" aria-label="This receipt was paid for by">
      <p className="shipped-paidby-head">THIS RECEIPT WAS PAID FOR BY</p>
      {paidFor.presented ? (
        <p className="mt-2 text-[11px]">
          PRESENTED BY
          <br />
          <Tall className="mt-1 text-[15px] font-semibold">
            <Sponsor entry={paidFor.presented} />
          </Tall>
        </p>
      ) : null}
      <ul className="mt-2 space-y-2">
        {paidFor.lines.map((entry) => (
          <li key={entry.key} className="text-[13px] font-semibold leading-snug">
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
  return (
    <article className="shipped-receipt">
      <header className="text-center">
        <p>
          <Tall className="text-[15px] font-semibold">BRYTONZOZ.COM</Tall>
        </p>
        <p className="mt-1 text-[11px] opacity-75">SHIPPED DEPT. · NEW YORK, NY</p>
      </header>

      <Rule />
      <div className="space-y-0.5 text-[12px]">
        <Line label="DATE" value={props.date} />
        <Line label="RECEIPT" value={`#${props.number}`} />
        <Line label="CASHIER" value="NIGHT SHIFT" />
      </div>
      <Rule />

      <h2 className="text-center">
        <span className="shipped-inverse">SHIPPED IN {props.year}</span>
        <span className="sr-only">: </span>
        <span className="mt-3 block text-[11px] font-normal opacity-70" aria-hidden="true">
          CUSTOMER
        </span>
        <span className="mt-0.5 block break-words">
          <Tall className="text-[16px] font-semibold">{props.who.toUpperCase()}</Tall>
        </span>
      </h2>
      {props.kicker ? <p className="mt-1 text-center text-[11px] opacity-70">{props.kicker}</p> : null}

      <Rule />
      <p className="shipped-lead text-[10.5px] opacity-60" aria-hidden="true">
        <span>ITEM</span>
        <span className="shipped-lead-fill is-blank" />
        <span>STATUS</span>
      </p>
      <ol className="mt-1">
        {props.items.map((item) => (
          <li key={item.key} className="shipped-year-item">
            {item.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.logo.src} width={item.logo.width} height={item.logo.height} alt="" loading="lazy" decoding="async" className="shipped-item-logo shipped-logo mb-1" />
            ) : null}
            <div className="shipped-lead">
              <h3 className="min-w-0 break-words text-[13.5px] font-semibold leading-snug">
                <ItemName item={item} />
              </h3>
              <span className="shipped-lead-fill" aria-hidden="true" />
              <p className="shrink-0 text-[12px] font-semibold">
                <span className="sr-only">Status: </span>
                {item.status}
              </p>
            </div>
            {item.date || item.description ? (
              <p className="mt-0.5 text-[11.5px] leading-[1.45] opacity-80">
                {item.description}
                {item.date ? <span className="whitespace-nowrap opacity-75">{item.description ? '  ' : ''}{item.date}</span> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {props.after}

      <Rule heavy />
      <div className="shipped-lead items-end py-1 text-[13px] font-semibold">
        <span>ITEMS SHIPPED</span>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <Tall className="text-[18px] tabular-nums">{String(props.count)}</Tall>
      </div>
      <Rule heavy />

      <section className="mt-3" aria-label="Cashier’s note">
        <p className="text-[10.5px] opacity-60">CASHIER’S NOTE</p>
        <p className="mt-1 text-[12.5px] leading-[1.5]">{props.note}</p>
      </section>

      <PaidForBlock paidFor={props.paidFor} />

      <footer className="mt-4 text-center text-[11px] leading-relaxed">
        <Barcode value={props.barcode} />
        <p className="mt-2">
          PRINTED AT{' '}
          <Link href="/shipped/" className="shipped-link font-semibold">
            BRYTONZOZ.COM/SHIPPED
          </Link>
        </p>
        <p className="mt-1 opacity-60">*** CUSTOMER COPY ***</p>
        {props.fine ? <div className="mt-3 text-[10.5px] leading-relaxed opacity-70">{props.fine}</div> : null}
      </footer>
    </article>
  );
}
