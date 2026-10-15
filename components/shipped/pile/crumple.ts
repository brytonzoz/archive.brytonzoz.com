// How a receipt crumples, written twice: once as GLSL (the vertex shader displaces every sheet on the GPU) and
// once in plain TypeScript (the "CPU twin"), so the physics colliders, the picking spheres and the held
// receipt agree with what is drawn. Both read the same fold table, generated once from a fixed seed below.
//
// The model, in sheet space (x across the 80 mm width, y down the length, the printed face looking up +z):
//   * creases: a sum of seeded triangle waves ("folds") in several directions and three octaves. Each is
//     piecewise linear, so every crease is a sharp straight line and the paper between creases is a flat
//     facet. A smooth window along each crease fades it in and out, so creases end instead of running
//     across the whole sheet. The fragment shader uses the exact gradient of the same field, which is what
//     makes the facets crisp at any mesh resolution, and what leaves the faint crease network on a sheet
//     that has been smoothed back out.
//   * the ball: the sheet rolls along its length and pinches across its width onto a torus that closes into
//     a sphere (radius from the sheet's area) as crumple -> 1, while it contracts in-plane. The creases
//     deepen as it contracts, so the paper's area goes into the folds instead of visibly stretching.
//     Some balls roll print-side out, some print-side in.
//   * lumps: two low waves and a spiral offset (so overlapping windings don't fight), and the long edges
//     tuck inward to close the poles.
// Units: 1 = 10 cm (the physics world's scale). A sheet is 0.8 wide.
import { prng } from '../physics';

export const SHEET_W = 0.8;
export const MM = 0.01;
/** Pile sheets: shortest and longest geometry (a longer print is squashed into this on a ball). */
export const PILE_MIN_LENGTH = 1.4;
export const PILE_MAX_LENGTH = 4.2;
/** The receipt held up to read keeps its real length (up to this). */
export const HELD_MAX_LENGTH = 16;
/** Crumple of a sheet smoothed back out: flat, with its creases still in it. */
export const FLAT_CRUMPLE = 0.07;

const N_FOLDS = 9;
const WINDOW = 2.3;
/** Octaves: wavelength and slope of each fold. */
const OCTAVES = [
  { lambda: 0.62, slope: 0.78 },
  { lambda: 0.33, slope: 0.7 },
  { lambda: 0.17, slope: 0.55 },
];
const CREASE_GAIN = 0.85;
const LUMP = 0.15;
const TUCK = 0.24;
const SPIRAL = 0.08;
const PHI_MAX = 1.45;

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Per-fold coefficients mixing the four seed numbers (fixed for every receipt; the seed varies). */
const FOLDS = (() => {
  const random = prng('pile:folds:v1');
  const rows: number[][] = [];
  for (let i = 0; i < N_FOLDS; i++) {
    const octave = OCTAVES[Math.floor(i / 3)];
    // lambda, slope, a, b, c, d, e, f, g, h, i2, w
    rows.push([
      octave.lambda,
      octave.slope,
      round(1 + random() * 6),
      round(1 + random() * 6),
      round(random()),
      round(1 + random() * 5),
      round(1 + random() * 5),
      round(1 + random() * 7),
      round(1 + random() * 7),
      round(1 + random() * 5),
      round(1 + random() * 5),
      round(random()),
    ]);
  }
  return rows;
})();

const fract = (x: number) => x - Math.floor(x);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = 6.283185307179586;

function sincf(t: number): number {
  return Math.abs(t) < 1e-3 ? 1 - (t * t) / 6 : Math.sin(t) / t;
}

/** (t - sin t) / t^2, the centroid's helper; t/6 near 0. */
function fsinc(t: number): number {
  return Math.abs(t) < 1e-2 ? t / 6 - (t * t * t) / 120 : (t - Math.sin(t)) / (t * t);
}

export type Seed4 = [number, number, number, number];

