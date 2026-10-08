// Balling up a receipt in 2D. The sheet is a grid of triangles (8 across, up to 24 down). Over the crumple
// the sheet buckles along seeded fold lines (each fold turns one side of the paper about the line, in
// order, the way a hand creases it), shrinks, and every vertex ends on a lumpy ball. Each frame the
// triangles are depth-sorted and drawn with canvas 2D: the front of the paper is the receipt texture mapped
// with an affine transform per triangle, the back is blank paper, and every facet is flat-shaded from the
// same lamp as the page (up, a little right, in front), so it reads as creased paper, not a blur.
import { PAPER_RGB } from './grain';

export type TextureSource = CanvasImageSource & { width: number; height: number };

export type CrumpleInput = {
  /** Receipt size in px (its own frame: x right, y down). */
  width: number;
  height: number;
  /** Covers the whole receipt; transparent outside the torn edges. */
  texture: TextureSource;
  /** Where the ball forms, receipt frame. */
  center: { x: number; y: number };
  radius: number;
  random: () => number;
  cols?: number;
  rows?: number;
};

/** Where the receipt frame sits on the canvas (css px): its origin, angle and scale. */
export type Placement = { x: number; y: number; angle: number; scale: number };

type Fold = { ax: number; ay: number; dx: number; dy: number; angle: number; t0: number; t1: number; moving: Uint8Array; axisMoving: Uint8Array };

