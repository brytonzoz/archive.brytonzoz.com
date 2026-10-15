'use client';

// The pile before (or without) WebGL: a Canvas 2D mound under the same lamp, every ball a real button that
// opens its receipt flat in place (its raster over paper with the faint creases of having been balled up).
// Your receipt waits in your hand at the bottom; flick it or press the key and it flies onto the mound.
// A printer elsewhere on the page can toss a ball in. All motion is transform/opacity, none under reduced
// motion.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { paperClip, rubber, tornEdge } from '../physics';
import { crumple as crumpleSound, land, uncrumple, whoosh } from '../thermal/sfx';
import { createRaster, type Raster } from '../thermal/raster';
import type { TossPayload } from '../thermal/toss';
import type { ThermalReceipt } from '../thermal/types';
import { pileLength } from './crumple';
import { MOUND_H, MOUND_W, ballSprite, creaseMap, drawMound, moundLayout, type BallSpec } from './draw2d';
import { docDots, docFor } from './rasters';
import styles from './ReceiptPile.module.css';

export type Pile2DApi = {
  open(id: string): void;
  close(): void;
  tossOwn(): void;
  receive(payload: TossPayload): boolean;
};

export type Pile2DProps = {
  receipts: ThermalReceipt[];
  own: ThermalReceipt | null;
  ownRaster: Raster | null;
  reduced: boolean;
  fontFamily: string;
  /** False once the 3D pile has taken over (kept mounted underneath, but inert). */
  active: boolean;
  apiRef: React.MutableRefObject<Pile2DApi | null>;
  onOpen(receipt: ThermalReceipt | null): void;
  /** A ball joins the mound (your own, or one tossed in). */
  onAdd(receipt: ThermalReceipt): void;
  onLanded(receipt: ThermalReceipt): void;
};

/** Keep a drag's pointer (a pointer that has already gone throws, and doesn't matter). */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // nothing to capture
  }
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const specs = new Map<string, BallSpec>();

/** A receipt as a ball: its id and the length of its sheet. */
function specOf(receipt: ThermalReceipt): BallSpec {
  let spec = specs.get(receipt.id);
  if (!spec) {
    spec = { id: receipt.id, length: pileLength(docDots(receipt)) };
    specs.set(receipt.id, spec);
  }
  return spec;
}

function label(receipt: ThermalReceipt) {
  return `Open receipt: ${receipt.who}, ${receipt.count} ${receipt.count === 1 ? 'item' : 'items'}`;
}

