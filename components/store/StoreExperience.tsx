'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../lib/analytics';
import { formatPrice, getProduct, productById, productPath, shippingLabel, STORE_PATH, type Product } from '../../lib/store';
import { cancelCheckout, hasPendingCheckout, refreshAvailability, removeFromBag, startCheckout, useAvailability, useBag } from '../../lib/store-client';
import { NotifySheet, hasSignedUp } from '../NotifySheet';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { BagIcon, CloseIcon, RemoveIcon } from '../player/icons';
import { useSheet } from '../useSheet';
import { ProductSheet } from './ProductSheet';
import { StoreGrid } from './StoreGrid';

function BagRow({ id }: { id: string }) {
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
        <span className="block text-[13px] text-white/45">
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

function BagSheet({ isOpen, onClose, onBuy, busy }: { isOpen: boolean; onClose: () => void; onBuy: (ids: string[]) => void; busy: boolean }) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const bag = useBag();
  if (!isOpen) return null;
  const total = bag.reduce((sum, id) => sum + (productById(id)?.price ?? 0), 0);

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
              <ul className="mt-3 divide-y divide-white/[0.07]">
                {bag.map((id) => <BagRow key={id} id={id} />)}
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
      aria-label={`Bag, ${bag.length} ${bag.length === 1 ? 'piece' : 'pieces'}`}
      className={`store-bag-button glass-capsule flex h-11 items-center gap-2 rounded-full pl-3.5 pr-4 text-[15px] font-semibold text-white transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${className}`}
    >
      <BagIcon size={19} />
      {/* Keyed by the count, so each change replays the pop. */}
      <span key={bag.length} className="store-bag-count tabular-nums">{bag.length}</span>
    </button>
  );
}

// The whole store in one place: the grid, a piece's sheet, the bag and checkout. Used by the
// homepage's Scrapwrk scene and by /scrapwrk/ (and each piece's own page, which opens its sheet).
export function StoreExperience({
  active,
  initialProduct,
  sizes,
  title,
  titleEnd,
  headerClassName = '',
  headerStyle,
}: {
  active: boolean;
  initialProduct?: string;
  sizes?: string;
  /** The heading row above the grid; the bag button (once something is in it) sits at its end. */
  title: React.ReactNode;
  titleEnd?: React.ReactNode;
  headerClassName?: string;
  headerStyle?: React.CSSProperties;
}) {
  const { notify } = usePlayer();
  const [open, setOpen] = useState<Product | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshAvailability();
    const initial = initialProduct ? getProduct(initialProduct) : undefined;
    if (initial) setOpen(initial);
    // Back from Stripe without paying (Stripe's back link or the browser's): release the hold
    // right away instead of waiting for the checkout to expire.
    const url = new URL(window.location.href);
    if (url.searchParams.has('checkout')) {
      url.searchParams.delete('checkout');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    if (hasPendingCheckout()) cancelCheckout();
    // Returning with the back button restores this page as it was; don't leave it "busy".
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setBusy(false);
      cancelCheckout();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [initialProduct]);

  const buy = useCallback(async (ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    navigator.vibrate?.(12);
    track({ type: 'checkout', detail: ids.join(',') });
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

  const openProduct = useCallback((product: Product) => {
    setOpen(product);
    // Each piece has its own address, so the page can be shared or reloaded.
    if (window.location.pathname.startsWith(STORE_PATH)) window.history.replaceState(window.history.state, '', productPath(product));
  }, []);

  const closeProduct = useCallback(() => {
    setOpen(null);
    if (window.location.pathname.startsWith(STORE_PATH)) window.history.replaceState(window.history.state, '', STORE_PATH);
  }, []);

  const [signedUp, setSignedUp] = useState(false);
  useEffect(() => setSignedUp(hasSignedUp('scrapwrk')), []);

  return (
    <>
      <div className={`flex items-end justify-between gap-3 ${headerClassName}`} style={headerStyle}>
        {title}
        <div className="flex items-center gap-3">
          <BagButton onOpen={() => setBagOpen(true)} />
          {titleEnd}
        </div>
      </div>
      <StoreGrid
        active={active}
        sizes={sizes}
        onOpen={openProduct}
        onNotify={() => (signedUp ? notify('You’re on the list for the next drop') : setNotifyOpen(true))}
      />
      <ProductSheet product={open} onClose={closeProduct} onBuy={buy} onOpenBag={() => { setOpen(null); setBagOpen(true); }} busy={busy} />
      <BagSheet isOpen={bagOpen} onClose={() => setBagOpen(false)} onBuy={buy} busy={busy} />
      <NotifySheet source="scrapwrk" isOpen={notifyOpen} onClose={() => setNotifyOpen(false)} onDone={() => setSignedUp(true)} />
    </>
  );
}
