'use client';

// The receipt printer on /shipped/. A job either feeds (the stub in the slot twitches while sources are
// searched) or prints: the paper is shoved out line by line from under the print head (Web Animations on
// transform, so it stays smooth while the page is busy), then hangs from the tear bar until someone tears
// it: drag it down or rip it sideways (touch: sideways anywhere, or down by the grip next to the bar), tap
// it, or press TEAR. The tear is a spring seeded with the hand's velocity, the receipt settles on the
// counter, and the stub left in the slot is the other half of the tear. A torn receipt tilts toward a mouse.
// prefers-reduced-motion: the receipt is already printed and torn, nothing moves.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { press } from './feel';
import { Ticket } from './paper';
import { feedFrames, rubber, spring, springStep, stubClip, tornEdge, type SpringConfig } from './physics';
import { click, motorOff, motorOn, rip, tick, useSound } from './sound';

type JobBase = {
  key: string;
  label: string;
  /** The receipt before this one vanishes without sliding off: the page animates its own copy away. */
  handoff?: boolean;
};

export type Job =
  | (JobBase & { kind: 'print'; content: React.ReactNode; slip?: boolean; end?: boolean; fast?: boolean })
  | (JobBase & { kind: 'feed' })
  | (JobBase & { kind: 'idle' });

export type Tone = 'ready' | 'busy' | 'error' | 'empty';

/** The name field and Print live on the printer itself. */
export type Console = {
  query: string;
  onQuery: (value: string) => void;
  onPrint: () => void;
  printing: boolean;
  listed: boolean;
  onListed: (value: boolean) => void;
  closed?: boolean;
  invalid?: boolean;
  /** LCD shows TRY AGAIN; Print is still enabled. */
  retry?: boolean;
};

export type MachineProps = {
  job: Job;
  /** What the printer's little display says. */
  display: string;
  tone: Tone;
  onPrinted?: (key: string) => void;
  onTorn?: (key: string) => void;
  /** Tear the hanging receipt now (another job is about to print). */
  tearSignal?: number;
  /** Tallest the paper may hang (px) so the page never scrolls; a longer receipt scrolls inside once torn. */
  paperMax?: number;
  /** Torn visitor receipt fills the viewport; printer recedes. */
  focus?: boolean;
  console?: Console;
  inputRef?: React.Ref<HTMLInputElement>;
};

type Phase = 'idle' | 'feeding' | 'printing' | 'hanging' | 'tearing' | 'torn';

const phaseFor = (job: Job): Phase => (job.kind === 'feed' ? 'feeding' : job.kind === 'idle' ? 'idle' : 'printing');
type Vec = { x: number; y: number; r: number };

const REST_Y = 30;
const STUB = 14;
const GRIP = 112;
const SETTLE = spring(0.38, 0.32);
const SNAP_BACK = spring(0.32, 0.08);
const TILT = spring(0.35, 0);


function reducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function finePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
}

const transformOf = (v: Vec) => `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) rotate(${v.r.toFixed(3)}deg)`;

