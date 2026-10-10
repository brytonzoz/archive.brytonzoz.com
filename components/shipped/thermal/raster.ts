// Burns a PrintDoc into dots, the way an 80 mm thermal head does: 8 dots per mm, 576 printable dots across,
// one dot-row at a time. What makes it read as a real print rather than a font on a screen:
//   * every glyph is thresholded to whole dots (with a little noise, so edges are ragged, not anti-aliased);
//   * density is uneven: rows with many dots fire at once and come out lighter (the head's supply sags),
//     a couple of the head's elements are weak (faint vertical streaks, the same on every receipt from this
//     printer), the paper's coating varies slowly down the roll, and the odd dot drops out;
//   * heat bleeds a little into the neighbouring dots;
//   * registration slips: the stepper and the paper path shift a line by a dot now and then, and a line can
//     run very slightly skewed.
// Output is ink only (dark dots with alpha on a transparent canvas), so a page can lay it over paper and a
// shader can use its alpha as ink coverage. Lines are burned lazily (burn()), so a printer can burn each
// line just before it feeds it out, and a long receipt never blocks the main thread in one go.
import { receiptBarcodeUnits } from '../../../lib/shipped';
import { prng } from '../physics';
import type { Band, PrintDoc, PrintLine } from './types';
import { COLS, COLS_SMALL } from './layout';

/** 80 mm paper at 203 dpi. */
export const PAPER_DOTS = 640;
export const PRINT_DOTS = 576;
export const MARGIN = (PAPER_DOTS - PRINT_DOTS) / 2;
/** Real size, for anything that needs millimetres (the pile's geometry). */
export const DOTS_PER_MM = 8;

export const INK_RGB: [number, number, number] = [29, 27, 25];
export const FALLBACK_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const ADVANCE = PRINT_DOTS / COLS; // 12
const ADVANCE_SMALL = PRINT_DOTS / COLS_SMALL; // 9
const LINE = 30;
const LINE_SMALL = 22;
const TALL_LINE = 56;
const INVERT_LINE = 40;
const RULE_LINE = 20;
const BOX_EDGE = 14;
const BOX_STROKE = 3;
const BOX_INSET = 6;

export type LogoImage = CanvasImageSource & { width: number; height: number };

export type RasterOptions = {
  /** The page's monospace (read it from getComputedStyle so next/font's hashed family is used). */
  fontFamily?: string;
  /** 0..1: how tired the head and how cheap the paper. Default 0.5. */
  wear?: number;
  /** Logos already loaded (loadLogos); a logo that isn't here is skipped. */
  logos?: Map<string, LogoImage>;
};

export type Raster = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  bands: Band[];
  /** Lines burned so far (bands[0..burned) are on the canvas). */
  readonly burned: number;
  /** Burn lines up to (not including) `to`; default all. Cheap to call again. */
  burn(to?: number): void;
};

/** Wait for the receipt font so the first burned line isn't set in a fallback. */
export async function prepareFont(fontFamily = FALLBACK_FONT): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.all([document.fonts.load(`400 20px ${fontFamily}`), document.fonts.load(`600 20px ${fontFamily}`)]);
  } catch {
    // A fallback face still prints.
  }
}

/** The family the page is set in, e.g. next/font's hashed IBM Plex Mono. */
export function pageFont(el: Element | null): string {
  if (!el || typeof window === 'undefined') return FALLBACK_FONT;
  const family = window.getComputedStyle(el).fontFamily;
  return family && /mono/i.test(family) ? family : FALLBACK_FONT;
}

export async function loadLogos(doc: PrintDoc): Promise<Map<string, LogoImage>> {
  const map = new Map<string, LogoImage>();
  const sources = Array.from(new Set(doc.lines.flatMap((line) => (line.kind === 'logo' ? [line.src] : []))));
  await Promise.all(
    sources.map(async (src) => {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        await img.decode();
        map.set(src, img);
      } catch {
        // A logo that doesn't load just isn't printed.
      }
    }),
  );
  return map;
}

function logoSize(img: LogoImage): { w: number; h: number } {
  const h = Math.min(56, img.height * 2);
  const w = Math.min(PRINT_DOTS * 0.6, (img.width / img.height) * h);
  return { w: Math.round(w), h: Math.round((w / img.width) * img.height) };
}

