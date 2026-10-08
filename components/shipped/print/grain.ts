// Thermal paper up close: a cool off-white with faint fibres and specks. One small tile, generated once per
// page and reused (as a CSS background on every face of the paper, and as a canvas pattern for the crumpled
// ball), so the grain costs nothing per frame.
import { prng } from '../physics';

export const PAPER = '#f2eee6';
export const PAPER_RGB: [number, number, number] = [242, 238, 230];
/** CSS px the tile covers on screen. */
export const GRAIN_SIZE = 56;

let tile: HTMLCanvasElement | null = null;
let url: string | null = null;

/** The grain as a transparent tile (specks and fibres only), drawn over the paper colour. */
export function grainTile(): HTMLCanvasElement | null {
  if (tile) return tile;
  if (typeof document === 'undefined') return null;
  const size = 112;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const random = prng('thermal paper grain');
  const image = ctx.createImageData(size, size);
  const px = image.data;
  for (let i = 0; i < size * size; i++) {
    const r = random();
    // Mostly a faint mottle; now and then a darker speck of coating.
    const dark = r < 0.012 ? 0.16 + random() * 0.12 : Math.pow(random(), 3) * 0.05;
    const light = r > 0.985 ? 0.25 : 0;
    const o = i * 4;
    if (light) {
      px[o] = 255;
      px[o + 1] = 253;
      px[o + 2] = 248;
      px[o + 3] = Math.round(light * 255);
    } else {
      px[o] = 70;
      px[o + 1] = 58;
      px[o + 2] = 44;
      px[o + 3] = Math.round(dark * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  // A few long fibres, barely there, wrapping around the tile edges so the repeat doesn't show.
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const length = 6 + random() * 18;
    const bendX = (random() - 0.5) * 4;
    const bendY = (random() - 0.5) * 4;
    ctx.strokeStyle = `rgba(90, 76, 60, ${0.05 + random() * 0.06})`;
    ctx.lineWidth = 0.6 + random() * 0.5;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.quadraticCurveTo(
          x + dx + Math.cos(angle) * length * 0.5 + bendX,
          y + dy + Math.sin(angle) * length * 0.5 + bendY,
          x + dx + Math.cos(angle) * length,
          y + dy + Math.sin(angle) * length,
        );
        ctx.stroke();
      }
    }
  }
  tile = canvas;
  return tile;
}

/** The tile as a CSS url(), made once. */
export function grainUrl(): string | null {
  if (url) return url;
  const canvas = grainTile();
  if (!canvas) return null;
  try {
    url = `url("${canvas.toDataURL('image/png')}")`;
  } catch {
    url = null;
  }
  return url;
}
