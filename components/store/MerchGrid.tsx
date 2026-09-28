'use client';

import React from 'react';
import { nonparallelAssets } from '../../lib/assets';
import { merchCards, merchMoreCard, type MerchCard } from '../../lib/merch';
import { formatPrice } from '../../lib/store';
import { ResponsiveImage } from '../ResponsiveImage';

// NonParallel tees in the same card system as Scrapwrk: the cards fly in (left column from the
// left, right from the right; top rows from above, bottom from below), turn over from the logo to
// the tee, then float. Photos are Printify's mockups on white. A "More soon" card invites a sign-up
// for new designs: in the free spot of an odd grid, or across the bottom under two tees.

const STAGGER_MS = 60;

function slotFor(index: number, count: number, columns: number, wide: boolean) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rows = Math.ceil(count / columns);
  const fromTop = !wide && row < rows / 2;
  const side = column === 0 ? -1 : column === columns - 1 ? 1 : 0;
  return {
    fromX: wide ? '0%' : `${side * 38}%`,
    fromY: fromTop ? '-70%' : '75%',
    fromRotate: `${(side || (fromTop ? 1 : -1)) * (fromTop ? 14 : -12)}deg`,
    floatY: `${-1.2 - (index % 3) * 0.15}cqw`,
    floatRotate: `${(index % 2 ? 1 : -1) * (0.7 + (index % 3) * 0.1)}deg`,
    duration: `${6.4 + (index % 4) * 0.35}s`,
  };
}

function Back({ number }: { number: string }) {
  return (
    <span className="store-card-face store-card-back merch-card-back" aria-hidden="true">
      <span className="merch-card-logo">
        <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="40vw" draggable={false} loading="lazy" className="h-full w-full object-contain" />
      </span>
      <span className="store-card-back-number">{number}</span>
    </span>
  );
}

function TeeCard({ card: { product, color, perColor }, sizes }: { card: MerchCard; sizes: string }) {
  return (
    <>
      <span className="store-card-face store-card-front merch-card-front">
        <span className="store-card-photo merch-card-photo">
          <ResponsiveImage asset={color.images[0]} alt="" sizes={sizes} draggable={false} loading="lazy" className="h-full w-full object-cover" />
          {!perColor && product.colors.length > 1 ? (
            <span className="merch-card-swatches" aria-hidden="true">
              {product.colors.slice(0, 5).map((option) => <span key={option.slug} style={{ background: option.swatch }} />)}
            </span>
          ) : null}
        </span>
        <span className="store-card-meta merch-card-meta">
          <span className="min-w-0">
            <span className="store-card-number">{perColor ? `${product.number} · ${color.name.toUpperCase()}` : product.number}</span>
            <span className="store-card-name">{product.name}</span>
          </span>
          <span className="store-card-price">{formatPrice(product.price)}</span>
        </span>
      </span>
      <Back number={product.number} />
    </>
  );
}

function WideMoreCard() {
  return (
    <>
      <span className="store-card-face store-card-front merch-card-front merch-more merch-more-wide">
        <span className="merch-more-wide-logo">
          <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="40vw" draggable={false} loading="lazy" className="h-full w-full object-contain" />
        </span>
        <span className="merch-more-wide-text">
          <span className="store-card-name">More designs soon</span>
          <span className="merch-more-wide-sub">One email when they drop</span>
          <span className="store-card-cta merch-card-cta">Notify me</span>
        </span>
      </span>
      <span className="store-card-face store-card-back merch-card-back" aria-hidden="true">
        <span className="merch-card-logo merch-card-logo-wide">
          <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="40vw" draggable={false} loading="lazy" className="h-full w-full object-contain" />
        </span>
      </span>
    </>
  );
}

function MoreCard({ number }: { number: string }) {
  return (
    <>
      <span className="store-card-face store-card-front merch-card-front">
        <span className="store-card-photo merch-card-photo merch-more">
          <span className="merch-more-logo">
            <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="30vw" draggable={false} loading="lazy" className="h-full w-full object-contain" />
          </span>
        </span>
        <span className="store-card-meta merch-card-meta">
          <span className="min-w-0">
            <span className="store-card-number">{number}</span>
            <span className="store-card-name">More soon</span>
          </span>
          <span className="store-card-cta merch-card-cta">Notify me</span>
        </span>
      </span>
      <Back number={number} />
    </>
  );
}

export function MerchGrid({
  active,
  onOpen,
  onNotify,
  sizes = '(min-width: 640px) 280px, 46vw',
  columns = 2,
}: {
  active: boolean;
  columns?: 2 | 3;
  onOpen: (card: MerchCard) => void;
  onNotify: () => void;
  sizes?: string;
}) {
  const cards: { key: string; label: string; face: React.ReactNode; wide?: boolean; onClick: () => void }[] = merchCards.map((card) => ({
    key: `${card.product.slug}-${card.color.slug}`,
    label: `${card.product.name} tee${card.perColor ? `, ${card.color.name}` : ''}, ${formatPrice(card.product.price)}`,
    face: <TeeCard card={card} sizes={sizes} />,
    onClick: () => onOpen(card),
  }));
  // Three across is only used when the tees fill the rows, so the "More soon" card is a two-column thing.
  if (columns === 2 && merchMoreCard === 'slot') {
    const number = String(new Set(merchCards.map((card) => card.product.slug)).size + 1).padStart(3, '0');
    cards.push({ key: 'more', label: 'More designs soon: notify me', face: <MoreCard number={number} />, onClick: onNotify });
  } else if (columns === 2 && merchMoreCard === 'wide') {
    cards.push({ key: 'more', label: 'More designs soon: notify me', face: <WideMoreCard />, wide: true, onClick: onNotify });
  }
  const count = cards.length;

  return (
    <div className={`store-grid merch-grid ${columns === 3 ? 'is-3col' : ''} ${active ? 'is-active' : ''}`}>
      {cards.map((card, i) => {
        const slot = slotFor(i, count, columns, Boolean(card.wide));
        return (
          <div
            key={card.key}
            className={`store-slot ${card.wide ? 'is-wide' : ''}`}
            style={{ '--from-x': slot.fromX, '--from-y': slot.fromY, '--from-rotate': slot.fromRotate, '--delay': `${i * STAGGER_MS}ms` } as React.CSSProperties}
          >
            <div
              className="store-float"
              style={{ '--float-y': slot.floatY, '--float-rotate': slot.floatRotate, '--float-duration': slot.duration, '--delay': `${i * STAGGER_MS + 700}ms` } as React.CSSProperties}
            >
              <button type="button" className="store-card" onClick={card.onClick} aria-label={card.label}>
                <span className="store-card-flip" style={{ '--delay': `${i * STAGGER_MS}ms` } as React.CSSProperties}>
                  <span className="store-card-inner">{card.face}</span>
                </span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
