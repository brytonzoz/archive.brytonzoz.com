'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { cardSource, transitionCard, type CardSource } from '../../lib/card-motion';
import { useMerch } from '../../lib/merch-client';
import { MERCH_PATH, merchPath, type MerchProduct } from '../../lib/merch-shared';
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
const SUGGESTIONS = ['hoodie', 'tee', 'rainbow', 'mug', 'sticker', 'hat', 'poster'];

// What people type for what the catalog calls something else.
const SYNONYMS: Record<string, string> = {
  shirt: 'tee', tshirt: 'tee', 't-shirt': 'tee', sweatshirt: 'hoodie', sweater: 'crewneck', hat: 'trucker', cap: 'trucker',
  cup: 'mug', coffee: 'mug', pin: 'button', badge: 'button', decal: 'sticker', case: 'case', iphone: 'phone', bag: 'tote',
  pants: 'sweatpants', joggers: 'sweatpants', print: 'poster', wall: 'poster', kid: 'kids', baby: 'baby', dog: 'pet',
};
const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
const stem = (word: string) => (word.length > 3 ? word.replace(/(es|s)$/, '') : word);
// Each product's searchable words, worked out once.
const haystacks = new WeakMap<MerchProduct, string>();
const haystack = (product: MerchProduct) => {
  let text = haystacks.get(product);
  if (text === undefined) {
    text = words([product.displayName, product.lineName, product.category, product.blank, 'nonparallel', ...product.colors.map((color) => color.name)].join(' ')).map(stem).join(' ');
    haystacks.set(product, text);
  }
  return text;
};

function matches(product: MerchProduct, query: string[]) {
  const text = haystack(product);
  return query.every((word) => text.includes(stem(SYNONYMS[word] ?? word)));
}

// One observer for every tile: a tile's shimmer only runs while it's near the screen (and until its
// photo arrives), so the tiles further down don't keep the phone busy.
let tileObserver: IntersectionObserver | null = null;
function watchTile(node: HTMLElement) {
  tileObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-near', entry.isIntersecting);
  }, { rootMargin: '200px 0px' });
  tileObserver.observe(node);
  return () => tileObserver?.unobserve(node);
}

type ShopProps = { title?: React.ReactNode; initialProduct?: string; headingLevel?: 1 | 2 };

// The catalog arrives separately (lib/merch-client.ts): on the homepage it's fetched in the
// background and is ready long before anyone scrolls this far; until then the space is kept.
export function MerchShop(props: ShopProps) {
  const merch = useMerch(false);
  if (!merch) return <div className="min-h-screen" aria-busy="true" />;
  return <MerchShopView {...props} merch={merch} />;
}

