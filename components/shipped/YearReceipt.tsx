'use client';

// The "SHIPPED IN <year>" receipt every visitor prints. Set like a real ESC/POS print: no letter-spacing,
// double-height for the store and the customer, one inverse band, dotted leaders, and the sponsor block at
// the foot (the share images in lib/receipt-svg.ts match it).
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { qr } from '../../lib/shipped-qr';
import { HERO_SLOT } from '../../lib/shipped-sponsors';
import { QR_PATH, groupItemsBySignificance, type SponsorBlock, type SponsorSlot } from '../../lib/shipped-year';
import { Barcode, Line, Rule, Tall, ExternalLink } from './paper';

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
  via?: string | null;
  confidence?: number;
  significance?: number;
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
  sponsors: SponsorBlock | null;
  barcode: string;
  /** Small print under the barcode. */
  fine?: React.ReactNode;
  /** Item names and statuses only (the opening example). */
  compact?: boolean;
  deepCut?: { name: string; why: string } | null;
  badges?: string[];
  firstRun?: boolean;
  modules?: { id: string; title: string; lines: string[] }[];
  shipScore?: number;
  /** ISO time the Worker stamped; shown with the serial. */
  printedAt?: string;
  /** Paid deep pass. */
  full?: boolean;
  /** Honest upsell from the free pass. Never a guessed count. */
  teaser?: string | null;
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

/** The printed QR has to point at whichever host is serving the page (staging prints staging codes). */
function useOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function QrCode({ text, label }: { text: string; label: string }) {
  const code = qr(text);
  const quiet = 2;
  const box = code.size + quiet * 2;
  return (
    <svg viewBox={`${-quiet} ${-quiet} ${box} ${box}`} className="shipped-qr" role="img" aria-label={label}>
      <path d={code.path} fill="currentColor" shapeRendering="crispEdges" />
    </svg>
  );
}

function Slot({ slot, origin, hero }: { slot: SponsorSlot; origin: string | null; hero: boolean }) {
  const href = QR_PATH(slot.qr);
  return (
    <a href={href} target="_blank" rel="sponsored nofollow noopener noreferrer" className="shipped-slot">
      <span className={hero ? 'w-[96px]' : 'w-[64px]'}>
        {origin ? <QrCode text={new URL(href, origin).toString()} label={`QR code for ${slot.name}`} /> : <span className="shipped-qr" aria-hidden="true" />}
      </span>
      {slot.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.logo} alt="" loading="lazy" className={`shipped-logo w-auto ${hero ? 'max-h-10' : 'max-h-6'} max-w-full`} />
      ) : null}
      <span className={`block break-words font-semibold leading-tight ${hero ? 'text-[14px]' : 'text-[10.5px]'}`}>{slot.name}</span>
      <span className={`block break-words leading-snug opacity-75 ${hero ? 'text-[11.5px]' : 'text-[9.5px]'}`}>{slot.cta}</span>
    </a>
  );
}

