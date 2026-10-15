// The pile without WebGL: the same crumpled balls as the 3D pile, drawn with Canvas 2D under the same lamp.
// Each ball is the crumple twin's mesh (crumple.ts, the exact shape the GPU draws), turned to a seeded angle,
// its triangles painted back to front and flat-shaded from one light (upper left): faceted paper, the coated
// side with rows of print, the back a touch greyer. Soft contact shadows sit on the counter. Positions are a
// pure function of the receipts, so the server renders the same buttons the canvas draws, and a new ball
// lands on top without moving the others.
import { prng } from '../physics';
import { creases, FLAT_CRUMPLE, PILE_GRID, restCrumple, shapeHull, shapePoint, shapeSeed, type ShapeInput } from './crumple';

/** The mound's own units: a 100 x 46 box, ground along its bottom. */
export const MOUND_W = 100;
export const MOUND_H = 46;
/** Mound units per world unit (a ball's hull radius of 0.3 is about 6.6 across here). */
const SCALE = 22;

export type BallSpec = { id: string; length: number };
export type Ball2D = BallSpec & { x: number; y: number; r: number };

const PAPER: [number, number, number] = [242, 238, 230];
const BACK: [number, number, number] = [228, 224, 216];
const INK: [number, number, number] = [29, 27, 25];
const WARM: [number, number, number] = [255, 228, 186];
const LIGHT = normalize([-0.5, 0.62, 0.6]);

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const radii = new Map<string, number>();

/** A ball's radius in mound units, from its real hull. */
function ballRadius(spec: BallSpec): number {
  let r = radii.get(spec.id);
  if (r === undefined) {
    r = shapeHull({ seed: shapeSeed(spec.id), length: spec.length, crumple: restCrumple(spec.id) }, 5, 11).radius * 0.82 * SCALE;
    radii.set(spec.id, r);
  }
  return r;
}

/** Drop balls one at a time where they sit lowest near the middle: a heap, stable as balls are added. */
export function moundLayout(specs: BallSpec[]): Ball2D[] {
  const balls: Ball2D[] = [];
  specs.forEach((spec) => {
    const random = prng(`mound:${spec.id}`);
    random();
    const r = ballRadius(spec);
    let best: Ball2D | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const spread = 22 + Math.min(16, balls.length * 0.8);
      const x = MOUND_W / 2 + (random() + random() + random() - 1.5) * spread;
      const cx = Math.min(MOUND_W - r - 2, Math.max(r + 2, x));
      let y = MOUND_H - r * 0.92;
      for (let j = 0; j < balls.length; j++) {
        const o = balls[j];
        const dx = cx - o.x;
        const reach = (r + o.r) * 0.82;
        if (Math.abs(dx) < reach) y = Math.min(y, o.y - Math.sqrt(reach * reach - dx * dx));
      }
      // Lowest wins, pulled hard toward the middle so it heaps rather than spreads.
      const score = y - Math.abs(cx - MOUND_W / 2) * 0.62;
      if (score > bestScore) {
        bestScore = score;
        best = { ...spec, x: cx, y, r };
      }
    }
    balls.push(best!);
  });
  return balls;
}

/** Soft shadow on the counter under (and away from the lamp, to the right of) a ball. */
export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x + r * 0.3, y + r * 0.78);
  ctx.scale(1, 0.34);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.3);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

type Mesh = { xy: Float32Array; z: Float32Array; tris: { a: number; b: number; c: number; depth: number; color: string }[] };

const meshes = new Map<string, Mesh>();

