'use client';

// Crumple-and-toss between the printer and the pile, wherever they are on the page. The pile registers
// itself as a target (useTossTarget); the printer asks for one (useCrumpleToss), flies the crumpled ball to
// the target's box in 2D, and hands it over with tossToPile(): the pile takes it from that screen point and
// velocity into its own 3D world. No provider needed: a page can mount either one, both, or several.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Raster } from './raster';
import type { ThermalReceipt } from './types';

export type ScreenRect = { x: number; y: number; width: number; height: number };

export type TossPayload = {
  receipt: ThermalReceipt;
  /** The raster already burned for this receipt, reused as the texture (nothing prints twice). */
  raster?: Raster | null;
  /** Where the ball is on screen as it crosses into the pile (client px). */
  from: ScreenRect;
  /** Throw velocity in client px per second (+y is down the screen). */
  velocity: { x: number; y: number };
  /** 0 = a flat sheet, 1 = a tight ball. */
  crumple: number;
  /** Spin in radians per second, if the thrower has one. */
  spin?: number;
};

export type TossTarget = {
  /** The box the ball should fly to (the pile's canvas), or null while it isn't on screen. */
  rect(): ScreenRect | null;
  /** Take the ball. False if it can't (still loading, or no WebGL: it then lands in the 2D pile). */
  receive(payload: TossPayload): boolean;
};

const targets = new Set<TossTarget>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((listener) => listener());
}

export function registerTossTarget(target: TossTarget): () => void {
  targets.add(target);
  changed();
  return () => {
    targets.delete(target);
    changed();
  };
}

/** The target nearest the middle of the screen that is at least partly visible. */
export function tossTarget(): TossTarget | null {
  if (typeof window === 'undefined') return null;
  let best: TossTarget | null = null;
  let bestDistance = Infinity;
  const middle = window.innerHeight / 2;
  targets.forEach((target) => {
    const rect = target.rect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const distance = Math.abs(rect.y + rect.height / 2 - middle);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  });
  return best;
}

/** Hand a ball to the pile. False when there's no pile to take it. */
export function tossToPile(payload: TossPayload): boolean {
  const target = tossTarget();
  return target ? target.receive(payload) : false;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The printer's side: is there a pile, where is it, and throw. */
export function useCrumpleToss() {
  const available = useSyncExternalStore(
    subscribe,
    () => version > 0 && targets.size > 0,
    () => false,
  );
  return {
    available,
    target: () => tossTarget()?.rect() ?? null,
    toss: tossToPile,
  };
}

/** The pile's side: register while mounted. The latest callbacks are always used. */
export function useTossTarget(target: TossTarget | null) {
  const ref = useRef(target);
  ref.current = target;
  const enabled = target !== null;
  useEffect(() => {
    if (!enabled) return;
    return registerTossTarget({
      rect: () => ref.current?.rect() ?? null,
      receive: (payload) => ref.current?.receive(payload) ?? false,
    });
  }, [enabled]);
}
