'use client';

// Listed receipts pinned on a cork board. Six on the homepage; endless masonry on the wall.
// Crumple is localStorage only — the pile API is read, never written, from here.
import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PileReceipt, PileResponse } from '../../../lib/shipped-pile';
import { layoutWall, readCrumpled, setCrumpled, wallColumns, wallGutter, type WallCard } from '../../../lib/shipped-wall';
import { press } from '../feel';
import { useShippedState } from '../state';
import { WallFocus } from './WallFocus';
import { WallSlip } from './WallSlip';
import styles from './ReceiptWall.module.css';

const PAGE = 24;
const PREVIEW_COUNT = 6;
const BUFFER = 720;
const RETRIES = 3;
const FETCH_MS = 4_000;

function asReceipt(row: Partial<PileReceipt> & { id: number; who?: string }): PileReceipt | null {
  if (!Number.isSafeInteger(row.id) || row.id < 1) return null;
  const items = Array.isArray(row.items)
    ? row.items
        .filter((item): item is { name: string; status: string } => Boolean(item && typeof item.name === 'string'))
        .map((item) => ({ name: item.name, status: typeof item.status === 'string' ? item.status : '' }))
    : [];
  return {
    id: row.id,
    who: typeof row.who === 'string' && row.who ? row.who : `#${row.id}`,
    count: Number.isFinite(row.count) ? Number(row.count) : items.length,
    potential: Boolean(row.potential),
    full: Boolean(row.full),
    items,
    printedAt: typeof row.printedAt === 'string' ? row.printedAt : '',
  };
}

async function fetchPile(before?: number | null, limit = PAGE): Promise<PileResponse> {
  const url = new URL('/api/shipped/pile', window.location.origin);
  url.searchParams.set('limit', String(limit));
  if (before) url.searchParams.set('before', String(before));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_MS) });
  if (!response.ok) throw new Error('pile');
  const page = (await response.json()) as PileResponse;
  const receipts = (page.receipts ?? []).flatMap((row) => asReceipt(row) ?? []);
  return { ...page, receipts, next: page.next ?? null, total: page.total ?? receipts.length };
}

