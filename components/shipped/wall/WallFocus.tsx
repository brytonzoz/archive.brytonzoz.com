'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RECEIPT_PATH, ROLLO_PNG_PATH, SHIPPED_URL } from '../../../lib/shipped-year';
import type { PileReceipt } from '../../../lib/shipped-pile';
import { press } from '../feel';
import { prng } from '../physics';
import { Crumple } from '../print/crumple';
import { WallSlip, paintWallSlip } from './WallSlip';
import styles from './ReceiptWall.module.css';

type Props = {
  receipt: PileReceipt;
  crumpled: boolean;
  reduced: boolean;
  onClose: () => void;
  onCrumple: () => void;
  onUncrumple: () => void;
};

function tweetFor(receipt: PileReceipt): string {
  const things = receipt.potential ? 'nothing public' : `${receipt.count} thing${receipt.count === 1 ? '' : 's'}`;
  return `${receipt.who} shipped ${things} in 2026 🧾`;
}

export function WallFocus({ receipt, crumpled, reduced, onClose, onCrumple, onUncrumple }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const printImage = useRef<HTMLImageElement | null>(null);
  const isCrumpled = useRef(crumpled);
  isCrumpled.current = crumpled;
  const spin = useRef({ rx: 0, ry: 0, vx: 0, vy: 0, px: 0, py: 0, dragging: false, raf: 0 });
  const crumple = useRef<Crumple | null>(null);
  const anim = useRef(0);
  const [ball, setBall] = useState(crumpled);
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => () => {
    if (anim.current) window.cancelAnimationFrame(anim.current);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('shipped-wall-focus-open');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('shipped-wall-focus-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (reduced) return;
    const state = spin.current;
    const tick = () => {
      if (!state.dragging) {
        state.vx *= 0.94;
        state.vy *= 0.94;
        state.rx += state.vy;
        state.ry += state.vx;
        state.rx += (0 - state.rx) * 0.08;
        state.ry += (0 - state.ry) * 0.08;
        if (Math.abs(state.rx) < 0.04 && Math.abs(state.ry) < 0.04 && Math.abs(state.vx) < 0.02 && Math.abs(state.vy) < 0.02) {
          state.rx = 0;
          state.ry = 0;
          state.vx = 0;
          state.vy = 0;
        }
      }
      const node = paper.current;
      if (node) node.style.transform = `rotateX(${state.rx.toFixed(2)}deg) rotateY(${state.ry.toFixed(2)}deg)`;
      if (state.dragging || Math.abs(state.rx) > 0.04 || Math.abs(state.ry) > 0.04 || Math.abs(state.vx) > 0.02 || Math.abs(state.vy) > 0.02) {
        state.raf = window.requestAnimationFrame(tick);
      } else {
        state.raf = 0;
      }
    };
    const start = () => {
      if (!state.raf) state.raf = window.requestAnimationFrame(tick);
    };
    start();
    return () => {
      if (state.raf) window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, [reduced, receipt.id]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (reduced || event.button > 0 || event.pointerType === 'touch') return;
    const state = spin.current;
    state.dragging = true;
    state.px = event.clientX;
    state.py = event.clientY;
    state.vx = 0;
    state.vy = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!state.raf) state.raf = window.requestAnimationFrame(() => undefined);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = spin.current;
    if (!state.dragging || reduced) return;
    const dx = event.clientX - state.px;
    const dy = event.clientY - state.py;
    state.px = event.clientX;
    state.py = event.clientY;
    state.vx = dx * 0.35;
    state.vy = -dy * 0.35;
    state.ry += state.vx;
    state.rx += state.vy;
    state.rx = Math.max(-48, Math.min(48, state.rx));
    state.ry = Math.max(-64, Math.min(64, state.ry));
    const node = paper.current;
    if (node) node.style.transform = `rotateX(${state.rx.toFixed(2)}deg) rotateY(${state.ry.toFixed(2)}deg)`;
  }

  function onPointerUp() {
    spin.current.dragging = false;
    const state = spin.current;
    if (!state.raf) {
      const tick = () => {
        state.vx *= 0.94;
        state.vy *= 0.94;
        state.rx += state.vy;
        state.ry += state.vx;
        state.rx += (0 - state.rx) * 0.08;
        state.ry += (0 - state.ry) * 0.08;
        const node = paper.current;
        if (node) node.style.transform = `rotateX(${state.rx.toFixed(2)}deg) rotateY(${state.ry.toFixed(2)}deg)`;
        if (Math.abs(state.rx) > 0.04 || Math.abs(state.ry) > 0.04 || Math.abs(state.vx) > 0.02 || Math.abs(state.vy) > 0.02) {
          state.raf = window.requestAnimationFrame(tick);
        } else {
          state.rx = 0;
          state.ry = 0;
          if (node) node.style.transform = '';
          state.raf = 0;
        }
      };
      state.raf = window.requestAnimationFrame(tick);
    }
  }

  function runCrumple(to: number, immediate = false) {
    if (anim.current) window.cancelAnimationFrame(anim.current);
    anim.current = 0;
    const node = canvas.current;
    if (!node) return;
    const width = Math.min(280, paper.current?.clientWidth || 280);
    const viewportHeight = width * 360 / 280;
    const image = printImage.current;
    const height = image ? Math.round(width * image.naturalHeight / image.naturalWidth) : viewportHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    node.width = width * dpr;
    node.height = viewportHeight * dpr;
    node.style.width = `${width}px`;
    node.style.height = `${viewportHeight}px`;
    const texture = document.createElement('canvas');
    texture.width = width;
    texture.height = height;
    const ink = texture.getContext('2d');
    if (!ink) return;
    paintWallSlip(ink, receipt, width, height, image);
    const engine = new Crumple({
      width,
      height,
      texture,
      center: { x: width / 2, y: height / 2 },
      radius: Math.min(width, height) * 0.28,
      random: prng(`wall-crumple:${receipt.id}`),
    });
    crumple.current = engine;
    const ctx = node.getContext('2d');
    if (!ctx) return;
    const from = to > 0.5 ? 0 : 1;
    const draw = (progress: number, angle = 0, squash = 0) => {
      const fit = Math.min(1, viewportHeight / height);
      const scale = (fit + (1 - fit) * progress) * (1 - squash);
      const cos = Math.cos(angle) * scale;
      const sin = Math.sin(angle) * scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, node.width, node.height);
      engine.draw(ctx, {
        x: width / 2 - (width / 2 * cos - height / 2 * sin),
        y: viewportHeight / 2 - (width / 2 * sin + height / 2 * cos),
        angle,
        scale,
      }, dpr);
    };
    if (reduced || immediate) {
      engine.update(to);
      draw(to);
      setBall(to > 0.5);
      return;
    }
    const start = performance.now();
    const dur = 680;
    const tick = (now: number) => {
      if (crumple.current !== engine) return;
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const squash = Math.sin(t * Math.PI) * 0.16;
      const progress = from + (to - from) * eased;
      engine.update(progress);
      draw(progress, (to > 0.5 ? 0.7 : -0.55) * eased, squash);
      if (t < 1) {
        anim.current = window.requestAnimationFrame(tick);
        return;
      }
      anim.current = 0;
      if (to <= 0.5) ctx.clearRect(0, 0, node.width, node.height);
      setBall(to > 0.5);
    };
    setBall(true);
    anim.current = window.requestAnimationFrame(tick);
  }

  // The lifted paper and its crumple share the same cached physical-print image.
  useEffect(() => {
    let live = true;
    printImage.current = null;
    if (isCrumpled.current) runCrumple(1, true);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!live) return;
      printImage.current = image;
      if (isCrumpled.current) runCrumple(1, true);
    };
    image.onerror = () => {
      if (live && isCrumpled.current) runCrumple(1, true);
    };
    image.src = ROLLO_PNG_PATH(receipt.id);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per receipt; the ref reads its latest crumple state
  }, [receipt.id]);

  const path = RECEIPT_PATH(receipt.id);
  const link = origin ? `${origin}${path}` : `${SHIPPED_URL}${path}`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(tweetFor(receipt))}&url=${encodeURIComponent(link)}`;

  return (
    <div className="shipped-wall-focus" data-wall-focus="" role="dialog" aria-label={`${receipt.who}'s receipt`}>
      <button type="button" className="shipped-wall-focus-scrim" aria-label="Close" onClick={onClose} />
      <div className={`shipped-wall-focus-stage ${styles.focusStage}`} ref={stage}>
        <div className={styles.focusScroll}>
        <div
          ref={paper}
          className={`shipped-wall-focus-paper ${styles.focusPaper}${ball ? ' is-ball' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas ref={canvas} className={`shipped-wall-focus-canvas${ball ? ' is-on' : ''}`} aria-hidden="true" />
          {ball ? null : <WallSlip receipt={receipt} focused />}
        </div>
        </div>
        <div className="shipped-wall-focus-actions">
          <a href={path} className="shipped-button is-big" onPointerDown={press}>
            Open receipt
          </a>
          <a href={intent} target="_blank" rel="noopener noreferrer" className="shipped-button is-ghost" onPointerDown={press}>
            Share
          </a>
          {crumpled || ball ? (
            <button
              type="button"
              className="shipped-button is-ghost"
              data-wall-uncrumple=""
              onPointerDown={press}
              onClick={() => {
                runCrumple(0);
                onUncrumple();
              }}
            >
              Uncrumple
            </button>
          ) : (
            <button
              type="button"
              className="shipped-button is-ghost"
              data-wall-crumple=""
              onPointerDown={press}
              onClick={() => {
                runCrumple(1);
                onCrumple();
              }}
            >
              Crumple
            </button>
          )}
        </div>
        <p className="shipped-wall-focus-note">Crumple stays on this phone. No one else sees it.</p>
      </div>
    </div>
  );
}
