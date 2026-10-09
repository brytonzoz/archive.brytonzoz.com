'use client';

// Endless masonry of listed receipts, pinned on a cork board. Tap one to lift it, drag to spin.
// Crumple is localStorage only — the pile API is read, never written, from here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PileReceipt, PileResponse } from '../../../lib/shipped-pile';
import { layoutWall, readCrumpled, setCrumpled, wallColumns, type WallCard } from '../../../lib/shipped-wall';
import { WallFocus } from './WallFocus';
import { WallSlip } from './WallSlip';

const PAGE = 24;
const BUFFER = 720;
const RETRIES = 3;

async function fetchPile(before?: number | null): Promise<PileResponse> {
  const url = new URL('/api/shipped/pile', window.location.origin);
  url.searchParams.set('limit', String(PAGE));
  if (before) url.searchParams.set('before', String(before));
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('pile');
  return response.json() as Promise<PileResponse>;
}

export function ReceiptWall({ page = false }: { page?: boolean }) {
  const board = useRef<HTMLDivElement>(null);
  const [receipts, setReceipts] = useState<PileReceipt[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(390);
  const [view, setView] = useState({ top: 0, height: 800 });
  const [crumpled, setCrumpledIds] = useState<Set<number>>(() => new Set());
  const [focus, setFocus] = useState<number | null>(null);
  const [reduced, setReduced] = useState(false);
  const loading = useRef(false);
  const tries = useRef(0);

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
      const page = await fetchPile(before);
      if (!before && page.receipts.length === 0) throw new Error('empty');
      setReceipts((current) => {
        const seen = new Set(current.map((row) => row.id));
        return before ? [...current, ...page.receipts.filter((row) => !seen.has(row.id))] : page.receipts;
      });
      setNext(page.next);
      setTotal(page.total);
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
      setReady(true);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const cols = wallColumns(width);
  const { cards, height } = useMemo(
    () => layoutWall(receipts, crumpled, width, cols),
    [receipts, crumpled, width, cols],
  );
  const byId = useMemo(() => new Map(receipts.map((row) => [row.id, row])), [receipts]);
  const visible = useMemo(() => {
    const lo = view.top - BUFFER;
    const hi = view.top + view.height + BUFFER;
    return cards.filter((card) => card.y + card.h >= lo && card.y <= hi);
  }, [cards, view]);

  useEffect(() => {
    if (!receipts.length || next === null) return;
    const last = cards[cards.length - 1];
    if (last && last.y < view.top + view.height + BUFFER * 2) void load(next);
  }, [receipts.length, next, cards, view, load]);

  const focused = focus !== null ? byId.get(focus) ?? null : null;
  const empty = receipts.length === 0;

  return (
    <section className={`shipped-wall${page ? ' is-page' : ''}`} data-wall="" aria-label="The wall">
      <header className="shipped-wall-head">
        <h2>The wall</h2>
        <p>{empty ? 'Pinning' : `${total} pinned`}</p>
      </header>
      <div ref={board} className="shipped-wall-board" style={{ height: empty ? Math.max(height, 520) : Math.max(height, 280) }}>
        {empty ? <WallSkeleton width={width} /> : null}
        {visible.map((card) => {
          const receipt = byId.get(card.id);
          if (!receipt) return null;
          return <WallPin key={card.id} card={card} receipt={receipt} crumpled={crumpled.has(card.id)} reduced={reduced} onOpen={() => setFocus(card.id)} />;
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

function WallSkeleton({ width }: { width: number }) {
  const dummies = Array.from({ length: 8 }, (_, i) => ({ id: -(i + 1), items: [{ name: '—' }, { name: '—' }, { name: '—' }] }));
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
  onOpen,
}: {
  card: WallCard;
  receipt: PileReceipt;
  crumpled: boolean;
  reduced: boolean;
  onOpen: () => void;
}) {
  const rotate = reduced ? 0 : card.rotate;
  return (
    <button
      type="button"
      className={`shipped-wall-pin is-${card.kind}${crumpled ? ' is-crumpled' : ''}`}
      data-wall-pin={card.id}
      data-crumpled={crumpled ? 'true' : 'false'}
      style={{
        width: card.w,
        height: card.h,
        transform: `translate3d(${card.x}px, ${card.y}px, 0) rotate(${rotate}deg)`,
      }}
      aria-label={`${receipt.who}, ${receipt.potential ? 'potential' : `${receipt.count} shipped`}${crumpled ? ', crumpled for you' : ''}`}
      onClick={onOpen}
    >
      {card.kind === 'pin' ? (
        <span className="shipped-wall-tack" style={{ left: `${card.pinX * 100}%` }} aria-hidden="true" />
      ) : (
        <span className="shipped-wall-tape" aria-hidden="true" />
      )}
      {crumpled ? <span className="shipped-wall-ball" aria-hidden="true" /> : <WallSlip receipt={receipt} />}
    </button>
  );
}
