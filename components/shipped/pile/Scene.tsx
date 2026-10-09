'use client';

// The 3D pile, loaded only when WebGL2 is there and the pile is near the viewport (ReceiptPile imports this
// module lazily, with rapier's wasm). The canvas renders on demand: the engine asks for frames while
// something moves and stops asking when the pile is asleep, offscreen, or the tab is hidden.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Raster } from '../thermal/raster';
import type { ScreenRect, TossPayload } from '../thermal/toss';
import type { ThermalReceipt } from '../thermal/types';
import { PileEngine, type Anchor } from './engine';
import styles from './ReceiptPile.module.css';

export type SceneApi = {
  open(id: string): void;
  close(): void;
  tossOwn(): void;
  receive(payload: TossPayload): boolean;
  rect(): ScreenRect | null;
  scrollBy(px: number): void;
  /** Lab timings: [time, ms] per frame of the engine's own work, of the render, of each physics step. */
  stats(): { frame: number[][]; render: number[][]; step: number[][] };
  inspect(): unknown;
};

export type SceneProps = {
  receipts: ThermalReceipt[];
  own: ThermalReceipt | null;
  ownRaster: Raster | null;
  capacity: number;
  reduced: boolean;
  crumple: number | null;
  fontFamily: string;
  phone: boolean;
  debug: boolean;
  label: string;
  apiRef: React.MutableRefObject<SceneApi | null>;
  onReady(): void;
  onFail(error: unknown): void;
  onOpen(receipt: ThermalReceipt | null): void;
  onOwnTossed(receipt: ThermalReceipt): void;
  onLanded(receipt: ThermalReceipt): void;
  onAnchors(anchors: Anchor[]): void;
};

/** Keep a drag's pointer (a pointer that has already gone throws, and doesn't matter). */
function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // nothing to capture
  }
}

let rapier: Promise<void> | null = null;

// r3f 8 still creates a THREE.Clock, which three r183+ reports as deprecated. That one notice is not ours to
// fix (r3f 9 needs React 19), so it is dropped; every other three.js message still reaches the console.
let consoleFiltered = false;
function filterClockNotice() {
  if (consoleFiltered) return;
  consoleFiltered = true;
  const previous = THREE.getConsoleFunction() as ReturnType<typeof THREE.getConsoleFunction> | null;
  THREE.setConsoleFunction((type, message, ...params) => {
    if (type === 'warn' && typeof message === 'string' && message.includes('Clock: This module has been deprecated')) return;
    if (previous) previous(type, message, ...params);
    else console[type](message, ...params);
  });
}

type EngineProps = Omit<SceneProps, 'apiRef' | 'onReady' | 'onFail' | 'label'> & {
  engineRef: React.MutableRefObject<PileEngine | null>;
  onReady(): void;
  onError(error: unknown): void;
  onHandRect(rect: { x: number; y: number; width: number; height: number } | null): void;
  onCursor(cursor: string): void;
};