/** Height of a printed line in dots. */
export function lineHeight(line: PrintLine, logos?: Map<string, LogoImage>): number {
  switch (line.kind) {
    case 'text':
      return line.invert ? INVERT_LINE : line.tall ? TALL_LINE : line.small ? LINE_SMALL : LINE;
    case 'lead':
      return line.tall ? TALL_LINE : line.small ? LINE_SMALL : LINE;
    case 'rule':
      return RULE_LINE;
    case 'feed':
      return line.dots;
    case 'box-top':
    case 'box-bottom':
      return BOX_EDGE;
    case 'barcode':
      return line.height + 8;
    case 'logo': {
      const img = logos?.get(line.src);
      return img ? logoSize(img).h + 6 : 0;
    }
  }
}

function lineBoxed(line: PrintLine): boolean {
  return 'boxed' in line && Boolean(line.boxed);
}

/** The print head: the same few weak elements on every receipt this printer makes. */
const HEAD = (() => {
  const random = prng('BZ-80 head');
  const strength = new Float32Array(PAPER_DOTS);
  for (let x = 0; x < PAPER_DOTS; x++) strength[x] = 0.93 + random() * 0.07;
  for (let i = 0; i < 3; i++) {
    const x = MARGIN + Math.floor(random() * PRINT_DOTS);
    strength[x] = 0.5 + random() * 0.2;
    if (random() < 0.5 && x + 1 < PAPER_DOTS) strength[x + 1] *= 0.85;
  }
  return strength;
})();

/** Glyph metrics for the page font, so 12 (or 9) dots is exactly one column whatever face loaded. */
type Metrics = { size: number; squeeze: number };

function metrics(ctx: CanvasRenderingContext2D, family: string, advance: number): Metrics {
  const size = advance / 0.6;
  ctx.font = `400 ${size}px ${family}`;
  const measured = ctx.measureText('0000000000').width / 10 || advance;
  return { size, squeeze: advance / measured };
}

