'use client';

import React from 'react';
import { formatPrice, products, type Product } from '../../lib/store';
import { useAvailability, warmProduct } from '../../lib/store-client';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';

// The Scrapwrk grid: four cards that fly in one after another (top left, top right, bottom left,
// bottom right), spin over to reveal the piece, then float. Three pieces and, in the fourth spot,
// the next drop.

const SLOTS = [
  { fromX: '-38%', fromY: '-70%', fromRotate: '-14deg', floatY: '-1.6cqw', floatRotate: '-0.8deg', duration: '6.4s' },
  { fromX: '38%', fromY: '-70%', fromRotate: '14deg', floatY: '-1.3cqw', floatRotate: '0.9deg', duration: '7.1s' },
  { fromX: '-38%', fromY: '75%', fromRotate: '12deg', floatY: '-1.5cqw', floatRotate: '0.7deg', duration: '6.8s' },
  { fromX: '38%', fromY: '75%', fromRotate: '-12deg', floatY: '-1.2cqw', floatRotate: '-0.9deg', duration: '7.4s' },
];
const STAGGER_MS = 70;

function Wordmark() {
  return (
    <span className="store-wordmark" aria-hidden="true">
      SCRAPWRK
    </span>
  );
}

function ProductFace({ product, sizes }: { product: Product; sizes: string }) {
  const status = useAvailability(product.id);
  const sold = status === 'sold';
  return (
    <>
      <span className="store-card-face store-card-front">
        <span className="store-card-photo" style={placeholderBackground(product.images[0])}>
          <ResponsiveImage asset={product.images[0]} alt="" sizes={sizes} draggable={false} loading="lazy" className={`h-full w-full object-cover ${sold ? 'opacity-60 grayscale-[0.6]' : ''}`} />
          {status !== 'available' ? <span className="store-chip">{sold ? 'Sold' : 'In checkout'}</span> : null}
        </span>
        <span className="store-card-meta">
          <span className="min-w-0">
            <span className="store-card-number">{product.number}</span>
            <span className="store-card-name">{product.name}</span>
          </span>
          <span className={`store-card-price ${sold ? 'line-through opacity-50' : ''}`}>{formatPrice(product.price)}</span>
        </span>
      </span>
      <span className="store-card-face store-card-back" aria-hidden="true">
        <span className="absolute inset-0" style={placeholderBackground(product.images[1] ?? product.images[0])}>
          <ResponsiveImage asset={product.images[1] ?? product.images[0]} alt="" sizes={sizes} draggable={false} loading="lazy" className="h-full w-full object-cover" />
        </span>
        <span className="store-card-back-shade" />
        <Wordmark />
        <span className="store-card-back-number">{product.number}</span>
      </span>
    </>
  );
}

function NextDropFace() {
  return (
    <>
      <span className="store-card-face store-card-front store-next">
        <span className="store-card-photo teaser-cover">
          <span className="store-next-lights">
            <span className="teaser-light teaser-light-a" />
            <span className="teaser-light teaser-light-b" />
            <span className="teaser-frost" />
          </span>
          <span className="teaser-pulse" style={{ width: '4cqw', height: '4cqw' }} />
        </span>
        <span className="store-card-meta">
          <span className="min-w-0">
            <span className="store-card-number">004</span>
            <span className="store-card-name">Next drop</span>
          </span>
          <span className="store-card-cta">Notify me</span>
        </span>
      </span>
      <span className="store-card-face store-card-back store-next-back" aria-hidden="true">
        <Wordmark />
        <span className="store-card-back-number">004</span>
      </span>
    </>
  );
}

export function StoreGrid({
  active,
  onOpen,
  onNotify,
  sizes = '(min-width: 640px) 280px, 46vw',
}: {
  active: boolean;
  onOpen: (product: Product, element: HTMLButtonElement) => void;
  onNotify: () => void;
  sizes?: string;
}) {
  const cards: { key: string; label: string; face: React.ReactNode; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; warm?: () => void }[] = [
    ...products.slice(0, 3).map((product) => ({
      key: product.id,
      label: `${product.name}, ${formatPrice(product.price)}`,
      face: <ProductFace product={product} sizes={sizes} />,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => onOpen(product, event.currentTarget),
      warm: () => warmProduct(product),
    })),
    { key: 'next-drop', label: 'Next drop: notify me', face: <NextDropFace />, onClick: onNotify },
  ];

  return (
    <div className={`store-grid ${active ? 'is-active' : ''}`}>
      {cards.map((card, i) => {
        const slot = SLOTS[i];
        return (
          <div
            key={card.key}
            className="store-slot"
            style={{
              '--from-x': slot.fromX,
              '--from-y': slot.fromY,
              '--from-rotate': slot.fromRotate,
              '--delay': `${i * STAGGER_MS}ms`,
            } as React.CSSProperties}
          >
            <div
              className="store-float"
              style={{
                '--float-y': slot.floatY,
                '--float-rotate': slot.floatRotate,
                '--float-duration': slot.duration,
                '--delay': `${i * STAGGER_MS + 700}ms`,
              } as React.CSSProperties}
            >
              <button type="button" className="store-card" onClick={card.onClick} onPointerDown={card.warm} onPointerEnter={card.warm} aria-label={card.label}>
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
