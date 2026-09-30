'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../lib/analytics';
import { shareLink } from '../../lib/share';
import type { MediaAsset } from '../../lib/media';
import { formatPrice, productPath, shippingLabel, type Product } from '../../lib/store';
import { addToBag, useAvailability, useBag } from '../../lib/store-client';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { BagIcon, ChevronDownIcon, ShareIcon } from '../player/icons';
import { useCardSheet } from '../useCardSheet';
import type { CardSource } from '../../lib/card-motion';
import { PhotoZoom } from './PhotoZoom';

const iconButton =
  'flex h-10 w-10 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';

// Swipe (or use the arrows / dots) through every photo. `dots` darkens for light photos.
export function Gallery({
  images,
  label,
  alt,
  tone = 'light',
  views,
}: {
  images: MediaAsset[];
  label: string;
  alt: (i: number) => string;
  tone?: 'light' | 'dark';
  /** Which side each photo shows (apparel): adds a Front / Back switch that's always on screen. */
  views?: ('front' | 'back' | null)[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = images.length;
  // Photos load one ahead of the furthest you've swiped, not all at once when the sheet opens.
  const [reach, setReach] = useState(0);
  useEffect(() => setReach((furthest) => Math.max(furthest, index)), [index]);

  // A new set of photos (another tee color) starts from the first one.
  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
    setIndex(0);
    setReach(0);
  }, [images]);

  const go = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * Math.max(0, Math.min(count - 1, i)), behavior: 'smooth' });
  };

  const [zoom, setZoom] = useState<number | null>(null);
  const sides = views && views.includes('front') && views.includes('back') ? views : null;
  const side = sides?.[index] ?? null;

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="store-gallery flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        }}
      >
        {images.map((image, i) => (
          <div
            key={image.src}
            className="relative aspect-square w-full shrink-0 snap-center cursor-zoom-in"
            style={placeholderBackground(image)}
            // Tap a photo to see it full screen and zoom into the print.
            onClick={() => setZoom(i)}
          >
            {i <= reach + 1 ? (
              <ResponsiveImage
                asset={image}
                alt={alt(i)}
                sizes="(min-width: 640px) 480px, 100vw"
                priority={i === 0}
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => go(index - 1)} aria-label="Previous photo" disabled={index === 0} className="store-gallery-arrow left-3">
        <ChevronDownIcon size={20} className="rotate-90" />
      </button>
      <button type="button" onClick={() => go(index + 1)} aria-label="Next photo" disabled={index === count - 1} className="store-gallery-arrow right-3">
        <ChevronDownIcon size={20} className="-rotate-90" />
      </button>
      {sides ? (
        <div className="gallery-sides" role="group" aria-label="Side shown">
          {(['front', 'back'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={side === option}
              // From the current photo, the nearest one of that side.
              onClick={() => {
                const order = sides.map((view, i) => ({ view, i })).filter((entry) => entry.view === option).sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index));
                if (order.length) go(order[0].i);
              }}
            >
              {option === 'front' ? 'Front' : 'Back'}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`pointer-events-none absolute inset-x-0 bottom-3 flex gap-1.5 ${sides ? 'justify-end pr-5 pb-2.5' : 'justify-center'}`} aria-hidden="true">
        {images.map((image, i) => (
          <span key={image.src} className={`h-1.5 rounded-full transition-all duration-300 ${tone === 'dark' ? 'bg-black' : 'bg-white'} ${i === index ? 'w-4 opacity-80' : 'w-1.5 opacity-30'}`} />
        ))}
      </div>
      {zoom !== null ? (
        <PhotoZoom
          images={images}
          index={zoom}
          alt={alt}
          onIndex={setZoom}
          onClose={() => {
            // Back in the sheet, on the photo you ended on.
            if (zoom !== index) go(zoom);
            setZoom(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function ProductSheet({
  product,
  source = null,
  onClose,
  onBuy,
  onOpenBag,
  busy,
}: {
  product: Product | null;
  source?: CardSource | null;
  onClose: () => void;
  onBuy: (ids: string[]) => void;
  onOpenBag: () => void;
  busy: boolean;
}) {
  const titleId = useId();
  const isOpen = Boolean(product);
  const { sheetRef, requestClose } = useCardSheet(isOpen, onClose, source);
  const { notify } = usePlayer();
  const bag = useBag();
  const status = useAvailability(product?.id ?? '');

  useEffect(() => {
    if (!product) return;
    track({ type: 'product', detail: product.id });
    // Warm the connection to Stripe's checkout page, so Buy now opens it without a handshake wait.
    if (!document.querySelector('link[data-stripe-preconnect]')) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = 'https://checkout.stripe.com';
      link.dataset.stripePreconnect = '';
      document.head.appendChild(link);
    }
  }, [product]);

  if (!product) return null;
  const inBag = bag.includes(product.id);
  const available = status === 'available';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="card-sheet sheet-dialog fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:px-6 sm:pt-6"
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel sheet-dialog-height relative isolate flex w-full max-w-[480px] flex-col overflow-hidden rounded-t-[32px] bg-[#14161d] text-white outline-none sm:rounded-[32px]"
      >
        <div className="absolute inset-x-0 top-0 z-10 touch-none select-none px-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/40 sm:invisible" />
          <div className="-mt-1 flex items-center justify-between">
            <button type="button" onClick={requestClose} aria-label="Close" className={`${iconButton} bg-black/25 backdrop-blur-md`}>
              <ChevronDownIcon size={22} />
            </button>
            <button
              type="button"
              aria-label={`Share ${product.name}`}
              onClick={() =>
                shareLink({ title: `Scrapwrk ${product.number}: ${product.name}`, text: `Scrapwrk ${product.number}: ${product.name} by Bryton Zoz`, path: productPath(product) })
                  .then((message) => message && notify(message))
              }
              className={`${iconButton} bg-black/25 backdrop-blur-md`}
            >
              <ShareIcon size={19} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(7.5rem + var(--sheet-player-offset, 0px))' }}>
          <Gallery
            images={product.images}
            label={`${product.name} photos`}
            alt={(i) => (i === 0 ? `Scrapwrk ${product.number} ${product.name}` : `${product.name}, photo ${i + 1} of ${product.images.length}`)}
          />
          <div className="px-6 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-[0.18em] text-white/45">SCRAPWRK {product.number}</p>
                <h2 id={titleId} className="mt-1 text-[30px] font-bold leading-none tracking-[-0.03em]">{product.name}</h2>
              </div>
              <p className={`shrink-0 text-[24px] font-semibold tabular-nums tracking-[-0.02em] ${status === 'sold' ? 'text-white/50 line-through' : ''}`}>
                {formatPrice(product.price)}
              </p>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2 text-[13px] font-medium text-white/80">
              <li className="rounded-full bg-white/[0.08] px-3 py-1.5">1 of 1</li>
              <li className="rounded-full bg-white/[0.08] px-3 py-1.5">Size {product.size}</li>
              <li className="rounded-full bg-white/[0.08] px-3 py-1.5">{product.material}</li>
            </ul>
            <p className="mt-5 text-[16px] leading-relaxed text-white/75">{product.description}</p>
            <ul className="mt-5 space-y-2.5 border-t border-white/[0.08] pt-5 text-[15px] text-white/70">
              {product.features.map((feature) => (
                <li key={feature} className="flex gap-3">
                  <span aria-hidden="true" className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-white/50" />
                  {feature}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] text-white/50">{shippingLabel} in the US · Secure checkout by Stripe</p>
          </div>
        </div>

        <div
          className="platform-fade absolute inset-x-0 bottom-0 px-5 pt-10"
          style={{ paddingBottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--sheet-player-offset, 0px))' }}
        >
          {available ? (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (inBag) {
                    onOpenBag();
                    return;
                  }
                  addToBag(product.id);
                  navigator.vibrate?.(10);
                  track({ type: 'bag', detail: product.id });
                  notify('Added to bag');
                }}
                aria-label={inBag ? 'In your bag: view bag' : 'Add to bag'}
                className="flex h-[56px] shrink-0 items-center justify-center gap-2 rounded-full bg-white/[0.12] px-5 text-[16px] font-semibold text-white backdrop-blur-md transition-[transform,background-color] hover:bg-white/[0.18] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
              >
                <BagIcon size={20} />
                {inBag ? 'In bag' : null}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onBuy(inBag ? bag : [product.id])}
                className="flex h-[56px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-white text-[17px] font-semibold text-black shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-[transform,opacity] active:scale-[0.98] disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              >
                {busy ? <span className="player-spinner store-spinner-dark h-5 w-5 rounded-full" aria-hidden="true" /> : null}
                {busy ? 'Opening checkout…' : inBag && bag.length > 1 ? `Checkout · ${bag.length} pieces` : `Buy now · ${formatPrice(product.price)}`}
              </button>
            </div>
          ) : (
            <p className="flex h-[56px] items-center justify-center rounded-full bg-white/[0.08] text-[16px] font-semibold text-white/60" role="status">
              {status === 'sold' ? 'Sold' : 'In someone’s checkout right now'}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