/** Four stable numbers per receipt id: every shape decision is a function of these. */
export function shapeSeed(id: string): Seed4 {
  const random = prng(`pile:${id}`);
  random();
  random();
  return [random(), random(), random(), random()];
}

/** How crumpled a receipt lies in the pile: mostly balls, a few only half balled up. */
export function restCrumple(id: string): number {
  const random = prng(`crumple:${id}`);
  // The first draw of seeds that differ only in their last character barely differ; skip it.
  random();
  random();
  return random() < 0.16 ? 0.5 + random() * 0.2 : 0.86 + random() * 0.14;
}

/** Sheet length (units) from the raster height (dots, 8 per mm), clamped for the pile. */
export function pileLength(heightDots: number): number {
  return clamp((heightDots / 8) * MM, PILE_MIN_LENGTH, PILE_MAX_LENGTH);
}

export function heldLength(heightDots: number): number {
  return clamp((heightDots / 8) * MM, 0.6, HELD_MAX_LENGTH);
}

type Derived = { sign: number; rb: number; kx1: number; ky1: number };

function derived(seed: Seed4, length: number): Derived {
  const sign = seed[3] < 0.38 ? -1 : 1;
  const rb = 0.135 * Math.sqrt(SHEET_W * length) * (0.92 + 0.16 * seed[1]);
  const turns = clamp(0.95 + (0.1 * length) / SHEET_W, 1.05, 1.45) + 0.1 * (seed[2] - 0.5);
  return { sign, rb, kx1: (PHI_MAX * rb) / (0.5 * SHEET_W), ky1: (Math.PI * turns * rb) / (0.5 * length) };
}

/** The crease field at sheet point (x, y): [height, d/dx, d/dy]. */
export function creases(x: number, y: number, s: Seed4, out: number[] = [0, 0, 0]): number[] {
  let h = 0;
  let gx = 0;
  let gy = 0;
  for (let i = 0; i < N_FOLDS; i++) {
    const f = FOLDS[i];
    const ang = TAU * fract(s[0] * f[2] + s[1] * f[3] + f[4]);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const lam = f[0] * (0.78 + 0.44 * fract(s[2] * f[5] + s[3] * f[6]));
    const ph = fract(s[3] * f[7] + s[0] * f[8]);
    const sig = f[1] * (0.55 + 0.9 * fract(s[1] * f[9] + s[2] * f[10]));
    const t = (x * nx + y * ny) / lam + ph;
    const fr = fract(t);
    const tri = Math.abs(fr - 0.5) * 4 - 1;
    const dtri = fr < 0.5 ? -4 : 4;
    const along = (-x * ny + y * nx) / (lam * WINDOW) + ph * 3.1 + f[11];
    const w = smoothstep(0.12, 0.88, 0.5 + 0.5 * Math.sin(TAU * along));
    h += sig * lam * 0.25 * tri * w;
    gx += sig * 0.25 * dtri * w * nx;
    gy += sig * 0.25 * dtri * w * ny;
  }
  out[0] = h;
  out[1] = gx;
  out[2] = gy;
  return out;
}

export type ShapeInput = { seed: Seed4; length: number; crumple: number };

const scratch = [0, 0, 0];

/**
 * Where sheet point (u, v) ends up (body-local, centred on the shape's centroid). u: 0..1 left to right,
 * v: 0 at the top of the receipt to 1 at the foot. Mirrors pileShape() in CRUMPLE_GLSL line for line.
 */