/** Runs a 3-axis spring on rAF, writing the transform straight to the element. */
function runSpring(el: HTMLElement, from: Vec, to: Vec, velocity: Vec, config: SpringConfig, onDone: () => void): () => void {
  const p = [from.x, from.y, from.r];
  const v = [velocity.x, velocity.y, velocity.r];
  const goal = [to.x, to.y, to.r];
  let last = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    let settled = true;
    for (let i = 0; i < 3; i++) {
      const [next, speed] = springStep(p[i], v[i], goal[i], config, dt);
      p[i] = next;
      v[i] = speed;
      if (Math.abs(next - goal[i]) > (i === 2 ? 0.005 : 0.08) || Math.abs(speed) > (i === 2 ? 0.05 : 2)) settled = false;
    }
    if (settled) {
      el.style.transform = transformOf(to);
      onDone();
      return;
    }
    el.style.transform = transformOf({ x: p[0], y: p[1], r: p[2] });
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export function Machine({ job, display, tone, onPrinted, onTorn, tearSignal = 0, paperMax, focus = false, console: desk, inputRef }: MachineProps) {
  const [phase, setPhase] = useState<Phase>(phaseFor(job));
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState<{ key: string; job: Job; transform: string } | null>(null);
  const [shown, setShown] = useState<Job>(job);
  const [stubSeed, setStubSeed] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [sound, toggleSound] = useSound();
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  const body = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const pull = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const pos = useRef<Vec>({ x: 0, y: 0, r: 0 });
  const stop = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onPrinted, onTorn });
  callbacks.current = { onPrinted, onTorn };
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // A new job: the torn (or hanging) receipt slides off the counter and the next one starts.
  useEffect(() => {
    if (job.key === shown.key) {
      if (job !== shown) setShown(job);
      return;
    }
    if (shown.kind === 'print' && pull.current && !reducedMotion() && !job.handoff) {
      setLeaving({ key: shown.key, job: shown, transform: pull.current.style.transform });
    }
    stop.current?.();
    pos.current = { x: 0, y: 0, r: 0 };
    if (shown.kind === 'print') setStubSeed(shown.key);
    setHint(false);
    setShown(job);
    setPhase(phaseFor(job));
  }, [job, shown]);

  /** Rotation pivots at the tear bar, so a long receipt swings less or its foot would fly off the counter. */
  const swing = useCallback(() => Math.min(1, 520 / Math.max(1, pull.current?.offsetHeight ?? 520)), []);

  const settle = useCallback((to: Vec, velocity: Vec, config: SpringConfig, done: () => void) => {
    const el = pull.current;
    if (!el) return done();
    stop.current?.();
    stop.current = runSpring(el, pos.current, to, velocity, config, () => {
      pos.current = to;
      stop.current = null;
      done();
    });
  }, []);

  const tear = useCallback(
    (velocity: Vec) => {
      if (phaseRef.current !== 'hanging') return;
      rip();
      setHint(false);
      setPhase('tearing');
      const direction = velocity.x === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(velocity.x);
      const rest = { x: direction * (2 + Math.random() * 6), y: REST_Y, r: direction * (0.5 + Math.random() * 0.9) * swing() };
      const key = shown.key;
      if (reducedMotion()) {
        pos.current = rest;
        if (pull.current) pull.current.style.transform = transformOf(rest);
        setPhase('torn');
        callbacks.current.onTorn?.(key);
        return;
      }
      settle(rest, velocity, SETTLE, () => {
        setPhase('torn');
        callbacks.current.onTorn?.(key);
      });
    },
    [settle, swing, shown.key],
  );

  // Print: shove the paper out from under the head, then let it hang.
  // After paint, not in layout: reading offsetHeight during commit trips React #329.
  useEffect(() => {
    if (shown.kind !== 'print') return;
    const el = feed.current;
    const p = pull.current;
    if (!el || !p) return;
    p.style.transform = '';
    if (reducedMotion() || shown.fast) {
      const rest = { x: 0, y: REST_Y, r: 0 };
      pos.current = rest;
      p.style.transform = transformOf(rest);
      setPhase('torn');
      const key = shown.key;
      // Parent focus CSS must not flush in this effect — that crashed /r/ as React #329.
      const later = window.setTimeout(() => {
        callbacks.current.onPrinted?.(key);
        callbacks.current.onTorn?.(key);
      }, 0);
      return () => window.clearTimeout(later);
    }
    const height = el.offsetHeight;
    const { frames, duration } = feedFrames(height, shown.key, shown.slip ? 0.45 : shown.fast ? 0.9 : 0.36);
    const animation = el.animate(
      frames.map((frame) => ({
        offset: frame.offset,
        transform: frame.transform,
        clipPath: frame.clipPath,
        // iOS Safari's WAAPI ignores unprefixed clipPath; both names keep the header-first reveal.
        webkitClipPath: frame.clipPath,
        easing: frame.easing,
      })),
      { duration, fill: 'both' },
    );
    const shiver = body.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(0.7px)' }, { transform: 'translateY(-0.3px)' }, { transform: 'translateY(0)' }],
      { duration: 110, iterations: Infinity },
    );
    motorOn();
    const timers = frames
      .filter((frame, i) => i > 0 && frames[i - 1].clipPath !== frame.clipPath)
      .filter((_, i) => i % 2 === 0)
      .map((frame) => window.setTimeout(tick, frame.offset * duration));
    let cancelled = false;
    animation.finished
      .then(() => {
        if (cancelled) return;
        shiver?.cancel();
        motorOff();
        setPhase('hanging');
        callbacks.current.onPrinted?.(shown.key);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      shiver?.cancel();
      motorOff();
    };
    // Only a new job restarts the print; fresh content for the same receipt doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.key, shown.kind]);

  // Hanging: a small nudge so it reads as loose paper, and the hint.
  useEffect(() => {
    if (phase !== 'hanging') return;
    const timer = window.setTimeout(() => {
      setHint(true);
      settle({ x: 0, y: 0, r: 0 }, { x: 0, y: 140, r: 0.6 }, SNAP_BACK, () => undefined);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [phase, settle]);

  // The page asked for a tear (a new job is waiting).
  const lastSignal = useRef(tearSignal);
  useEffect(() => {
    if (tearSignal === lastSignal.current) return;
    lastSignal.current = tearSignal;
    tear({ x: 0, y: 520, r: 0 });
  }, [tearSignal, tear]);

  // ---- drag to tear ------------------------------------------------------------------------------
  const drag = useRef<{ id: number; x: number; y: number; t: number; lx: number; ly: number; lt: number; vx: number; vy: number; grip: boolean; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phaseRef.current !== 'hanging' || drag.current || event.button > 0) return;
    const grip = (event.target as HTMLElement).closest('.shipped-grip') !== null;
    stop.current?.();
    const now = performance.now();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: now, lx: event.clientX, ly: event.clientY, lt: now, vx: 0, vy: 0, grip, moved: false };
    swallowClick.current = false;
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId || phaseRef.current !== 'hanging') return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      // On touch, a vertical move away from the grip is the page scrolling, not a pull.
      if (event.pointerType === 'touch' && !d.grip && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        settle({ x: 0, y: 0, r: 0 }, { x: 0, y: 0, r: 0 }, SNAP_BACK, () => undefined);
        return;
      }
      d.moved = true;
      swallowClick.current = true;
      window.getSelection()?.removeAllRanges();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.lt);
    d.vx = 0.7 * ((event.clientX - d.lx) / dt) + 0.3 * d.vx;
    d.vy = 0.7 * ((event.clientY - d.ly) / dt) + 0.3 * d.vy;
    d.lx = event.clientX;
    d.ly = event.clientY;
    d.lt = now;
    const side = rubber(dx, 300);
    const v = { x: side * 0.16, y: dy > 0 ? rubber(dy, 150) : rubber(dy, 16), r: side * 0.034 * swing() };
    pos.current = v;
    if (pull.current) pull.current.style.transform = transformOf(v);
    const pulled = dy > 64 || Math.abs(dx) > 84 || (d.vy > 0.7 && dy > 14) || (Math.abs(d.vx) > 0.9 && Math.abs(dx) > 18);
    if (pulled) {
      drag.current = null;
      tear({ x: d.vx * 1000 * 0.35, y: Math.max(200, d.vy * 1000 * 0.5), r: d.vx * 60 });
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (!d.moved && performance.now() - d.t < 350) {
      // A tap tears it too, unless the tap was on a link printed on the receipt.
      if (!(event.target as HTMLElement).closest('a,button')) tear({ x: 0, y: 600, r: 0 });
      return;
    }
    settle({ x: 0, y: 0, r: 0 }, { x: d.vx * 1000 * 0.3, y: d.vy * 1000 * 0.3, r: 0 }, SNAP_BACK, () => undefined);
  }

  // ---- hover tilt (torn receipt, mouse only) -------------------------------------------------------
  useEffect(() => {
    const el = tilt.current;
    const outer = pull.current;
    if (phase !== 'torn' || !el || !outer || reducedMotion() || !finePointer()) return;
    let target = { x: 0, y: 0 };
    let cur = { x: 0, y: 0, vx: 0, vy: 0 };
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const [x, vx] = springStep(cur.x, cur.vx, target.x, TILT, dt);
      const [y, vy] = springStep(cur.y, cur.vy, target.y, TILT, dt);
      cur = { x, y, vx, vy };
      const lift = Math.min(1, Math.hypot(x, y) / 2);
      el.style.transform = `translateZ(${(lift * 4).toFixed(2)}px) rotateX(${y.toFixed(3)}deg) rotateY(${x.toFixed(3)}deg)`;
      if (Math.abs(x - target.x) + Math.abs(y - target.y) + Math.abs(vx) + Math.abs(vy) > 0.002) frame = requestAnimationFrame(loop);
      else frame = 0;
    };
    const kick = () => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const box = el.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = Math.max(-0.5, Math.min(0.5, (event.clientY - window.innerHeight / 2) / window.innerHeight));
      outer.style.perspectiveOrigin = `${event.clientX - box.left}px ${event.clientY - box.top}px`;
      target = { x: px * 5, y: -py * 2.4 };
      kick();
    };
    const leave = () => {
      target = { x: 0, y: 0 };
      kick();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
      el.style.transform = '';
    };
  }, [phase]);

  // A receipt taller than the window fades out at the bottom until it's scrolled to the end.
  useEffect(() => {
    const el = tilt.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      observer.disconnect();
    };
  }, [shown.key, phase, paperMax]);

  // The receipt that just left slides off, then goes.
  const leavingEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = leavingEl.current;
    if (!leaving || !el) return;
    const animation = el.animate(
      [
        { transform: leaving.transform || 'none', opacity: 1 },
        { transform: `${leaving.transform || ''} translate3d(-14%, 70px, 0) rotate(-5deg)`, opacity: 0 },
      ],
      { duration: 340, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' },
    );
    animation.finished.then(() => setLeaving(null)).catch(() => setLeaving(null));
    return () => animation.cancel();
  }, [leaving]);

  const ownStub = shown.kind === 'print' && (phase === 'tearing' || phase === 'torn');
  const stubKey = ownStub ? shown.key : stubSeed;
  const stubVisible = ownStub || phase === 'feeding' || (phase === 'idle' && stubKey !== null);
  const lead = shown.kind === 'feed';
  const showInput = Boolean(desk && !desk.closed && !desk.printing && !desk.retry && (phase === 'idle' || phase === 'hanging' || phase === 'torn'));
  const houseSlip = shown.kind === 'print' && (shown.key === 'house' || Boolean(shown.slip));
  const status =
    phase === 'idle'
      ? showInput
        ? 'Type a name, handle, GitHub or website on the printer, then press Print.'
        : ''
      : phase === 'feeding'
        ? display
        : phase === 'printing'
          ? houseSlip || (shown.kind === 'print' && shown.fast)
            ? ''
            : `Printing: ${shown.label}`
          : phase === 'hanging'
            ? houseSlip
              ? 'How it works. Drag the slip down to tear it off, or type a name and press Print.'
              : 'Printed. Tear it off to share.'
            : '';

  const keys = (
    <div className="shipped-keys">
      <button
        type="button"
        className="shipped-key"
        aria-pressed={sound}
        aria-label={sound ? 'Sound on. Turn printer sound off' : 'Sound off. Turn printer sound on'}
        onPointerDown={press}
        onClick={toggleSound}
      >
        <span aria-hidden="true">{sound ? 'SND ON' : 'SND OFF'}</span>
      </button>
      {desk ? (
        <button
          type="button"
          className="shipped-key"
          aria-pressed={desk.listed}
          aria-label={desk.listed ? 'Listed under recently printed. Tap to unlist' : 'List it under recently printed'}
          onPointerDown={press}
          onClick={() => desk.onListed(!desk.listed)}
        >
          <span aria-hidden="true">{desk.listed ? 'PILE ON' : 'PILE'}</span>
        </button>
      ) : null}
      <span className="shipped-keys-space" aria-hidden="true" />
      <button
        type="button"
        className="shipped-key is-tear"
        disabled={phase !== 'hanging'}
        aria-disabled={phase !== 'hanging'}
        onPointerDown={press}
        onClick={() => {
          if (phase !== 'hanging') return;
          click();
          tear({ x: (Math.random() - 0.5) * 300, y: 640, r: 0 });
        }}
      >
        TEAR
      </button>
      {desk ? (
        <button type="submit" className="shipped-key is-print" disabled={desk.closed || desk.printing} onPointerDown={press}>
          PRINT
        </button>
      ) : null}
    </div>
  );

  const chrome = (
    <>
      <div className="shipped-printer-face">
        <span className="shipped-led" aria-hidden="true" />
        <label className={`shipped-lcd${showInput ? ' is-input' : ''}`}>
          {showInput && desk ? (
            <>
              <span className="sr-only">Name, @handle, GitHub or website</span>
              <input
                ref={inputRef}
                id="shipped-query"
                className="shipped-lcd-input"
                value={desk.query}
                onChange={(event) => desk.onQuery(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                enterKeyHint="go"
                placeholder="TYPE A NAME"
                aria-invalid={desk.invalid ? true : undefined}
                disabled={desk.closed || desk.printing}
              />
              <span className="shipped-lcd-block" aria-hidden="true" />
            </>
          ) : (
            <span key={display} className="shipped-lcd-text" aria-hidden="true">
              {display}
            </span>
          )}
        </label>
        <span className="shipped-plate" aria-hidden="true">
          BZ-80
        </span>
      </div>
      {keys}
    </>
  );

  return (
    <div className={`shipped-printer is-${phase} tone-${tone}${focus ? ' is-focus' : ''}`} data-sound={sound ? 'on' : 'off'}>
      <div className="shipped-printer-body" ref={body}>
        {desk ? (
          <form
            className="shipped-printer-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (desk.closed || desk.printing) return;
              desk.onPrint();
            }}
            noValidate
          >
            {chrome}
          </form>
        ) : (
          chrome
        )}
        <div className="shipped-mouth" aria-hidden="true">
          <span className="shipped-head" />
          <span className="shipped-aperture" />
          <span className="shipped-bar" />
        </div>
      </div>

      <div className="shipped-out">
        {stubKey ? (
          <div
            className={`shipped-stub${stubVisible ? ' is-on' : ''}${lead ? ' is-feeding' : ''}`}
            key={`stub:${stubKey}`}
            style={{ clipPath: stubClip(tornEdge(`${stubKey}:top`), STUB), WebkitClipPath: stubClip(tornEdge(`${stubKey}:top`), STUB) }}
            aria-hidden="true"
          />
        ) : (
          <div className={`shipped-stub${phase === 'feeding' ? ' is-on' : ''}${lead ? ' is-feeding' : ''}`} aria-hidden="true" />
        )}
        {phase === 'feeding' ? <div className="shipped-lead-paper" aria-hidden="true" /> : null}

        {leaving && leaving.job.kind === 'print' ? (
          <div className="shipped-leaving" ref={leavingEl} aria-hidden="true">
            <Ticket seed={leaving.key} slip={leaving.job.slip} className={leaving.job.end ? 'is-end' : ''}>
              {leaving.job.content}
            </Ticket>
          </div>
        ) : null}

        {shown.kind === 'print' ? (
          <div className="shipped-feed" ref={feed} key={`feed:${shown.key}`}>
            <div
              className="shipped-pull"
              ref={pull}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClickCapture={(event) => {
                if (swallowClick.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  swallowClick.current = false;
                }
              }}
            >
              {phase === 'hanging' ? <div className="shipped-grip" aria-hidden="true" style={{ height: GRIP }} /> : null}
              <div
                className={`shipped-tilt${phase === 'torn' || focus ? ' is-scroll' : ''}${more ? ' is-more' : ''}${phase === 'hanging' && !houseSlip && paperMax ? ' is-fade' : ''}`}
                ref={tilt}
                style={paperMax && !focus ? { maxHeight: paperMax } : undefined}
                tabIndex={(phase === 'torn' || focus) && more ? 0 : undefined}
                aria-label={(phase === 'torn' || focus) && more ? `${shown.label}, scrollable` : undefined}
              >
                <Ticket seed={shown.key} label={shown.label} slip={shown.slip} className={shown.end ? 'is-end' : ''}>
                  {shown.content}
                </Ticket>
              </div>
            </div>
            <p className={`shipped-hint${hint && phase === 'hanging' ? ' is-on' : ''}`} aria-hidden="true">
              <span className="shipped-hint-arrow">↓</span> pull to tear
            </p>
          </div>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live ? status : ''}
      </p>
    </div>
  );
}
