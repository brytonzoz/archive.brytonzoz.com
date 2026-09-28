'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getMerch, MERCH_PATH, merchPath, type MerchCard, type MerchProduct } from '../../lib/merch';
import { NotifySheet, hasSignedUp } from '../NotifySheet';
import { usePlayer } from '../player/context';
import { BagButton, BagSheet, useCheckout } from './Bag';
import { MerchGrid } from './MerchGrid';
import { MerchSheet } from './MerchSheet';

// NonParallel: the heading row, the tee grid, a tee's sheet, the shared bag and checkout.
// Used by the homepage scene and by /nonparallel/ (and each tee's page, which opens its sheet).
export function MerchExperience({
  active,
  initialProduct,
  sizes,
  columns,
  title,
  titleEnd,
  intro,
  headerClassName = '',
}: {
  active: boolean;
  initialProduct?: string;
  sizes?: string;
  columns?: 2 | 3;
  title: React.ReactNode;
  titleEnd?: React.ReactNode;
  intro?: React.ReactNode;
  headerClassName?: string;
}) {
  const { notify } = usePlayer();
  const [open, setOpen] = useState<{ product: MerchProduct; color?: string } | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const { busy, buy } = useCheckout();

  useEffect(() => {
    setSignedUp(hasSignedUp('nonparallel'));
    const initial = initialProduct ? getMerch(initialProduct) : undefined;
    if (initial) setOpen({ product: initial });
  }, [initialProduct]);

  const openCard = useCallback(({ product, color, perColor }: MerchCard) => {
    setOpen({ product, color: perColor ? color.slug : undefined });
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', merchPath(product));
  }, []);

  const closeProduct = useCallback(() => {
    setOpen(null);
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', MERCH_PATH);
  }, []);

  return (
    <>
      <div className={`flex items-center justify-between gap-3 ${headerClassName}`}>
        {title}
        <div className="flex items-center gap-3">
          <BagButton onOpen={() => setBagOpen(true)} />
          {titleEnd}
        </div>
      </div>
      {intro}
      <MerchGrid
        active={active}
        sizes={sizes}
        columns={columns}
        onOpen={openCard}
        onNotify={() => (signedUp ? notify('You’re on the list for new designs') : setNotifyOpen(true))}
      />
      <MerchSheet product={open?.product ?? null} initialColor={open?.color} onClose={closeProduct} onBuy={buy} busy={busy} />
      <BagSheet isOpen={bagOpen} onClose={() => setBagOpen(false)} onBuy={buy} busy={busy} />
      <NotifySheet source="nonparallel" isOpen={notifyOpen} onClose={() => setNotifyOpen(false)} onDone={() => setSignedUp(true)} />
    </>
  );
}
