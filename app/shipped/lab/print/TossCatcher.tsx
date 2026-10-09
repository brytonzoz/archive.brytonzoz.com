'use client';

// A stand-in for the receipt pile on the print lab: a tray that registers as a toss target, takes the ball
// at the screen point and velocity the printer hands over, and lets it drop and roll to a stop inside.
// Only for testing the handoff; the real pile (components/shipped/pile/) takes the same payload into 3D.
import React, { useEffect, useRef, useState } from 'react';
import { useTossTarget, type TossPayload } from '../../../../components/shipped/thermal/toss';
import { pileLength } from '../../../../components/shipped/pile/crumple';
import { ballSprite as pileBall } from '../../../../components/shipped/pile/draw2d';
import { land } from '../../../../components/shipped/thermal/sfx';
import styles from './lab.module.css';

type Ball = { el: HTMLCanvasElement; r: number; x: number; y: number; vx: number; vy: number; a: number; va: number; resting: boolean };

const GRAVITY = 2600;

function ballSprite(payload: TossPayload, radius: number): HTMLCanvasElement | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.max(28, Math.round(radius * 2));
  const canvas = pileBall({ id: payload.receipt.id, length: pileLength(payload.raster?.height ?? 800) }, size, dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  return canvas;
}

export function TossCatcher() {
  const tray = useRef<HTMLDivElement>(null);
  const floor = useRef<HTMLDivElement>(null);
  const balls = useRef<Ball[]>([]);
  const frame = useRef(0);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const run = () => {
    if (frame.current) return;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = Math.min(1 / 30, (now - prev) / 1000);
      prev = now;
      const box = floor.current;
      let moving = false;
      if (box) {
        const w = box.clientWidth;
        const h = box.clientHeight;
        for (const b of balls.current) {
          if (b.resting) continue;
          moving = true;
          b.vy += GRAVITY * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.a += b.va * dt;
          if (b.y > h - b.r) {
            b.y = h - b.r;
            if (b.vy > 120) land(Math.min(1, b.vy / 1600));
            b.vy *= -0.32;
            b.vx *= 0.7;
            b.va = b.vx / b.r;
          }
          if (b.x < b.r) {
            b.x = b.r;
            b.vx = Math.abs(b.vx) * 0.4;
          } else if (b.x > w - b.r) {
            b.x = w - b.r;
            b.vx = -Math.abs(b.vx) * 0.4;
          }
          if (b.y >= h - b.r - 0.5) {
            // Rolling on the floor: friction brings it to a stop.
            b.vx *= Math.exp(-3.5 * dt);
            b.va = b.vx / b.r;
            if (Math.abs(b.vy) < 30 && Math.abs(b.vx) < 6) {
              b.vy = 0;
              b.resting = true;
            }
          }
          b.el.style.transform = `translate3d(${(b.x - b.el.offsetWidth / 2).toFixed(1)}px, ${(b.y - b.el.offsetHeight / 2).toFixed(1)}px, 0) rotate(${b.a.toFixed(3)}rad)`;
        }
      }
      frame.current = moving ? requestAnimationFrame(step) : 0;
    };
    frame.current = requestAnimationFrame(step);
  };

  useTossTarget({
    rect: () => {
      const box = tray.current?.getBoundingClientRect();
      return box ? { x: box.left, y: box.top, width: box.width, height: box.height } : null;
    },
    receive: (payload) => {
      const box = floor.current;
      if (!box) return false;
      const r = Math.max(14, Math.min(34, payload.from.width / 2));
      const el = ballSprite(payload, r * 1.05);
      if (!el) return false;
      el.className = styles.ball;
      el.setAttribute('aria-hidden', 'true');
      box.appendChild(el);
      const rect = box.getBoundingClientRect();
      const ball: Ball = {
        el,
        r,
        x: payload.from.x + payload.from.width / 2 - rect.left,
        y: payload.from.y + payload.from.height / 2 - rect.top,
        vx: payload.velocity.x * 0.6,
        vy: payload.velocity.y * 0.6,
        a: 0,
        va: payload.spin ?? 0,
        resting: false,
      };
      balls.current.push(ball);
      while (balls.current.length > 8) balls.current.shift()?.el.remove();
      setCount((n) => n + 1);
      setLast(payload.receipt.who);
      run();
      return true;
    },
  });

  return (
    <section className={styles.catcher} aria-label="Test catcher">
      <div className={styles.tray} ref={tray}>
        <div className={styles.floor} ref={floor} />
        <div className={styles.trayLip}>
          <span>TEST CATCHER · DEV</span>
          <span aria-live="polite">{count ? `${count} IN · ${last ?? ''}` : 'EMPTY'}</span>
        </div>
      </div>
    </section>
  );
}
