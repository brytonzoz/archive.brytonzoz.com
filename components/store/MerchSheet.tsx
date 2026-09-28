'use client';

import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../lib/analytics';
import { merchBlank, merchDetails, merchKey, merchPath, type MerchProduct } from '../../lib/merch';
import { shareLink } from '../../lib/share';
import { formatPrice, shippingLabel } from '../../lib/store';
import { addToBag } from '../../lib/store-client';
import { usePlayer } from '../player/context';
import { BagIcon, ChevronDownIcon, ShareIcon } from '../player/icons';
import { useSheet } from '../useSheet';
import { Gallery } from './ProductSheet';

const iconButton =
  'flex h-10 w-10 items-center justify-center rounded-full text-black/70 transition-colors hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black/50';

// A NonParallel tee: photos on white (Printify's mockups), color, size, then Buy now or bag it.
export function MerchSheet({
  product,
  initialColor,
  onClose,
  onBuy,
  busy,
}: {
  product: MerchProduct | null;
  /** The color whose card was tapped. */
  initialColor?: string;
  onClose: () => void;
  onBuy: (ids: string[]) => void;
  busy: boolean;
}) {
  const titleId = useId();
  const isOpen = Boolean(product);
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const { notify } = usePlayer();
  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    if (!product) return;
    setColorIndex(Math.max(0, product.colors.findIndex((color) => color.slug === initialColor)));
    setSize(null);
    track({ type: 'product', detail: `np:${product.slug}` });
    if (!document.querySelector('link[data-stripe-preconnect]')) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = 'https://checkout.stripe.com';
      link.dataset.stripePreconnect = '';
      document.head.appendChild(link);
    }
  }, [product, initialColor]);

  if (!product) return null;
  const color = product.colors[Math.min(colorIndex, product.colors.length - 1)];
  const chosen = color.sizes.find((entry) => entry.size === size);
  const price = chosen?.price ?? color.sizes[0]?.price ?? product.price;
  // Bigger sizes cost more to make; say so under the sizes.
  const upcharges = color.sizes.filter((option) => option.price > product.price);

  // Size first: without one, the size row gives a little shake instead.
  const withSize = (action: (key: string) => void) => () => {
    if (!chosen) {
      setNudge((n) => n + 1);
      navigator.vibrate?.([8, 40, 8]);
      return;
    }
    action(merchKey(product, chosen.variantId));
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`sheet-dialog fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:px-6 sm:pt-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel sheet-dialog-height relative isolate flex w-full max-w-[480px] flex-col overflow-hidden rounded-t-[32px] bg-[#f5f5f7] text-[#111] outline-none sm:rounded-[32px]"
        style={sheetStyle}
      >
        <div {...dragHandlers} className="absolute inset-x-0 top-0 z-10 touch-none select-none px-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-black/20 sm:invisible" />
          <div className="-mt-1 flex items-center justify-between">
            <button type="button" onClick={requestClose} aria-label="Close" className={`${iconButton} bg-white/70 backdrop-blur-md`}>
              <ChevronDownIcon size={22} />
            </button>
            <button
              type="button"
              aria-label={`Share the ${product.name} tee`}
              onClick={() =>
                shareLink({ title: product.title, text: `${product.title} · NonParallel`, path: merchPath(product) })
                  .then((message) => message && notify(message))
              }
              className={`${iconButton} bg-white/70 backdrop-blur-md`}
            >
              <ShareIcon size={19} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(7.5rem + var(--sheet-player-offset, 0px))' }}>
          <div className="bg-white">
            <Gallery
              images={color.images}
              tone="dark"
              label={`${product.title}, ${color.name}`}
              alt={(i) => `${product.title} in ${color.name}${i ? `, view ${i + 1}` : ''}`}
            />
          </div>
          <div className="px-6 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-[0.18em] text-black/55">
                  NONPARALLEL {product.number}{product.colors.length === 1 ? ` · ${color.name.toUpperCase()} TEE` : ''}
                </p>
                <h2 id={titleId} className="mt-1 text-[30px] font-bold leading-none tracking-[-0.03em]">{product.name}</h2>
              </div>
              <p className="shrink-0 text-[24px] font-semibold tabular-nums tracking-[-0.02em]">{formatPrice(price)}</p>
            </div>

            {product.colors.length > 1 ? (
              <fieldset className="mt-6">
                <legend className="text-[13px] font-semibold text-black/60">Color · <span className="text-black">{color.name}</span></legend>
                <div className="mt-2.5 flex flex-wrap gap-3">
                  {product.colors.map((option, i) => (
                    <button
                      key={option.slug}
                      type="button"
                      aria-pressed={i === colorIndex}
                      aria-label={option.name}
                      onClick={() => setColorIndex(i)}
                      className={`merch-swatch ${i === colorIndex ? 'is-selected' : ''}`}
                      style={{ '--swatch': option.swatch } as React.CSSProperties}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset key={nudge} className={`mt-6 ${nudge ? 'merch-nudge' : ''}`}>
              <legend className="text-[13px] font-semibold text-black/60">
                Size{chosen ? <> · <span className="text-black">{chosen.size}</span></> : nudge ? <span className="text-[#c4252a]"> · pick one</span> : null}
              </legend>
              <div className="mt-2.5 grid grid-cols-6 gap-2">
                {color.sizes.map((option) => (
                  <button
                    key={option.variantId}
                    type="button"
                    aria-pressed={option.size === size}
                    onClick={() => setSize(option.size)}
                    className={`merch-size ${option.size === size ? 'is-selected' : ''}`}
                  >
                    {option.size}
                  </button>
                ))}
              </div>
              {upcharges.length ? (
                <p className="mt-2 text-[13px] text-black/60">{upcharges.map((option) => `${option.size} ${formatPrice(option.price)}`).join(' · ')}</p>
              ) : null}
            </fieldset>

            <p className="mt-6 text-[15px] leading-relaxed text-black/70">
              NonParallel is the label and company behind all of this. A tee is a way to support it: you get something to wear, and it keeps the work going.
            </p>
            {merchDetails.length ? (
              <details className="mt-5 border-t border-black/[0.08] pt-4 text-[14px] text-black/65">
                <summary className="cursor-pointer font-semibold text-black/80">{merchBlank} · details</summary>
                <ul className="mt-2 space-y-1.5 leading-relaxed">
                  {merchDetails.map((line) => <li key={line} className="flex gap-2.5"><span aria-hidden="true" className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-black/40" />{line}</li>)}
                </ul>
              </details>
            ) : null}
            <p className="mt-5 text-[13px] text-black/55">Printed to order · {shippingLabel} in the US · Secure checkout by Stripe</p>
          </div>
        </div>

        <div
          className="merch-fade absolute inset-x-0 bottom-0 px-5 pt-10"
          style={{ paddingBottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--sheet-player-offset, 0px))' }}
        >
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={withSize((key) => {
                addToBag(key);
                navigator.vibrate?.(10);
                track({ type: 'bag', detail: key });
                notify('Added to bag');
              })}
              aria-label="Add to bag"
              className="flex h-[56px] shrink-0 items-center justify-center gap-2 rounded-full bg-black/[0.07] px-5 text-[16px] font-semibold text-black transition-[transform,background-color] hover:bg-black/[0.1] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-black/50"
            >
              <BagIcon size={20} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={withSize((key) => onBuy([key]))}
              className="flex h-[56px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#111] text-[17px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-[transform,opacity] active:scale-[0.98] disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/50"
            >
              {busy ? <span className="player-spinner h-5 w-5 rounded-full" aria-hidden="true" /> : null}
              {busy ? 'Opening checkout…' : chosen ? `Buy now · ${formatPrice(price)}` : 'Buy now'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