export function shapePoint(u: number, v: number, input: ShapeInput, out: number[] = [0, 0, 0]): number[] {
  const { seed: s, length: L, crumple: c } = input;
  const d = derived(s, L);
  const x = (u - 0.5) * SHEET_W;
  const y = (0.5 - v) * L;
  const g = smoothstep(0.06, 0.92, c);
  const A = Math.pow(Math.max(c, 0), 0.85);
  const kx = mix(1, d.kx1, g);
  const ky = mix(1, d.ky1, g);
  const kap = (d.sign * g) / d.rb;
  const X = x * kx;
  const Y = y * ky;
  const phi = X * kap;
  const psi = Y * kap;
  const sphi = Math.sin(phi);
  const cphi = Math.cos(phi);
  const spsi = Math.sin(psi);
  const cpsi = Math.cos(psi);
  const hphi = sincf(0.5 * phi);
  const hpsi = sincf(0.5 * psi);
  const ry = 0.5 * X * X * kap * hphi * hphi;
  const rz = 0.5 * Y * Y * kap * hpsi * hpsi;
  let px = X * sincf(phi);
  let py = Y * sincf(psi) - spsi * ry;
  let pz = -rz - cpsi * ry;
  const nx = sphi;
  const ny = spsi * cphi;
  const nz = cpsi * cphi;
  const xm = 0.5 * SHEET_W * kx;
  const ym = 0.5 * L * ky;
  const cz = -(ym * fsinc(ym * kap) + sincf(ym * kap) * xm * fsinc(xm * kap));
  pz -= cz;

  creases(x, y, s, scratch);
  const amp = A * mix(1, 0.55, g) * CREASE_GAIN;
  const a1 = TAU * fract(s[2] * 3.7 + s[0] * 1.3);
  const a2 = TAU * fract(s[0] * 2.9 + s[3] * 1.7);
  const f1 = TAU / (0.9 + 0.5 * s[0]);
  const f2 = TAU / (0.7 + 0.5 * s[1]);
  const p1 = x * Math.cos(a1) * f1 + y * Math.sin(a1) * f1 + TAU * s[1];
  const p2 = x * Math.cos(a2) * f2 + y * Math.sin(a2) * f2 + TAU * s[3];
  const lump = d.rb * LUMP * g * Math.sin(p1) * Math.sin(p2);
  const e = (2 * Math.abs(x)) / SHEET_W;
  const tuck = d.rb * TUCK * g * e * e * e * e;
  const spiral = d.rb * SPIRAL * g * (0.5 - v);
  const disp = d.sign * (lump + spiral - tuck) + amp * scratch[0];
  px += nx * disp;
  py += ny * disp;
  pz += nz * disp;
  out[0] = px;
  out[1] = py;
  out[2] = pz;
  return out;
}

export type Hull = { points: Float32Array; radius: number; halfHeight: number };

/** The pile's instanced sheet: 10 x 40 cells (<= 800 triangles a receipt). */
export const PILE_GRID = { across: 10, along: 40 };

/**
 * The surface points of the drawn sheet for the convex-hull collider, and the bounding radius for picking.
 * Sampled on the same grid the GPU displaces, so the hull contains every triangle that is drawn (nothing
 * pokes through the counter or through the ball underneath).
 */
export function shapeHull(input: ShapeInput, nu = PILE_GRID.across + 1, nv = PILE_GRID.along + 1): Hull {
  const points = new Float32Array(nu * nv * 3);
  const p = [0, 0, 0];
  let radius = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let k = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      shapePoint(i / (nu - 1), j / (nv - 1), input, p);
      points[k++] = p[0];
      points[k++] = p[1];
      points[k++] = p[2];
      radius = Math.max(radius, Math.hypot(p[0], p[1], p[2]));
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
  }
  return { points, radius, halfHeight: Math.max(0.01, (maxZ - minZ) / 2) };
}

const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const table = (index: number) => `float[${N_FOLDS}](${FOLDS.map((row) => glslFloat(row[index])).join(', ')})`;

/**
 * GLSL ES 3.0 for both the colour and the depth passes. Defines pileShape(), pileCreases(), pileTornEdge().
 * Generated from the same constants as the functions above, so the twin is exact.
 */