function MerchShopView({
  merch,
  title,
  initialProduct,
  headingLevel = 2,
}: ShopProps & { merch: NonNullable<ReturnType<typeof useMerch>> }) {
  const { getMerch, merchCategories, merchProducts } = merch;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('featured');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<MerchProduct | null>(null);
  const source = useRef<CardSource | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const { busy, buy } = useCheckout();
  const sentinel = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [searching, setSearching] = useState(false);
  // Enters like the scenes above it: once it scrolls into view the heading rises in out of a blur
  // and the cards flip in one after another.
  const sectionRef = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRevealed(true);
        observer.disconnect();
      }
    }, { threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Deep in the grid, a small "Top" button brings the search and filters back.
  useEffect(() => {
    const onScroll = () => {
      const top = topRef.current?.getBoundingClientRect().top ?? 0;
      setShowTop(top < -window.innerHeight * 1.2);
    };
    // Scroll events don't bubble, but a capturing listener hears the homepage's scroll container too.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // "/" jumps to search (desktop), unless you're already typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || target?.closest('input, textarea, [contenteditable="true"]')) return;
      const box = searchRef.current;
      if (!box || !box.getClientRects().length) return;
      event.preventDefault();
      box.focus({ preventScroll: true });
      topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const initial = initialProduct ? getMerch(initialProduct) : undefined;
    if (initial) setOpen(initial);
  }, [getMerch, initialProduct]);

  const results = useMemo(() => {
    const terms = words(deferredQuery);
    const list = merchProducts.filter((product) => (!category || product.category === category) && matches(product, terms));
    if (sort === 'low') list.sort((a, b) => a.price - b.price);
    if (sort === 'high') list.sort((a, b) => b.price - a.price);
    return list;
  }, [merchProducts, deferredQuery, category, sort]);

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

  const openProduct = useCallback((product: MerchProduct, element: HTMLButtonElement) => {
    source.current = cardSource(element);
    transitionCard(source.current, () => setOpen(product), true);
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', merchPath(product));
  }, []);
  const closeProduct = useCallback(() => {
    setOpen(null);
    if (window.location.pathname.startsWith(MERCH_PATH)) window.history.replaceState(window.history.state, '', MERCH_PATH);
  }, []);

  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section ref={sectionRef} aria-labelledby="shop-title" className={`shop ${revealed ? 'is-revealed' : ''}`}>
      <div className="shop-rise flex items-end justify-between gap-4" style={{ '--d': '0ms' } as React.CSSProperties}>
        <div className="min-w-0">
          {title}
          {/* The /nonparallel/ page shows the logo instead; the homepage says the name. */}
          {title ? null : <p className="shop-eyebrow">NONPARALLEL</p>}
          <Heading id="shop-title" className="shop-title">Shop</Heading>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden text-[13px] text-white/50 sm:block">Printed to order · US shipping included</p>
          <BagButton onOpen={() => setBagOpen(true)} />
        </div>
      </div>

      <div ref={topRef} className="shop-controls shop-rise" style={{ '--d': '90ms' } as React.CSSProperties}>
        <div className="flex gap-2">
          <label className="shop-search">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.4" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            <span className="sr-only">Search the shop</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearching(true)}
              onBlur={() => window.setTimeout(() => setSearching(false), 150)}
              placeholder="Search"
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
        {searching && !query ? (
          // Focused but empty: a few things people look for, one tap each.
          <div className="shop-suggest" aria-label="Suggestions">
            {SUGGESTIONS.map((word) => (
              <button key={word} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(word)} className="shop-suggest-item">
                {word}
              </button>
            ))}
          </div>
        ) : null}
        <div className="shop-chips" role="group" aria-label="Category">
          <button type="button" aria-pressed={!category} onClick={() => chooseCategory(null)} className="shop-chip">All</button>
          {merchCategories.map((name) => (
            <button key={name} type="button" aria-pressed={category === name} onClick={() => chooseCategory(category === name ? null : name)} className="shop-chip">
              {name}
            </button>
          ))}
        </div>
      </div>

      <p className="shop-rise mt-4 text-[13px] text-white/45 sm:mt-5" style={{ '--d': '160ms' } as React.CSSProperties} aria-live="polite">{results.length} {results.length === 1 ? 'item' : 'items'}</p>
      {results.length ? (
        <ul className="shop-grid !mt-3">
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
      <button
        type="button"
        onClick={() => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
        className={`shop-top ${showTop ? 'is-shown' : ''}`}
        tabIndex={showTop ? 0 : -1}
        aria-hidden={!showTop}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Top
      </button>

      <MerchSheet product={open} source={source.current} onClose={closeProduct} onBuy={buy} busy={busy} />
      <BagSheet isOpen={bagOpen} onClose={() => setBagOpen(false)} onBuy={buy} busy={busy} />
    </section>
  );
}

const ShopTile = React.memo(function ShopTile({ product, onOpen }: { product: MerchProduct; onOpen: (product: MerchProduct, element: HTMLButtonElement) => void }) {
  const color = product.colors[0];
  const second = color.images[1];
  const view = color.views?.[0];
  const altView = second ? color.views?.[1] : undefined;
  const sideLabel = (side: string) => (side === 'front' ? 'Front' : 'Back');
  const price = `${product.priceVaries ? 'From ' : ''}${formatPrice(product.price)}`;
  // The shimmer stops once the photo is in (it may already be, from the cache, before this runs).
  const photoRef = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const node = photoRef.current;
    if (!node) return;
    if (node.querySelector('img')?.complete) setLoaded(true);
    return watchTile(node);
  }, []);
  // The second photo only shows on hover with a mouse, so it's only fetched once a mouse arrives:
  // phones never download it.
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={(event) => onOpen(product, event.currentTarget)}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true); }}
      aria-label={`${product.displayName}, ${price}`}
      className={`shop-tile group ${altView && altView !== view ? 'has-alt' : ''}`}
    >
      <span ref={photoRef} className={`shop-tile-photo ${loaded ? 'is-loaded' : ''}`}>
        <ResponsiveImage asset={color.images[0]} alt="" sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 46vw" loading="lazy" draggable={false} className="shop-tile-img" onLoad={() => setLoaded(true)} />
        {second && hovered ? (
          <ResponsiveImage asset={second} alt="" sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 46vw" draggable={false} className="shop-tile-img shop-tile-img-alt" />
        ) : null}
        {view ? <span className="shop-tile-side shop-tile-side-main" aria-hidden="true">{sideLabel(view)}</span> : null}
        {altView && altView !== view ? <span className="shop-tile-side shop-tile-side-alt" aria-hidden="true">{sideLabel(altView)}</span> : null}
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
