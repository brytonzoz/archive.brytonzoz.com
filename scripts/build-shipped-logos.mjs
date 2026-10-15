// Thermal-print logos for the /shipped/ master receipt: each `logo` in data/shipped/businesses.json
// (originals in data/shipped/logos/) is trimmed, fitted to a small box, flattened on white paper and
// Atkinson-dithered to 1-bit ink on transparent, then written to public/shipped/logos/<name>.png.
// lib/shipped-logos.json records each one's size so the receipt reserves the space before it loads.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC_DIR = path.join(ROOT, 'data', 'shipped', 'logos');
const OUT_DIR = path.join(ROOT, 'public', 'shipped', 'logos');
const MANIFEST = path.join(ROOT, 'lib', 'shipped-logos.json');

// CSS box on the receipt; files are drawn at 2× for sharp dots on retina screens.
const BOX = { width: 72, height: 28 };
const SCALE = 2;
const INK = [28, 25, 23];
// Per-logo tweaks for marks that are much paler than their background suggests.
const TUNING = { 'zoz-wear.png': { gain: 5 } };

function atkinson(gray, width, height) {
  const ink = new Uint8Array(width * height);
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const on = gray[i] < 128;
      ink[i] = on ? 1 : 0;
      const error = (gray[i] - (on ? 0 : 255)) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) gray[ny * width + nx] += error;
      }
    }
  }
  return ink;
}

/**
 * Ink tone 0 (ink) … 255 (paper) at a working size. The background is the logo's own border colour
 * (white, black, lime, a pale gradient…), so whatever stands out from it prints as ink, whether the
 * mark is darker, lighter or just a different colour. Transparent pixels are always bare paper.
 */
async function toneMap(file) {
  const gain = TUNING[file]?.gain ?? 2;
  const { data: px, info } = await sharp(path.join(SRC_DIR, file))
    .ensureAlpha()
    .resize({ width: 512, height: 512, fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const border = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1);
  const opaque = border.filter((i) => px[i * 4 + 3] > 128);
  const median = (channel) => {
    const values = opaque.map((i) => px[i * 4 + channel]).sort((a, b) => a - b);
    return values.length ? values[values.length >> 1] : 255;
  };
  const bg = [median(0), median(1), median(2)];
  const lightness = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const darkBg = lightness(...bg) < 128;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const [r, g, b] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
    const alpha = px[i * 4 + 3] / 255;
    const standsOut = Math.min(1, (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) / Math.sqrt(3)) * (gain / 255));
    // Within the mark, tones furthest from the background's lightness print heaviest, so a
    // multicolour logo keeps its detail instead of printing as one slab.
    const contrast = (darkBg ? lightness(r, g, b) : 255 - lightness(r, g, b)) / 255;
    gray[i] = 255 - 255 * standsOut * (0.5 + 0.5 * contrast) * alpha;
  }

  // Rounded app-icon corners are white (or clear) around a coloured tile: flood them back to paper.
  const isPaper = (i) => px[i * 4 + 3] < 128 || Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 225;
  const seen = new Uint8Array(gray.length);
  const stack = [0, width - 1, (height - 1) * width, height * width - 1].filter(isPaper);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    gray[i] = 255;
    const x = i % width;
    for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (n >= 0 && n < gray.length && !seen[n] && isPaper(n)) stack.push(n);
    }
  }
  return { gray, width, height };
}

/** Crop to where there is ink (ignoring stray specks), then scale into the print box. */
async function fitToBox(gray, width, height) {
  const cols = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < 235) {
        cols[x] += 1;
        rows[y] += 1;
      }
    }
  }
  const minRun = 3;
  const x0 = cols.findIndex((n) => n >= minRun);
  const y0 = rows.findIndex((n) => n >= minRun);
  const x1 = width - 1 - [...cols].reverse().findIndex((n) => n >= minRun);
  const y1 = height - 1 - [...rows].reverse().findIndex((n) => n >= minRun);
  if (x0 < 0 || y0 < 0) throw new Error('logo is blank after processing');
  const bytes = Buffer.alloc(width * height);
  for (let i = 0; i < gray.length; i++) bytes[i] = Math.round(gray[i]);
  const { data, info } = await sharp(bytes, { raw: { width, height, channels: 1 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .resize({ width: BOX.width * SCALE, height: BOX.height * SCALE, fit: 'inside' })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { gray: Float32Array.from(data), width: info.width, height: info.height };
}

async function render(file) {
  const mapped = await toneMap(file);
  const { gray, width: workW, height: workH } = mapped;

  // Stretch contrast so faint marks still print, then clip the ends of the range: soft background
  // gradients drop to bare paper and solid marks to solid ink, so only real midtones dither.
  let lo = 255;
  let hi = 0;
  for (const value of gray) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const range = Math.max(hi - lo, 1);
  const [black, white] = [70, 185];
  for (let i = 0; i < gray.length; i++) {
    const stretched = ((gray[i] - lo) / range) * 255;
    gray[i] = Math.min(255, Math.max(0, ((stretched - black) / (white - black)) * 255));
  }

  const fitted = await fitToBox(gray, workW, workH);
  const { width, height } = fitted;
  const ink = atkinson(fitted.gray, width, height);
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < ink.length; i++) {
    out[i * 4] = INK[0];
    out[i * 4 + 1] = INK[1];
    out[i * 4 + 2] = INK[2];
    out[i * 4 + 3] = ink[i] ? 255 : 0;
  }
  const png = await sharp(out, { raw: { width, height, channels: 4 } }).png({ palette: true, colors: 2, compressionLevel: 9 }).toBuffer();
  return { png, width: Math.round(width / SCALE), height: Math.round(height / SCALE) };
}

async function main() {
  const data = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'shipped', 'businesses.json'), 'utf8'));
  const files = [...new Set(data.entries.map((entry) => entry.logo).filter(Boolean))].sort();
  await fs.mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  const keep = new Set();
  for (const file of files) {
    const name = `${file.replace(/\.[^.]+$/, '')}.png`;
    const { png, width, height } = await render(file);
    await fs.writeFile(path.join(OUT_DIR, name), png);
    keep.add(name);
    manifest[file] = { src: `/shipped/logos/${name}`, width, height };
  }
  for (const name of await fs.readdir(OUT_DIR)) if (!keep.has(name)) await fs.unlink(path.join(OUT_DIR, name));
  await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`shipped logos: ${files.length} → public/shipped/logos/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