/** The ball's triangles in its own frame (unit = its hull radius), shaded, sorted back to front. */
function ballMesh(spec: BallSpec): Mesh {
  const cached = meshes.get(spec.id);
  if (cached) return cached;
  const input: ShapeInput = { seed: shapeSeed(spec.id), length: spec.length, crumple: restCrumple(spec.id) };
  const nu = PILE_GRID.across + 1;
  const nv = PILE_GRID.along + 1;
  // A seeded tumble.
  const random = prng(`ball2d:${spec.id}`);
  random();
  const ax = random() * Math.PI * 2;
  const ay = random() * Math.PI * 2;
  const az = random() * Math.PI * 2;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const xy = new Float32Array(nu * nv * 2);
  const z = new Float32Array(nu * nv);
  const p = [0, 0, 0];
  let radius = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      shapePoint(i / (nu - 1), j / (nv - 1), input, p);
      // Rotate x, then y, then z.
      let y1 = p[1] * cx - p[2] * sx;
      let z1 = p[1] * sx + p[2] * cx;
      const x2 = p[0] * cy + z1 * sy;
      z1 = -p[0] * sy + z1 * cy;
      const x3 = x2 * cz - y1 * sz;
      y1 = x2 * sz + y1 * cz;
      const k = j * nu + i;
      xy[k * 2] = x3;
      xy[k * 2 + 1] = y1;
      z[k] = z1;
      radius = Math.max(radius, Math.hypot(x3, y1));
    }
  }
  for (let k = 0; k < xy.length; k++) xy[k] /= radius;
  const dots = spec.length * 800;
  const tris: Mesh['tris'] = [];
  const add = (a: number, b: number, c: number, u: number, v: number) => {
    const ux = xy[b * 2] - xy[a * 2];
    const uy = xy[b * 2 + 1] - xy[a * 2 + 1];
    const uz = (z[b] - z[a]) / radius;
    const vx = xy[c * 2] - xy[a * 2];
    const vy = xy[c * 2 + 1] - xy[a * 2 + 1];
    const vz = (z[c] - z[a]) / radius;
    let n = normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    const front = n[2] > 0;
    if (!front) n = [-n[0], -n[1], -n[2]];
    const light = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    let albedo = front ? PAPER : BACK;
    if (front) {
      // Rows of print: about one line in three dots of paper is ink, in rows of varying length.
      const row = Math.floor((v * dots) / 30);
      const rr = prng(`${spec.id}:${row}`)();
      const reach = 0.08 + 0.84 * (0.3 + 0.7 * rr);
      if (rr > 0.22 && u > 0.07 && u < reach) {
        const ink = 0.26 + 0.2 * rr;
        albedo = [albedo[0] + (INK[0] - albedo[0]) * ink, albedo[1] + (INK[1] - albedo[1]) * ink, albedo[2] + (INK[2] - albedo[2]) * ink];
      }
    }
    const level = 0.4 + 0.66 * light;
    const warm = 0.14 * light;
    const ch = (i: number) => Math.min(255, Math.round((albedo[i] * (1 - warm) + WARM[i] * warm) * level));
    tris.push({ a, b, c, depth: (z[a] + z[b] + z[c]) / 3, color: `rgb(${ch(0)},${ch(1)},${ch(2)})` });
  };
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      const u = (i + 0.5) / (nu - 1);
      const v = (j + 0.5) / (nv - 1);
      add(a, c, b, u, v);
      add(b, c, d, u, v);
    }
  }
  tris.sort((t1, t2) => t1.depth - t2.depth);
  const mesh = { xy, z, tris };
  meshes.set(spec.id, mesh);
  return mesh;
}

/** One crumpled ball (radius r around x, y), its facets painted far to near. */
export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spec: BallSpec) {
  const { xy, tris } = ballMesh(spec);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.4, r * 0.012);
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    ctx.beginPath();
    ctx.moveTo(x + xy[tri.a * 2] * r, y - xy[tri.a * 2 + 1] * r);
    ctx.lineTo(x + xy[tri.b * 2] * r, y - xy[tri.b * 2 + 1] * r);
    ctx.lineTo(x + xy[tri.c * 2] * r, y - xy[tri.c * 2 + 1] * r);
    ctx.closePath();
    ctx.fillStyle = tri.color;
    ctx.fill();
    // The same colour around the edge closes the hairline seams between facets.
    ctx.strokeStyle = tri.color;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The whole mound into a canvas sized to the mound box (css px x dpr). Balls are drawn a few per frame so the
 * first paint isn't held up; returns a cancel function.
 */
export function drawMound(canvas: HTMLCanvasElement, balls: Ball2D[], skip: Set<string>, onDone?: () => void): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const scale = canvas.width / MOUND_W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const shown = balls.filter((ball) => !skip.has(ball.id));
  shown.forEach((ball) => drawShadow(ctx, ball.x, ball.y, ball.r));
  const order = shown.slice().sort((a, b) => a.y - b.y);
  let index = 0;
  let frame = 0;
  const step = () => {
    const end = performance.now() + 8;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    while (index < order.length && performance.now() < end) {
      const ball = order[index++];
      drawBall(ctx, ball.x, ball.y, ball.r, ball);
    }
    if (index < order.length) frame = requestAnimationFrame(step);
    else onDone?.();
  };
  step();
  return () => cancelAnimationFrame(frame);
}

/** A ball on its own little canvas (the one flying in or out). */
export function ballSprite(spec: BallSpec, px: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = Math.ceil(px * 1.3 * dpr);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) drawBall(ctx, size / 2, size / 2, (px / 2) * dpr, spec);
  return canvas;
}

/**
 * The faint crease network of a smoothed-out receipt, as a shading map (mid grey = flat paper) a third of the
 * paper's size in css px. Same crease field as the 3D sheet, lit from the same side.
 */
export function creaseMap(id: string, widthPx: number, heightPx: number): HTMLCanvasElement {
  const w = Math.max(8, Math.round(widthPx / 3));
  const h = Math.max(8, Math.round(heightPx / 3));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const seed = shapeSeed(id);
  const image = ctx.createImageData(w, h);
  const lengthUnits = (0.8 * heightPx) / widthPx;
  const amp = Math.pow(FLAT_CRUMPLE, 0.85) * 0.85;
  const g = [0, 0, 0];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      creases(((i + 0.5) / w - 0.5) * 0.8, (0.5 - (j + 0.5) / h) * lengthUnits, seed, g);
      // Slope toward the lamp (upper left) brightens, away darkens.
      const lit = -(g[1] * -0.6 + g[2] * 0.6) * amp;
      const v = Math.max(0, Math.min(255, 128 + lit * 260));
      const o = (j * w + i) * 4;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