function Engine(props: EngineProps) {
  const { gl, scene, camera, invalidate, size } = useThree();
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const p = latest.current;
    let engine: PileEngine | null = null;
    try {
      engine = new PileEngine({
        gl,
        scene,
        camera: camera as THREE.PerspectiveCamera,
        invalidate: () => invalidate(),
        R: RAPIER,
        receipts: p.receipts,
        own: p.own,
        ownRaster: p.ownRaster,
        capacity: p.capacity,
        reduced: p.reduced,
        crumple: p.crumple,
        fontFamily: p.fontFamily,
        phone: p.phone,
        debug: p.debug,
        callbacks: {
          onReady: () => latest.current.onReady(),
          onOpen: (receipt) => latest.current.onOpen(receipt),
          onOwnTossed: (receipt) => latest.current.onOwnTossed(receipt),
          onLanded: (receipt) => latest.current.onLanded(receipt),
          onAnchors: (anchors) => latest.current.onAnchors(anchors),
          onHandRect: (rect) => latest.current.onHandRect(rect),
          onCursor: (cursor) => latest.current.onCursor(cursor),
          onError: (error) => latest.current.onError(error),
        },
      });
      p.engineRef.current = engine;
      engine.resize(size.width, size.height);
      engine.start();
    } catch (error) {
      p.onError(error);
    }
    // Lab only: time what the renderer spends submitting each frame.
    const render = gl.render;
    const timed = engine;
    if (p.debug && timed) {
      gl.render = (scene, cam) => {
        const start = performance.now();
        render.call(gl, scene, cam);
        timed.recordRender(start, performance.now() - start);
      };
    }
    return () => {
      gl.render = render;
      p.engineRef.current = null;
      engine?.dispose();
    };
    // The engine is built once per mount; ReceiptPile remounts the scene when the pile itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every call into the engine: an error stops the 3D pile (the 2D one takes over).
  const run = (task: (engine: PileEngine) => void) => {
    const engine = latest.current.engineRef.current;
    if (!engine) return;
    try {
      task(engine);
    } catch (error) {
      latest.current.onError(error);
    }
  };

  useEffect(() => {
    run((engine) => engine.resize(size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => {
    run((engine) => engine.setOwn(props.own, props.ownRaster));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.own, props.ownRaster]);

  useFrame(() => run((engine) => engine.frame(performance.now())));

  return null;
}

const GL = { antialias: true, alpha: false, powerPreference: 'high-performance' as const, stencil: false };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap };
const DPR: [number, number] = [1, 2];
const CAMERA = { fov: 40, near: 0.1, far: 80, position: [0, 6, 5] as [number, number, number] };

export default function PileScene(props: SceneProps) {
  const [physics, setPhysics] = useState(false);
  const [hand, setHand] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [holding, setHolding] = useState(false);
  const engineRef = useRef<PileEngine | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const handEl = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  // Any engine error (a rapier panic leaves its world unusable for good) hands over to the 2D pile, once.
  const guard = useMemo(() => {
    let failed = false;
    const crash = (error: unknown) => {
      engineRef.current = null;
      if (failed) return;
      failed = true;
      latest.current.onFail(error);
    };
    const use = <T,>(task: (engine: PileEngine) => T, fallback: T): T => {
      const engine = engineRef.current;
      if (!engine) return fallback;
      try {
        return task(engine);
      } catch (error) {
        crash(error);
        return fallback;
      }
    };
    return { crash, use };
  }, []);

  useEffect(() => {
    filterClockNotice();
    let alive = true;
    rapier ??= RAPIER.init();
    rapier.then(
      () => alive && setPhysics(true),
      (error) => alive && latest.current.onFail(error),
    );
    return () => {
      alive = false;
    };
  }, []);

  // The public handle.
  useEffect(() => {
    const { use } = guard;
    const api: SceneApi = {
      open: (id) => use((engine) => engine.open(id), undefined),
      close: () => use((engine) => engine.close(), undefined),
      tossOwn: () => use((engine) => engine.tossOwn(), undefined),
      receive: (payload) => {
        const el = wrap.current;
        return el ? use((engine) => engine.receive(payload, el.getBoundingClientRect()), false) : false;
      },
      rect: () => use((engine) => engine.rect(), null),
      scrollBy: (px) => use((engine) => engine.scrollBy(px), undefined),
      stats: () => use((engine) => engine.frameStats(), { frame: [], render: [], step: [] }),
      inspect: () => use((engine) => engine.inspect(), null),
    };
    latest.current.apiRef.current = api;
    return () => {
      latest.current.apiRef.current = null;
    };
  }, [guard]);

  // Pointer input on the canvas: tap a ball to pick it up, drag to scroll the one you hold, tap outside to
  // put it back. Wheel scrolls the held receipt. Offscreen or hidden: no frames at all.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !physics) return;
    const { use } = guard;
    const box = () => el.getBoundingClientRect();
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-pile-hand]')) return;
      use((engine) => {
        if (engine.isHolding) capture(el, event.pointerId);
        engine.pointerDown(event, false);
      }, undefined);
    };
    const move = (event: PointerEvent) => use((engine) => engine.pointerMove(event, box()), undefined);
    const up = (event: PointerEvent) => use((engine) => engine.pointerUp(event, box()), undefined);
    const cancel = (event: PointerEvent) => use((engine) => engine.pointerUp(event, box(), true), undefined);
    const wheel = (event: WheelEvent) => {
      if (!engineRef.current?.isHolding) return;
      event.preventDefault();
      use((engine) => engine.scrollBy(event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY), undefined);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });

    let onScreen = true;
    const sync = () => engineRef.current?.setVisible(onScreen && !document.hidden);
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [physics, guard]);

  // Your receipt in hand: a touch target over the part of it that shows, so flicking it never scrolls the page.
  useEffect(() => {
    const el = handEl.current;
    const root = wrap.current;
    if (!el || !root) return;
    const { use } = guard;
    const box = () => root.getBoundingClientRect();
    // Handled here only: the canvas underneath must not see these too (it would count every move twice).
    const down = (event: PointerEvent) => {
      event.stopPropagation();
      capture(el, event.pointerId);
      use((engine) => engine.pointerDown(event, true), undefined);
    };
    const move = (event: PointerEvent) => {
      event.stopPropagation();
      use((engine) => engine.pointerMove(event, box()), undefined);
    };
    const up = (event: PointerEvent) => {
      event.stopPropagation();
      use((engine) => engine.pointerUp(event, box()), undefined);
    };
    const cancel = (event: PointerEvent) => {
      event.stopPropagation();
      use((engine) => engine.pointerUp(event, box(), true), undefined);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [hand !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreated = useMemo(
    () => (state: { gl: THREE.WebGLRenderer }) => {
      const canvas = state.gl.domElement;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', latest.current.label);
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        latest.current.onFail(new Error('webgl context lost'));
      });
    },
    [],
  );

  if (!physics) return null;

  return (
    <div ref={wrap} className={`${styles.scene}${holding ? ` ${styles.holding}` : ''}`} data-pile-scene="">
      <Canvas frameloop="demand" dpr={DPR} shadows={SHADOWS} flat gl={GL} camera={CAMERA} onCreated={onCreated}>
        <Engine
          receipts={props.receipts}
          own={props.own}
          ownRaster={props.ownRaster}
          capacity={props.capacity}
          reduced={props.reduced}
          crumple={props.crumple}
          fontFamily={props.fontFamily}
          phone={props.phone}
          debug={props.debug}
          engineRef={engineRef}
          onReady={() => latest.current.onReady()}
          onError={guard.crash}
          onOpen={(receipt) => {
            setHolding(receipt !== null);
            latest.current.onOpen(receipt);
          }}
          onOwnTossed={(receipt) => latest.current.onOwnTossed(receipt)}
          onLanded={(receipt) => latest.current.onLanded(receipt)}
          onAnchors={(anchors) => latest.current.onAnchors(anchors)}
          onHandRect={setHand}
          onCursor={(cursor) => {
            if (wrap.current) wrap.current.style.cursor = cursor;
          }}
        />
      </Canvas>
      {hand ? (
        <div
          ref={handEl}
          className={styles.handTarget}
          data-pile-hand=""
          aria-hidden="true"
          style={{ transform: `translate3d(${hand.x}px, ${hand.y}px, 0)`, width: hand.width, height: hand.height }}
        />
      ) : null}
    </div>
  );
}
