'use client';

// The "SHIPPED IN <year>" receipt every visitor prints. Set like a real ESC/POS print: no letter-spacing,
// double-height for the store and the customer, one inverse band, dotted leaders, and the sponsor block at
// the foot (the share images in lib/receipt-svg.ts match it).
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { qr } from '../../lib/shipped-qr';
import { HERO_SLOT } from '../../lib/shipped-sponsors';
import { QR_PATH, SHIPPED_URL, type SponsorBlock, type SponsorSlot } from '../../lib/shipped-year';
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
function useOrigin(): string {
  const [origin, setOrigin] = useState(SHIPPED_URL);
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

function Slot({ slot, origin, hero }: { slot: SponsorSlot; origin: string; hero: boolean }) {
  const href = QR_PATH(slot.qr);
  return (
    <a href={href} target="_blank" rel="sponsored nofollow noopener noreferrer" className="shipped-slot">
      <span className={hero ? 'w-[96px]' : 'w-[64px]'}>
        <QrCode text={new URL(href, origin).toString()} label={`QR code for ${slot.name}`} />
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

function DeepCut({ cut }: { cut: YearReceiptProps['deepCut'] }) {
  if (!cut) return null;
  return (
    <section className="mt-3 text-center" aria-label="How did it know?">
      <p className="shipped-inverse">HOW DID IT KNOW?</p>
      <p className="mt-2 text-[13px] font-semibold">{cut.name}</p>
      <p className="mt-0.5 text-[11px] opacity-70">{cut.why}</p>
    </section>
  );
}

function ItemList({ props }: { props: YearReceiptProps }) {
  return (
    <>
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
            {!props.compact && (item.date || item.description) ? (
              <p className="mt-0.5 text-[11.5px] leading-[1.45] opacity-80">
                {item.description}
                {item.date ? <span className="whitespace-nowrap opacity-75">{item.description ? '  ' : ''}{item.date}</span> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <Rule heavy />
      <div className="shipped-lead items-end py-1 text-[13px] font-semibold">
        <span>ITEMS SHIPPED</span>
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
      <p className="mt-1 text-[12.5px] leading-[1.5]">{note}</p>
    </section>
  );
}

function ModuleBand({ band, props }: { band: { id: string; title: string; lines: string[] }; props: YearReceiptProps }) {
  if (band.id === 'items') return <ItemList props={props} />;
  if (band.id === 'deep-cut') return <DeepCut cut={props.deepCut} />;
  if (band.id === 'cashier') return <CashierNote note={props.note} />;
  return (
    <section className="mt-3 text-center" aria-label={band.title}>
      <p className="text-[10.5px] font-semibold tracking-[0.14em] opacity-60">{band.title}</p>
      {band.lines.map((line, i) => (
        <p key={`${band.id}-${i}`} className="mt-1 text-[12px] leading-[1.45]">
          {line}
        </p>
      ))}
    </section>
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
        <Line label="CASHIER" value="NIGHT SHIFT" />
        {props.firstRun ? <Line label="RUN" value="FIRST RUN" /> : null}
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
      {props.badges?.length ? <p className="mt-2 text-center text-[10px] font-semibold tracking-[0.14em] opacity-70">{props.badges.join(' · ')}</p> : null}
      {typeof props.shipScore === 'number' ? <p className="mt-1 text-center text-[10px] opacity-60">SHIP SCORE {props.shipScore}</p> : null}

      {props.modules?.length ? (
        props.modules.map((band) => (
          <ModuleBand key={band.id} band={band} props={props} />
        ))
      ) : (
        <>
          <DeepCut cut={props.deepCut} />
          <ItemList props={props} />
          <CashierNote note={props.note} />
        </>
      )}

      <SponsorBlockView block={props.sponsors} />

      <footer className="mt-4 text-center text-[11px] leading-relaxed">
        <Barcode value={props.barcode} />
        <p className="mt-2">
          PRINTED AT{' '}
          <a href="/" className="shipped-link font-semibold">
            SHIPPED.BRYTONZOZ.COM
          </a>
        </p>
        <p className="mt-1 opacity-60">*** CUSTOMER COPY ***</p>
        {props.fine ? <div className="mt-3 text-[10.5px] leading-relaxed opacity-70">{props.fine}</div> : null}
      </footer>
    </article>
  );
}
