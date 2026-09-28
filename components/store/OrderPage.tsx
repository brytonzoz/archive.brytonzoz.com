'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { track } from '../../lib/analytics';
import { MERCH_PATH, merchKey, merchVariant } from '../../lib/merch';
import { formatPrice, productById, STORE_PATH } from '../../lib/store';
import { finishCheckout } from '../../lib/store-client';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { SiteFooter } from '../SiteFooter';

type Order = {
  paid: boolean;
  status?: string;
  items: string[];
  merch?: string | null;
  amountTotal: number | null;
  email: string | null;
  name: string | null;
  city: string | null;
};

// "variantId:qty,…" from the checkout, as bag keys with quantities.
const teeLines = (value?: string | null) =>
  (value ?? '').split(',').map((part) => {
    const [id, quantity] = part.split(':').map(Number);
    return { key: merchKey(id), quantity };
  }).filter((line) => line.quantity > 0 && merchVariant(line.key));

const rowClass = 'flex items-center gap-4 rounded-[20px] bg-white/[0.06] p-3 ring-1 ring-inset ring-white/[0.08]';

// Where Stripe sends the buyer after paying: /scrapwrk/order/?session_id=…
export function OrderPage() {
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId) {
      setState('missing');
      return;
    }
    fetch(`/api/order?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: Order) => {
        setOrder(body);
        setState('ready');
        if (body.paid) {
          finishCheckout([...body.items, ...teeLines(body.merch).map((line) => line.key)]);
          // Counted once per order, even if the page is reloaded.
          const key = `bz.order.${sessionId}`;
          try {
            if (!window.localStorage.getItem(key)) {
              window.localStorage.setItem(key, '1');
              track({ type: 'purchase', detail: [...body.items, ...teeLines(body.merch).map((line) => `${line.key}x${line.quantity}`)].join(',') });
            }
          } catch {
            // Storage blocked: skip the metric rather than risk counting twice.
          }
        }
      })
      .catch(() => setState('missing'));
  }, []);

  const firstName = order?.name?.split(' ')[0];
  const tees = teeLines(order?.merch);
  const onlyTees = Boolean(order && tees.length && !order.items.length);

  return (
    <div className="store-page min-h-screen text-white">
      <div className="mx-auto max-w-[480px] px-5 pb-16 pt-16 sm:pt-24">
        {state === 'loading' ? (
          <div className="flex justify-center py-24" role="status" aria-label="Loading your order">
            <span className="player-spinner h-8 w-8 rounded-full" />
          </div>
        ) : state === 'ready' && order?.paid ? (
          <div className="order-enter text-center">
            <span className="notify-check mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-black">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="mt-6 text-[32px] font-bold leading-tight tracking-[-0.03em]">{firstName ? `Thank you, ${firstName}` : 'Thank you'}</h1>
            <p className="mt-2 text-[16px] text-white/60">
              {order.email ? <>A receipt is on its way to {order.email}.</> : 'Your order is confirmed.'}
              {order.city ? <> Shipping to {order.city}.</> : null}
            </p>
            <ul className="mt-8 space-y-3 text-left">
              {order.items.map((id) => {
                const product = productById(id);
                if (!product) return null;
                return (
                  <li key={id} className={rowClass}>
                    <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px]" style={placeholderBackground(product.images[0])}>
                      <ResponsiveImage asset={product.images[0]} alt="" sizes="80px" className="absolute inset-0 h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold tracking-[0.16em] text-white/45">SCRAPWRK {product.number}</span>
                      <span className="block text-[18px] font-semibold">{product.name}</span>
                      <span className="block text-[13px] text-white/45">1 of 1 · Size {product.size}</span>
                    </span>
                    <span className="shrink-0 text-[16px] font-semibold tabular-nums">{formatPrice(product.price)}</span>
                  </li>
                );
              })}
              {tees.map(({ key, quantity }) => {
                const { product, color, size } = merchVariant(key)!;
                return (
                  <li key={key} className={rowClass}>
                    <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[14px] bg-white">
                      <ResponsiveImage asset={color.images[0]} alt="" sizes="80px" className="absolute inset-0 h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold tracking-[0.16em] text-white/45">NONPARALLEL {product.number}</span>
                      <span className="block text-[18px] font-semibold">{product.name} Tee{quantity > 1 ? ` × ${quantity}` : ''}</span>
                      <span className="block text-[13px] text-white/45">{color.name} · Size {size.size} · Printed to order</span>
                    </span>
                    <span className="shrink-0 text-[16px] font-semibold tabular-nums">{formatPrice(size.price * quantity)}</span>
                  </li>
                );
              })}
            </ul>
            {order.amountTotal !== null ? (
              <p className="mt-4 flex justify-between px-1 text-[15px] text-white/55">
                <span>Total paid</span>
                <span className="font-semibold tabular-nums text-white">{formatPrice(order.amountTotal)}</span>
              </p>
            ) : null}
            <Link href="/" className="mt-10 inline-flex h-[52px] items-center rounded-full bg-white px-7 text-[16px] font-semibold text-black transition-transform active:scale-[0.98]">
              Back to Bryton Zoz
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <h1 className="text-[28px] font-bold tracking-[-0.03em]">{state === 'ready' ? 'Payment not finished' : 'Order not found'}</h1>
            <p className="mt-2 text-[16px] text-white/55">
              {state === 'ready' ? 'Nothing was charged. Everything is still in your bag.' : 'If you paid, your receipt email has the details.'}
            </p>
            <Link href={onlyTees ? MERCH_PATH : STORE_PATH} className="mt-8 inline-flex h-[52px] items-center rounded-full bg-white px-7 text-[16px] font-semibold text-black">
              {onlyTees ? 'Back to NonParallel' : 'Back to Scrapwrk'}
            </Link>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