/** The lamp: above, slightly right, in front (z toward the viewer). */
const LIGHT = (() => {
  const v = [0.28, -0.72, 0.64];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const AMBIENT = 0.5;
const DIFFUSE = 0.64;
const FLAT = AMBIENT + DIFFUSE * LIGHT[2];
const FOCAL = 900;
const BACK_RGB: [number, number, number] = [PAPER_RGB[0] - 8, PAPER_RGB[1] - 8, PAPER_RGB[2] - 8];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class Crumple {
  readonly cols: number;
  readonly rows: number;
  readonly radius: number;
  readonly center: { x: number; y: number };
  private readonly width: number;
  private readonly height: number;
  private readonly texture: TextureSource;
  private readonly count: number;
  private readonly rest: Float32Array;
  private readonly uv: Float32Array;
  private readonly ball: Float32Array;
  private readonly delay: Float32Array;
  /** Current positions, receipt frame, z toward the viewer. */
  readonly pos: Float32Array;
  private readonly folds: Fold[];
  private readonly axes: Float32Array;
  private readonly tris: Uint16Array;
  private readonly order: number[];
  private readonly depth: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;

  constructor(input: CrumpleInput) {
    const { width, height, texture, center, radius, random } = input;
    this.width = width;
    this.height = height;
    this.texture = texture;
    this.center = center;
    this.radius = radius;
    this.cols = input.cols ?? 8;
    this.rows = input.rows ?? Math.max(6, Math.min(24, Math.round((this.cols * height) / width)));
    const cols = this.cols;
    const rows = this.rows;
    const count = (cols + 1) * (rows + 1);
    this.count = count;
    this.rest = new Float32Array(count * 2);
    this.uv = new Float32Array(count * 2);
    this.ball = new Float32Array(count * 3);
    this.delay = new Float32Array(count);
    this.pos = new Float32Array(count * 3);
    this.sx = new Float32Array(count);
    this.sy = new Float32Array(count);
    const tu = texture.width / width;
    const tv = texture.height / height;

    // Lumps: a few broad bumps and dents on the ball.
    const bumps = Array.from({ length: 6 }, () => {
      const z = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      return { x: r * Math.cos(t), y: r * Math.sin(t), z, a: (random() - 0.4) * 0.3, w: 0.35 + random() * 0.5 };
    });
    const lump = (x: number, y: number, z: number) => {
      let s = 1;
      for (const b of bumps) {
        const d = (x - b.x) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2;
        s += b.a * Math.exp(-d / (b.w * b.w));
      }
      return s;
    };
    const spin = random() * Math.PI * 2;
    const twist = 0.6 + random() * 0.8;

    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const v = j * (cols + 1) + i;
        const x = (i / cols) * width;
        const y = (j / rows) * height;
        this.rest[v * 2] = x;
        this.rest[v * 2 + 1] = y;
        this.uv[v * 2] = x * tu;
        this.uv[v * 2 + 1] = y * tv;
        // Where this bit of paper ends up: the sheet wraps the ball pole to pole with a twist, each vertex
        // knocked off its neighbours' line so the surface folds instead of stretching smoothly.
        const u = i / cols;
        const w = j / rows;
        const lat = Math.asin(Math.max(-0.97, Math.min(0.97, (2 * w - 1) * 0.94 + (random() - 0.5) * 0.3)));
        const lon = spin + Math.PI * 2 * (u * 0.8 + w * twist) + (random() - 0.5) * 0.9;
        const dx = Math.cos(lat) * Math.cos(lon);
        const dy = Math.sin(lat);
        const dz = Math.cos(lat) * Math.sin(lon);
        const r = radius * lump(dx, dy, dz) * (0.86 + random() * 0.2);
        this.ball[v * 3] = dx * r;
        this.ball[v * 3 + 1] = dy * r;
        this.ball[v * 3 + 2] = dz * r;
        // The edges and corners close in last.
        const edge = Math.max(Math.abs(u - 0.5), Math.abs(w - 0.5)) * 2;
        this.delay[v] = 0.16 * edge * (0.6 + random() * 0.4);
      }
    }

    // Fold lines across the sheet, mostly near the middle, each turning the far side (the side without the
    // ball's centre) toward or away from the viewer.
    const folds: Fold[] = [];
    const n = 7;
    for (let f = 0; f < n; f++) {
      const ax = width * (0.15 + random() * 0.7);
      const ay = height * (0.1 + random() * 0.8);
      const theta = random() * Math.PI;
      const dx = Math.cos(theta);
      const dy = Math.sin(theta);
      const side = Math.sign((center.x - ax) * dy - (center.y - ay) * dx) || 1;
      const moving = new Uint8Array(count);
      for (let v = 0; v < count; v++) {
        const s = (this.rest[v * 2] - ax) * dy - (this.rest[v * 2 + 1] - ay) * dx;
        moving[v] = Math.sign(s) === -side ? 1 : 0;
      }
      const t0 = 0.02 + (f / n) * 0.3 + random() * 0.06;
      folds.push({ ax, ay, dx, dy, angle: (random() < 0.5 ? -1 : 1) * (0.7 + random() * 1.3), t0, t1: t0 + 0.32 + random() * 0.18, moving, axisMoving: new Uint8Array(n * 2) });
    }
    // The axis of each fold is carried along by the folds before it.
    this.axes = new Float32Array(n * 2 * 3);
    folds.forEach((fold, f) => {
      for (let e = 0; e < n * 2; e++) {
        const g = folds[e >> 1];
        const px = e % 2 === 0 ? g.ax : g.ax + g.dx * 40;
        const py = e % 2 === 0 ? g.ay : g.ay + g.dy * 40;
        const side = Math.sign((center.x - fold.ax) * fold.dy - (center.y - fold.ay) * fold.dx) || 1;
        const s = (px - fold.ax) * fold.dy - (py - fold.ay) * fold.dx;
        fold.axisMoving[e] = Math.sign(s) === -side ? 1 : 0;
      }
    });
    this.folds = folds;

    const tris: number[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        tris.push(a, b, c, b, d, c);
      }
    }
    this.tris = new Uint16Array(tris);
    this.order = Array.from({ length: tris.length / 3 }, (_, i) => i);
    this.depth = new Float32Array(tris.length / 3);
    this.update(0);
  }

  /** Positions at crumple progress t (0 = flat sheet, 1 = ball). */
  update(t: number): void {
    const { pos, rest, count, folds, axes, center, ball, delay } = this;
    for (let v = 0; v < count; v++) {
      pos[v * 3] = rest[v * 2];
      pos[v * 3 + 1] = rest[v * 2 + 1];
      pos[v * 3 + 2] = 0;
    }
    for (let f = 0; f < folds.length; f++) {
      const g = folds[f];
      axes[f * 6] = g.ax;
      axes[f * 6 + 1] = g.ay;
      axes[f * 6 + 2] = 0;
      axes[f * 6 + 3] = g.ax + g.dx * 40;
      axes[f * 6 + 4] = g.ay + g.dy * 40;
      axes[f * 6 + 5] = 0;
    }
    for (let f = 0; f < folds.length; f++) {
      const g = folds[f];
      const phi = g.angle * smooth(clamp01((t - g.t0) / (g.t1 - g.t0)));
      if (phi === 0) continue;
      const ax = axes[f * 6];
      const ay = axes[f * 6 + 1];
      const az = axes[f * 6 + 2];
      let kx = axes[f * 6 + 3] - ax;
      let ky = axes[f * 6 + 4] - ay;
      let kz = axes[f * 6 + 5] - az;
      const kl = Math.hypot(kx, ky, kz) || 1;
      kx /= kl;
      ky /= kl;
      kz /= kl;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const rotate = (arr: Float32Array, o: number) => {
        const vx = arr[o] - ax;
        const vy = arr[o + 1] - ay;
        const vz = arr[o + 2] - az;
        const dot = kx * vx + ky * vy + kz * vz;
        const cx = ky * vz - kz * vy;
        const cy = kz * vx - kx * vz;
        const cz = kx * vy - ky * vx;
        arr[o] = ax + vx * c + cx * s + kx * dot * (1 - c);
        arr[o + 1] = ay + vy * c + cy * s + ky * dot * (1 - c);
        arr[o + 2] = az + vz * c + cz * s + kz * dot * (1 - c);
      };
      for (let v = 0; v < count; v++) if (g.moving[v]) rotate(pos, v * 3);
      for (let e = (f + 1) * 2; e < folds.length * 2; e++) if (g.axisMoving[e]) rotate(axes, e * 3);
    }
    // Squeeze toward the centre, then onto the ball.
    const shrink = 1 - 0.45 * smooth(t);
    for (let v = 0; v < count; v++) {
      const b = smooth(clamp01((t - 0.22 - delay[v]) / 0.62));
      const o = v * 3;
      const fx = center.x + (pos[o] - center.x) * shrink;
      const fy = center.y + (pos[o + 1] - center.y) * shrink;
      const fz = pos[o + 2] * shrink;
      pos[o] = fx + (center.x + ball[o] - fx) * b;
      pos[o + 1] = fy + (center.y + ball[o + 1] - fy) * b;
      pos[o + 2] = fz + (ball[o + 2] - fz) * b;
    }
  }

  /** Draws the current shape. `dpr` is the canvas's device pixel ratio (the context is reset to it). */
  draw(ctx: CanvasRenderingContext2D, place: Placement, dpr: number): void {
    const { pos, uv, tris, order, depth, sx, sy, center, count, texture } = this;
    const cos = Math.cos(place.angle) * place.scale;
    const sin = Math.sin(place.angle) * place.scale;
    for (let v = 0; v < count; v++) {
      const o = v * 3;
      const p = FOCAL / (FOCAL - pos[o + 2]);
      const lx = center.x + (pos[o] - center.x) * p;
      const ly = center.y + (pos[o + 1] - center.y) * p;
      sx[v] = place.x + lx * cos - ly * sin;
      sy[v] = place.y + lx * sin + ly * cos;
    }
    const n = order.length;
    for (let t = 0; t < n; t++) {
      depth[t] = pos[tris[t * 3] * 3 + 2] + pos[tris[t * 3 + 1] * 3 + 2] + pos[tris[t * 3 + 2] * 3 + 2];
    }
    order.sort((a, b) => depth[a] - depth[b]);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (let k = 0; k < n; k++) {
      const t = order[k];
      const i0 = tris[t * 3];
      const i1 = tris[t * 3 + 1];
      const i2 = tris[t * 3 + 2];
      const x0 = sx[i0];
      const y0 = sy[i0];
      const x1 = sx[i1];
      const y1 = sy[i1];
      const x2 = sx[i2];
      const y2 = sy[i2];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 0.02) continue;
      // Facet normal in 3D (z toward the viewer); the side we see is the side facing us.
      const ax = pos[i1 * 3] - pos[i0 * 3];
      const ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
      const az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const bx = pos[i2 * 3] - pos[i0 * 3];
      const by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
      const bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      // The paper's front faces +n; where the facet shows its back (wound the other way on screen), the side
      // we see faces -n.
      const front = area > 0;
      const nl = (front ? 1 : -1) * (Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) || 1);
      const nx = (ay * bz - az * by) / nl;
      const ny = (az * bx - ax * bz) / nl;
      const nz = (ax * by - ay * bx) / nl;
      const light = (AMBIENT + DIFFUSE * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])) / FLAT;

      // A hair bigger than the facet, so neighbours overlap instead of leaving hairline gaps.
      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      const g0 = 0.5 / (Math.hypot(x0 - cx, y0 - cy) || 1);
      const g1 = 0.5 / (Math.hypot(x1 - cx, y1 - cy) || 1);
      const g2 = 0.5 / (Math.hypot(x2 - cx, y2 - cy) || 1);
      ctx.beginPath();
      ctx.moveTo(x0 + (x0 - cx) * g0, y0 + (y0 - cy) * g0);
      ctx.lineTo(x1 + (x1 - cx) * g1, y1 + (y1 - cy) * g1);
      ctx.lineTo(x2 + (x2 - cx) * g2, y2 + (y2 - cy) * g2);
      ctx.closePath();

      if (!front) {
        // The back of thermal paper: blank, a shade greyer.
        const r = Math.round(Math.min(255, BACK_RGB[0] * light * 0.94));
        const g = Math.round(Math.min(255, BACK_RGB[1] * light * 0.94));
        const b = Math.round(Math.min(255, BACK_RGB[2] * light * 0.94));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
        continue;
      }
      if (Math.abs(area) < 3) {
        ctx.fillStyle = `rgb(${Math.round(Math.min(255, PAPER_RGB[0] * light))},${Math.round(Math.min(255, PAPER_RGB[1] * light))},${Math.round(Math.min(255, PAPER_RGB[2] * light))})`;
        ctx.fill();
        continue;
      }
      // Map the texture triangle onto the screen triangle.
      const u0 = uv[i0 * 2];
      const v0 = uv[i0 * 2 + 1];
      const u1 = uv[i1 * 2];
      const v1 = uv[i1 * 2 + 1];
      const u2 = uv[i2 * 2];
      const v2 = uv[i2 * 2 + 1];
      const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(det) < 1e-6) continue;
      const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
      const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
      const e = x0 - a * u0 - c * v0;
      const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
      const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
      const f = y0 - b * u0 - d * v0;
      ctx.save();
      ctx.clip();
      ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
      ctx.drawImage(texture, 0, 0);
      ctx.restore();
      if (light < 0.985) {
        ctx.fillStyle = `rgba(28,22,16,${((1 - light) * 0.92).toFixed(3)})`;
        ctx.fill();
      } else if (light > 1.015) {
        ctx.fillStyle = `rgba(255,252,246,${Math.min(0.5, (light - 1) * 0.6).toFixed(3)})`;
        ctx.fill();
      }
    }
  }

  /** The finished ball as a small sprite (for the throw): returns the canvas and its size in css px. */
  sprite(dpr: number): { canvas: HTMLCanvasElement; size: number } {
    this.update(1);
    const size = Math.ceil(this.radius * 2.9 + 8);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size * dpr);
    canvas.height = Math.ceil(size * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) this.draw(ctx, { x: size / 2 - this.center.x, y: size / 2 - this.center.y, angle: 0, scale: 1 }, dpr);
    return { canvas, size };
  }
}