/** Burn a receipt a few lines per frame (it prints in), or at once under reduced motion. */
function useBurned(receipt: ThermalReceipt | null, fontFamily: string, reduced: boolean, preburned?: Raster | null): Raster | null {
  const [raster, setRaster] = useState<Raster | null>(null);
  useEffect(() => {
    if (!receipt) {
      setRaster(null);
      return;
    }
    if (preburned) {
      preburned.burn();
      setRaster(preburned);
      return;
    }
    let frame = 0;
    let cancelled = false;
    const r = createRaster(docFor(receipt), { fontFamily, wear: 0.55 });
    setRaster(r);
    // The canvas is on the page already; each burned line simply appears on it.
    const step = () => {
      if (cancelled) return;
      const end = performance.now() + 6;
      while (r.burned < r.bands.length && performance.now() < end) r.burn(r.burned + 2);
      if (r.burned < r.bands.length) frame = requestAnimationFrame(step);
    };
    if (reduced) r.burn();
    else frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [receipt, fontFamily, reduced, preburned]);
  return raster;
}

/** A burned raster shown as an element: the canvas itself, scaled to the paper's width by CSS. */
function RasterView({ raster, className }: { raster: Raster | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useIsoLayoutEffect(() => {
    const el = host.current;
    if (!el || !raster) return;
    raster.canvas.className = styles.rasterCanvas;
    el.appendChild(raster.canvas);
    return () => {
      if (raster.canvas.parentNode === el) el.removeChild(raster.canvas);
    };
  }, [raster]);
  return <div ref={host} className={className} style={raster ? { aspectRatio: `${raster.width} / ${raster.height}` } : undefined} aria-hidden="true" />;
}

function Flat({ receipt, fontFamily, reduced, onClose }: { receipt: ThermalReceipt; fontFamily: string; reduced: boolean; onClose(): void }) {
  const raster = useBurned(receipt, fontFamily, reduced);
  // Torn on the printer's bar at both ends, like every receipt on the site.
  const clip = useMemo(() => paperClip(tornEdge(`${receipt.id}:top`), tornEdge(`${receipt.id}:bottom`)), [receipt.id]);
  const paper = useRef<HTMLDivElement>(null);
  const creases = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = paper.current;
    const host = creases.current;
    if (!el || !host || !raster) return;
    const map = creaseMap(receipt.id, el.clientWidth, (el.clientWidth * raster.height) / raster.width);
    map.className = styles.creaseCanvas;
    host.appendChild(map);
    return () => {
      if (map.parentNode === host) host.removeChild(map);
    };
  }, [raster, receipt.id]);
  return (
    <div className={`${styles.flat}${reduced ? '' : ` ${styles.flatIn}`}`} onClick={onClose}>
      <div className={styles.flatScroll}>
        <div className={styles.flatSheet} onClick={(event) => event.stopPropagation()}>
          <div ref={paper} className={styles.flatPaper} style={{ clipPath: clip, WebkitClipPath: clip }} data-seed={receipt.id}>
            <div ref={creases} className={styles.creases} aria-hidden="true" />
            <RasterView raster={raster} className={styles.flatInk} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Pile2D({ receipts, own, ownRaster, reduced, fontFamily, active, apiRef, onOpen, onAdd, onLanded }: Pile2DProps) {
  const specs = useMemo(() => receipts.map(specOf), [receipts]);
  const balls = useMemo(() => moundLayout(specs), [specs]);
  const [open, setOpen] = useState<ThermalReceipt | null>(null);
  const [flying, setFlying] = useState<Set<string>>(() => new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const mound = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const handEl = useRef<HTMLDivElement>(null);
  const ownBurned = useBurned(own, fontFamily, reduced, ownRaster);
  const latest = useRef({ onOpen, onAdd, onLanded, receipts, own, reduced });
  latest.current = { onOpen, onAdd, onLanded, receipts, own, reduced };

  useIsoLayoutEffect(() => {
    const hand = handEl.current;
    const rootEl = root.current;
    if (!hand || !rootEl || !own || !active) return;
    const layout = () => {
      const handH = hand.offsetHeight;
      const rootH = rootEl.offsetHeight || 1;
      const visible = Math.min(0.42 * handH, 0.32 * rootH);
      hand.style.setProperty('--hand-shift', `${Math.max(0, handH - visible)}px`);
      rootEl.style.setProperty('--hand-visible', `${visible}px`);
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(hand);
    observer.observe(rootEl);
    return () => observer.disconnect();
  }, [own, active, ownBurned]);

  // Draw the mound at the canvas's real size (and again when it changes). Hidden 2D (3D showing) skips the paint.
  useEffect(() => {
    const el = canvas.current;
    const box = mound.current;
    if (!el || !box || !active) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.clientWidth * dpr));
      const h = Math.max(1, Math.round((w * MOUND_H) / MOUND_W));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      cancel();
      cancel = drawMound(el, balls, flying);
    };
    let cancel = () => undefined as void;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, [balls, flying, active]);

  const openRef = useRef<ThermalReceipt | null>(null);
  const openReceipt = useCallback((receipt: ThermalReceipt) => {
    if (!latest.current.reduced) uncrumple(0.4);
    openRef.current = receipt;
    setOpen(receipt);
    latest.current.onOpen(receipt);
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = null;
    if (!latest.current.reduced) crumpleSound(0.3);
    setOpen(null);
    latest.current.onOpen(null);
  }, []);

  /** Where a ball sits in the root box (css px). */
  const ballBox = useCallback((id: string, list: BallSpec[]) => {
    const rootEl = root.current;
    const box = mound.current;
    if (!rootEl || !box) return null;
    const layout = moundLayout(list).find((ball) => ball.id === id);
    if (!layout) return null;
    const r0 = rootEl.getBoundingClientRect();
    const r1 = box.getBoundingClientRect();
    const k = r1.width / MOUND_W;
    return { x: r1.left - r0.left + layout.x * k, y: r1.top - r0.top + layout.y * k, d: layout.r * 2 * k };
  }, []);

  /** A sprite of the ball flies from `from` (root px) and lands on its spot; then the mound shows it. */
  const fly = useCallback(
    (receipt: ThermalReceipt, from: { x: number; y: number; d: number }, done: () => void) => {
      const spec = specOf(receipt);
      const list = [...latest.current.receipts.map(specOf), spec];
      const to = ballBox(receipt.id, list);
      const rootEl = root.current;
      if (!to || !rootEl || latest.current.reduced) {
        done();
        queueMicrotask(() => latest.current.onLanded(receipt));
        return;
      }
      setFlying((set) => new Set(set).add(receipt.id));
      done();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const sprite = ballSprite(spec, to.d, dpr);
      sprite.className = styles.sprite;
      const size = to.d * 1.3;
      sprite.style.width = `${size}px`;
      sprite.style.height = `${size}px`;
      rootEl.appendChild(sprite);
      const sx = from.x - size / 2;
      const sy = from.y - size / 2;
      const tx = to.x - size / 2;
      const ty = to.y - size / 2;
      const s0 = Math.max(0.3, from.d / to.d);
      const peak = Math.min(sy, ty) - 60;
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const x = sx + (tx - sx) * t;
        const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * peak + t * t * ty;
        const s = s0 + (1 - s0) * Math.min(1, t * 1.6);
        frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)}) rotate(${(t * 420).toFixed(0)}deg)` });
      }
      const animation = sprite.animate(frames, { duration: 560, easing: 'cubic-bezier(0.35, 0, 0.6, 1)', fill: 'forwards' });
      animation.finished
        .catch(() => undefined)
        .then(() => {
          setFlying((set) => {
            const next = new Set(set);
            next.delete(receipt.id);
            return next;
          });
          land(0.5);
          latest.current.onLanded(receipt);
          requestAnimationFrame(() => sprite.remove());
        });
    },
    [ballBox],
  );

  const tossing = useRef(false);
  const tossOwn = useCallback(
    (velocity?: { x: number; y: number }) => {
      const receipt = latest.current.own;
      const hand = handEl.current;
      const rootEl = root.current;
      if (!receipt || !rootEl || tossing.current) return;
      tossing.current = true;
      const r0 = rootEl.getBoundingClientRect();
      const box = hand?.getBoundingClientRect();
      const visible = box ? Math.min(box.height, r0.bottom - box.top) : 0;
      const from = box ? { x: box.left - r0.left + box.width / 2, y: box.top - r0.top + visible / 2 - 90, d: box.width * 0.24 } : { x: r0.width / 2, y: r0.height - 60, d: 60 };
      const done = () => {
        tossing.current = false;
        latest.current.onAdd(receipt);
      };
      if (!hand || latest.current.reduced) {
        fly(receipt, from, done);
        return;
      }
      // The sheet balls up as it leaves the hand, then the ball flies onto the mound.
      const t = hand.style.transform || '';
      const lift = hand.animate(
        [
          { transform: t, opacity: 1 },
          { transform: `${t} translate3d(${((velocity?.x ?? 0) * 0.04).toFixed(1)}px, -90px, 0) scale(0.24, 0.14) rotate(40deg)`, opacity: 0 },
        ],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      );
      whoosh();
      crumpleSound(0.28);
      lift.finished.catch(() => undefined).then(() => fly(receipt, from, done));
    },
    [fly],
  );

  const receive = useCallback(
    (payload: TossPayload) => {
      const rootEl = root.current;
      if (!rootEl) return false;
      const r0 = rootEl.getBoundingClientRect();
      const from = {
        x: payload.from.x - r0.left + payload.from.width / 2,
        y: Math.max(0, payload.from.y - r0.top + payload.from.height / 2),
        d: Math.max(payload.from.width, payload.from.height),
      };
      fly(payload.receipt, from, () => latest.current.onAdd(payload.receipt));
      return true;
    },
    [fly],
  );

  useEffect(() => {
    if (!active) return;
    apiRef.current = {
      open: (id) => {
        const receipt = latest.current.receipts.find((r) => r.id === id);
        if (receipt) openReceipt(receipt);
      },
      close,
      tossOwn: () => tossOwn(),
      receive,
    };
    return () => {
      apiRef.current = null;
    };
  }, [active, apiRef, close, openReceipt, receive, tossOwn]);

  // Flick your receipt up off the bottom edge to throw it.
  useEffect(() => {
    const el = handEl.current;
    if (!el || !own || !active) return;
    let drag: { id: number; x: number; y: number; t: number; lx: number; ly: number; lt: number; vx: number; vy: number } | null = null;
    const base = 'translate(-50%, var(--hand-shift, 58%)) rotate(-4deg)';
    el.style.transform = base;
    const down = (event: PointerEvent) => {
      if (event.button > 0) return;
      capture(el, event.pointerId);
      const now = performance.now();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: now, lx: event.clientX, ly: event.clientY, lt: now, vx: 0, vy: 0 };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lt);
      drag.vx = 0.75 * ((event.clientX - drag.lx) / dt) * 1000 + 0.25 * drag.vx;
      drag.vy = 0.75 * ((event.clientY - drag.ly) / dt) * 1000 + 0.25 * drag.vy;
      drag.lx = event.clientX;
      drag.ly = event.clientY;
      drag.lt = now;
      const dx = rubber(event.clientX - drag.x, 220);
      const dy = event.clientY - drag.y;
      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${(dy > 0 ? rubber(dy, 30) : dy).toFixed(1)}px, 0) ${base} rotate(${(dx * 0.05).toFixed(2)}deg)`;
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const d = drag;
      drag = null;
      const dy = event.clientY - d.y;
      if ((d.vy < -380 && dy < -18) || dy < -140) {
        tossOwn({ x: d.vx, y: d.vy });
        return;
      }
      const from = el.style.transform;
      el.style.transform = base;
      if (!latest.current.reduced) el.animate([{ transform: from }, { transform: base }], { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [own, active, tossOwn]);

  return (
    <div ref={root} className={`${styles.pile2d}${own && active ? ` ${styles.withHand}` : ''}`} aria-hidden={active ? undefined : true}>
      <div ref={mound} className={styles.mound}>
        <canvas ref={canvas} className={styles.moundCanvas} role="img" aria-label={`A pile of ${receipts.length} crumpled receipts from other people`} />
        <ul className={styles.balls}>
          {balls.map((ball) => {
            const receipt = receipts.find((r) => r.id === ball.id);
            if (!receipt) return null;
            return (
              <li key={ball.id}>
                <button
                  type="button"
                  className={styles.ball}
                  data-receipt={ball.id}
                  tabIndex={active && !flying.has(ball.id) ? 0 : -1}
                  aria-label={label(receipt)}
                  style={{ left: `${((ball.x / MOUND_W) * 100).toFixed(2)}%`, top: `${((ball.y / MOUND_H) * 100).toFixed(2)}%`, ['--d' as string]: `${(((ball.r * 2) / MOUND_W) * 100).toFixed(2)}cqw` }}
                  onClick={() => openReceipt(receipt)}
                />
              </li>
            );
          })}
        </ul>
      </div>
      {own && active ? (
        <div ref={handEl} className={styles.hand2d} aria-hidden="true" data-seed={own.id}>
          <RasterView raster={ownBurned} className={styles.handInk} />
        </div>
      ) : null}
      {open && active ? <Flat receipt={open} fontFamily={fontFamily} reduced={reduced} onClose={close} /> : null}
    </div>
  );
}
