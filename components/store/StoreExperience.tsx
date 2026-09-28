'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getProduct, productPath, STORE_PATH, type Product } from '../../lib/store';
import { refreshAvailability } from '../../lib/store-client';
import { NotifySheet, hasSignedUp } from '../NotifySheet';
import { usePlayer } from '../player/context';
import { BagButton, BagSheet, useCheckout } from './Bag';
import { ProductSheet } from './ProductSheet';
import { StoreGrid } from './StoreGrid';

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
  const { busy, buy } = useCheckout();

  useEffect(() => {
    refreshAvailability();
    const initial = initialProduct ? getProduct(initialProduct) : undefined;
    if (initial) setOpen(initial);
  }, [initialProduct]);

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
