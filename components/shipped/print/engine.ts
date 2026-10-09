// Everything that moves in PrintAndTear, in one requestAnimationFrame loop that writes transforms (and a few
// opacities) straight to the elements: no React state per frame, and the loop stops when nothing moves.
//
//   printing  the feed plan (timeline.ts) burns each line just before the stepper shoves it out of the slot;
//             the paper rises with its free end curling back (nested 3D slices), sways on each shove.
//   hanging   pull it: it bends about the bar, then tears tooth by tooth from the side you grabbed (tear.ts);
//             tap, TEAR, Enter or handle.tear() tears it in ~180 ms with a small yank.
//   free      a 2D rigid body (body.ts): held, it swings from your finger; let go, it falls in front of the
//             printer and springs to rest in the hands zone below it (which the component grows to fit).
//   ball      crumpled in 2D (crumple.ts) and thrown on a parabola to the pile (thermal/toss.ts).
import type { Band, PrintDoc, ThermalReceipt } from '../thermal/types';
import { createRaster, loadLogos, pageFont, prepareFont, PAPER_DOTS, type Raster } from '../thermal/raster';
import type { ScreenRect, TossPayload } from '../thermal/toss';
import { prng, rubber, spring, springStep, type SpringConfig } from '../physics';
import { buildFeedPlan, sampleFeed, type FeedPlan } from './timeline';
import { aboveClip, barClip, belowClip, edgeY, serratedEdge, TOOTH_DEPTH, TOOTH_PITCH, type EdgePoint, type TornPart } from './tear';
import { localPoint, stepFalling, stepHeld, type Body2D } from './body';
import { Crumple, paperTexture } from './crumple';
import { GRAIN_SIZE, grainTile, grainUrl } from './grain';

export type PrintSounds = {
  /** The motor starts feeding. */
  feedStart(): void;
  /** Line `index` was just burned (a beat before the stepper shoves it out). */
  line(index: number, band: Band): void;
  feedStop(): void;
  /** The paper starts giving way at the bar. */
  tearStart(): void;
  /** It's off. */
  tear(): void;
  crumple(): void;
  toss(): void;
};

export type PrintPhase = 'idle' | 'loading' | 'printing' | 'hanging' | 'falling' | 'inhand' | 'tossing' | 'tossed';

export type EngineHooks = {
  sounds(): PrintSounds;
  reduced(): boolean;
  tossable(): boolean;
  speed(): number;
  target(): ScreenRect | null;
  toss(payload: TossPayload): boolean;
  phase(phase: PrintPhase, landed?: boolean): void;
  line(index: number): void;
  printed(): void;
  torn(): void;
  tossed(landed: boolean): void;
};

export type EngineElements = {
  root: HTMLElement;
  frame: HTMLElement;
  guide: HTMLElement;
  back: HTMLElement;
  front: HTMLElement;
  bar: HTMLElement;
  /** The steel itself, cut to teeth. */
  blade: HTMLElement;
  slot: HTMLElement;
  hands: HTMLElement;
  stubLayer: HTMLElement;
  stub: HTMLElement;
  paperLayer: HTMLElement;
  sheet: HTMLElement;
  shadow: HTMLElement;
  body: HTMLElement;
  /** Blank paper from just above the tear line down into the roll; it carries the torn edge, so the big
   * face with the print never needs a clip-path (re-clipping a tall layer every frame is costly). */
  foot: HTMLElement;
  ink: HTMLElement;
  tint: HTMLElement;
  grip: HTMLElement;
  ring: HTMLElement;
  /** Zero-height anchor at the top of the flat part; the curl slices hang off it. */
  curl: HTMLElement;
  slices: HTMLElement[];
  fronts: HTMLElement[];
  backs: HTMLElement[];
  /** Per face: a flat shade (the darker end's light) and a ramp across the face (the rest of the change),
   * so the light falls off smoothly over the bend instead of in bands, with opacity changes only. */
  frontShades: HTMLElement[];
  backShades: HTMLElement[];
  frontRamps: HTMLElement[];
  backRamps: HTMLElement[];
};

/** Curl: 10 slices of 28 dots (3.5 mm) at the free end. */
export const SLICES = 10;
const SLICE_ROWS = 28;
const CURL_ROWS = SLICES * SLICE_ROWS;
/** Each slice's face reaches this many rows into the one below, so the hinges never show a hairline. */
const OVERLAP = 3;
/** The tear line sits this many dots above the slot (what's left of the stub). */
const STUB_ROWS = 20;
/** Room above the tear line for the edge's teeth and fibres. */
const EDGE_PAD = 12;
/** The print is shown in bands of this many dots: a burned line only re-uploads its own band. */
const TILE_ROWS = 256;
/** The foot starts this many dots above the tear line (above the highest tooth and fibre). */
const FOOT_ABOVE = 14;
/** Blank paper still on the roll below the print, and how much FEED may push out. */
const ROLL_ROWS = 220;
const FEED_STEP = 24;
const FEED_MAX = 96;
const FEED_RATE = 0.9; // dots per ms

/** The lamp: in front of the paper and a little above it (22 degrees), so paper curling away goes dim. */
const LAMP = (22 * Math.PI) / 180;
const AMBIENT = 0.44;
const DIFFUSE = 0.6;
const LIT_FLAT = AMBIENT + DIFFUSE * Math.cos(LAMP);

const SWAY = spring(0.85, 0.42);
const PULL = spring(0.28, 0.1);
const FLEX = spring(0.55, 0.35);
const OPEN = spring(0.32, 0.2);
const RELAX = spring(0.5, 0.1);
const LAND = spring(0.5, 0.32);
const LAND_TILT = spring(0.65, 0.28);
const LIFT = spring(0.3, 0);
const FLIP = spring(0.42, 0);

const TEAR_START = 30;
const TEAR_RANGE = 100;
const AUTO_TEAR_MS = 180;
const CRUMPLE_MS = 350;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const DEG = 180 / Math.PI;

type Mode = 'empty' | 'loading' | 'printing' | 'hanging' | 'free' | 'gone';
type FreeSub = 'held' | 'falling' | 'landing' | 'rest';

type Drag = {
  id: number;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  lx: number;
  ly: number;
  lt: number;
  vx: number;
  vy: number;
  /** Recent samples (ms, client px), for the release velocity. */
  trail: { t: number; x: number; y: number }[];
  state: 'pending' | 'pull' | 'hold' | 'scroll';
  grip: boolean;
  side: -1 | 1;
  /** Height of the grab above the slot (px). */
  reach: number;
};

type Ball = {
  phase: 'crumple' | 'fly';
  t: number;
  crumple: Crumple;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr: number;
  /** Receipt frame -> canvas px at the start, and the frame's top then (to follow scrolling). */
  place: { x: number; y: number; angle: number; scale: number };
  frameTop: number;
  /** Where the crumple canvas sits on the page. */
  origin: { x: number; y: number };
  /** In flight the ball is its own small canvas, moved by transform only. */
  sprite?: { canvas: HTMLCanvasElement; size: number };
  start?: { x: number; y: number };
  duration?: number;
  arc?: number;
  spin: number;
  last?: { x: number; y: number; t: number };
  velocity: { x: number; y: number };
  aimless?: { x: number; y: number };
  receipt: ThermalReceipt;
  raster: Raster | null;
};