/**
 * The receipt as one texture: paper, grain and ink, cut to its torn edges. `rows` paper rows map to the
 * texture's height; the ink canvas (raster) starts at paper row `inkTop`.
 */
export function paperTexture(opts: {
  ink: HTMLCanvasElement;
  inkTop: number;
  rows: number;
  /** Texture width in px (height follows the paper's proportions, capped). */
  width: number;
  grain: HTMLCanvasElement | null;
  /** How many paper dots one grain tile covers. */
  grainDots: number;
  /** Clip polygon in paper dots (x 0..640, y rows), or null for a plain rectangle. */
  outline: { x: number; y: number }[] | null;
}): HTMLCanvasElement {
  const dotsWide = opts.ink.width;
  const k = Math.min(opts.width / dotsWide, 4096 / Math.max(1, opts.rows));
  const w = Math.max(1, Math.round(dotsWide * k));
  const h = Math.max(1, Math.round(opts.rows * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = `rgb(${PAPER_RGB.join(',')})`;
  ctx.fillRect(0, 0, w, h);
  if (opts.grain) {
    const pattern = ctx.createPattern(opts.grain, 'repeat');
    if (pattern) {
      const s = (opts.grainDots * k) / opts.grain.width;
      pattern.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(opts.ink, 0, opts.inkTop * k, w, opts.ink.height * k);
  if (opts.outline && opts.outline.length > 2) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    opts.outline.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  return canvas;
}
