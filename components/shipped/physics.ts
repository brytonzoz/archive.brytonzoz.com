// The receipt printer's physical bits, kept pure so tests/shipped.test.mjs can check them: seeded torn
// edges, the stuttering line feed of a thermal print head, and a small spring for the tear and the tilt.

/** mulberry32: the same seed always tears the same edge. */
export function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type EdgePoint = { x: number; y: number };

/**
 * A hand-torn edge across the paper: x in % of the width, y in px of depth (0 = the outermost fibre).
 * Teeth are uneven, mostly shallow, with the odd deeper bite where the paper caught on the bar.
 */
export function tornEdge(seed: string, depth = 5): EdgePoint[] {
  const random = prng(seed);
  const points: EdgePoint[] = [{ x: 0, y: random() * depth * 0.6 }];
  let x = 0;
  while (x < 100) {
    x = Math.min(100, x + 1.1 + random() * 2.6);
    const bite = random() < 0.08 ? 1 : 0.55;
    points.push({ x: +x.toFixed(2), y: +(random() * depth * bite).toFixed(2) });
  }
  return points;
}

/** clip-path for a strip of paper torn along both edges. */
export function paperClip(top: EdgePoint[] | null, bottom: EdgePoint[] | null): string {
  const upper = top ? top.map((p) => `${p.x}% ${p.y}px`) : ['0% 0px', '100% 0px'];
  const lower = bottom ? [...bottom].reverse().map((p) => `${p.x}% calc(100% - ${p.y}px)`) : ['100% 100%', '0% 100%'];
  return `polygon(${upper.concat(lower).join(', ')})`;
}

/** The stub left in the printer: its lower edge is the exact other half of the receipt's top edge. */
export function stubClip(edge: EdgePoint[], height: number, depth = 5): string {
  const lower = [...edge].reverse().map((p) => `${p.x}% ${(height - depth + p.y).toFixed(2)}px`);
  return `polygon(0% 0px, 100% 0px, ${lower.join(', ')})`;
}

export type FeedFrame = { offset: number; transform: string; clipPath: string; easing: string };

const clipFor = (hidden: number) => `inset(0 0 ${Math.max(0, hidden)}px 0)`;

/**
 * A thermal print head advances one dot-line at a time; to the eye it is a quick shove per text line,
 * a beat while the line burns, and every so often a longer catch. The header (top of the paper) comes
 * out of the slot first: clip-path reveals from the top while the feed stays at the slot.
 */
export function feedFrames(height: number, seed: string, speed = 0.8): { frames: FeedFrame[]; duration: number } {
  const random = prng(`feed:${seed}`);
  const line = 18;
  const steps = Math.max(1, Math.ceil(height / line));
  const weights: { move: number; hold: number }[] = [];
  let nextCatch = 8 + Math.floor(random() * 6);
  for (let i = 0; i < steps; i++) {
    let hold = 0.55 + random() * 0.9;
    if (i === nextCatch) {
      hold *= 3.2;
      nextCatch += 9 + Math.floor(random() * 7);
    }
    weights.push({ move: 1, hold });
  }
  const total = weights.reduce((sum, w) => sum + w.move + w.hold, 0);
  const duration = Math.round(Math.min(4200, Math.max(1300, height / speed)));
  const frames: FeedFrame[] = [{ offset: 0, transform: 'translateY(0) rotate(0deg)', clipPath: clipFor(height), easing: 'linear' }];
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const printed = Math.min(height, (i + 1) * line);
    const hidden = height - printed;
    const moved = (t + weights[i].move) / total;
    t += weights[i].move + weights[i].hold;
    const skew = ((random() - 0.45) * 0.45).toFixed(3);
    frames[frames.length - 1].easing = 'cubic-bezier(0.23, 1, 0.32, 1)';
    frames.push({ offset: +Math.min(1, moved).toFixed(5), transform: `translateY(0) rotate(${skew}deg)`, clipPath: clipFor(hidden), easing: 'linear' });
    if (i < steps - 1) frames.push({ offset: +Math.min(1, t / total).toFixed(5), transform: `translateY(0) rotate(${skew}deg)`, clipPath: clipFor(hidden), easing: 'linear' });
  }
  frames[frames.length - 1].offset = 1;
  frames[frames.length - 1].clipPath = clipFor(0);
  frames[frames.length - 1].transform = 'translateY(0) rotate(0.28deg)';
  return { frames, duration };
}

export type SpringConfig = { stiffness: number; damping: number };

/** Apple-style spring: perceptual duration (s) and bounce (0 = critically damped). */
export function spring(duration: number, bounce = 0): SpringConfig {
  return { stiffness: (2 * Math.PI / duration) ** 2, damping: (4 * Math.PI * (1 - bounce)) / duration };
}

/** One integration step (semi-implicit Euler). Velocity is in units per second. */
export function springStep(x: number, v: number, target: number, config: SpringConfig, dt: number): [number, number] {
  const force = -config.stiffness * (x - target) - config.damping * v;
  const next = v + force * dt;
  return [x + next * dt, next];
}

/**
 * The same spring as a CSS easing, for one-shot Web Animations (the receipt flying into the example, the ticker,
 * sheets): a `linear()` curve sampled from 0 to 1, and how long it takes to settle.
 */
export function springEasing(duration: number, bounce = 0, samples = 48): { easing: string; ms: number } {
  const config = spring(duration, bounce);
  const dt = 1 / 240;
  const xs: number[] = [0];
  let x = 0;
  let v = 0;
  let t = 0;
  while (t < 3) {
    [x, v] = springStep(x, v, 1, config, dt);
    t += dt;
    xs.push(x);
    if (Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const points = Array.from({ length: samples + 1 }, (_, i) => +xs[Math.round((i / samples) * (xs.length - 1))].toFixed(4));
  points[samples] = 1;
  return { easing: `linear(${points.join(', ')})`, ms: Math.round(t * 1000) };
}

/** Rubber band past a boundary: the further it goes, the less it moves. */
export function rubber(distance: number, limit: number): number {
  const sign = Math.sign(distance);
  const d = Math.abs(distance);
  return sign * (limit * d) / (limit + d);
}
