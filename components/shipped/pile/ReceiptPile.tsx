'use client';

// A pile of other people's crumpled receipts on the counter. Pick one up and it smooths out in front of you
// so you can read it; put it back and it balls up again. Your own receipt waits in your hand: flick it (or
// press CRUMPLE & TOSS) and it lands on the pile. A printer on the same page can toss its torn receipt in.
//
// The first paint (and the server render) is the 2D pile. The 3D pile (three.js, rapier) is fetched only when
// WebGL2 is there and the pile is within 400px of the viewport; until it has settled, and whenever anything
// fails, the 2D pile stays. Reduced motion: still 3D, but nothing tweens and frames render only on demand.
// Lab overrides: ?mode=2d, ?motion=reduced, ?crumple=<0..1> (every receipt frozen at that crumple).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pageFont } from '../thermal/raster';
import { useTossTarget, type TossPayload } from '../thermal/toss';
import type { ThermalReceipt } from '../thermal/types';
import type { Anchor } from './engine';
import { Pile2D, type Pile2DApi } from './Pile2D';
import { docFor } from './rasters';
import type { SceneApi, SceneProps } from './Scene';
import styles from './ReceiptPile.module.css';

export type ReceiptPileProps = {
  /** Other people's receipts (only the first maxBodies are used). */
  receipts: ThermalReceipt[];
  /** The visitor's receipt: shown flat in hand with a CRUMPLE & TOSS key. */
  own?: ThermalReceipt | null;
  /** Default ~18 on small or coarse-pointer screens, ~28 otherwise. */
  maxBodies?: number;
  /** Register as the page's toss target (default true). */
  acceptTosses?: boolean;
  /** A receipt was picked up (or put back: null). */
  onOpen?(receipt: ThermalReceipt | null): void;
  /** A tossed receipt (yours, or one from the printer) landed on the pile. */
  onToss?(receipt: ThermalReceipt): void;
  className?: string;
  /** The pile fills its box; default height clamp(380px, 70svh, 720px). */
  style?: React.CSSProperties;
  /** Accessible name of the pile. */
  label?: string;
  /** Overrides (the lab page): force the 2D pile, reduced motion, or freeze every receipt's crumple. */
  mode?: 'auto' | '2d';
  motion?: 'auto' | 'reduced';
  crumple?: number | null;
  /** Keep per-frame timings (window.__pile.stats()). */
  debug?: boolean;
};

type Stage = '2d' | 'loading' | '3d';

