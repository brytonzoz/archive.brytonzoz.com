'use client';

// The receipt printer on /shipped/. A job either feeds (the stub in the slot twitches while sources are
// searched) or prints: the paper is shoved out line by line from under the print head (Web Animations on
// transform, so it stays smooth while the page is busy), then hangs from the tear bar until someone tears
// it: drag it down or rip it sideways (touch: sideways anywhere, or down by the grip next to the bar), tap
// it, or press TEAR. The tear is a spring seeded with the hand's velocity, the receipt settles on the
// counter, and the stub left in the slot is the other half of the tear. A torn receipt tilts toward a mouse.
// prefers-reduced-motion: the receipt is already printed and torn, nothing moves.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { press, pressPrint, pressTear, pressTick } from './feel';
import { Ticket } from './paper';
import { rubber, spring, springStep, stubClip, tearRevealClip, tornEdge, type SpringConfig } from './physics';
import { click, motorOff, motorOn, rip, tick, useSound } from './sound';

type JobBase = {
  key: string;
  label: string;
  /** The receipt before this one vanishes without sliding off: the page animates its own copy away. */
  handoff?: boolean;
};

export type Job =
  | (JobBase & { kind: 'print'; content: React.ReactNode; slip?: boolean; end?: boolean; fast?: boolean; revision?: number })
  | (JobBase & { kind: 'feed' })
  | (JobBase & { kind: 'idle' });

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg className="shipped-key-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 9h4.2L13 4.6v14.8L7.7 15H3.5z" fill="currentColor" />
      {on ? (
        <path
          d="M16.2 9.2c1.3 1.1 1.3 4.5 0 5.6M19 6.8c2.4 2.1 2.4 8.3 0 10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : (
        <path d="M16.2 9.2l5.2 5.2M21.4 9.2l-5.2 5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      )}
    </svg>
  );
}

export type Tone = 'ready' | 'busy' | 'error' | 'empty';

