// Link-preview cards (1200x630 JPEG: the cover on a blurred copy of itself) for every release in
// lib/tracks.json, plus the home-screen app icons. Writes content-hashed files to
// public/media/share/ and lib/share-images.json. Skips work whose output already exists.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(ROOT, 'public', 'media', 'share');
const MANIFEST = path.join(ROOT, 'lib', 'share-images.json');
const VERSION = 3;
const APP_ICON_SOURCE = 'covers/solenya';

async function findSource(key) {
  const dir = path.join(ROOT, 'assets-src', path.dirname(key));
  const base = path.basename(key);
  const match = (await fs.readdir(dir)).find((file) => path.parse(file).name === base);
  if (!match) throw new Error(`No source image for ${key} in assets-src/`);
  return path.join(dir, match);
}

async function hashOf(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).update(String(VERSION)).digest('hex').slice(0, 10);
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function card(source, out) {
  const background = await sharp(source).resize(1200, 630, { fit: 'cover' }).blur(40).modulate({ brightness: 0.62, saturation: 1.3 }).toBuffer();
  const coverSize = 470;
  const cover = await sharp(source).resize(coverSize, coverSize, { fit: 'cover' }).toBuffer();
  const mask = Buffer.from(`<svg width="${coverSize}" height="${coverSize}"><rect width="${coverSize}" height="${coverSize}" rx="22" ry="22"/></svg>`);
  const rounded = await sharp(cover).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  // Blur runs in its own pipeline: sharp applies composites after other operations.
  const pad = 120;
  const shadow = await sharp(Buffer.from(
    `<svg width="${coverSize + pad}" height="${coverSize + pad}"><rect x="${pad / 2}" y="${pad / 2 + 16}" width="${coverSize}" height="${coverSize}" rx="22" fill="rgba(0,0,0,0.6)"/></svg>`,
  ))
    .blur(28)
    .png()
    .toBuffer();
  await sharp(background)
    .composite([
      { input: shadow, left: 600 - (coverSize + pad) / 2, top: 315 - (coverSize + pad) / 2 },
      { input: rounded, left: 600 - coverSize / 2, top: 315 - coverSize / 2 },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(out);
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'lib', 'tracks.json'), 'utf8'));
  await fs.mkdir(OUT_DIR, { recursive: true });
  const manifest = { releases: {}, icons: {} };

  for (const release of catalog.releases) {
    const source = await findSource(release.cover);
    const name = `${release.id}.${await hashOf(source)}.jpg`;
    const out = path.join(OUT_DIR, name);
    if (!(await exists(out))) await card(source, out);
    manifest.releases[release.id] = `/media/share/${name}`;
  }

  // Home screen / tab icons: the latest cover, full bleed (iOS and Android round the corners).
  const iconSource = await findSource(APP_ICON_SOURCE);
  const iconHash = await hashOf(iconSource);
  for (const size of [32, 180, 192, 512]) {
    const name = `icon-${size}.${iconHash}.png`;
    const out = path.join(OUT_DIR, name);
    if (!(await exists(out))) await sharp(iconSource).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9, palette: size >= 180, quality: 90 }).toFile(out);
    manifest.icons[size] = `/media/share/${name}`;
  }

  // Drop outputs from earlier versions of the sources.
  const keep = new Set([...Object.values(manifest.releases), ...Object.values(manifest.icons)].map((p) => path.basename(p)));
  for (const file of await fs.readdir(OUT_DIR)) if (!keep.has(file)) await fs.rm(path.join(OUT_DIR, file));

  await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`share images: ${Object.keys(manifest.releases).length} cards, ${Object.keys(manifest.icons).length} icons`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
