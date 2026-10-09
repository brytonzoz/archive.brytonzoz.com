// The tear: paper pulled against the printer's serrated bar gives way from tooth tip to tooth tip, so the
// edge is a sawtooth with the bar's pitch (2.5 mm, 20 dots), about 1.2 mm deep, every tooth a little off
// and the fibres ragged. One polyline is both edges: the receipt keeps the paper above it, the stub left in
// the slot keeps the paper below it, so the two halves are exact complements. Pure; `random` is
// prng(`${id}:tear`) so the same receipt always tears the same way.

export type EdgePoint = { x: number; y: number };

/** Dots across the paper (80 mm at 8 dots/mm). */
export const EDGE_WIDTH = 640;
/** The bar's tooth pitch and the tear's depth, in dots. */
export const TOOTH_PITCH = 20;
export const TOOTH_DEPTH = 10;

/**
 * x in dots from the left edge (0..width, increasing), y in dots from the tear line (+ is further down).
 * Tooth tips of the bar (where the paper is pierced, so the edge rides high) are at pitch/2 + k * pitch.
 */
export function serratedEdge(random: () => number, width = EDGE_WIDTH, pitch = TOOTH_PITCH, depth = TOOTH_DEPTH): EdgePoint[] {
  const main: EdgePoint[] = [];
  const teeth = Math.round(width / pitch);
  for (let k = 0; k <= teeth; k++) {
    // Between two tips the paper sags into the gap and tears lower.
    main.push({ x: Math.min(width, k * pitch + (k > 0 && k < teeth ? (random() - 0.5) * pitch * 0.16 : 0)), y: (depth / 2) * (0.7 + random() * 0.55) });
    if (k < teeth) {
      main.push({ x: k * pitch + pitch / 2 + (random() - 0.5) * pitch * 0.24, y: -(depth / 2) * (0.65 + random() * 0.6) });
    }
  }
  main[0].x = 0;
  main[main.length - 1].x = width;

  const points: EdgePoint[] = [main[0]];
  for (let i = 1; i < main.length; i++) {
    const a = main[i - 1];
    const b = main[i];
    // Ragged fibres along the run from one tooth to the next, and now and then a hair sticking out.
    const n = 2 + Math.floor(random() * 2);
    const hair = random() < 0.2 ? 1 + Math.floor(random() * n) : -1;
    for (let j = 1; j <= n; j++) {
      const f = j / (n + 1) + (random() - 0.5) * (0.5 / (n + 1));
      const x = a.x + (b.x - a.x) * f;
      const y = a.y + (b.y - a.y) * f + (random() - 0.5) * 1.3;
      if (j === hair) {
        const out = (random() < 0.5 ? -1 : 1) * (1.4 + random() * 1.8);
        points.push({ x: x - 0.35, y }, { x, y: y + out }, { x: x + 0.35, y });
      } else {
        points.push({ x, y });
      }
    }
    points.push(b);
  }
  // Keep x strictly increasing (interpolation and the clip polygons rely on it).
  for (let i = 1; i < points.length; i++) {
    if (points[i].x <= points[i - 1].x) points[i] = { x: Math.min(width, points[i - 1].x + 0.01), y: points[i].y };
  }
  return points.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }));
}

/** The edge's y at x (linear between points). */
export function edgeY(edge: EdgePoint[], x: number): number {
  if (x <= edge[0].x) return edge[0].y;
  const last = edge[edge.length - 1];
  if (x >= last.x) return last.y;
  let lo = 0;
  let hi = edge.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edge[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = edge[lo];
  const b = edge[hi];
  const f = (x - a.x) / (b.x - a.x || 1);
  return a.y + (b.y - a.y) * f;
}

const pct = (x: number, width: number) => `${((x / width) * 100).toFixed(3)}%`;
const px = (y: number) => `${y.toFixed(2)}px`;

/** Which part of the edge has given way: from one side of the paper to `front` (dots). */
export type TornPart = { side: -1 | 1; front: number };

/**
 * clip-path for paper ABOVE the edge, on a face whose own top is at 0. `line` is the tear line's y on that
 * face in px; `scale` px per dot. While the tear is partial, the paper past the front is still one piece
 * with the stub, so it reaches the bottom of the face (the printer hides what's under the slot).
 */
export function aboveClip(edge: EdgePoint[], line: number, scale: number, torn: TornPart | null = null, width = EDGE_WIDTH): string {
  const at = (p: EdgePoint) => `${pct(p.x, width)} ${px(line + p.y * scale)}`;
  const out: string[] = ['0% 0px', '100% 0px'];
  if (!torn || (torn.side === -1 && torn.front >= width) || (torn.side === 1 && torn.front <= 0)) {
    for (let i = edge.length - 1; i >= 0; i--) out.push(at(edge[i]));
    return `polygon(${out.join(', ')})`;
  }
  const front = { x: torn.front, y: edgeY(edge, torn.front) };
  if (torn.side === -1) {
    // Torn from the left up to the front.
    out.push('100% 100%', `${pct(front.x, width)} 100%`, at(front));
    for (let i = edge.length - 1; i >= 0; i--) if (edge[i].x < front.x) out.push(at(edge[i]));
  } else {
    out.push(at(edge[edge.length - 1]));
    for (let i = edge.length - 2; i >= 0; i--) if (edge[i].x > front.x) out.push(at(edge[i]));
    out.push(at(front), `${pct(front.x, width)} 100%`, '0% 100%');
  }
  return `polygon(${out.join(', ')})`;
}

/** clip-path for paper BELOW the edge (the stub in the slot, or the top of the next receipt). */
export function belowClip(edge: EdgePoint[], line: number, scale: number, width = EDGE_WIDTH): string {
  const out = edge.map((p) => `${pct(p.x, width)} ${px(line + p.y * scale)}`);
  out.push('100% 100%', '0% 100%');
  return `polygon(${out.join(', ')})`;
}

/** The bar's teeth as a clip-path: `width` px wide, tips at `phase + k * pitch` px, `depth` px deep. */
export function barClip(width: number, height: number, pitch: number, phase: number, depth: number): string {
  const out: string[] = [];
  let x = phase - Math.ceil(phase / pitch) * pitch;
  out.push(`0px ${px(depth)}`);
  while (x < width + pitch) {
    const valley = x + pitch / 2;
    if (x >= 0 && x <= width) out.push(`${px(x)} 0px`);
    if (valley >= 0 && valley <= width) out.push(`${px(valley)} ${px(depth)}`);
    x += pitch;
  }
  out.push(`${px(width)} ${px(depth)}`, `${px(width)} ${px(height)}`, `0px ${px(height)}`);
  return `polygon(${out.join(', ')})`;
}
