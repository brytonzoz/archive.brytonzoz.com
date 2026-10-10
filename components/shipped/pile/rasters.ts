// Burning receipts for the pile without blocking a frame: a queue that burns rasters a few lines at a time
// (in idle time, or a small slice per frame while things move), the downscaled atlas tile of each, and a
// short memory of full rasters so the receipt you just put back opens again instantly.
import { receiptToDoc } from '../thermal/layout';
import { createRaster, downscale, lineHeight, loadLogos, prepareFont, type Raster } from '../thermal/raster';
import type { PrintDoc, ThermalReceipt } from '../thermal/types';

export const TILE_W = 256;
export const TILE_H = 1024;

export type Tile = { data: Uint8Array; width: number; height: number };

const docs = new Map<string, PrintDoc>();

/** The print job for a receipt, made once per id. */
export function docFor(receipt: ThermalReceipt): PrintDoc {
  let doc = docs.get(receipt.id);
  if (!doc) {
    doc = receiptToDoc(receipt);
    docs.set(receipt.id, doc);
    if (docs.size > 80) {
      const first = docs.keys().next();
      if (!first.done) docs.delete(first.value);
    }
  }
  return doc;
}

/** The receipt's printed height in dots, without burning it (a logo counts as its usual height). */
export function docDots(receipt: ThermalReceipt): number {
  const doc = docFor(receipt);
  let dots = 0;
  for (const line of doc.lines) dots += line.kind === 'logo' ? 62 : lineHeight(line);
  return dots;
}

/** Ink coverage of a raster, shrunk to an atlas tile (one byte per texel). */
export function tileFrom(raster: Raster): Tile {
  const small = downscale(raster.canvas, TILE_W, TILE_H);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  const width = small.width;
  const height = small.height;
  const data = new Uint8Array(width * height);
  if (ctx) {
    const px = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0, j = 3; i < data.length; i++, j += 4) data[i] = px[j];
  }
  return { data, width, height };
}

type Job = {
  receipt: ThermalReceipt;
  priority: number;
  raster: Raster | null;
  loading: boolean;
  waiters: { resolve: (raster: Raster) => void; reject: (reason: unknown) => void }[];
  cancelled: boolean;
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class BurnQueue {
  private jobs: Job[] = [];
  private font: string;
  private fontReady: Promise<void>;
  private ready = false;
  private recent: { id: string; raster: Raster }[] = [];
  private timer = 0;
  private idle = 0;
  private disposed = false;
  onProgress: (() => void) | null = null;

  constructor(fontFamily: string) {
    this.font = fontFamily;
    this.fontReady = prepareFont(fontFamily).then(() => {
      this.ready = true;
    });
  }

  /** A fully burned raster for this receipt (higher priority burns first). */
  burn(receipt: ThermalReceipt, priority = 0, preburned?: Raster | null): { promise: Promise<Raster>; cancel(): void } {
    const cached = this.recent.find((entry) => entry.id === receipt.id);
    if (cached) return { promise: Promise.resolve(cached.raster), cancel() {} };
    if (preburned) {
      preburned.burn();
      return { promise: Promise.resolve(preburned), cancel() {} };
    }
    const queued = this.jobs.find((job) => job.receipt.id === receipt.id && !job.cancelled);
    if (queued) {
      queued.priority = Math.max(queued.priority, priority);
      this.jobs.sort((a, b) => b.priority - a.priority);
      let waiter!: { resolve: (raster: Raster) => void; reject: (reason: unknown) => void };
      const promise = new Promise<Raster>((resolve, reject) => {
        waiter = { resolve, reject };
        queued.waiters.push(waiter);
      });
      return {
        promise,
        cancel: () => {
          queued.waiters = queued.waiters.filter((w) => w !== waiter);
          if (!queued.waiters.length) {
            queued.cancelled = true;
            this.jobs = this.jobs.filter((j) => j !== queued);
          }
        },
      };
    }
    let job!: Job;
    const promise = new Promise<Raster>((resolve, reject) => {
      job = { receipt, priority, raster: null, loading: false, waiters: [{ resolve, reject }], cancelled: false };
    });
    this.jobs.push(job);
    this.jobs.sort((a, b) => b.priority - a.priority);
    this.schedule();
    const waiter = job.waiters[0];
    return {
      promise,
      cancel: () => {
        job.waiters = job.waiters.filter((w) => w !== waiter);
        if (!job.waiters.length) {
          job.cancelled = true;
          this.jobs = this.jobs.filter((j) => j !== job);
        }
      },
    };
  }

  /** Burn this receipt sooner or later (the top of the pile first). */
  prioritize(id: string, priority: number) {
    this.jobs.forEach((job) => {
      if (job.receipt.id === id) job.priority = priority;
    });
    this.jobs.sort((a, b) => b.priority - a.priority);
  }

  /** Keep a full raster around for a moment (the held receipt), so reopening it is instant. */
  remember(id: string, raster: Raster) {
    this.recent = [{ id, raster }, ...this.recent.filter((entry) => entry.id !== id)].slice(0, 2);
  }

  get pending(): boolean {
    return this.jobs.length > 0;
  }

  /** Burn for up to `budget` ms. True if work remains. */
  pump(budget: number): boolean {
    if (!this.ready || this.disposed) return this.jobs.length > 0;
    const end = now() + budget;
    while (this.jobs.length && now() < end) {
      const job = this.jobs[0];
      if (!job.raster) {
        if (job.loading) {
          // Logos are on their way; burn the next job meanwhile.
          const other = this.jobs.find((j) => !j.loading);
          if (!other) break;
          this.jobs = [other, ...this.jobs.filter((j) => j !== other)];
          continue;
        }
        const doc = docFor(job.receipt);
        if (doc.lines.some((line) => line.kind === 'logo')) {
          job.loading = true;
          loadLogos(doc).then((logos) => {
            job.loading = false;
            if (!job.cancelled) job.raster = createRaster(doc, { fontFamily: this.font, logos, wear: 0.55 });
            this.schedule();
          });
          continue;
        }
        job.raster = createRaster(doc, { fontFamily: this.font, wear: 0.55 });
      }
      const raster = job.raster;
      const total = raster.bands.length;
      while (raster.burned < total && now() < end) raster.burn(raster.burned + 4);
      if (raster.burned >= total) {
        this.jobs.shift();
        job.waiters.forEach((waiter) => waiter.resolve(raster));
        this.onProgress?.();
      }
    }
    return this.jobs.length > 0;
  }

  /** Burn in idle time, between frames (never inside one). */
  schedule() {
    if (this.disposed || this.timer || this.idle || !this.jobs.length) return;
    const run = (budget: number) => {
      this.timer = 0;
      this.idle = 0;
      if (this.pump(budget)) this.schedule();
    };
    if (!this.ready) {
      this.fontReady.then(() => this.schedule());
      return;
    }
    const w = window as Window & { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) {
      this.idle = w.requestIdleCallback((deadline) => run(Math.max(2, Math.min(14, deadline.timeRemaining() - 1))), { timeout: 400 });
    } else {
      this.timer = window.setTimeout(() => run(4), 24);
    }
  }

  dispose() {
    this.disposed = true;
    this.jobs.forEach((job) => {
      job.cancelled = true;
    });
    this.jobs = [];
    this.recent = [];
    if (this.timer) window.clearTimeout(this.timer);
    const w = window as Window & { cancelIdleCallback?: (id: number) => void };
    if (this.idle) w.cancelIdleCallback?.(this.idle);
  }
}
