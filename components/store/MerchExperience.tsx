'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useMerch } from '../../lib/merch-client';
import { MERCH_PATH, merchPath, type MerchCard, type MerchProduct } from '../../lib/merch-shared';
import { BagButton, BagSheet, useCheckout } from './Bag';
import { MerchGrid } from './MerchGrid';
import { MerchSheet } from './MerchSheet';

// NonParallel on the homepage: the heading row, the best sellers (2x2, like Scrapwrk), a piece's
// sheet, the shared bag and checkout, and whatever goes under the grid (the "scroll for more" hint).
export function MerchExperience({
  active,
  initialProduct,
  sizes,
  title,
  titleEnd,
  intro,
  footer,
  headerClassName = '',
}: {
  active: boolean;
  initialProduct?: string;
  sizes?: string;
  title: React.ReactNode;
  titleEnd?: React.ReactNode;
  intro?: React.ReactNode;
  footer?: React.ReactNode;
  headerClassName?: string;
}) {
  const [open, setOpen] = useState<{ product: MerchProduct; color?: string } | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const { busy, buy } = useCheckout();
  // The homepage starts loading the catalog once it's up (app/page.tsx), not when this mounts.
  const merch = useMerch(false);

  useEffect(() => {
    const initial = initialProduct ? merch?.getMerch(initialProduct) : undefined;
    if (initial) setOpen({ product: initial });
  }, [merch, initialProduct]);

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
        cards={merch?.merchCards ?? null}
        active={active}
        sizes={sizes}
        onOpen={openCard}
      />
      {footer}
      <MerchSheet product={open?.product ?? null} initialColor={open?.color} onClose={closeProduct} onBuy={buy} busy={busy} />
      <BagSheet isOpen={bagOpen} onClose={() => setBagOpen(false)} onBuy={buy} busy={busy} />
    </>
  );
}