/** The hero slot and the 3×3 grid, each with its own QR code. Every link is marked sponsored. */
export function SponsorBlockView({ block }: { block: SponsorBlock | null }) {
  const origin = useOrigin();
  const hero = block?.slots.find((s) => s.slot === HERO_SLOT);
  const rest = block?.slots.filter((s) => s.slot !== HERO_SLOT) ?? [];
  if (!block || !hero) return null;
  return (
    <section className="shipped-paidby" aria-label="Sponsors">
      <p className="shipped-paidby-head">{block.frozen ? 'SPONSORED BY (FINAL)' : 'SPONSORED BY'}</p>
      <div className="mt-2">
        <Slot slot={hero} origin={origin} hero />
      </div>
      {rest.length ? (
        <div className="shipped-slot-grid">
          {rest.map((slot) => (
            <Slot key={slot.slot} slot={slot} origin={origin} hero={false} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ItemRow({ item, compact }: { item: ViewItem; compact?: boolean }) {
  const low = typeof item.confidence === 'number' && item.confidence < 0.85;
  return (
    <li className="shipped-year-item">
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
          {low ? (
            <span className="ml-1 font-normal opacity-40" title={`confidence ${(item.confidence! * 100).toFixed(0)}%`}>
              ~
            </span>
          ) : null}
        </p>
      </div>
      {!compact && (item.date || item.description || item.via) ? (
        <p className="mt-0.5 text-[11.5px] leading-[1.45] opacity-80">
          {item.via ? <span className="mr-1.5 opacity-60">{item.via}</span> : null}
          {item.description}
          {item.date ? <span className="whitespace-nowrap opacity-75">{item.description || item.via ? '  ' : ''}{item.date}</span> : null}
        </p>
      ) : null}
    </li>
  );
}

function ItemList({ props }: { props: YearReceiptProps }) {
  const groups = props.items.length >= 8 && props.items.some((item) => item.significance != null) ? groupItemsBySignificance(props.items) : [{ key: 'all', label: '', items: props.items }];
  return (
    <>
      <Rule />
      <p className="shipped-lead text-[10.5px] opacity-60" aria-hidden="true">
        <span>ITEM</span>
        <span className="shipped-lead-fill is-blank" />
        <span>STATUS</span>
      </p>
      <ol className="mt-1">
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.label ? <li className="mt-3 mb-1 list-none text-[10px] tracking-[0.14em] opacity-45">{group.label}</li> : null}
            {group.items.map((item) => (
              <ItemRow key={item.key} item={item} compact={props.compact} />
            ))}
          </React.Fragment>
        ))}
      </ol>
      <Rule heavy />
      <div className="shipped-lead items-end py-1 text-[13px] font-semibold">
        <span>
          ITEMS SHIPPED
          {typeof props.shipScore === 'number' ? (
            <span className="ml-2 text-[11px] font-medium opacity-70">SCORE {props.shipScore}</span>
          ) : null}
        </span>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <Tall className="text-[18px] tabular-nums">{String(props.count)}</Tall>
      </div>
      <Rule heavy />
    </>
  );
}

function CashierNote({ note }: { note: string }) {
  return (
    <section className="mt-3" aria-label="Cashier’s note">
      <p className="text-[10.5px] opacity-60">CASHIER’S NOTE</p>
      <p className="mt-1 text-[12.5px] leading-snug">{note}</p>
    </section>
  );
}

function Stamp({ number, printed, firstRun, firstFull }: { number: string; printed?: string; firstRun?: boolean; firstFull?: boolean }) {
  const stamp = printed?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') ?? '';
  const serial = `#${number}${firstFull ? ' FULL' : firstRun ? ' FIRST RUN' : ''}`;
  return (
    <div className="mt-3 text-[11.5px] tabular-nums">
      <Line label={serial} value={stamp || '—'} />
    </div>
  );
}

export function YearReceipt(props: YearReceiptProps) {
  return (
    <article className="shipped-receipt">
      <header className="text-center">
        <p>
          <Tall className="text-[15px] font-semibold">SHIPPED {props.year}</Tall>
        </p>
        <p className="mt-1 text-[11px] opacity-75">THE PUBLIC RECEIPT PRINTER</p>
      </header>

      <Rule />
      <div className="space-y-0.5 text-[12px]">
        <Line label="DATE" value={props.date} />
        <Line label="RECEIPT" value={`#${props.number}`} />
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

      <ItemList props={props} />
      <CashierNote note={props.note} />
      {props.full ? (
        <p className="mt-3 text-center text-[11px] font-semibold tracking-[0.22em]" style={{ color: '#c9a227' }}>
          VERIFIED FULL RUN
        </p>
      ) : props.teaser ? (
        <p className="mt-3 text-center text-[11.5px] opacity-70">{props.teaser}</p>
      ) : null}
      <Stamp number={props.number} printed={props.printedAt} firstRun={props.firstRun} firstFull={props.full} />

      <SponsorBlockView block={props.sponsors} />

      <footer className="mt-4 text-center text-[11px] leading-relaxed">
        <Barcode value={props.barcode} />
        {props.fine ? <div className="mt-3 text-[10.5px] leading-relaxed opacity-70">{props.fine}</div> : null}
      </footer>
    </article>
  );
}