type Config = { mode: 'auto' | '2d'; reduced: boolean; crumple: number | null; debug: boolean; phone: boolean; font: string };

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function plural(n: number) {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

export function ReceiptPile({
  receipts,
  own = null,
  maxBodies,
  acceptTosses = true,
  onOpen,
  onToss,
  className = '',
  style,
  label,
  mode,
  motion,
  crumple,
  debug = false,
}: ReceiptPileProps) {
  const root = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [stage, setStage] = useState<Stage>('2d');
  const [Scene, setScene] = useState<React.ComponentType<SceneProps> | null>(null);
  const [sceneReceipts, setSceneReceipts] = useState<ThermalReceipt[] | null>(null);
  const [tossed, setTossed] = useState<ThermalReceipt[]>([]);
  const [ownTossed, setOwnTossed] = useState(false);
  const [open, setOpen] = useState<ThermalReceipt | null>(null);
  const openRef = useRef<ThermalReceipt | null>(null);
  openRef.current = open;
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [live, setLive] = useState('');
  const sceneApi = useRef<SceneApi | null>(null);
  const flatApi = useRef<Pile2DApi | null>(null);
  const putBack = useRef<HTMLButtonElement>(null);
  const lastOpened = useRef<string | null>(null);
  const callbacks = useRef({ onOpen, onToss });
  callbacks.current = { onOpen, onToss };

  // Overrides, motion preference, screen class and the page's font: read once on the client.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const forced = query.get('crumple');
    const parsed = forced !== null && forced !== '' ? Math.min(1, Math.max(0, Number(forced))) : NaN;
    const read = (): Config => ({
      mode: mode ?? (query.get('mode') === '2d' ? '2d' : 'auto'),
      reduced: motion ? motion === 'reduced' : query.get('motion') === 'reduced' || Boolean(media?.matches),
      crumple: crumple !== undefined ? crumple : Number.isFinite(parsed) ? parsed : null,
      debug: debug || query.get('stats') === '1',
      phone: Boolean(window.matchMedia?.('(pointer: coarse)').matches) || window.innerWidth < 700,
      font: pageFont(root.current),
    });
    setConfig(read());
    const change = () => setConfig(read());
    media?.addEventListener?.('change', change);
    return () => media?.removeEventListener?.('change', change);
  }, [mode, motion, crumple, debug]);

  const limit = Math.max(1, Math.min(28, maxBodies ?? (config?.phone ? 18 : 28)));
  const base = useMemo(() => receipts.slice(0, limit), [receipts, limit]);
  const all = useMemo(() => {
    const ids = new Set(base.map((r) => r.id));
    return base.concat(tossed.filter((r) => !ids.has(r.id)));
  }, [base, tossed]);
  const inHand = own && !ownTossed ? own : null;
  const baseKey = base.map((r) => r.id).join(',');

  useEffect(() => setOwnTossed(false), [own?.id]);

  // Load the 3D pile once it's near the viewport (and only with WebGL2). Once is enough.
  const gate = config ? config.mode : null;
  const loaded = useRef(false);
  useEffect(() => {
    if (!gate || gate === '2d' || loaded.current || !hasWebGL2()) return;
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loaded.current = true;
        setStage('loading');
        import('./Scene')
          .then((mod) => {
            if (cancelled) return;
            setScene(() => mod.default);
          })
          .catch(() => {
            loaded.current = false;
            if (!cancelled) setStage('2d');
          });
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [gate]);

  // The scene starts from the pile as it is when it mounts (later tosses go to it directly).
  useEffect(() => {
    if (Scene) setSceneReceipts(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Scene, baseKey]);

  // WebGL went away (or never came up): the 2D pile takes over, nothing held.
  const fail = useCallback(() => {
    setScene(null);
    setSceneReceipts(null);
    setStage('2d');
    if (openRef.current) {
      openRef.current = null;
      setOpen(null);
      callbacks.current.onOpen?.(null);
    }
  }, []);

  const add = useCallback(
    (receipt: ThermalReceipt) => {
      setTossed((list) => (list.some((r) => r.id === receipt.id) ? list : list.concat(receipt)));
      if (own && receipt.id === own.id) {
        setOwnTossed(true);
        setLive('Your receipt is on the pile.');
      }
    },
    [own],
  );

  const opened = useCallback((receipt: ThermalReceipt | null) => {
    setOpen(receipt);
    if (receipt) {
      lastOpened.current = receipt.id;
      setLive(`Opened ${receipt.who}'s receipt, ${plural(receipt.count)}. ${docFor(receipt).text}`);
    } else {
      setLive('Put back on the pile.');
    }
    callbacks.current.onOpen?.(receipt);
  }, []);

  const landed = useCallback((receipt: ThermalReceipt) => callbacks.current.onToss?.(receipt), []);

  const api = () => (stage === '3d' ? sceneApi.current : flatApi.current);

  // Keyboard: Esc puts the receipt back; arrows and page keys scroll the one you hold.
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        (stage === '3d' ? sceneApi.current : flatApi.current)?.close();
        return;
      }
      if (stage !== '3d') return;
      const step = event.key === 'ArrowDown' ? 60 : event.key === 'ArrowUp' ? -60 : event.key === 'PageDown' ? 400 : event.key === 'PageUp' ? -400 : 0;
      if (step) {
        event.preventDefault();
        sceneApi.current?.scrollBy(step);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, stage]);

  // Focus follows the receipt: to PUT BACK when one opens from the keyboard, back to its ball once it's back
  // on the pile (in 3D its button returns when the pile has settled again).
  const restore = useRef(false);
  useEffect(() => {
    if (open) {
      restore.current = Boolean(root.current?.contains(document.activeElement));
      if (restore.current) putBack.current?.focus({ preventScroll: true });
      return;
    }
    if (!restore.current) return;
    const id = lastOpened.current;
    const target = id ? root.current?.querySelector<HTMLButtonElement>(`button[data-receipt="${CSS.escape(id)}"]`) : null;
    if (target && !target.closest('[aria-hidden="true"]')) {
      restore.current = false;
      target.focus({ preventScroll: true });
    }
  }, [open, anchors]);

  // The page's printer throws to whichever pile is showing.
  useTossTarget(
    acceptTosses
      ? {
          rect: () => {
            const el = root.current;
            if (!el) return null;
            const box = el.getBoundingClientRect();
            if (box.bottom < 0 || box.top > window.innerHeight) return null;
            return { x: box.left, y: box.top, width: box.width, height: box.height };
          },
          receive: (payload: TossPayload) => {
            if (stage === '3d' && sceneApi.current?.receive(payload)) {
              setTossed((list) => (list.some((r) => r.id === payload.receipt.id) ? list : list.concat(payload.receipt)));
              return true;
            }
            return flatApi.current?.receive(payload) ?? false;
          },
        }
      : null,
  );

  // Lab: frame timings for the test harness.
  useEffect(() => {
    if (!config?.debug) return;
    const w = window as Window & { __pile?: unknown };
    w.__pile = { stats: () => sceneApi.current?.stats() ?? null, inspect: () => sceneApi.current?.inspect() ?? null, stage: () => stage };
  }, [config?.debug, stage]);

  const name = label ?? 'Receipts from other people';
  const reduced = config?.reduced ?? false;
  const show3d = stage === '3d';

  return (
    <div
      ref={root}
      className={`${styles.root}${reduced ? ` ${styles.still}` : ''} ${className}`}
      style={style}
      role="group"
      aria-label={name}
      data-stage={stage}
    >
      <div className={`${styles.layer}${show3d ? ` ${styles.behind}` : ''}`}>
        <Pile2D
          receipts={all}
          own={show3d ? null : inHand}
          ownRaster={null}
          reduced={reduced}
          fontFamily={config?.font ?? ''}
          active={!show3d}
          apiRef={flatApi}
          onOpen={opened}
          onAdd={add}
          onLanded={landed}
        />
      </div>

      {Scene && config && sceneReceipts ? (
        <div className={`${styles.layer} ${styles.layer3d}${show3d ? ` ${styles.shown}` : ''}`}>
          <Scene
            key={`${baseKey}:${reduced ? 'still' : 'moving'}`}
            receipts={sceneReceipts}
            own={inHand}
            ownRaster={null}
            capacity={Math.min(32, limit + 4)}
            reduced={reduced}
            crumple={config.crumple}
            fontFamily={config.font}
            phone={config.phone}
            debug={config.debug}
            label={`A pile of ${sceneReceipts.length} crumpled receipts from other people`}
            apiRef={sceneApi}
            onReady={() => setStage('3d')}
            // A remount (new pile, or the motion preference changed) shows the 2D pile until it's ready again.
            onFail={fail}
            onOpen={opened}
            onOwnTossed={add}
            onLanded={landed}
            onAnchors={setAnchors}
          />
        </div>
      ) : null}

      {show3d ? (
        <ul className={styles.anchors}>
          {anchors.map((anchor) => (
            <li key={anchor.id}>
              <button
                type="button"
                className={styles.anchor}
                data-receipt={anchor.id}
                aria-label={`Open receipt: ${anchor.label}`}
                style={{ transform: `translate3d(${anchor.x}px, ${anchor.y}px, 0) translate(-50%, -50%)`, width: Math.max(44, anchor.r * 2), height: Math.max(44, anchor.r * 2) }}
                onClick={() => sceneApi.current?.open(anchor.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.keys}>
        {open ? (
          <button ref={putBack} type="button" className={`${styles.key} ${styles.keyTop}`} onClick={() => api()?.close()}>
            PUT BACK
          </button>
        ) : null}
        {inHand && !open ? (
          <button type="button" className={`${styles.key} ${styles.keyToss}`} onClick={() => api()?.tossOwn()} aria-label="Crumple your receipt and toss it on the pile">
            CRUMPLE &amp; TOSS
          </button>
        ) : null}
      </div>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