class WallCatch extends Component<{ children: React.ReactNode; page: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <section className={`shipped-wall${this.props.page ? ' is-page' : ''}`} data-wall="" aria-label="The wall">
          <header className="shipped-wall-head">
            <h2>The wall</h2>
            {!this.props.page ? <a className={styles.openWall} href="/wall/">Open wall →</a> : null}
          </header>
          <div className={`shipped-wall-board ${styles.board}`} style={{ height: 280 }}>
            <div className={styles.boardEmpty}>
              <p>Receipts couldn’t load.</p>
              <button type="button" onClick={() => window.location.reload()}>Reload receipts</button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

export function ReceiptWall({ page = false }: { page?: boolean }) {
  return (
    <WallCatch page={page}>
      <ReceiptWallBoard page={page} />
    </WallCatch>
  );
}

function ReceiptWallBoard({ page = false }: { page?: boolean }) {
  const state = useShippedState();
  const board = useRef<HTMLDivElement>(null);
  const [receipts, setReceipts] = useState<PileReceipt[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(320);
  const [view, setView] = useState({ top: 0, height: 800 });
  const [crumpled, setCrumpledIds] = useState<Set<number>>(() => new Set());
  const [imageRatios, setImageRatios] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [reduced, setReduced] = useState(false);
  const loading = useRef(false);
  const tries = useRef(0);
  const rememberImage = useCallback((id: number, image: HTMLImageElement) => {
    const ratio = image.naturalHeight / image.naturalWidth;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setImageRatios((current) => {
      if (current.get(id) === ratio) return current;
      return new Map(current).set(id, ratio);
    });
  }, []);

  useEffect(() => {
    setCrumpledIds(new Set(readCrumpled()));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const load = useCallback(async (before?: number | null) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetchPile(before, page ? PAGE : PREVIEW_COUNT);
      if (page && !before && response.receipts.length === 0 && response.next != null && tries.current < RETRIES) {
        tries.current += 1;
        loading.current = false;
        void load(response.next);
        return;
      }
      setReceipts((current) => {
        if (!page) return response.receipts.slice(0, PREVIEW_COUNT);
        const seen = new Set(current.map((row) => row.id));
        return before ? [...current, ...response.receipts.filter((row) => !seen.has(row.id))] : response.receipts;
      });
      setNext(page ? response.next : null);
      setTotal(response.total);
      setFailed(false);
      setReady(true);
    } catch {
      if (!before && tries.current < RETRIES) {
        tries.current += 1;
        window.setTimeout(() => {
          loading.current = false;
          void load();
        }, 400 * tries.current);
        return;
      }
      setFailed(true);
      setReady(true);
    } finally {
      loading.current = false;
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (receipts.length || !ready || !state?.recent?.length) return;
    const fallback = state.recent.flatMap((row) => asReceipt({ id: row.id, who: row.who, count: row.count, potential: row.potential, full: row.full, items: [] }) ?? []);
    if (fallback.length) {
      setReceipts(page ? fallback : fallback.slice(0, PREVIEW_COUNT));
      setTotal((n) => n || state.piled || fallback.length);
    }
  }, [ready, receipts.length, state, page]);

  useEffect(() => {
    const node = board.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setWidth(Math.max(280, Math.round(rect.width)));
      setView({ top: -rect.top, height: window.innerHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure);
    };
  }, [ready, receipts.length]);

  const cols = page ? wallColumns(width) : Math.min(3, wallColumns(width));
  const gutter = wallGutter(width);
  const { cards, height } = useMemo(
    () => layoutWall(receipts, crumpled, width, cols, gutter, imageRatios),
    [receipts, crumpled, width, cols, gutter, imageRatios],
  );
  const byId = useMemo(() => new Map(receipts.map((row) => [row.id, row])), [receipts]);
  const visible = useMemo(() => {
    if (!page) return cards;
    const lo = view.top - BUFFER;
    const hi = view.top + view.height + BUFFER;
    const inView = cards.filter((card) => card.y + card.h >= lo && card.y <= hi);
    return inView.length ? inView : cards.slice(0, 16);
  }, [cards, view, page]);

  useEffect(() => {
    if (!page || !receipts.length || next === null) return;
    const last = cards[cards.length - 1];
    if (last && last.y < view.top + view.height + BUFFER * 2) void load(next);
  }, [page, receipts.length, next, cards, view, load]);

  const focused = focus !== null ? byId.get(focus) ?? null : null;
  const empty = receipts.length === 0;

  return (
    <section className={`shipped-wall${page ? ' is-page' : ''}`} data-wall="" aria-label="The wall">
      <header className="shipped-wall-head">
        <h2>The wall</h2>
        <div className={styles.headActions}>
          <p>{empty ? (ready ? (failed ? 'Unavailable' : 'Nothing pinned yet') : 'Loading…') : `${total} pinned`}</p>
          {!page ? <a className={styles.openWall} href="/wall/">Open wall →</a> : null}
        </div>
      </header>
      <div ref={board} className={`shipped-wall-board ${styles.board}`} style={{ height: empty && !ready ? 520 : Math.max(height, 280) }}>
        {empty && !ready ? <WallSkeleton width={width} count={page ? 8 : PREVIEW_COUNT} /> : null}
        {empty && ready ? (
          <div className={styles.boardEmpty} role="status">
            <p>{failed ? 'Receipts couldn’t load right now.' : 'No receipts pinned yet.'}</p>
            {failed ? (
              <button type="button" onClick={() => { tries.current = 0; setReady(false); void load(); }}>Try again</button>
            ) : page ? <a href="/">Print your receipt →</a> : null}
          </div>
        ) : null}
        {visible.map((card) => {
          const receipt = byId.get(card.id);
          if (!receipt) return null;
          return (
            <WallPin
              key={card.id}
              card={card}
              receipt={receipt}
              crumpled={crumpled.has(card.id)}
              reduced={reduced}
              parallax={reduced ? 0 : ((card.id % 5) - 2) * Math.max(-80, Math.min(80, view.top)) * 0.028}
              onOpen={() => setFocus(card.id)}
              onImageLoad={(image) => rememberImage(card.id, image)}
            />
          );
        })}
      </div>
      {focused ? (
        <WallFocus
          receipt={focused}
          crumpled={crumpled.has(focused.id)}
          reduced={reduced}
          onClose={() => setFocus(null)}
          onCrumple={() => setCrumpledIds(new Set(setCrumpled(focused.id, true)))}
          onUncrumple={() => setCrumpledIds(new Set(setCrumpled(focused.id, false)))}
        />
      ) : null}
    </section>
  );
}

function WallSkeleton({ width, count = 8 }: { width: number; count?: number }) {
  const dummies = Array.from({ length: count }, (_, i) => ({ id: -(i + 1), items: [{ name: '—' }, { name: '—' }, { name: '—' }] }));
  const { cards, height } = layoutWall(dummies, new Set(), width, wallColumns(width));
  return (
    <div className="shipped-wall-skel" style={{ height }} aria-hidden="true">
      {cards.map((card) => (
        <div
          key={card.id}
          className="shipped-wall-skel-pin"
          style={{
            width: card.w,
            height: card.h,
            transform: `translate3d(${card.x}px, ${card.y}px, 0) rotate(${card.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function WallPin({
  card,
  receipt,
  crumpled,
  reduced,
  parallax,
  onOpen,
  onImageLoad,
}: {
  card: WallCard;
  receipt: PileReceipt;
  crumpled: boolean;
  reduced: boolean;
  parallax: number;
  onOpen: () => void;
  onImageLoad: (image: HTMLImageElement) => void;
}) {
  const rotate = reduced ? 0 : card.rotate;
  return (
    <button
      type="button"
      className={`shipped-wall-pin ${styles.pin} is-${card.kind}${crumpled ? ' is-crumpled' : ''}`}
      data-wall-pin={card.id}
      data-crumpled={crumpled ? 'true' : 'false'}
      style={{
        width: card.w,
        height: card.h,
        transform: `translate3d(${card.x}px, ${card.y + parallax}px, 0) rotate(${rotate}deg)`,
      }}
      aria-label={`${receipt.who}, ${receipt.potential ? 'potential' : `${receipt.count} shipped`}${crumpled ? ', crumpled for you' : ''}`}
      onPointerDown={press}
      onClick={onOpen}
    >
      {card.kind === 'pin' ? (
        <span className={`shipped-wall-tack is-${card.pinColor}`} style={{ left: `${card.pinX * 100}%` }} aria-hidden="true" />
      ) : (
        <span className="shipped-wall-tape" aria-hidden="true" />
      )}
      {crumpled ? <span className="shipped-wall-ball" aria-hidden="true" /> : (
        <>
          <WallSlip receipt={receipt} onImageLoad={onImageLoad} />
          <span className={styles.pinCaption} aria-hidden="true">
            <span>{receipt.who}</span>
            <small>{receipt.potential ? 'Potential' : `${receipt.count} shipped`}</small>
          </span>
        </>
      )}
    </button>
  );
}