/** The name field and Print live on the printer itself. */
export type Console = {
  query: string;
  onQuery: (value: string) => void;
  onPrint: () => void;
  /** Mount Turnstile on first focus so PRINT and Enter share one warmed widget. */
  onWarm?: () => void;
  printing: boolean;
  listed: boolean;
  onListed: (value: boolean) => void;
  closed?: boolean;
  invalid?: boolean;
  /** Last print failed the human check; input stays, PRINT re-runs. */
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
  /** Shared /r/<id>/ page: the receipt is already out; skip the printer chrome. */
  hero?: boolean;
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
const FLY = spring(0.52, 0.3);
const SNAP_BACK = spring(0.32, 0.08);
const TILT = spring(0.35, 0);

function isVisitorPrint(job: Job): boolean {
  return job.kind === 'print' && !job.slip && job.key !== 'house';
}


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

export function Machine({ job, display, tone, onPrinted, onTorn, tearSignal = 0, paperMax, focus = false, hero = false, console: desk, inputRef }: MachineProps) {
  const [phase, setPhase] = useState<Phase>(() => (hero ? 'torn' : phaseFor(job)));
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState<{ key: string; job: Job; transform: string } | null>(null);
  const [shown, setShown] = useState<Job>(job);
  const [stubSeed, setStubSeed] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [sound, toggleSound] = useSound();
  const [live, setLive] = useState(false);
  const [lifting, setLifting] = useState(false);
  useEffect(() => setLive(true), []);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const pull = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const ripFromLeft = useRef(true);
  const lastRip = useRef(0);
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
    setLifting(false);
    setShown(job);
    setPhase(phaseFor(job));
  }, [job, shown]);

  /** Rotation pivots at the tear bar, so a long receipt swings less or its foot would fly off the counter. */
  const swing = useCallback(() => Math.min(1, 520 / Math.max(1, pull.current?.offsetHeight ?? 520)), []);

  const ticketFace = () => pull.current?.querySelector('.shipped-ticket') as HTMLElement | null;

  const applyRip = useCallback(
    (progress: number, fromLeft: boolean) => {
      const ticket = ticketFace();
      if (!ticket) return;
      const clip = tearRevealClip(tornEdge(`${shown.key}:top`), progress, fromLeft);
      ticket.style.clipPath = clip;
      ticket.style.setProperty('-webkit-clip-path', clip);
    },
    [shown.key],
  );

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
      pressTear();
      setHint(false);
      const fromLeft = velocity.x === 0 ? ripFromLeft.current : velocity.x < 0;
      ripFromLeft.current = fromLeft;
      applyRip(1, fromLeft);
      setPhase('tearing');
      const lift = isVisitorPrint(shown);
      if (lift) setLifting(true);
      const direction = fromLeft ? -1 : 1;
      const rest = lift
        ? { x: 0, y: 0, r: 0 }
        : { x: direction * (2 + Math.random() * 6), y: REST_Y, r: direction * (0.5 + Math.random() * 0.9) * swing() };
      const throwV = lift
        ? { x: velocity.x * 0.35, y: Math.min(velocity.y, -420), r: direction * 10 }
        : velocity;
      const key = shown.key;
      if (reducedMotion()) {
        pos.current = rest;
        if (pull.current) pull.current.style.transform = transformOf(rest);
        setPhase('torn');
        setLifting(false);
        callbacks.current.onTorn?.(key);
        return;
      }
      settle(rest, throwV, lift ? FLY : SETTLE, () => {
        setPhase('torn');
        setLifting(false);
        callbacks.current.onTorn?.(key);
      });
    },
    [applyRip, settle, swing, shown],
  );

  // Print: shove the paper out from under the head, then let it hang.
  // Wait until `live` so this never runs in the same turn as mount setState (React #329).
  // Parent callbacks are deferred: onPrinted/onTorn update ShippedStage during this effect and crash the root.
  useEffect(() => {
    if (!live || shown.kind !== 'print') return;
    if (hero) {
      setPhase('torn');
      window.setTimeout(() => callbacks.current.onTorn?.(shown.key), 0);
      return;
    }
    const el = feed.current;
    const p = pull.current;
    if (!el || !p) return;
    const key = shown.key;
    let cancelled = false;
    let shiver: Animation | undefined;
    const timers: number[] = [];
    const tell = (printed: boolean, torn: boolean) => {
      window.setTimeout(() => {
        if (cancelled) return;
        if (printed) callbacks.current.onPrinted?.(key);
        if (torn) callbacks.current.onTorn?.(key);
      }, 0);
    };
    p.style.transform = '';
    const clip = (hidden: number) => {
      const value = hidden <= 0 ? '' : `inset(0 0 ${hidden}px 0)`;
      el.style.clipPath = value;
      const webkitClipPath = '-webkit-clip-path';
      el.style.setProperty(webkitClipPath, value);
    };
    const height = Math.max(1, el.offsetHeight);
    clip(height);
    if (reducedMotion()) {
      clip(0);
      const rest = { x: 0, y: REST_Y, r: 0 };
      pos.current = rest;
      p.style.transform = transformOf(rest);
      setPhase('torn');
      tell(true, true);
      return () => {
        cancelled = true;
      };
    }
    const line = 18;
    const stepMs = shown.slip ? 32 : shown.fast ? 42 : 88;
    let printed = 0;
    let n = 0;
    shiver = body.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(0.8px)' }, { transform: 'translateY(-0.4px)' }, { transform: 'translateY(0)' }],
      { duration: 90, iterations: Infinity },
    );
    motorOn();
    const strokeHead = (right: boolean, ms: number) => {
      const bar = head.current;
      if (!bar || reducedMotion()) return;
      bar.animate(
        right
          ? [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(257%, 0, 0)' }]
          : [{ transform: 'translate3d(257%, 0, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: Math.max(48, ms - 8), easing: 'linear', fill: 'forwards' },
      );
    };
    const feedLine = () => {
      if (cancelled) return;
      printed = Math.min(height, printed + line);
      n += 1;
      const jitter = n % 2 ? 0.55 : -0.4;
      clip(height - printed);
      el.style.transform = `translate3d(${jitter.toFixed(2)}px, 0, 0)`;
      el.style.setProperty('--burn', `${printed}px`);
      strokeHead(n % 2 === 1, stepMs);
      tick();
      if (n % 2 === 0) pressTick();
      const inked = printed;
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) el.style.setProperty('--inked', `${inked}px`);
        }, Math.round(stepMs * 0.55)),
      );
      if (printed < height) {
        const hold = n % 7 === 0 ? stepMs * 2.1 : stepMs;
        timers.push(window.setTimeout(feedLine, hold));
        return;
      }
      shiver?.cancel();
      motorOff();
      clip(0);
      el.style.transform = '';
      el.style.setProperty('--inked', `${height}px`);
      setPhase('hanging');
      tell(true, false);
    };
    timers.push(window.setTimeout(feedLine, 40));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      shiver?.cancel();
      motorOff();
    };
    // Only a new job restarts the print; fresh content for the same receipt doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, shown.key, shown.kind, hero]);

  // Streaming: new lines after the first feed. Same job key, taller tape — shove the extra paper out.
  const revision = shown.kind === 'print' ? shown.revision ?? 0 : 0;
  const fedHeight = useRef(0);
  useEffect(() => {
    fedHeight.current = 0;
  }, [shown.key]);
  useEffect(() => {
    const el = feed.current;
    if (!live || !el || shown.kind !== 'print') return;
    const height = el.offsetHeight;
    if (fedHeight.current === 0) {
      fedHeight.current = height;
      return;
    }
    const hidden = height - fedHeight.current;
    if (hidden < 12) return;
    fedHeight.current = height;
    if (phaseRef.current === 'printing' || phaseRef.current === 'tearing' || reducedMotion()) return;
    const clip = (left: number) => {
      const value = left <= 0 ? '' : `inset(0 0 ${left}px 0)`;
      el.style.clipPath = value;
      const webkitClipPath = '-webkit-clip-path';
      el.style.setProperty(webkitClipPath, value);
    };
    let left = hidden;
    let n = 0;
    clip(left);
    motorOn();
    const timers: number[] = [];
    const step = () => {
      left = Math.max(0, left - 18);
      n += 1;
      clip(left);
      const printed = height - left;
      el.style.setProperty('--burn', `${printed}px`);
      el.style.transform = `translate3d(${n % 2 ? 0.4 : -0.35}px, 0, 0)`;
      head.current?.animate(
        n % 2
          ? [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(257%, 0, 0)' }]
          : [{ transform: 'translate3d(257%, 0, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 62, easing: 'linear', fill: 'forwards' },
      );
      tick();
      if (n % 2 === 0) pressTick();
      timers.push(
        window.setTimeout(() => {
          el.style.setProperty('--inked', `${printed}px`);
        }, 38),
      );
      if (left > 0) {
        timers.push(window.setTimeout(step, 70));
        return;
      }
      clip(0);
      el.style.transform = '';
      el.style.setProperty('--inked', `${height}px`);
      motorOff();
    };
    timers.push(window.setTimeout(step, 40));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      motorOff();
    };
  }, [live, shown.key, shown.kind, revision]);

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
    lastRip.current = 0;
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
    const rip = Math.max(0, Math.min(1, Math.max(dy / 72, Math.abs(dx) / 90)));
    const fromLeft = dx <= 0;
    ripFromLeft.current = fromLeft;
    applyRip(rip, fromLeft);
    if (rip - lastRip.current >= 0.14) {
      lastRip.current = rip;
      pressTick();
      tick();
    }
    const pulled = dy > 64 || Math.abs(dx) > 84 || rip >= 0.92 || (d.vy > 0.7 && dy > 14) || (Math.abs(d.vx) > 0.9 && Math.abs(dx) > 18);
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
    applyRip(0, ripFromLeft.current);
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
  const showInput = Boolean(desk && !desk.closed && !desk.printing && (phase === 'idle' || phase === 'hanging' || phase === 'torn'));
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
        className="shipped-key is-icon"
        aria-pressed={sound}
        aria-label={sound ? 'Sound on. Turn printer sound off' : 'Sound off. Turn printer sound on'}
        onPointerDown={press}
        onClick={toggleSound}
      >
        <SpeakerIcon on={sound} />
      </button>
      {desk ? (
        <button
          type="button"
          className="shipped-key"
          aria-pressed={desk.listed}
          aria-label={desk.listed ? 'On the wall. Tap to keep this receipt off the wall' : 'Off the wall. Tap to pin it'}
          onPointerDown={press}
          onClick={() => desk.onListed(!desk.listed)}
        >
          <span aria-hidden="true">{desk.listed ? 'ON WALL' : 'OFF WALL'}</span>
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
        <button
          type="button"
          className="shipped-key is-print"
          disabled={desk.closed || desk.printing}
          onPointerDown={() => {
            if (desk.closed || desk.printing) return;
            pressPrint();
          }}
          onClick={() => {
            if (desk.closed || desk.printing) return;
            desk.onPrint();
          }}
        >
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
                onFocus={() => desk.onWarm?.()}
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
          ) : desk?.retry ? (
            <button
              type="button"
              className="shipped-lcd-text is-retry"
              onPointerDown={press}
              onClick={() => {
                desk.onWarm?.();
                desk.onPrint();
              }}
            >
              TRY AGAIN
            </button>
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
    <div className={`shipped-printer is-${phase} tone-${tone}${focus ? ' is-focus' : ''}${hero ? ' is-hero' : ''}${lifting ? ' is-lifting' : ''}`} data-sound={sound ? 'on' : 'off'}>
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
          <span className="shipped-head" ref={head} />
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
                <Ticket
                  seed={shown.key}
                  label={shown.label}
                  slip={shown.slip}
                  torn={{ top: phase === 'torn' || phase === 'tearing', bottom: true }}
                  className={shown.end ? 'is-end' : ''}
                >
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
