'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { getMerch, MERCH_PATH, merchCategories, merchPath, merchProducts, type MerchProduct } from '../../lib/merch';
import { formatPrice } from '../../lib/store';
import { ResponsiveImage } from '../ResponsiveImage';
import { BagButton, BagSheet, useCheckout } from './Bag';
import { MerchSheet } from './MerchSheet';

// The NonParallel shop: everything Printify makes for the label (tees to stickers to bottles), with
// search, a category row and sorting over one grid that keeps loading as you scroll. Tapping a
// piece opens its sheet; the bag and checkout are the same as the rest of the site's, and the
// player keeps going throughout. On the homepage (below the scenes) and at /nonparallel/.

type Sort = 'featured' | 'low' | 'high';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'low', label: 'Lowest price' },
  { value: 'high', label: 'Highest price' },
];
const PAGE = 24;

// What people type for what the catalog calls something else.
const SYNONYMS: Record<string, string> = {
  shirt: 'tee', tshirt: 'tee', 't-shirt': 'tee', sweatshirt: 'hoodie', sweater: 'crewneck', hat: 'trucker', cap: 'trucker',
  cup: 'mug', coffee: 'mug', pin: 'button', badge: 'button', decal: 'sticker', case: 'case', iphone: 'phone', bag: 'tote',
  pants: 'sweatpants', joggers: 'sweatpants', print: 'poster', wall: 'poster', kid: 'kids', baby: 'baby', dog: 'pet',
};
const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
const stem = (word: string) => (word.length > 3 ? word.replace(/(es|s)$/, '') : word);
const haystack = new Map(merchProducts.map((product) => [
  product.slug,
  words([product.displayName, product.lineName, product.category, product.blank, 'nonparallel', ...product.colors.map((color) => color.name)].join(' ')).map(stem).join(' '),
]));

function matches(product: MerchProduct, query: string[]) {
  const text = haystack.get(product.slug) ?? '';
  return query.every((word) => text.includes(stem(SYNONYMS[word] ?? word)));
}

export function MerchShop({
  title,
  initialProduct,
  headingLevel = 2,
}: {
  title?: React.ReactNode;
  initialProduct?: string;
  headingLevel?: 1 | 2;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('featured');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<MerchProduct | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const { busy, buy } = useCheckout();
  const sentinel = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const initial = initialProduct ? getMerch(initialProduct) : undefined;
    if (initial) setOpen(initial);
  }, [initialProduct]);

  const results = useMemo(() => {
    const terms = words(deferredQuery);
    const list = merchProducts.filter((product) => (!category || product.category === category) && matches(product, terms));
    if (sort === 'low') list.sort((a, b) => a.price - b.price);
    if (sort === 'high') list.sort((a, b) => b.price - a.price);
    return list;
  }, [deferredQuery, category, sort]);

  // A new search or filter starts from the top of the grid.
  useEffect(() => setShown(PAGE), [deferredQuery, category, sort]);

  // Keep loading as the end of the grid comes near.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown >= results.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown((count) => count + PAGE);
    }, { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, results.length]);

  const chooseCategory = (next: string | null) => {
    setCategory(next);
    // Bring the grid's top into view when a filter would otherwise leave you deep in it.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const openProduct = useCallback((product: MerchProduct) => {
    setOpen(product);
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', merchPath(product));
  }, []);
  const closeProduct = useCallback(() => {
    setOpen(null);
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', MERCH_PATH);
  }, []);

  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const counts = useMemo(() => new Map(merchCategories.map((name) => [name, merchProducts.filter((product) => product.category === name).length])), []);

  return (
    <section aria-labelledby="shop-title" className="shop">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {title}
          <Heading id="shop-title" className="shop-title">Shop NonParallel</Heading>
          <p className="mt-1.5 text-[14px] text-white/60">{merchProducts.length} pieces · printed to order · US shipping included</p>
        </div>
        <BagButton onOpen={() => setBagOpen(true)} />
      </div>

      <div ref={topRef} className="shop-controls">
        <div className="flex gap-2">
          <label className="shop-search">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            <span className="sr-only">Search the shop</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search hoodies, mugs, stickers…"
              enterKeyHint="search"
              autoComplete="off"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="shop-search-clear">×</button>
            ) : null}
          </label>
          <label className="shop-sort">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </label>
        </div>
        <div className="shop-chips" role="group" aria-label="Category">
          <button type="button" aria-pressed={!category} onClick={() => chooseCategory(null)} className="shop-chip">All</button>
          {merchCategories.map((name) => (
            <button key={name} type="button" aria-pressed={category === name} onClick={() => chooseCategory(category === name ? null : name)} className="shop-chip">
              {name}<span className="shop-chip-count">{counts.get(name)}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{results.length} {results.length === 1 ? 'result' : 'results'}</p>
      {results.length ? (
        <ul className="shop-grid">
          {results.slice(0, shown).map((product, index) => (
            <li key={product.slug} className="shop-tile-wrap" style={{ '--i': index % PAGE } as React.CSSProperties}>
              <ShopTile product={product} onOpen={openProduct} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="shop-empty">
          <p className="text-[17px] font-semibold text-white">Nothing matches “{query}”</p>
          <p className="mt-1 text-[14px] text-white/60">Try “hoodie”, “mug” or “sticker”.</p>
          <button type="button" onClick={() => { setQuery(''); setCategory(null); }} className="shop-chip mt-4" aria-pressed="false">Show everything</button>
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" />

      <MerchSheet product={open} onClose={closeProduct} onBuy={buy} busy={busy} />
      <BagSheet isOpen={bagOpen} onClose={() => setBagOpen(false)} onBuy={buy} busy={busy} />
    </section>
  );
}

const ShopTile = React.memo(function ShopTile({ product, onOpen }: { product: MerchProduct; onOpen: (product: MerchProduct) => void }) {
  const color = product.colors[0];
  const second = color.images[1];
  const price = `${product.priceVaries ? 'From ' : ''}${formatPrice(product.price)}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      aria-label={`${product.displayName}, ${price}`}
      className="shop-tile group"
    >
      <span className="shop-tile-photo">
        <ResponsiveImage asset={color.images[0]} alt="" sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 46vw" loading="lazy" draggable={false} className="shop-tile-img" />
        {second ? (
          <ResponsiveImage asset={second} alt="" sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 46vw" loading="lazy" draggable={false} className="shop-tile-img shop-tile-img-alt" />
        ) : null}
        {product.colors.length > 1 ? (
          <span className="shop-tile-swatches" aria-hidden="true">
            {product.colors.slice(0, 4).map((option) => <span key={option.slug} style={{ background: option.swatch }} />)}
          </span>
        ) : null}
      </span>
      <span className="shop-tile-meta">
        <span className="shop-tile-name">{product.displayName}</span>
        <span className="shop-tile-price">{price}</span>
      </span>
    </button>
  );
});
