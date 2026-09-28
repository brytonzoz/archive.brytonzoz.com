'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../lib/analytics';
import { merchVariant } from '../../lib/merch';
import { formatPrice, productById, shippingLabel } from '../../lib/store';
import {
  addToBag, bagLines, cancelCheckout, hasPendingCheckout, removeFromBag, removeOneFromBag, startCheckout, useAvailability, useBag,
} from '../../lib/store-client';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { BagIcon, CloseIcon, RemoveIcon } from '../player/icons';
import { useSheet } from '../useSheet';

// The bag both stores share (Scrapwrk pieces and NonParallel tees), and the checkout they share.

export const lineName = (key: string) => productById(key)?.name ?? (merchVariant(key) ? `${merchVariant(key)!.product.name} Tee` : 'Item');
export const linePrice = (key: string) => productById(key)?.price ?? merchVariant(key)?.size.price ?? 0;

const stepButton =
  'flex h-7 w-7 items-center justify-center rounded-full text-[18px] font-semibold text-white/85 transition-colors hover:bg-white/[0.12] disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';

function PieceRow({ id }: { id: string }) {
  const product = productById(id);
  const status = useAvailability(id);
  if (!product) return null;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[12px]" style={placeholderBackground(product.images[0])}>
        <ResponsiveImage asset={product.images[0]} alt="" sizes="56px" className="absolute inset-0 h-full w-full object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{product.name}</span>
        <span className="block text-[13px] text-white/50">
          {status === 'available' ? `Scrapwrk ${product.number} · 1 of 1` : status === 'sold' ? 'Sold' : 'In someone’s checkout'}
        </span>
      </span>
      <span className="shrink-0 text-[16px] font-semibold tabular-nums">{formatPrice(product.price)}</span>
      <button
        type="button"
        onClick={() => removeFromBag(id)}
        aria-label={`Remove ${product.name} from bag`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
      >
        <RemoveIcon size={22} />
      </button>
    </li>
  );
}

function TeeRow({ id, quantity }: { id: string; quantity: number }) {
  const variant = merchVariant(id);
  if (!variant) return null;
  const image = variant.color.images[0];
  const name = `${variant.product.name} tee`;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[12px] bg-white">
        <ResponsiveImage asset={image} alt="" sizes="56px" className="absolute inset-0 h-full w-full object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{variant.product.name} Tee</span>
        <span className="block truncate text-[13px] text-white/50">{variant.color.name} · {variant.size.size}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] p-1">
        <button type="button" className={stepButton} onClick={() => removeOneFromBag(id)} aria-label={quantity > 1 ? `One fewer ${name}` : `Remove ${name} from bag`}>
          {quantity > 1 ? '−' : <RemoveIcon size={16} />}
        </button>
        <span className="w-4 text-center text-[15px] font-semibold tabular-nums" aria-label={`${quantity} in bag`}>{quantity}</span>
        <button type="button" className={stepButton} onClick={() => addToBag(id)} disabled={quantity >= 10} aria-label={`One more ${name}`}>+</button>
      </span>
      <span className="w-12 shrink-0 text-right text-[16px] font-semibold tabular-nums">{formatPrice(variant.size.price * quantity)}</span>
    </li>
  );
}

export function BagSheet({ isOpen, onClose, onBuy, busy }: { isOpen: boolean; onClose: () => void; onBuy: (ids: string[]) => void; busy: boolean }) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const bag = useBag();
  if (!isOpen) return null;
  const total = bag.reduce((sum, id) => sum + linePrice(id), 0);
  const lines = bagLines(bag);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`sheet-dialog fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:px-6 sm:pt-6 ${isClosing ? 'is-closing' : ''}`}>
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative w-full max-w-[440px] overflow-hidden rounded-t-[32px] bg-[#14161d] text-white outline-none sm:rounded-[32px]"
        style={{ ...sheetStyle, paddingBottom: 'calc(max(1.5rem, env(safe-area-inset-bottom)) + var(--sheet-player-offset, 0px))' }}
      >
        <div {...dragHandlers} className="relative touch-none select-none px-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/30 sm:invisible" />
          <button type="button" onClick={requestClose} aria-label="Close" className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/75 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="px-6 pt-6">
          <h2 id={titleId} className="text-[24px] font-bold tracking-[-0.02em]">Bag</h2>
          {bag.length ? (
            <>
              <ul className="mt-3 max-h-[50dvh] divide-y divide-white/[0.07] overflow-y-auto overscroll-contain">
                {lines.map((line) => (merchVariant(line.key)
                  ? <TeeRow key={line.key} id={line.key} quantity={line.quantity} />
                  : <PieceRow key={line.key} id={line.key} />))}
              </ul>
              <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.08] pt-4">
                <span className="text-[15px] text-white/55">{shippingLabel}</span>
                <span className="text-[22px] font-semibold tabular-nums">{formatPrice(total)}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onBuy(bag)}
                className="mt-5 flex h-[56px] w-full items-center justify-center gap-2 rounded-full bg-white text-[17px] font-semibold text-black transition-[transform,opacity] active:scale-[0.98] disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              >
                {busy ? <span className="player-spinner store-spinner-dark h-5 w-5 rounded-full" aria-hidden="true" /> : null}
                {busy ? 'Opening checkout…' : 'Checkout'}
              </button>
            </>
          ) : (
            <p className="mt-3 pb-4 text-[15px] text-white/50">Your bag is empty.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BagButton({ onOpen, className = '' }: { onOpen: () => void; className?: string }) {
  const bag = useBag();
  if (!bag.length) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Bag, ${bag.length} ${bag.length === 1 ? 'item' : 'items'}`}
      className={`store-bag-button glass-capsule flex h-11 items-center gap-2 rounded-full pl-3.5 pr-4 text-[15px] font-semibold text-white transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${className}`}
    >
      <BagIcon size={19} />
      {/* Keyed by the count, so each change replays the pop. */}
      <span key={bag.length} className="store-bag-count tabular-nums">{bag.length}</span>
    </button>
  );
}

// Checkout shared by both stores: sends the bag (or one item) to Stripe, and tidies up when
// someone comes back without paying.
export function useCheckout() {
  const { notify } = usePlayer();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('checkout')) {
      url.searchParams.delete('checkout');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    if (hasPendingCheckout()) cancelCheckout();
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setBusy(false);
      cancelCheckout();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const buy = useCallback(async (ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    navigator.vibrate?.(12);
    track({ type: 'checkout', detail: ids.join(',').slice(0, 200) });
    const result = await startCheckout(ids);
    if ('url' in result) {
      window.location.assign(result.url);
      return;
    }
    setBusy(false);
    if (result.error === 'unavailable' && 'unavailable' in result) {
      const names = result.unavailable.map((id) => productById(id)?.name).filter(Boolean).join(' and ');
      notify(`${names || 'That piece'} just sold or is in someone’s checkout`);
    } else if (result.error === 'not-configured') {
      notify('Checkout opens soon');
    } else {
      notify('Couldn’t open checkout. Try again.');
    }
  }, [busy, notify]);

  return { busy, buy };
}
