import React from 'react';
import Link from 'next/link';
import {
  SHIPPED_BARCODE_VALUE,
  SHIPPED_STATUSES,
  receiptDate,
  shippedCounts,
  yearGroups,
  type ShippedItem,
} from '../../lib/shipped';
import { SHIPPED_ITEMS, SHIPPED_UPDATED } from '../../lib/shipped-data';
import { Barcode, ExternalLink, Line, Rule, Ticket } from './paper';
import { SponsorRoll } from './SponsorRoll';

const GROUPS = yearGroups(SHIPPED_ITEMS);
const COUNTS = shippedCounts(SHIPPED_ITEMS);
const CHECKED = receiptDate(SHIPPED_UPDATED);
const SPAN = COUNTS.first && COUNTS.last ? `${COUNTS.first}–${COUNTS.last}` : null;

function ItemName({ item }: { item: ShippedItem }) {
  const { link } = item;
  if (!link) return <>{item.name}</>;
  if (link.internal) {
    return (
      <Link href={link.href} className="shipped-link">
        {item.name}
      </Link>
    );
  }
  return <ExternalLink href={link.href}>{item.name}</ExternalLink>;
}

function Item({ item }: { item: ShippedItem }) {
  return (
    <li className="border-b border-dashed border-[#1c1917]/20 py-2.5 last:border-b-0">
      {item.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.logo.src}
          width={item.logo.width}
          height={item.logo.height}
          alt=""
          loading="lazy"
          decoding="async"
          className="shipped-item-logo mb-1.5"
        />
      ) : null}
      <div className="shipped-lead">
        <h3 className="min-w-0 text-[15px] font-semibold leading-snug">
          <ItemName item={item} />
        </h3>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <p className="shrink-0 text-[12.5px] font-semibold tracking-[0.12em]">
          <span className="sr-only">Status: </span>
          {item.status}
        </p>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#1c1917]/80">{item.description}</p>
      {item.note ? <p className="mt-0.5 text-[11px] leading-relaxed text-[#1c1917]/60">* {item.note}</p> : null}
      {item.stack || item.appStore ? (
        <p className="mt-1 text-[10.5px] leading-relaxed tracking-[0.02em] text-[#1c1917]/55">
          {item.stack}
          {item.stack && item.appStore ? ' · ' : null}
          {item.appStore ? <ExternalLink href={item.appStore}>App Store</ExternalLink> : null}
        </p>
      ) : null}
    </li>
  );
}

function YearDivider({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="shipped-year">
      <span className="shipped-year-rule" aria-hidden="true" />
      <span className="text-[12px] font-semibold tracking-[0.3em]">{label}</span>
      <span className="text-[10px] tracking-[0.16em] text-[#1c1917]/55">
        ×{count}
        <span className="sr-only"> {count === 1 ? 'item' : 'items'}</span>
      </span>
      <span className="shipped-year-rule" aria-hidden="true" />
    </h2>
  );
}

/** Bryton's master receipt: everything he started, in timeline order, from data/shipped/businesses.json. */
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

        {GROUPS.map((group) => (
          <section key={group.label} className="mt-3 first-of-type:mt-1" aria-label={group.label === 'UNDATED' ? 'Undated' : `Started in ${group.label}`}>
            <YearDivider label={group.label} count={group.items.length} />
            <ol>
              {group.items.map((item) => (
                <Item key={item.name} item={item} />
              ))}
            </ol>
          </section>
        ))}

        <SponsorRoll />

        <div className="mt-1">
          <Rule />
        </div>
        <div className="mt-2 space-y-1 text-[12.5px]">
          {SHIPPED_STATUSES.filter((status) => COUNTS.byStatus[status]).map((status) => (
            <Line key={status} label={status} value={String(COUNTS.byStatus[status])} />
          ))}
        </div>
        <div className="mt-2">
          <Rule />
        </div>
        <div className="mt-2 space-y-1 text-[12.5px]">
          {SPAN ? <Line label="YEARS" value={SPAN} /> : null}
          <Line label="STILL RUNNING" value={String(COUNTS.running)} />
        </div>
        <div className="mt-2">
          <Rule heavy />
        </div>
        <div className="mt-2 text-[15px] font-semibold">
          <Line label="ITEMS" value={String(COUNTS.items)} />
        </div>
        <div className="mt-2">
          <Rule heavy />
        </div>

        <footer className="mt-5 text-center text-[12px] leading-relaxed">
          <p className="tracking-[0.14em]">THANK YOU FOR LOOKING</p>
          <p className="mt-1 text-[#1c1917]/70">Proof over hype. Checked {CHECKED}.</p>
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