function reducedFromMedia(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export class PrintEngine {
  private readonly el: EngineElements;
  private readonly hooks: EngineHooks;
  private destroyed = false;

  // Layout (css px)
  private W = 340;
  private s = 340 / PAPER_DOTS;
  private frameW = 0;
  private paperLeft = 0;
  private slotY = 0;

  // The job
  private receipt: ThermalReceipt | null = null;
  private doc: PrintDoc | null = null;
  private raster: Raster | null = null;
  private plan: FeedPlan | null = null;
  private token = 0;
  private mode: Mode = 'empty';
  private jobT = 0;
  private hint = 0;
  private burned = 0;
  private motor = false;
  private strips: HTMLCanvasElement[] = [];
  private tiles: HTMLCanvasElement[] = [];
  private stripDone: boolean[] = [];

  // Paper geometry, in dots (rows of the sheet from its top fibre)
  private T0 = EDGE_PAD + STUB_ROWS;
  private Htot = 0;
  private Ptot = 0;
  /** Sheet rows out of the slot. */
  private F = 0;
  private Ftarget = 0;
  private fedExtra = 0;
  private stubRows = STUB_ROWS;
  private stubTarget = STUB_ROWS;
  private topEdge: EdgePoint[] | null = null;
  /** Sheet row where the foot starts (0 while printing: the print face runs to the end of the sheet). */
  private footTop = 0;
  private edge: EdgePoint[] | null = null;
  private curl = new Float32Array(SLICES);

  // Springs on the standing paper
  private sx = 0;
  private vsx = 0;
  private sz = 0;
  private vsz = 0;
  private flex = 0;
  private vflex = 0;
  private relax = 1;
  private vrelax = 0;
  private vib = 0;

  // The tear
  private progress = 0;
  private side: -1 | 1 = -1;
  private started = false;
  private auto = false;
  private alpha = 0;
  private valpha = 0;
  private clipKey = '';
  private pendingToss = false;

  // The free receipt
  private bodyState: Body2D = { x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0, w: 1, h: 1 };
  private bz = 0;
  private vbz = 0;
  private tilt = 0;
  private vtilt = 0;
  private sub: FreeSub = 'rest';
  private grab = { x: 0, y: 0 };
  private rest = { x: 0, y: 0, a: 0 };
  private landed = false;
  private lift = 0;
  private vlift = 0;
  private handsH = 0;
  private revealed = false;
  private texture: HTMLCanvasElement | null = null;

  // Leaving (a new print while the old receipt is still out)
  private leaving: { t: number; then: () => void } | null = null;

  private flipY = 0;
  private vflipY = 0;
  private drag: Drag | null = null;
  private ball: Ball | null = null;

  private frame = 0;
  private last = 0;
  private writes = new Map<HTMLElement, string>();
  private observer: ResizeObserver | null = null;
  private holdTimer = 0;

  constructor(el: EngineElements, hooks: EngineHooks) {
    this.el = el;
    this.hooks = hooks;
    const grain = grainUrl();
    if (grain) el.root.style.setProperty('--paper-grain', grain);
    for (let k = 0; k < SLICES; k++) {
      const canvas = document.createElement('canvas');
      canvas.width = PAPER_DOTS;
      canvas.height = SLICE_ROWS + OVERLAP;
      canvas.setAttribute('aria-hidden', 'true');
      el.fronts[k].insertBefore(canvas, el.frontShades[k]);
      this.strips.push(canvas);
      this.stripDone.push(false);
    }
    el.sheet.addEventListener('pointerdown', this.onPointerDown);
    el.sheet.addEventListener('keydown', this.onKeyDown);
    el.sheet.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.sheet.addEventListener('click', this.onClick, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(el.root);
    this.layout();
    this.writeStub();
  }

  destroy() {
    this.destroyed = true;
    this.token++;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.holdTimer);
    if (this.motor) this.hooks.sounds().feedStop();
    this.motor = false;
    this.endDrag();
    this.ball?.canvas.remove();
    this.ball?.sprite?.canvas.remove();
    this.ball = null;
    this.observer?.disconnect();
    this.el.sheet.removeEventListener('pointerdown', this.onPointerDown);
    this.el.sheet.removeEventListener('keydown', this.onKeyDown);
    this.el.sheet.removeEventListener('touchmove', this.onTouchMove);
    this.el.sheet.removeEventListener('click', this.onClick, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  // ---- public ---------------------------------------------------------------------------------------

  /** A (new) receipt to print. Nothing moves until print(). */
  load(receipt: ThermalReceipt, doc: PrintDoc) {
    this.receipt = receipt;
    this.doc = doc;
    if (!this.edge && !this.topEdge) {
      // The first sheet's top was torn by whoever used the printer before.
      this.edge = serratedEdge(prng(`${receipt.id}:top`));
      this.writeStub(true);
    }
  }

  print() {
    if (!this.receipt || !this.doc || this.destroyed) return;
    const token = ++this.token;
    if (this.mode === 'printing' && this.motor) {
      this.hooks.sounds().feedStop();
      this.motor = false;
    }
    const go = () => {
      if (token !== this.token) return;
      void this.startPrint(token);
    };
    if ((this.mode === 'hanging' || this.mode === 'free' || this.mode === 'printing') && !this.hooks.reduced()) {
      this.endDrag();
      this.leaving = { t: 0, then: go };
      this.kick();
    } else {
      go();
    }
  }

  tear() {
    if (this.mode !== 'hanging' || this.auto) return;
    this.startAutoTear(this.started ? this.side : prng(`${this.receipt?.id}:side`)() < 0.5 ? -1 : 1);
  }

  crumpleAndToss() {
    if (this.mode === 'hanging') {
      this.pendingToss = true;
      this.tear();
      return;
    }
    if (this.mode !== 'free' || this.ball) return;
    if (this.sub === 'falling' && !this.landed) {
      this.pendingToss = true;
      return;
    }
    this.startCrumple();
  }

  /** The FEED key: push out a little blank paper. */
  feed() {
    if (this.mode === 'hanging' && !this.started && !this.drag) {
      if (this.fedExtra >= FEED_MAX) return;
      this.fedExtra += FEED_STEP;
      this.Ftarget = this.T0 + this.Htot + this.fedExtra;
    } else if (this.mode === 'empty' || this.mode === 'gone') {
      if (this.stubTarget - STUB_ROWS >= FEED_MAX) return;
      this.stubTarget += FEED_STEP;
    } else {
      return;
    }
    if (this.hooks.reduced()) {
      this.stubRows = this.stubTarget;
      this.writeStub();
      if (this.mode === 'hanging') {
        this.F = this.Ftarget;
        this.writeStanding();
        this.placeHanging();
      }
      return;
    }
    if (!this.motor) {
      this.hooks.sounds().feedStart();
      this.motor = true;
    }
    this.kick();
  }

  // ---- layout ---------------------------------------------------------------------------------------

  layout() {
    if (this.destroyed) return;
    const el = this.el;
    const W = el.guide.offsetWidth || 320;
    this.W = W;
    this.s = W / PAPER_DOTS;
    this.frameW = el.frame.offsetWidth;
    this.paperLeft = (this.frameW - W) / 2;
    const frameBox = el.frame.getBoundingClientRect();
    const slotBox = el.slot.getBoundingClientRect();
    this.slotY = slotBox.top + slotBox.height / 2 - frameBox.top - this.vib;
    el.root.style.setProperty('--slot-y', `${this.slotY.toFixed(2)}px`);

    const s = this.s;
    el.sheet.style.width = `${W}px`;
    for (const slice of el.slices) slice.style.height = `${(SLICE_ROWS * s).toFixed(3)}px`;
    for (const face of [...el.fronts, ...el.backs]) face.style.height = `${((SLICE_ROWS + OVERLAP) * s).toFixed(3)}px`;
    el.body.style.top = `${(CURL_ROWS * s).toFixed(3)}px`;
    el.curl.style.top = `${(CURL_ROWS * s).toFixed(3)}px`;
    this.positionTiles();
    this.sizeSheet();

    // The serrated bar: its teeth have the paper's tooth pitch and line up with the tear.
    const barLeft = this.paperLeft - 14;
    const barWidth = W + 28;
    // Teeth about 1.2 mm tall with their tips 1.6 mm above the slot; the bar's body covers the slot's lip.
    const tip = 13 * s;
    const depth = 10 * s;
    const height = tip + 4;
    el.bar.style.setProperty('--teeth', `${depth.toFixed(2)}px`);
    // The bar lives in the printer's front: place it in that box's coordinates.
    const frontBox = el.front.getBoundingClientRect();
    const fx = frontBox.left - frameBox.left;
    const fy = frontBox.top - frameBox.top - this.vib;
    el.bar.style.left = `${(barLeft - fx).toFixed(2)}px`;
    el.bar.style.width = `${barWidth.toFixed(2)}px`;
    el.bar.style.top = `${(this.slotY - tip - fy).toFixed(2)}px`;
    el.bar.style.height = `${height.toFixed(2)}px`;
    const clip = barClip(barWidth, height, TOOTH_PITCH * s, 14 + (TOOTH_PITCH / 2) * s, depth);
    el.blade.style.clipPath = clip;
    el.blade.style.setProperty('-webkit-clip-path', clip);

    // The stub strip.
    el.stub.style.left = `${this.paperLeft.toFixed(2)}px`;
    el.stub.style.top = `${this.slotY.toFixed(2)}px`;
    el.stub.style.width = `${W}px`;
    el.stub.style.height = `${((EDGE_PAD + STUB_ROWS + FEED_MAX + 24) * s).toFixed(2)}px`;
    this.writeStub(true);
    this.writeClips();
    if (this.mode === 'free') {
      this.placeHands();
      if (this.sub === 'rest') {
        this.bodyState.x = this.rest.x;
        this.bodyState.y = this.rest.y;
      }
    }
    if (this.mode === 'hanging') this.placeHanging();
    this.writeAll();
  }

  /** Clip paths are in px, so they follow the paper's scale. */
  private writeClips() {
    const s = this.s;
    this.clipKey = '';
    if (this.topEdge && this.mode !== 'empty') {
      // The back face is turned over (rotateY 180deg), so its copy of the edge is mirrored.
      const mirrored = this.topEdge.map((p) => ({ x: PAPER_DOTS - p.x, y: p.y })).reverse();
      const clips: [HTMLElement, string][] = [
        [this.el.fronts[SLICES - 1], belowClip(this.topEdge, EDGE_PAD * s, s)],
        [this.el.backs[SLICES - 1], belowClip(mirrored, EDGE_PAD * s, s)],
      ];
      for (const [face, clip] of clips) {
        face.style.clipPath = clip;
        face.style.setProperty('-webkit-clip-path', clip);
      }
    }
    if (this.mode === 'hanging' && this.started) this.writeTornClip();
    if ((this.mode === 'free' || this.mode === 'gone') && this.edge) {
      const tearRow = this.F - STUB_ROWS;
      this.placeFoot();
      this.clipFoot(aboveClip(this.edge, (tearRow - this.footTop) * s, s, null));
      this.el.shadow.style.height = `${(tearRow * s).toFixed(2)}px`;
      this.el.ring.style.height = `${(tearRow * s).toFixed(2)}px`;
      this.bodyState.w = this.W;
      this.bodyState.h = tearRow * s;
    }
  }

  private sizeSheet() {
    const el = this.el;
    const s = this.s;
    const rows = Math.max(this.Ptot, CURL_ROWS + ROLL_ROWS);
    el.sheet.style.height = `${(rows * s).toFixed(3)}px`;
    // The print face runs 3 dots into the foot (blank paper both), so the join never shows a hairline.
    el.body.style.height = `${(((this.footTop ? this.footTop + 3 : rows) - CURL_ROWS) * s).toFixed(3)}px`;
    if (this.footTop) {
      el.foot.style.top = `${(this.footTop * s).toFixed(3)}px`;
      el.foot.style.height = `${((rows - this.footTop) * s).toFixed(3)}px`;
    }
    el.ink.style.top = `${((this.T0 - CURL_ROWS) * s).toFixed(3)}px`;
    el.ink.style.height = `${(Math.max(1, this.Htot) * s).toFixed(3)}px`;
  }

  // ---- printing -------------------------------------------------------------------------------------

  private async startPrint(token: number) {
    const receipt = this.receipt;
    const doc = this.doc;
    if (!receipt || !doc) return;
    this.leaving = null;
    this.setMode('loading');
    const family = pageFont(this.el.root);
    const [logos] = await Promise.all([loadLogos(doc), prepareFont(family)]);
    if (token !== this.token || this.destroyed) return;
    let raster: Raster;
    try {
      raster = createRaster(doc, { fontFamily: family, logos });
    } catch {
      this.setMode('empty');
      return;
    }
    this.resetPaper();
    this.raster = raster;
    this.Htot = raster.height;
    this.makeTiles(raster);
    // The new sheet starts as the stub that was left in the slot.
    this.topEdge = this.edge ?? serratedEdge(prng(`${receipt.id}:top`));
    this.T0 = EDGE_PAD + this.stubRows;
    this.Ptot = this.T0 + this.Htot + ROLL_ROWS;
    this.F = this.T0;
    this.Ftarget = this.T0 + this.Htot;
    this.fedExtra = 0;
    this.edge = serratedEdge(prng(`${receipt.id}:tear`));
    const curl = prng(`${receipt.id}:curl`);
    // How the paper remembers the roll: a gentle bend that tightens toward the free end and rolls it over
    // the top (about 150-180 degrees in all).
    const total = 150 + curl() * 30;
    let sum = 0;
    const weight = (k: number) => 0.5 + k / (SLICES - 1) + (curl() - 0.5) * 0.12;
    const weights = Array.from({ length: SLICES }, (_, k) => weight(k));
    for (const w of weights) sum += w;
    for (let k = 0; k < SLICES; k++) this.curl[k] = (total * weights[k]) / sum;
    this.plan = buildFeedPlan(raster.bands, doc.lines, prng(`${receipt.id}:feed`), this.hooks.speed());
    this.jobT = 0;
    this.hint = 0;
    this.burned = 0;
    this.sizeSheet();
    this.mode = 'loading'; // (writeClips cuts the new sheet's top edge only once there is a sheet)
    this.writeClips();
    this.el.sheet.style.visibility = 'visible';
    this.el.stub.style.visibility = 'hidden';

    if (this.hooks.reduced()) {
      raster.burn();
      this.burned = doc.lines.length;
      this.copyTiles(0, raster.height);
      for (let k = 0; k < SLICES; k++) this.copyStrip(k);
      this.F = this.Ftarget;
      for (let i = 0; i < doc.lines.length; i++) this.hooks.line(i);
      this.finishPrint();
      return;
    }
    this.setMode('printing');
    this.hooks.sounds().feedStart();
    this.motor = true;
    this.kick();
  }

  private resetPaper() {
    const el = this.el;
    this.endDrag();
    this.mode = 'empty';
    this.progress = 0;
    this.started = false;
    this.auto = false;
    this.alpha = 0;
    this.valpha = 0;
    this.sx = this.vsx = this.sz = this.vsz = 0;
    this.flex = this.vflex = 0;
    this.relax = 1;
    this.vrelax = 0;
    this.landed = false;
    this.lift = this.vlift = 0;
    this.bz = this.vbz = this.tilt = this.vtilt = 0;
    this.pendingToss = false;
    this.revealed = false;
    this.texture = null;
    this.clipKey = '';
    this.raster = null;
    this.footTop = 0;
    el.foot.style.visibility = 'hidden';
    this.clipFoot('');
    for (let k = 0; k < SLICES; k++) {
      const ctx = this.strips[k].getContext('2d');
      ctx?.clearRect(0, 0, PAPER_DOTS, SLICE_ROWS + OVERLAP);
      this.stripDone[k] = false;
    }
    el.paperLayer.removeAttribute('data-free');
    el.paperLayer.style.opacity = '';
    el.paperLayer.style.transform = '';
    el.sheet.style.visibility = 'hidden';
    el.shadow.style.opacity = '0';
    this.writes.clear();
    this.opacities.clear();
    if (this.handsH) this.setHands(0);
  }

  /** Copies the burned rows of the raster that fall in curl slice k into its strip. */
  private copyStrip(k: number) {
    const raster = this.raster;
    if (!raster || this.stripDone[k]) return;
    // Slice k covers sheet rows [CURL_ROWS - (k + 1) * SLICE_ROWS, CURL_ROWS - k * SLICE_ROWS).
    const top = CURL_ROWS - (k + 1) * SLICE_ROWS - this.T0;
    const from = Math.max(0, top);
    const to = Math.min(raster.height, top + SLICE_ROWS + OVERLAP);
    const ctx = this.strips[k].getContext('2d');
    if (!ctx) return;
    if (to > from) {
      ctx.clearRect(0, from - top, PAPER_DOTS, to - from);
      ctx.drawImage(raster.canvas, 0, from, PAPER_DOTS, to - from, 0, from - top, PAPER_DOTS, to - from);
    }
    const band = raster.bands[raster.burned - 1];
    if (raster.burned >= raster.bands.length || (band && band.y + band.height >= to)) this.stripDone[k] = true;
  }

  /**
   * The print on screen: the raster canvas stays off the page and is copied, band by band, into tiles as
   * lines burn. A canvas that changes is re-sent to the GPU whole on some browsers; a 640 x 5000 receipt
   * would re-send 12 MB a line, a tile re-sends 0.6 MB.
   */
  private makeTiles(raster: Raster) {
    const count = Math.max(1, Math.ceil(raster.height / TILE_ROWS));
    const s = this.s;
    while (this.tiles.length < count) {
      const canvas = document.createElement('canvas');
      canvas.width = PAPER_DOTS;
      canvas.setAttribute('aria-hidden', 'true');
      this.tiles.push(canvas);
    }
    const nodes: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const canvas = this.tiles[i];
      const rows = Math.min(TILE_ROWS, raster.height - i * TILE_ROWS);
      canvas.height = rows; // also clears it
      canvas.style.top = `${(i * TILE_ROWS * s).toFixed(3)}px`;
      canvas.style.height = `${(rows * s).toFixed(3)}px`;
      nodes.push(canvas);
    }
    this.el.ink.replaceChildren(...nodes);
  }

  /** Copies raster rows [from, to) into the tiles that show them. */
  private copyTiles(from: number, to: number) {
    const raster = this.raster;
    if (!raster || to <= from) return;
    for (let i = Math.floor(from / TILE_ROWS); i * TILE_ROWS < to && i < this.tiles.length; i++) {
      const top = i * TILE_ROWS;
      const a = Math.max(from, top);
      const b = Math.min(to, top + TILE_ROWS, raster.height);
      if (b <= a) continue;
      const ctx = this.tiles[i].getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, a - top, PAPER_DOTS, b - a);
      ctx.drawImage(raster.canvas, 0, a, PAPER_DOTS, b - a, 0, a - top, PAPER_DOTS, b - a);
    }
  }

  private positionTiles() {
    const s = this.s;
    this.tiles.forEach((canvas, i) => {
      canvas.style.top = `${(i * TILE_ROWS * s).toFixed(3)}px`;
      canvas.style.height = `${(canvas.height * s).toFixed(3)}px`;
    });
  }

  private burnTo(target: number, quiet: boolean) {
    const raster = this.raster;
    if (!raster || !this.doc) return;
    const begin = performance.now();
    const fromRow = raster.bands[this.burned]?.y ?? 0;
    const probe = (window as unknown as { __PRINT_BURN__?: number[] }).__PRINT_BURN__;
    let fired = -1;
    while (this.burned < target) {
      const t = probe ? performance.now() : 0;
      raster.burn(this.burned + 1);
      if (probe) probe.push(performance.now() - t);
      const index = this.burned;
      this.burned++;
      this.hooks.line(index);
      fired = index;
      const band = raster.bands[index];
      // The shove that follows nudges the standing paper.
      if (band.height > 0 && band.kind !== 'feed') {
        const r = prng(`${this.receipt?.id}:${index}:sway`);
        this.vsx += (r() - 0.35) * 5 * (band.height / 30);
        this.vsz += (r() - 0.5) * 7 * (band.height / 30);
        this.vflex += 0.55 * (band.height / 30);
      }
      if (performance.now() - begin > 6) break;
    }
    if (fired >= 0) {
      const last = raster.bands[fired];
      this.copyTiles(fromRow, last.y + last.height);
    }
    // One sound per frame at most: catching up after a tab switch doesn't machine-gun.
    if (fired >= 0 && !quiet) this.hooks.sounds().line(fired, raster.bands[fired]);
    for (let k = 0; k < SLICES; k++) if (!this.stripDone[k]) this.copyStrip(k);
  }

  private finishPrint() {
    if (this.motor) {
      this.hooks.sounds().feedStop();
      this.motor = false;
    }
    this.F = Math.max(this.F, this.Ftarget);
    this.setMode('hanging');
    this.placeHanging();
    this.writeAll();
    this.hooks.printed();
    if (this.pendingToss) this.tear();
  }

  /** Grip (the paper near the bar, where a touch pulls instead of scrolling) and the focus ring. */
  private placeHanging() {
    const s = this.s;
    const tearRow = this.F - STUB_ROWS;
    if (!this.started) this.placeFoot();
    const gripTop = Math.max(CURL_ROWS, tearRow - 190);
    this.el.grip.style.top = `${(gripTop * s).toFixed(2)}px`;
    this.el.grip.style.height = `${((this.F - gripTop + 4) * s).toFixed(2)}px`;
    this.el.ring.style.top = `${(CURL_ROWS * s).toFixed(2)}px`;
    this.el.ring.style.height = `${((tearRow - CURL_ROWS) * s).toFixed(2)}px`;
  }

  /** Splits the sheet at the foot: the print face ends just above the tear line, blank paper below. */
  private placeFoot() {
    const footTop = Math.max(CURL_ROWS + 1, Math.round(this.F - STUB_ROWS - FOOT_ABOVE));
    if (footTop === this.footTop && this.el.foot.style.visibility === 'inherit') return;
    this.footTop = footTop;
    this.sizeSheet();
    // inherit, not visible: it must vanish with the sheet.
    this.el.foot.style.visibility = 'inherit';
  }

  private clipFoot(clip: string) {
    const foot = this.el.foot;
    foot.style.clipPath = clip;
    if (clip) foot.style.setProperty('-webkit-clip-path', clip);
    else foot.style.removeProperty('-webkit-clip-path');
  }

  // ---- tearing --------------------------------------------------------------------------------------

  private startAutoTear(side: -1 | 1) {
    if (this.mode !== 'hanging') return;
    if (!this.started) {
      this.started = true;
      this.side = side;
      this.hooks.sounds().tearStart();
    }
    if (this.hooks.reduced()) {
      this.progress = 1;
      this.completeTear(null);
      return;
    }
    this.auto = true;
    // The yank: the paper is snapped toward you and away from the side it tears from.
    this.vsx -= 38;
    this.vsz += -this.side * 26;
    this.kick();
  }

  /** The standing sheet's transform (also used to hand its pose to the free body). */
  private standingTransform(): string {
    const s = this.s;
    const W = this.W;
    const baseX = this.paperLeft + W / 2;
    const baseY = this.slotY + this.vib;
    let open = '';
    if (this.started && Math.abs(this.alpha) > 1e-4) {
      const front = this.front();
      const px = (front / PAPER_DOTS) * W - W / 2;
      const py = (-STUB_ROWS + (this.edge ? edgeY(this.edge, front) : 0)) * s;
      open = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) rotateZ(${this.alpha.toFixed(3)}deg) translate3d(${(-px).toFixed(2)}px, ${(-py).toFixed(2)}px, 0) `;
    }
    return `translate3d(${baseX.toFixed(2)}px, ${baseY.toFixed(2)}px, 0) ${open}rotateZ(${this.sz.toFixed(3)}deg) rotateX(${this.sx.toFixed(3)}deg) translate3d(${(-W / 2).toFixed(2)}px, ${(-this.F * s).toFixed(2)}px, 0)`;
  }

  private front(): number {
    return this.side === -1 ? this.progress * PAPER_DOTS : (1 - this.progress) * PAPER_DOTS;
  }

  private completeTear(drag: Drag | null) {
    const el = this.el;
    const s = this.s;
    const tearRow = this.F - STUB_ROWS;
    const Hr = tearRow * s;
    // Where the receipt's centre is right now, so the free body takes over without a jump.
    let cx = this.paperLeft + this.W / 2;
    let cy = this.slotY - STUB_ROWS * s - Hr / 2;
    let cz = 0;
    let angle = 0;
    let tilt = 0;
    try {
      const m = new DOMMatrix(this.standingTransform());
      const p = m.transformPoint(new DOMPoint(this.W / 2, Hr / 2, 0));
      cx = p.x;
      cy = p.y;
      cz = p.z;
      angle = Math.atan2(m.m12, m.m11);
      tilt = Math.asin(clamp(m.m23, -1, 1)) * DEG;
    } catch {
      // Older engines: start from the upright pose.
    }
    this.hooks.sounds().tear();
    this.auto = false;
    this.progress = 1;
    this.mode = 'free';
    this.landed = false;
    this.bodyState = { x: cx, y: cy, a: angle, vx: 0, vy: 0, va: 0, w: this.W, h: Hr };
    this.bz = cz;
    this.vbz = 0;
    this.tilt = tilt;
    this.vtilt = -this.vsx * 0.5;
    this.relax = 1;
    this.vrelax = 0;
    this.placeFoot();
    this.clipFoot(aboveClip(this.edge!, (tearRow - this.footTop) * s, s, null));
    el.shadow.style.height = `${Hr.toFixed(2)}px`;
    el.ring.style.top = '0px';
    el.ring.style.height = `${Hr.toFixed(2)}px`;
    el.grip.style.height = '0px';
    el.paperLayer.setAttribute('data-free', '');
    // What's left in the slot.
    this.stubRows = STUB_ROWS;
    this.stubTarget = STUB_ROWS;
    el.stub.style.visibility = 'visible';
    this.writeStub(true);
    this.placeHands();
    this.setHands(this.handsH);
    this.writes.delete(el.sheet);

    if (this.hooks.reduced()) {
      this.bodyState.x = this.rest.x;
      this.bodyState.y = this.rest.y;
      this.bodyState.a = this.rest.a;
      this.bz = 0;
      this.tilt = 0;
      this.relax = 0;
      this.sub = 'rest';
      this.landed = true;
      el.shadow.style.opacity = '1';
      this.writeAll();
      this.reveal();
      this.hooks.phase('inhand');
      this.hooks.torn();
      if (this.pendingToss) {
        this.pendingToss = false;
        this.startCrumple();
      }
      return;
    }

    if (drag && drag.state === 'pull') {
      const local = this.toFrame(drag.x, drag.y);
      this.grab = localPoint(this.bodyState, local.x, local.y);
      this.bodyState.vx = drag.vx * 1000 * 0.5;
      this.bodyState.vy = drag.vy * 1000 * 0.5;
      this.sub = 'held';
      drag.state = 'hold';
    } else {
      // A quick yank toward you and down, away from where the tear started.
      this.bodyState.vx = -this.side * (90 + Math.random() * 60);
      this.bodyState.vy = 60;
      this.bodyState.va = -this.side * 0.6;
      this.sub = 'falling';
      this.reveal();
    }
    this.hooks.phase('falling');
    this.kick();
  }

  /** Brings the hands zone into view as the receipt drops into it (the page follows it down, never up). */
  private reveal() {
    if (this.revealed) return;
    this.revealed = true;
    const vh = window.innerHeight;
    const top = this.el.hands.getBoundingClientRect().top - this.flipY;
    const delta = top + Math.min(this.bodyState.h, vh * 0.55) + 28 - vh;
    if (delta > 4) window.scrollBy({ top: delta, behavior: this.hooks.reduced() ? 'auto' : 'smooth' });
  }

  /** The hands zone: the whole receipt at reading scale, under the printer. */
  private placeHands() {
    const Hr = this.bodyState.h;
    const pad = 22;
    this.handsH = Math.ceil(Hr + pad + 34);
    const handsTop = this.el.hands.offsetTop;
    const tilt = (prng(`${this.receipt?.id}:rest`)() - 0.5) * 0.016;
    this.rest = { x: this.frameW / 2, y: handsTop + pad + Hr / 2, a: tilt };
  }

  /** Grows or shrinks the hands zone, compensating any shift of the component on the page (FLIP). */
  private setHands(height: number) {
    const before = this.el.frame.getBoundingClientRect().top - this.flipY;
    this.el.hands.style.height = `${height}px`;
    const after = this.el.frame.getBoundingClientRect().top - this.flipY;
    const shift = before - after;
    if (Math.abs(shift) > 0.5 && !this.hooks.reduced()) {
      this.flipY += shift;
      this.kick();
    }
    if (height === 0) this.handsH = 0;
  }

  // ---- the ball -------------------------------------------------------------------------------------

  private buildTexture(): HTMLCanvasElement | null {
    if (this.texture) return this.texture;
    const raster = this.raster;
    if (!raster || !this.edge || !this.topEdge) return null;
    const tearRow = this.F - STUB_ROWS;
    const outline: { x: number; y: number }[] = [];
    for (const p of this.topEdge) outline.push({ x: p.x, y: EDGE_PAD + p.y });
    for (let i = this.edge.length - 1; i >= 0; i--) outline.push({ x: this.edge[i].x, y: tearRow + this.edge[i].y });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.texture = paperTexture({
      ink: raster.canvas,
      inkTop: this.T0,
      rows: tearRow,
      width: Math.min(PAPER_DOTS, this.W * dpr),
      grain: grainTile(),
      grainDots: GRAIN_SIZE / this.s,
      outline,
    });
    return this.texture;
  }

  private startCrumple() {
    const receipt = this.receipt;
    if (!receipt || this.mode !== 'free') return;
    this.pendingToss = false;
    this.endDrag();
    const raster = this.raster;
    const frameBox = this.el.frame.getBoundingClientRect();
    const b = this.bodyState;
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    const W = this.W;
    const Hr = b.h;
    // The receipt's own origin (top-left) on the page.
    const ox = frameBox.left + b.x - (W / 2) * cos + (Hr / 2) * sin;
    const oy = frameBox.top + b.y - (W / 2) * sin - (Hr / 2) * cos;

    if (this.hooks.reduced()) {
      const size = 80;
      const centre = { x: frameBox.left + b.x, y: frameBox.top + b.y };
      const landed = this.hooks.toss({ receipt, raster, from: { x: centre.x - size / 2, y: centre.y - size / 2, width: size, height: size }, velocity: { x: 0, y: 0 }, crumple: 1, spin: 0 });
      this.park();
      this.setHands(0);
      this.hooks.phase('tossed', landed);
      this.hooks.tossed(landed);
      return;
    }

    const texture = this.buildTexture();
    if (!texture) return;
    // Ball up the part you can see (a long receipt is crumpled around the middle of the screen).
    const viewMid = localPoint(b, window.innerWidth / 2 - frameBox.left, window.innerHeight / 2 - frameBox.top);
    const radius = clamp(0.16 * Math.sqrt(W * Hr), 34, 92);
    const centre = { x: W / 2, y: clamp(viewMid.y + Hr / 2, Math.min(Hr / 2, radius + 20), Math.max(Hr / 2, Hr - radius - 20)) };
    const crumple = new Crumple({ width: W, height: Hr, texture, center: centre, radius, random: prng(`${receipt.id}:crumple`) });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // The crumple is drawn on a canvas just over the part of the receipt on screen (the paper only moves
    // in toward the ball; the margin covers the folds that lift toward you).
    const corners = [
      [0, 0],
      [W, 0],
      [0, Hr],
      [W, Hr],
    ].map(([x, y]) => ({ x: ox + x * cos - y * sin, y: oy + x * sin + y * cos }));
    const margin = 36;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) - margin));
    const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) - margin));
    const right = Math.min(vw, Math.ceil(Math.max(...corners.map((p) => p.x)) + margin));
    const bottom = Math.min(vh, Math.ceil(Math.max(...corners.map((p) => p.y)) + margin));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: 'none',
      zIndex: '2147483000',
    });
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      return;
    }
    this.park();
    this.ball = {
      phase: 'crumple',
      t: 0,
      crumple,
      canvas,
      ctx,
      dpr,
      place: { x: ox - left, y: oy - top, angle: b.a, scale: 1 },
      origin: { x: left, y: top },
      frameTop: frameBox.top,
      spin: (prng(`${receipt.id}:spin`)() < 0.5 ? -1 : 1) * (7 + Math.random() * 4),
      velocity: { x: 0, y: 0 },
      receipt,
      raster,
    };
    this.hooks.sounds().crumple();
    this.hooks.phase('tossing');
    this.kick();
  }

  /** The receipt has left the component (balled up and thrown): hide the sheet and put it back home. */
  private park() {
    const el = this.el;
    el.sheet.style.visibility = 'hidden';
    el.shadow.style.opacity = '0';
    this.opacities.set(el.shadow, '0');
    el.paperLayer.removeAttribute('data-free');
    this.writes.delete(el.sheet);
    el.sheet.style.transform = '';
    this.mode = 'gone';
  }

  private stepBall(dt: number, now: number) {
    const ball = this.ball;
    if (!ball) return false;
    ball.t += dt;
    const { ctx, canvas, dpr } = ball;
    if (ball.phase === 'crumple') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const u = Math.min(1, (ball.t * 1000) / CRUMPLE_MS);
      ball.crumple.update(u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
      // Stay with the page if it scrolls.
      const top = this.el.frame.getBoundingClientRect().top;
      const place = { ...ball.place, y: ball.place.y + (top - ball.frameTop) };
      ball.crumple.draw(ctx, place, dpr);
      if (u >= 1) {
        const c = ball.crumple.center;
        const cos = Math.cos(place.angle);
        const sin = Math.sin(place.angle);
        ball.start = { x: ball.origin.x + place.x + c.x * cos - c.y * sin, y: ball.origin.y + place.y + c.x * sin + c.y * cos };
        // From here the ball is one small canvas that only moves: no drawing per frame.
        const sprite = ball.crumple.sprite(dpr);
        Object.assign(sprite.canvas.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: `${sprite.size}px`,
          height: `${sprite.size}px`,
          pointerEvents: 'none',
          zIndex: '2147483000',
          willChange: 'transform',
        });
        sprite.canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(sprite.canvas);
        canvas.remove();
        ball.sprite = sprite;
        ball.phase = 'fly';
        ball.t = 0;
        ball.last = { ...ball.start, t: now };
        this.hooks.sounds().toss();
        // The empty hands zone stays until the next print: shrinking the page under a thrown ball (and
        // whatever the reader scrolled to) would jump it.
        this.placeSprite(ball, ball.start.x, ball.start.y, 0, 1);
      }
      return true;
    }
    // In flight: a parabola from where it was balled up to the pile, re-aimed every frame.
    const start = ball.start!;
    const rect = this.hooks.target();
    let aim: { x: number; y: number };
    if (rect && !ball.aimless) {
      aim = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.45 };
    } else {
      if (!ball.aimless) {
        // Nowhere to go: up, over and off the screen.
        const dir = start.x < window.innerWidth / 2 ? 1 : -1;
        ball.aimless = { x: start.x + dir * window.innerWidth * 0.55, y: window.innerHeight + 260 };
        ball.duration = 0.95;
      }
      aim = ball.aimless;
    }
    if (!ball.duration) {
      const dist = Math.hypot(aim.x - start.x, aim.y - start.y);
      ball.duration = clamp(0.5 + dist / 2200, 0.55, 0.95);
      ball.arc = clamp(110 + dist * 0.25, 120, 280);
    }
    const arc = ball.arc ?? 180;
    const u = Math.min(1.25, ball.t / ball.duration);
    const x = start.x + (aim.x - start.x) * u;
    const y = start.y + (aim.y - start.y) * u - arc * 4 * u * (1 - u);
    const last = ball.last!;
    const dts = Math.max(1e-3, (now - last.t) / 1000);
    ball.velocity = { x: (x - last.x) / dts, y: (y - last.y) / dts };
    ball.last = { x, y, t: now };
    const scale = 1 - 0.18 * Math.min(1, u);
    const size = (ball.sprite?.size ?? 80) * scale;
    const r = ball.crumple.radius * scale;
    this.placeSprite(ball, x, y, ball.spin * ball.t, scale);

    if (rect && !ball.aimless && u > 0.35) {
      const hit = x + r > rect.x && x - r < rect.x + rect.width && y + r > rect.y && y - r < rect.y + rect.height;
      if (hit || u >= 1) {
        const landed = this.hooks.toss({
          receipt: ball.receipt,
          raster: ball.raster,
          from: { x: x - r, y: y - r, width: r * 2, height: r * 2 },
          velocity: ball.velocity,
          crumple: 1,
          spin: ball.spin,
        });
        this.endBall(landed);
        return false;
      }
    }
    if (ball.aimless && (y - size / 2 > window.innerHeight || u >= 1.25)) {
      this.endBall(false);
      return false;
    }
    return true;
  }

  private placeSprite(ball: Ball, x: number, y: number, angle: number, scale: number) {
    const sprite = ball.sprite;
    if (!sprite) return;
    const half = sprite.size / 2;
    sprite.canvas.style.transform = `translate3d(${(x - half).toFixed(2)}px, ${(y - half).toFixed(2)}px, 0) rotate(${angle.toFixed(3)}rad) scale(${scale.toFixed(3)})`;
  }

  private endBall(landed: boolean) {
    this.ball?.canvas.remove();
    this.ball?.sprite?.canvas.remove();
    this.ball = null;
    this.hooks.phase('tossed', landed);
    this.hooks.tossed(landed);
  }

  // ---- the loop -------------------------------------------------------------------------------------

  private kick() {
    if (this.frame || this.destroyed) return;
    this.last = performance.now();
    this.el.sheet.style.willChange = 'transform';
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.destroyed) return;
    const begin = performance.now();
    const gap = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(gap, 1 / 30);
    let active = false;

    if (this.leaving) {
      active = true;
      this.leaving.t += dt;
      const u = Math.min(1, this.leaving.t / 0.24);
      this.el.paperLayer.style.opacity = (1 - u).toFixed(3);
      this.el.paperLayer.style.transform = `translate3d(${(-u * 40).toFixed(1)}px, ${(u * 26).toFixed(1)}px, 0)`;
      if (u >= 1) {
        const then = this.leaving.then;
        this.leaving = null;
        then();
      }
    }

    if (this.mode === 'printing' && this.plan && this.raster) {
      active = true;
      this.jobT += gap * 1000;
      const sample = sampleFeed(this.plan, this.jobT, this.hint);
      this.hint = sample.step;
      if (sample.burned > this.burned) this.burnTo(sample.burned, gap > 0.25);
      // The paper can't show a line the head hasn't burned yet (a catch-up spreads over a few frames).
      const band = this.raster.bands[this.burned - 1];
      const limit = band ? band.y + band.height + 2 : 0;
      this.F = this.T0 + Math.min(sample.rows, limit);
      this.vib = this.motor ? (Math.sin(now * 0.31) * 0.6 + Math.sin(now * 0.173 + 1.3) * 0.4) * 0.45 : 0;
      if (this.jobT >= this.plan.duration && this.burned >= this.raster.bands.length) {
        this.vib = 0;
        this.finishPrint();
      }
    } else if (this.mode === 'hanging' && this.F < this.Ftarget - 0.01) {
      active = true;
      this.F = Math.min(this.Ftarget, this.F + FEED_RATE * dt * 1000);
      this.vib = (Math.sin(now * 0.31) * 0.6 + Math.sin(now * 0.173 + 1.3) * 0.4) * 0.45;
      if (this.F >= this.Ftarget - 0.01) {
        this.F = this.Ftarget;
        this.vib = 0;
        this.placeHanging();
        if (this.motor) {
          this.hooks.sounds().feedStop();
          this.motor = false;
        }
      }
    } else if ((this.mode === 'empty' || this.mode === 'gone') && this.stubRows < this.stubTarget - 0.01) {
      active = true;
      this.stubRows = Math.min(this.stubTarget, this.stubRows + FEED_RATE * dt * 1000);
      this.vib = (Math.sin(now * 0.31) * 0.6 + Math.sin(now * 0.173 + 1.3) * 0.4) * 0.45;
      if (this.stubRows >= this.stubTarget - 0.01) {
        this.stubRows = this.stubTarget;
        this.vib = 0;
        if (this.motor) {
          this.hooks.sounds().feedStop();
          this.motor = false;
        }
      }
      this.writeStub();
    } else if (this.vib !== 0) {
      this.vib = 0;
    }

    if (this.mode === 'printing' || this.mode === 'hanging') {
      if (this.stepStanding(dt)) active = true;
    } else if (this.mode === 'free') {
      if (this.stepFree(dt)) active = true;
    }

    if (Math.abs(this.flipY) > 0.1 || Math.abs(this.vflipY) > 1) {
      [this.flipY, this.vflipY] = springStep(this.flipY, this.vflipY, 0, FLIP, dt);
      active = true;
    } else if (this.flipY !== 0) {
      this.flipY = 0;
      this.vflipY = 0;
    }

    if (this.ball && this.stepBall(dt, now)) active = true;
    if (this.drag) active = true;

    this.writeAll();
    const perf = (window as unknown as { __PRINT_PERF__?: number[] }).__PRINT_PERF__;
    if (Array.isArray(perf)) perf.push(performance.now() - begin);

    if (active && !this.destroyed) {
      if (!this.frame) this.frame = requestAnimationFrame(this.tick);
    } else if (!this.frame) {
      this.el.sheet.style.willChange = '';
    }
  };

  /** Springs on the standing paper: sway, curl flex, the pull and the opening tear. Returns true while moving. */
  private stepStanding(dt: number): boolean {
    const reduced = this.hooks.reduced();
    let moving = false;
    const d = this.drag;
    let targetSx = 0;
    let targetSz = 0;
    let tension = 0;
    if (d && d.state === 'pull') {
      const dx = d.x - d.x0;
      const dy = d.y - d.y0;
      const side = rubber(dx, 150);
      const down = rubber(Math.max(0, dy), 150);
      // How hard the paper is pulled against the teeth (px of pull; up only stretches it a little).
      tension = Math.hypot(dx, Math.max(0, dy) * 1.1, Math.min(0, dy) * 0.25);
      // The whole sheet pivots about the slot, so even a pull right at the bar only leans it a little.
      const reach = Math.max(160, (this.F - CURL_ROWS) * this.s * 0.6);
      // Before it gives, the sheet leans toward the pull; once it's tearing, the opening takes over.
      targetSz = this.started ? 0 : clamp(Math.atan2(side * 0.5, reach) * DEG, -5, 5);
      targetSx = -clamp(Math.atan2(down * 0.35, reach) * DEG, 0, 5);
      if (!this.started && tension > TEAR_START) {
        this.started = true;
        this.side = d.side;
        this.hooks.sounds().tearStart();
      }
      if (this.started) {
        const goal = clamp((tension - TEAR_START * 0.8) / TEAR_RANGE, 0, 1);
        if (goal > this.progress) this.progress = Math.min(goal, this.progress + dt * 9);
      }
    } else if (this.auto) {
      this.progress = Math.min(1, this.progress + (dt * 1000) / AUTO_TEAR_MS);
    }

    const cfg: SpringConfig = d && d.state === 'pull' ? PULL : SWAY;
    if (!reduced) {
      [this.sx, this.vsx] = springStep(this.sx, this.vsx, targetSx, cfg, dt);
      [this.sz, this.vsz] = springStep(this.sz, this.vsz, targetSz, cfg, dt);
      [this.flex, this.vflex] = springStep(this.flex, this.vflex, 0, FLEX, dt);
      if (Math.abs(this.sx - targetSx) + Math.abs(this.sz - targetSz) > 0.01 || Math.abs(this.vsx) + Math.abs(this.vsz) > 0.05) moving = true;
      if (Math.abs(this.flex) > 0.002 || Math.abs(this.vflex) > 0.01) moving = true;
    }

    if (this.started) {
      // The torn side lifts, the paper pivoting on what's still attached.
      const lean = d && d.state === 'pull' ? Math.min(4.5, 1.4 + tension * 0.025) : 1.6 + this.progress * 1.4;
      const target = -this.side * lean * smooth(Math.min(1, this.progress * 1.6));
      if (reduced) this.alpha = target;
      else [this.alpha, this.valpha] = springStep(this.alpha, this.valpha, target, OPEN, dt);
      if (Math.abs(this.alpha - target) > 0.005 || Math.abs(this.valpha) > 0.05) moving = true;
      this.writeTornClip();
      if (this.progress >= 1 && this.mode === 'hanging') {
        this.completeTear(d && d.state === 'pull' ? d : null);
        return true;
      }
    }
    if (this.auto) moving = true;
    return moving;
  }

  private writeTornClip() {
    if (!this.edge) return;
    const torn: TornPart = { side: this.side, front: this.front() };
    const key = `${torn.side}:${torn.front.toFixed(1)}`;
    if (key === this.clipKey) return;
    this.clipKey = key;
    const tearRow = this.F - STUB_ROWS;
    this.placeFoot();
    this.clipFoot(aboveClip(this.edge, (tearRow - this.footTop) * this.s, this.s, torn));
    if (this.el.stub.style.visibility !== 'visible') {
      // The stub shows through where the paper has parted.
      this.stubRows = STUB_ROWS;
      this.stubTarget = STUB_ROWS;
      this.el.stub.style.visibility = 'visible';
      this.writeStub(true);
    }
  }

  private stepFree(dt: number): boolean {
    const b = this.bodyState;
    const reduced = this.hooks.reduced();
    let moving = true;
    const air = { linear: 0.7, angular: 3.2 };
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const d = this.drag;
    if (this.sub === 'held' && d) {
      const target = this.toFrame(d.x, d.y);
      // Below the middle it would be an inverted pendulum; the sheet's stiffness keeps it up, swaying.
      const up = this.grab.y > 0 ? 70 : 14;
      for (let i = 0; i < steps; i++) stepHeld(b, this.grab, target, h, 2200, { linear: air.linear, angular: 7 }, 300, 30, up);
    } else if (this.sub === 'held') {
      this.sub = 'falling';
    }
    if (this.sub === 'falling') {
      const dist = Math.max(0, this.rest.y - b.y);
      const g = Math.max(2600, (2 * dist) / (0.55 * 0.55));
      for (let i = 0; i < steps; i++) {
        stepFalling(b, h, g, air, 6);
        // The hands move under it to catch it.
        b.vx += (this.rest.x - b.x) * 9 * h;
      }
      if (b.y >= this.rest.y) {
        b.vy = Math.min(b.vy, 650);
        this.sub = 'landing';
        if (!this.landed) {
          this.landed = true;
          this.hooks.phase('inhand');
          this.hooks.torn();
          if (this.pendingToss) {
            this.pendingToss = false;
            this.startCrumple();
            return false;
          }
        }
      }
    }
    if (this.sub === 'landing') {
      [b.x, b.vx] = springStep(b.x, b.vx, this.rest.x, LAND, dt);
      [b.y, b.vy] = springStep(b.y, b.vy, this.rest.y, LAND, dt);
      [b.a, b.va] = springStep(b.a, b.va, this.rest.a, LAND_TILT, dt);
      const settled = Math.abs(b.x - this.rest.x) + Math.abs(b.y - this.rest.y) < 0.15 && Math.abs(b.vx) + Math.abs(b.vy) < 2 && Math.abs(b.a - this.rest.a) < 0.0005 && Math.abs(b.va) < 0.01;
      if (settled) {
        b.x = this.rest.x;
        b.y = this.rest.y;
        b.a = this.rest.a;
        b.vx = b.vy = b.va = 0;
        this.sub = 'rest';
        // Ready to crumple without a hitch.
        const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
        if (idle) idle(() => this.buildTexture());
      }
    }
    if (this.sub === 'rest') moving = false;

    // Out of the printer's 3D: the curl relaxes, the sheet comes flat to the hands.
    if (!reduced) {
      [this.bz, this.vbz] = springStep(this.bz, this.vbz, 0, RELAX, dt);
      [this.tilt, this.vtilt] = springStep(this.tilt, this.vtilt, 0, RELAX, dt);
      [this.relax, this.vrelax] = springStep(this.relax, this.vrelax, 0, RELAX, dt);
      const liftTarget = this.sub === 'held' ? 1 : 0;
      [this.lift, this.vlift] = springStep(this.lift, this.vlift, liftTarget, LIFT, dt);
      if (Math.abs(this.bz) + Math.abs(this.tilt) > 0.02 || Math.abs(this.relax) > 0.002 || Math.abs(this.vrelax) > 0.01) moving = true;
      if (Math.abs(this.lift - liftTarget) > 0.002 || Math.abs(this.vlift) > 0.01) moving = true;
      if (Math.abs(this.relax) <= 0.002 && Math.abs(this.vrelax) <= 0.01) this.relax = 0;
    }
    return moving;
  }

  // ---- writing --------------------------------------------------------------------------------------

  private set(el: HTMLElement, value: string) {
    if (this.writes.get(el) === value) return;
    this.writes.set(el, value);
    el.style.transform = value;
  }

  private writeAll() {
    const el = this.el;
    if (this.mode === 'printing' || this.mode === 'hanging' || this.mode === 'loading') this.writeStanding();
    else if (this.mode === 'free') this.writeFree();
    const vib = this.vib ? `translate3d(0, ${this.vib.toFixed(2)}px, 0)` : '';
    this.set(el.back, vib);
    this.set(el.front, vib);
    this.set(el.frame, this.flipY ? `translate3d(0, ${this.flipY.toFixed(2)}px, 0)` : '');
  }

  private writeStanding() {
    this.set(this.el.sheet, this.standingTransform());
    this.writeCurl(1, this.sx);
    // The flat part turns a little from the lamp as it sways (or is pulled toward you).
    const shade = this.shadeFor(this.sx);
    this.setOpacity(this.el.tint, shade.front * 0.6);
  }

  private writeFree() {
    const b = this.bodyState;
    const W = this.W;
    const lift = this.lift;
    this.set(
      this.el.sheet,
      `translate3d(${b.x.toFixed(2)}px, ${(b.y - lift * 6).toFixed(2)}px, ${this.bz.toFixed(2)}px) rotateZ(${b.a.toFixed(4)}rad) rotateX(${this.tilt.toFixed(3)}deg) scale(${(1 + lift * 0.012).toFixed(4)}) translate3d(${(-W / 2).toFixed(2)}px, ${(-b.h / 2).toFixed(2)}px, 0)`,
    );
    this.writeCurl(this.relax, this.tilt);
    this.setOpacity(this.el.tint, 0);
    // Its shadow on your hands firms up as it comes down to them, and softens when you lift it.
    const near = clamp(1 - (this.rest.y - b.y) / 140, 0, 1);
    this.setOpacity(this.el.shadow, near * (1 - lift * 0.6));
  }

  private opacities = new Map<HTMLElement, string>();
  private setOpacity(el: HTMLElement, value: number) {
    const v = value <= 0.004 ? '0' : value.toFixed(3);
    if (this.opacities.get(el) === v) return;
    this.opacities.set(el, v);
    el.style.opacity = v;
  }

  /** Brightness of a face turned `angle` degrees back from upright, relative to upright paper. */
  private shadeFor(angle: number): { front: number; back: number } {
    const a = (angle * Math.PI) / 180;
    const front = (AMBIENT + DIFFUSE * Math.max(0, Math.cos(a - LAMP))) / LIT_FLAT;
    const back = (AMBIENT * 0.9 + DIFFUSE * Math.max(0, -Math.cos(a - LAMP))) / LIT_FLAT;
    return { front: clamp(1 - front, 0, 0.66), back: clamp(1 - back * 0.92, 0.06, 0.7) };
  }

  private writeCurl(amount: number, base: number) {
    const el = this.el;
    let total = base;
    const F = this.F;
    const flex = 1 + this.flex * 0.12;
    let below = this.shadeFor(base);
    for (let k = 0; k < SLICES; k++) {
      // Only paper that is out of the slot curls.
      const from = CURL_ROWS - (k + 1) * SLICE_ROWS;
      const out = clamp((F - from) / SLICE_ROWS, 0, 1);
      const angle = this.curl[k] * out * amount * (1 + (flex - 1) * ((k + 1) / SLICES));
      total += angle;
      this.set(el.slices[k], angle ? `rotateX(${angle.toFixed(3)}deg)` : '');
      // The face turns from `below` (its hinge) to `above` (its top edge): the front darkens upward,
      // the back (lit as it turns over) the other way.
      const above = this.shadeFor(total);
      this.setOpacity(el.frontShades[k], Math.min(below.front, above.front));
      this.setOpacity(el.frontRamps[k], Math.max(0, above.front - below.front));
      this.setOpacity(el.backShades[k], Math.min(below.back, above.back));
      this.setOpacity(el.backRamps[k], Math.max(0, below.back - above.back));
      below = above;
    }
  }

  private writeStub(force = false) {
    const s = this.s;
    const y = -(this.stubRows + EDGE_PAD) * s;
    this.set(this.el.stub, `translate3d(0, ${y.toFixed(2)}px, 0)`);
    if (force && this.edge) {
      const clip = belowClip(this.edge, EDGE_PAD * s, s);
      this.el.stub.style.clipPath = clip;
      this.el.stub.style.setProperty('-webkit-clip-path', clip);
    } else if (force) {
      this.el.stub.style.clipPath = '';
    }
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    if (mode === 'printing') this.hooks.phase('printing');
    else if (mode === 'hanging') this.hooks.phase('hanging');
    else if (mode === 'loading') this.hooks.phase('loading');
    else if (mode === 'empty') this.hooks.phase('idle');
  }

  private toFrame(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.el.frame.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  }

  // ---- input ----------------------------------------------------------------------------------------

  private onPointerDown = (event: PointerEvent) => {
    if (event.button > 0 || this.drag || this.leaving) return;
    if (this.mode === 'printing') {
      // A finger on the paper while it prints: it wobbles.
      this.vsz += (Math.random() - 0.5) * 40;
      this.vflex += 1.2;
      this.kick();
      return;
    }
    if (this.mode !== 'hanging' && this.mode !== 'free') return;
    if (this.mode === 'hanging' && this.auto) return;
    const now = performance.now();
    const local = this.toFrame(event.clientX, event.clientY);
    const grip = event.target instanceof Element && this.el.grip.contains(event.target);
    this.drag = {
      id: event.pointerId,
      type: event.pointerType,
      x0: event.clientX,
      y0: event.clientY,
      t0: now,
      x: event.clientX,
      y: event.clientY,
      lx: event.clientX,
      ly: event.clientY,
      lt: now,
      vx: 0,
      vy: 0,
      trail: [{ t: now, x: event.clientX, y: event.clientY }],
      state: 'pending',
      grip,
      side: local.x < this.paperLeft + this.W / 2 ? -1 : 1,
      reach: this.slotY - local.y,
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    if (this.mode === 'free') {
      if (event.pointerType === 'mouse' || this.sub === 'falling' || this.sub === 'held') this.pickUp();
      else {
        // Touch: hold still a moment to pick it up; otherwise the page scrolls as usual.
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          const dd = this.drag;
          if (dd && dd.state === 'pending' && Math.hypot(dd.x - dd.x0, dd.y - dd.y0) < 8) this.pickUp();
        }, 170);
      }
    }
    this.kick();
  };

  private pickUp() {
    const d = this.drag;
    if (!d || this.mode !== 'free') return;
    d.state = 'hold';
    try {
      this.el.sheet.setPointerCapture(d.id);
    } catch {
      // Already released.
    }
    const local = this.toFrame(d.x, d.y);
    this.grab = localPoint(this.bodyState, local.x, local.y);
    this.sub = 'held';
    this.kick();
  }

  private onPointerMove = (event: PointerEvent) => {
    const d = this.drag;
    if (!d || event.pointerId !== d.id) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lt);
    d.vx = 0.65 * ((event.clientX - d.lx) / dt) + 0.35 * d.vx;
    d.vy = 0.65 * ((event.clientY - d.ly) / dt) + 0.35 * d.vy;
    d.lx = d.x = event.clientX;
    d.ly = d.y = event.clientY;
    d.lt = now;
    d.trail.push({ t: now, x: event.clientX, y: event.clientY });
    if (d.trail.length > 12) d.trail.shift();
    if (d.state === 'pending') {
      const dx = d.x - d.x0;
      const dy = d.y - d.y0;
      if (Math.hypot(dx, dy) < 6) return;
      if (this.mode === 'free') {
        // A touch that moved before the hold: it's a scroll.
        if (d.type !== 'mouse') {
          window.clearTimeout(this.holdTimer);
          d.state = 'scroll';
          this.endDrag();
        }
        return;
      }
      // On touch, a mostly vertical move away from the bar is the page scrolling, not a pull.
      if (d.type !== 'mouse' && !d.grip && Math.abs(dy) > Math.abs(dx)) {
        d.state = 'scroll';
        this.endDrag();
        this.kick();
        return;
      }
      d.state = 'pull';
      window.getSelection()?.removeAllRanges();
      try {
        this.el.sheet.setPointerCapture(d.id);
      } catch {
        // The pointer may already be gone.
      }
    }
    this.kick();
  };

  private onPointerUp = (event: PointerEvent) => {
    const d = this.drag;
    if (!d || event.pointerId !== d.id) return;
    window.clearTimeout(this.holdTimer);
    const quick = performance.now() - d.t0 < 350 && Math.hypot(d.x - d.x0, d.y - d.y0) < 8;
    const cancelled = event.type === 'pointercancel';
    this.endDrag();
    if (this.mode === 'hanging') {
      if (d.state === 'pending' && quick && !cancelled) this.startAutoTear(this.started ? this.side : d.side);
      this.kick();
      return;
    }
    if (this.mode === 'free' && this.sub === 'held') {
      const vx = d.vx * 1000;
      const vy = d.vy * 1000;
      this.bodyState.vx = vx * 0.6;
      this.bodyState.vy = vy * 0.6;
      this.sub = 'falling';
      if (!this.landed) this.reveal();
      // A flick up throws it: fast at the release, or a quick, mostly upward stroke over the last 150 ms.
      const now = performance.now();
      const from = d.trail.find((p) => now - p.t <= 150) ?? d.trail[d.trail.length - 1];
      const rise = from.y - d.y;
      const stroke = rise / Math.max(0.016, (now - from.t) / 1000);
      const flick = (vy < -900 && Math.abs(vy) > Math.abs(vx) * 1.2) || (rise > 90 && stroke > 600 && rise > Math.abs(d.x - from.x) * 1.2);
      if (!cancelled && flick && this.hooks.tossable()) {
        this.startCrumple();
        return;
      }
      this.kick();
    }
  };

  /** Once a held receipt has the finger, the page mustn't scroll under it. */
  private onTouchMove = (event: TouchEvent) => {
    const d = this.drag;
    if (d && (d.state === 'hold' || d.state === 'pull')) event.preventDefault();
  };

  private onClick = (event: MouseEvent) => {
    // A drag isn't a click on anything printed under it.
    if (this.drag && this.drag.state !== 'pending') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (this.mode !== 'hanging') return;
    event.preventDefault();
    this.tear();
  };

  private onVisibility = () => {
    if (this.mode !== 'printing') return;
    if (document.hidden && this.motor) {
      this.hooks.sounds().feedStop();
      this.motor = false;
    } else if (!document.hidden && !this.motor) {
      this.hooks.sounds().feedStart();
      this.motor = true;
    }
  };

  private endDrag() {
    if (!this.drag) return;
    try {
      if (this.el.sheet.hasPointerCapture(this.drag.id)) this.el.sheet.releasePointerCapture(this.drag.id);
    } catch {
      // Nothing to release.
    }
    this.drag = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}

export function prefersReducedMotion(): boolean {
  return reducedFromMedia();
}