export function createRaster(doc: PrintDoc, options: RasterOptions = {}): Raster {
  const family = options.fontFamily ?? FALLBACK_FONT;
  const wear = Math.max(0, Math.min(1, options.wear ?? 0.5));
  const logos = options.logos;

  const bands: Band[] = [];
  let y = 0;
  for (const line of doc.lines) {
    const height = lineHeight(line, logos);
    bands.push({ y, height, ink: 0, kind: line.kind });
    y += height;
  }
  const height = Math.max(1, y);

  const canvas = document.createElement('canvas');
  canvas.width = PAPER_DOTS;
  canvas.height = height;
  const out = canvas.getContext('2d', { willReadFrequently: false });
  if (!out) throw new Error('canvas');

  // Glyphs are drawn here first, then thresholded into dots.
  const scratch = document.createElement('canvas');
  scratch.width = PAPER_DOTS;
  scratch.height = Math.max(TALL_LINE, ...bands.map((band) => band.height), 1);
  const g = scratch.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('canvas');
  const fontA = metrics(g, family, ADVANCE);
  const fontB = metrics(g, family, ADVANCE_SMALL);

  // Slow variation down the roll (coating, head temperature), and the stepper's slips.
  const roll = prng(`${doc.seed}:roll`);
  const coat: number[] = [];
  for (let i = 0; i <= Math.ceil(height / 64) + 1; i++) coat.push(0.9 + roll() * 0.1);
  const coatAt = (row: number) => {
    const t = row / 64;
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return coat[i] * (1 - s) + coat[i + 1] * s;
  };

  let burned = 0;

  function drawText(
    value: string,
    x: number,
    baseline: number,
    opts: { small?: boolean; bold?: boolean; tall?: boolean; composite?: GlobalCompositeOperation },
  ) {
    const m = opts.small ? fontB : fontA;
    g!.save();
    g!.globalCompositeOperation = opts.composite ?? 'source-over';
    g!.font = `${opts.bold ? 600 : 400} ${m.size}px ${family}`;
    g!.textBaseline = 'alphabetic';
    g!.translate(x, baseline);
    g!.scale(m.squeeze, opts.tall ? 2 : 1);
    g!.fillText(value, 0, 0);
    // ESC E emphasis is a double strike: the head fires each column again one dot over.
    if (opts.bold) g!.fillText(value, 0.6 / m.squeeze, 0);
    g!.restore();
  }

  const col = (small?: boolean) => (small ? ADVANCE_SMALL : ADVANCE);

  function alignX(textLength: number, align: 'left' | 'center' | 'right', small?: boolean, boxed?: boolean) {
    const width = textLength * col(small);
    const inset = boxed ? col(small) * 2 : 0;
    if (align === 'left') return MARGIN + inset;
    if (align === 'right') return MARGIN + PRINT_DOTS - inset - width;
    return Math.round(MARGIN + (PRINT_DOTS - width) / 2);
  }

  /** Paints the line's glyphs onto the scratch canvas (black on transparent). Returns a density factor. */
  function paint(line: PrintLine, h: number): number {
    g!.clearRect(0, 0, PAPER_DOTS, scratch.height);
    g!.fillStyle = '#000';
    g!.strokeStyle = '#000';
    const boxed = lineBoxed(line);
    if (boxed || line.kind === 'box-top' || line.kind === 'box-bottom') {
      const left = MARGIN + BOX_INSET;
      const right = MARGIN + PRINT_DOTS - BOX_INSET;
      if (line.kind === 'box-top') {
        g!.fillRect(left, h - BOX_STROKE, right - left, BOX_STROKE);
        g!.fillRect(left, h - BOX_STROKE, BOX_STROKE, BOX_STROKE);
        g!.fillRect(right - BOX_STROKE, h - BOX_STROKE, BOX_STROKE, BOX_STROKE);
      } else if (line.kind === 'box-bottom') {
        g!.fillRect(left, 0, right - left, BOX_STROKE);
      } else {
        g!.fillRect(left, 0, BOX_STROKE, h);
        g!.fillRect(right - BOX_STROKE, 0, BOX_STROKE, h);
      }
    }

    switch (line.kind) {
      case 'text': {
        if (line.invert) {
          const pad = ADVANCE * 1.2;
          const width = line.text.length * ADVANCE + pad * 2;
          const x = alignX(line.text.length, line.align) - pad;
          g!.fillRect(x, 2, width, h - 4);
          drawText(line.text, x + pad, h - 12, { bold: line.bold, composite: 'destination-out' });
          return 1;
        }
        const baseline = line.tall ? h - 10 : line.small ? h - 6 : h - 8;
        drawText(line.text, alignX(line.text.length, line.align, line.small, line.boxed), baseline, line);
        return line.faint ? 0.6 : 1;
      }
      case 'lead': {
        const baseline = line.tall ? h - 10 : line.small ? h - 6 : h - 8;
        const c = col(line.small);
        const inset = line.boxed ? c * 2 : 0;
        const cols = (line.small ? COLS_SMALL : COLS) - (line.boxed ? 4 : 0);
        drawText(line.left, MARGIN + inset, baseline, line);
        drawText(line.right, MARGIN + PRINT_DOTS - inset - line.right.length * c, baseline, line);
        const from = line.left.length + 1;
        const to = cols - line.right.length - 1;
        if (to > from) {
          // The leader is printed lighter: a row of single dots, not the full glyph.
          g!.save();
          g!.globalAlpha = 0.75;
          for (let i = from; i < to; i++) g!.fillRect(MARGIN + inset + i * c + c / 2 - 1, baseline - 2, 2, 2);
          g!.restore();
        }
        return line.faint ? 0.6 : 1;
      }
      case 'rule': {
        const char = line.heavy ? '=' : '-';
        const n = line.heavy ? COLS : COLS_SMALL;
        drawText(char.repeat(n - (line.boxed ? 4 : 0)), alignX(n - (line.boxed ? 4 : 0), 'center', !line.heavy), h - 6, { small: !line.heavy });
        return line.heavy ? 0.85 : 0.6;
      }
      case 'barcode': {
        const units = receiptBarcodeUnits(line.value);
        const total = units.reduce((sum, n) => sum + n, 0);
        const unit = Math.max(2, Math.floor((PRINT_DOTS * 0.72) / total));
        let x = Math.round(MARGIN + (PRINT_DOTS - unit * total) / 2);
        units.forEach((n, i) => {
          if (i % 2 === 0) g!.fillRect(x, 4, unit * n, line.height);
          x += unit * n;
        });
        return 1;
      }
      case 'logo': {
        const img = logos?.get(line.src);
        if (!img) return 1;
        const { w, h: lh } = logoSize(img);
        g!.drawImage(img, alignX(0, line.align) - (line.align === 'center' ? w / 2 : 0), 2, w, lh);
        return 1;
      }
      default:
        return 1;
    }
  }

  function burnLine(index: number) {
    const line = doc.lines[index];
    const band = bands[index];
    const h = band.height;
    if (h <= 0) return;
    const factor = paint(line, h);
    const glyphs = g!.getImageData(0, 0, PAPER_DOTS, h);
    const src = glyphs.data;
    const dst = out!.createImageData(PAPER_DOTS, h);
    const px = dst.data;
    const random = prng(`${doc.seed}:${index}`);

    // Registration for this line: a dot of slip, sometimes, and a hair of skew across the band.
    const slip = random() < 0.12 * (0.5 + wear) ? (random() < 0.5 ? -1 : 1) : 0;
    const skew = (random() - 0.5) * 1.2;
    let inked = 0;
    const threshold = new Float32Array(PAPER_DOTS);

    for (let row = 0; row < h; row++) {
      // How many dots fire in this row: a full row sags the supply and prints lighter.
      let on = 0;
      for (let x = 0; x < PAPER_DOTS; x++) if (src[(row * PAPER_DOTS + x) * 4 + 3] > 110) on++;
      const sag = 1 - 0.22 * Math.pow(on / PRINT_DOTS, 0.8);
      const coatRow = coatAt(band.y + row);
      // The line's slip, its skew, and a rare one-row hiccup from the stepper.
      const shift = slip + Math.round(skew * (row / Math.max(1, h))) + (random() < 0.025 * (0.5 + wear) ? (random() < 0.5 ? -1 : 1) : 0);
      for (let x = 0; x < PAPER_DOTS; x++) threshold[x] = 0.42 + (random() - 0.5) * 0.18;

      for (let x = 0; x < PAPER_DOTS; x++) {
        const a = src[(row * PAPER_DOTS + x) * 4 + 3] / 255;
        if (a < 0.05) continue;
        const tx = x + shift;
        if (tx < 0 || tx >= PAPER_DOTS) continue;
        const o = (row * PAPER_DOTS + tx) * 4;
        if (a > threshold[x]) {
          if (random() < 0.006 + 0.012 * wear) continue; // a dot that didn't take
          const speckle = 0.86 + random() * 0.14 - wear * random() * 0.12;
          const d = Math.min(1, factor * sag * coatRow * HEAD[tx] * speckle);
          px[o] = INK_RGB[0];
          px[o + 1] = INK_RGB[1];
          px[o + 2] = INK_RGB[2];
          px[o + 3] = Math.max(px[o + 3], Math.round(d * 255));
          inked++;
        } else if (a > 0.18) {
          // Heat spreading into the edge of the glyph: a faint fringe.
          const d = factor * 0.16 * a;
          px[o] = INK_RGB[0];
          px[o + 1] = INK_RGB[1];
          px[o + 2] = INK_RGB[2];
          px[o + 3] = Math.max(px[o + 3], Math.round(d * 255));
        }
      }
    }
    band.ink = inked / (PRINT_DOTS * h);
    out!.putImageData(dst, 0, band.y);
  }

  const raster: Raster = {
    canvas,
    width: PAPER_DOTS,
    height,
    bands,
    get burned() {
      return burned;
    },
    burn(to = doc.lines.length) {
      const end = Math.min(to, doc.lines.length);
      while (burned < end) burnLine(burned++);
    },
  };
  return raster;
}

/**
 * A smaller copy for textures (the pile's atlas): halves repeatedly so thin strokes average into grey
 * instead of aliasing away. Ink alpha is kept; nothing is drawn where there's no ink.
 */
export function downscale(source: HTMLCanvasElement, width: number, maxHeight = Infinity): HTMLCanvasElement {
  let current: HTMLCanvasElement = source;
  const scale = Math.min(width / source.width, maxHeight / source.height);
  const targetW = Math.max(1, Math.round(source.width * scale));
  const targetH = Math.max(1, Math.round(source.height * scale));
  while (current.width / 2 >= targetW * 1.01) {
    const next = document.createElement('canvas');
    next.width = Math.round(current.width / 2);
    next.height = Math.max(1, Math.round(current.height / 2));
    const ctx = next.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  const final = document.createElement('canvas');
  final.width = targetW;
  final.height = targetH;
  const ctx = final.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, targetW, targetH);
  }
  return final;
}