export const CRUMPLE_GLSL = /* glsl */ `
#define PILE_TAU 6.283185307179586
#define PILE_W ${glslFloat(SHEET_W)}
const float PF_LAM[${N_FOLDS}] = ${table(0)};
const float PF_SIG[${N_FOLDS}] = ${table(1)};
const float PF_A[${N_FOLDS}] = ${table(2)};
const float PF_B[${N_FOLDS}] = ${table(3)};
const float PF_C[${N_FOLDS}] = ${table(4)};
const float PF_D[${N_FOLDS}] = ${table(5)};
const float PF_E[${N_FOLDS}] = ${table(6)};
const float PF_F[${N_FOLDS}] = ${table(7)};
const float PF_G[${N_FOLDS}] = ${table(8)};
const float PF_H[${N_FOLDS}] = ${table(9)};
const float PF_I[${N_FOLDS}] = ${table(10)};
const float PF_W[${N_FOLDS}] = ${table(11)};

float pileSinc(float t) { return abs(t) < 1e-3 ? 1.0 - t * t / 6.0 : sin(t) / t; }
float pileFsinc(float t) { return abs(t) < 1e-2 ? t / 6.0 - t * t * t / 120.0 : (t - sin(t)) / (t * t); }

// x: height, yz: gradient (sheet units).
vec3 pileCreases(vec2 p, vec4 s) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${N_FOLDS}; i++) {
    float ang = PILE_TAU * fract(s.x * PF_A[i] + s.y * PF_B[i] + PF_C[i]);
    vec2 n = vec2(cos(ang), sin(ang));
    float lam = PF_LAM[i] * (0.78 + 0.44 * fract(s.z * PF_D[i] + s.w * PF_E[i]));
    float ph = fract(s.w * PF_F[i] + s.x * PF_G[i]);
    float sig = PF_SIG[i] * (0.55 + 0.9 * fract(s.y * PF_H[i] + s.z * PF_I[i]));
    float fr = fract(dot(p, n) / lam + ph);
    float tri = abs(fr - 0.5) * 4.0 - 1.0;
    float dtri = fr < 0.5 ? -4.0 : 4.0;
    float along = (-p.x * n.y + p.y * n.x) / (lam * ${glslFloat(WINDOW)}) + ph * 3.1 + PF_W[i];
    float w = smoothstep(0.12, 0.88, 0.5 + 0.5 * sin(PILE_TAU * along));
    acc.x += sig * lam * 0.25 * tri * w;
    acc.yz += sig * 0.25 * dtri * w * n;
  }
  return acc;
}

struct PileShape {
  vec3 p;     // body-local position
  vec3 n;     // macro normal of the printed face
  vec3 tx;    // unit tangent across the sheet
  vec3 ty;    // unit tangent along the sheet
  vec2 sheet; // sheet coordinates (units)
  vec2 sg;    // surface gradient of the smooth displacement
  vec2 cs;    // crease gradient -> surface gradient scale
};

PileShape pileShape(vec2 uv, vec4 s, float c, float L) {
  PileShape o;
  float sgn = s.w < 0.38 ? -1.0 : 1.0;
  float rb = 0.135 * sqrt(PILE_W * L) * (0.92 + 0.16 * s.y);
  float turns = clamp(0.95 + 0.1 * L / PILE_W, 1.05, 1.45) + 0.1 * (s.z - 0.5);
  float kx1 = ${glslFloat(PHI_MAX)} * rb / (0.5 * PILE_W);
  float ky1 = 3.141592653589793 * turns * rb / (0.5 * L);
  float x = (uv.x - 0.5) * PILE_W;
  float y = (0.5 - uv.y) * L;
  float g = smoothstep(0.06, 0.92, c);
  float A = pow(max(c, 0.0), 0.85);
  float kx = mix(1.0, kx1, g);
  float ky = mix(1.0, ky1, g);
  float kap = sgn * g / rb;
  float X = x * kx;
  float Y = y * ky;
  float phi = X * kap;
  float psi = Y * kap;
  float sphi = sin(phi);
  float cphi = cos(phi);
  float spsi = sin(psi);
  float cpsi = cos(psi);
  float hphi = pileSinc(0.5 * phi);
  float hpsi = pileSinc(0.5 * psi);
  float ry = 0.5 * X * X * kap * hphi * hphi;
  float rz = 0.5 * Y * Y * kap * hpsi * hpsi;
  vec3 P = vec3(X * pileSinc(phi), Y * pileSinc(psi) - spsi * ry, -rz - cpsi * ry);
  vec3 N = vec3(sphi, spsi * cphi, cpsi * cphi);
  float xm = 0.5 * PILE_W * kx;
  float ym = 0.5 * L * ky;
  P.z += ym * pileFsinc(ym * kap) + pileSinc(ym * kap) * xm * pileFsinc(xm * kap);

  vec3 cr = pileCreases(vec2(x, y), s);
  float amp = A * mix(1.0, 0.55, g) * ${glslFloat(CREASE_GAIN)};
  float a1 = PILE_TAU * fract(s.z * 3.7 + s.x * 1.3);
  float a2 = PILE_TAU * fract(s.x * 2.9 + s.w * 1.7);
  vec2 k1 = vec2(cos(a1), sin(a1)) * (PILE_TAU / (0.9 + 0.5 * s.x));
  vec2 k2 = vec2(cos(a2), sin(a2)) * (PILE_TAU / (0.7 + 0.5 * s.y));
  float p1 = dot(vec2(x, y), k1) + PILE_TAU * s.y;
  float p2 = dot(vec2(x, y), k2) + PILE_TAU * s.w;
  float lumpK = rb * ${glslFloat(LUMP)} * g;
  float lump = lumpK * sin(p1) * sin(p2);
  vec2 dLump = lumpK * (cos(p1) * sin(p2) * k1 + sin(p1) * cos(p2) * k2);
  float e = 2.0 * abs(x) / PILE_W;
  float tuckK = rb * ${glslFloat(TUCK)} * g;
  float tuck = tuckK * e * e * e * e;
  vec2 dTuck = vec2(tuckK * 4.0 * e * e * e * (2.0 / PILE_W) * sign(x), 0.0);
  float spiralK = rb * ${glslFloat(SPIRAL)} * g;
  float spiral = spiralK * (0.5 - uv.y);
  vec2 dSpiral = vec2(0.0, spiralK / L);
  float disp = sgn * (lump + spiral - tuck) + amp * cr.x;
  P += N * disp;

  float cy = max(cphi, 0.25);
  vec2 smoothG = sgn * (dLump + dSpiral - dTuck);
  o.p = P;
  o.n = N;
  o.tx = vec3(cphi, -sphi * spsi, -sphi * cpsi);
  o.ty = vec3(0.0, cpsi, -spsi);
  o.sheet = vec2(x, y);
  o.sg = vec2(smoothG.x / kx, smoothG.y / (ky * cy));
  o.cs = vec2(amp / kx, amp / (ky * cy));
  return o;
}

float pileHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Torn short edges: the teeth of the printer's serrated bar, a little ragged. True where there's no paper.
bool pileTorn(vec2 uv, float L, vec4 s) {
  float fromTop = uv.y * L;
  float fromFoot = (1.0 - uv.y) * L;
  float edge = min(fromTop, fromFoot);
  if (edge > 0.02) return false;
  float x = uv.x * PILE_W;
  float salt = fromTop < fromFoot ? s.x * 17.0 : s.z * 23.0;
  float pitch = 0.021;
  float k = x / pitch + salt;
  float cell = floor(k);
  float tooth = abs(fract(k) - 0.5) * 2.0;
  float depth = 0.0085 * (0.45 + 0.55 * tooth) * (0.7 + 0.6 * pileHash(vec2(cell, salt)));
  return edge < depth;
}
`;
