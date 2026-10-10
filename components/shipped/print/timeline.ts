// The print job as a schedule. For every printed line: the head burns it (the raster gets the line and the
// line sound fires) a beat before the stepper shoves it out of the slot, a quick move of the line's height
// with a fast attack and a small settle, then the paper holds while the next line burns. Dense lines (the
// inverse band, the barcode) take longer to burn, as on a real head; blank feeds run straight through.
// Pure and seeded: the same receipt always prints to the same rhythm. `random` is prng(`${id}:feed`).
import type { Band, PrintLine } from '../thermal/types';

export type FeedStep = {
  /** Index of the PrintLine (and its band). */
  index: number;
  /** A blank feed: continuous motion, nothing burned. */
  feed: boolean;
  /** ms from the start of the job: the line is burned onto the raster and its sound fires. */
  burn: number;
  /** ms: the shove out of the slot. */
  start: number;
  end: number;
  /** Raster rows out of the slot before and after this step. */
  from: number;
  to: number;
};

export type FeedPlan = {
  steps: FeedStep[];
  /** ms at speed 1 x 1/speed. */
  duration: number;
  /** Raster rows fed in total. */
  rows: number;
};

/** Raw timings (ms) before the job is fitted to its length. */
const LEAD = 110;
const BEAT = 16;
const MOVE_BASE = 22;
const MOVE_PER_DOT = 0.55;
const HOLD_BASE = 18;
const HOLD_INK = 165;
const FEED_RATE = 1.5; // dots per ms

/** How long a whole job takes at speed 1: 2.5 s for a short slip, up to 6 s for a long receipt. */
export function jobDuration(rows: number): number {
  return Math.min(6000, Math.max(2500, 1500 + rows * 1.25));
}

/**
 * Share of a line's dots that the head fires, guessed from the line itself (the raster measures the real
 * figure only after burning, and the schedule must not depend on which font loaded).
 */
export function inkEstimate(line: PrintLine): number {
  switch (line.kind) {
    case 'text': {
      if (line.invert) return 0.78;
      const cols = line.small ? 64 : 48;
      const fill = Math.min(1, line.text.replace(/\s/g, '').length / cols);
      const weight = (line.bold ? 1.35 : 1) * (line.tall ? 1.6 : 1) * (line.faint ? 0.6 : 1);
      return Math.min(0.6, 0.05 + 0.2 * fill * weight);
    }
    case 'lead': {
      const chars = (line.left + line.right).replace(/\s/g, '').length;
      const weight = (line.bold ? 1.35 : 1) * (line.tall ? 1.6 : 1);
      return Math.min(0.6, 0.07 + 0.18 * Math.min(1, chars / 40) * weight);
    }
    case 'rule':
      return line.heavy ? 0.2 : 0.12;
    case 'barcode':
      return 0.62;
    case 'logo':
      return 0.4;
    case 'box-top':
    case 'box-bottom':
      return 0.1;
    case 'feed':
      return 0;
  }
}

/** Step response of a lightly damped stepper (about 4% overshoot), normalised to land exactly on 1. */
export function stepperEase(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const a = 9;
  const b = 8.7;
  const x = (v: number) => 1 - Math.exp(-a * v) * (Math.cos(b * v) + (a / b) * Math.sin(b * v));
  return x(u) / x(1);
}

export function buildFeedPlan(bands: Band[], lines: PrintLine[], random: () => number, speed = 1): FeedPlan {
  const steps: FeedStep[] = [];
  let t = LEAD;
  let printed = 0;
  let nextCatch = 8 + Math.floor(random() * 6);
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const line = lines[i];
    const from = band.y;
    const to = band.y + band.height;
    if (!line || line.kind === 'feed' || band.height <= 0) {
      const d = Math.max(0, band.height) / FEED_RATE;
      steps.push({ index: i, feed: true, burn: t, start: t, end: t + d, from, to });
      t += d;
      continue;
    }
    // The head burns this line while the paper holds still: longer for dense or tall lines, with the
    // stepper's small irregularity and, every so often, a longer catch while the buffer refills.
    let hold = (HOLD_BASE + HOLD_INK * inkEstimate(line) * (band.height / 30)) * (0.82 + random() * 0.36);
    printed++;
    if (printed === nextCatch) {
      hold *= 2.6;
      nextCatch += 9 + Math.floor(random() * 7);
    }
    t += hold;
    const burn = t;
    const start = burn + BEAT;
    const end = start + MOVE_BASE + MOVE_PER_DOT * band.height;
    steps.push({ index: i, feed: false, burn, start, end, from, to });
    t = end;
  }
  const last = bands[bands.length - 1];
  const rows = last ? last.y + last.height : 0;
  const total = jobDuration(rows) / Math.max(0.05, speed);
  const k = t > 0 ? total / t : 1;
  for (const step of steps) {
    step.burn *= k;
    step.start *= k;
    step.end *= k;
  }
  return { steps, duration: total, rows };
}

export type FeedSample = {
  /** Raster rows out of the slot (can overshoot a line by a hair while the stepper settles). */
  rows: number;
  /** Lines burned by now: raster.burn(burned). */
  burned: number;
  /** Index of the current step, to pass back as the next hint. */
  step: number;
  /** The paper is moving right now. */
  moving: boolean;
};

/** Where the job is at `t` ms. `hint` is the previous sample's step, so a frame is O(1). */
export function sampleFeed(plan: FeedPlan, t: number, hint = 0): FeedSample {
  const steps = plan.steps;
  if (!steps.length) return { rows: 0, burned: 0, step: 0, moving: false };
  let i = Math.min(Math.max(0, hint), steps.length - 1);
  while (i + 1 < steps.length && steps[i + 1].burn <= t) i++;
  while (i > 0 && steps[i].burn > t) i--;
  const s = steps[i];
  if (s.burn > t) return { rows: 0, burned: 0, step: 0, moving: false };
  if (t <= s.start) return { rows: s.from, burned: i + 1, step: i, moving: false };
  if (t >= s.end) return { rows: s.to, burned: i + 1, step: i, moving: false };
  const u = (t - s.start) / (s.end - s.start);
  const rows = s.from + (s.to - s.from) * (s.feed ? u : stepperEase(u));
  return { rows, burned: i + 1, step: i, moving: true };
}
