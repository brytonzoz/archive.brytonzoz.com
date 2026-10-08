import React from 'react';
import Link from 'next/link';
import {
  SHIPPED_BARCODE_VALUE,
  SHIPPED_STATUSES,
  chronological,
  receiptDate,
  shippedCounts,
  statusLabel,
  yearSpan,
  type ShippedItem,
} from '../../lib/shipped';
import { Barcode, ExternalLink, Line, Rule, Ticket } from './paper';
import { SponsorRoll } from './SponsorRoll';

const ITEMS = chronological();
const COUNTS = shippedCounts();
const CHECKED = receiptDate();

function ItemLink({ item }: { item: ShippedItem }) {
  const primary = item.links?.[0];
  if (!primary) return <span className="font-semibold">{item.name}</span>;
  if (primary.internal) {
    return (
      <Link href={primary.href} className="shipped-link font-semibold">
        {item.name}
      </Link>
    );
  }
  return (
    <ExternalLink href={primary.href} className="shipped-link font-semibold">
      {item.name}
    </ExternalLink>
  );
}

function Item({ item }: { item: ShippedItem }) {
  const links = item.links ?? [];
  return (
    <li className="border-b border-dashed border-[#1c1917]/20 py-2.5 last:border-b-0">
      <div className="shipped-lead">
        <h2 className="min-w-0 text-[15px] font-semibold leading-snug">
          <ItemLink item={item} />
        </h2>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <p className="shrink-0 text-[13px] font-semibold tracking-[0.14em]">
          <span className="sr-only">Status: </span>
          {statusLabel(item.status)}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] tracking-[0.12em] text-[#1c1917]/60">
        <span className="sr-only">Years: </span>
        {yearSpan(item)}
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#1c1917]/80">{item.blurb}</p>
      {item.version || item.rating ? (
        <p className="mt-1 text-[12px] text-[#1c1917]/70">
          {item.version ? `v${item.version}` : null}
          {item.version && item.rating ? ' · ' : null}
          {item.rating ? `${item.rating.average} stars from ${item.rating.count} rating${item.rating.count === 1 ? '' : 's'}` : null}
        </p>
      ) : null}
      {links.length > 1 ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          {links.map((link) =>
            link.internal ? (
              <Link key={link.href} href={link.href} className="shipped-link">
                {link.label}
              </Link>
            ) : (
              <ExternalLink key={link.href} href={link.href}>
                {link.label}
              </ExternalLink>
            ),
          )}
        </p>
      ) : null}
      {item.stack?.length ? (
        <p className="mt-1 text-[11.5px] leading-relaxed tracking-[0.01em] text-[#1c1917]/65">{item.stack.join(' · ')}</p>
      ) : null}
    </li>
  );
}

/** Bryton's master receipt: everything he started, oldest first, from lib/shipped.ts. */
export function Receipt() {
  return (
    <Ticket label="Shipped receipt">
      <article>
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
          {ITEMS.map((item) => (
            <Item key={item.name} item={item} />
          ))}
        </ol>

        <SponsorRoll />

        <div className="mt-1">
          <Rule />
        </div>
        <div className="mt-2 space-y-1 text-[12.5px]">
          <Line label="ITEMS" value={String(COUNTS.items)} />
          {SHIPPED_STATUSES.filter((status) => COUNTS.byStatus[status]).map((status) => (
            <Line key={status} label={statusLabel(status)} value={String(COUNTS.byStatus[status])} />
          ))}
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
          <p className="mt-3 text-[12px]">
            <a href="#print" className="shipped-link font-semibold">
              Print your own receipt ↓
            </a>
          </p>
          <Barcode value={SHIPPED_BARCODE_VALUE} />
        </footer>
      </article>
    </Ticket>
  );
}
