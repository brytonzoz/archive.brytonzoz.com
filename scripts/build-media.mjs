// Converts originals in assets-src/ into responsive, content-hashed AVIF + WebP files in
// public/media/ and writes lib/media-manifest.json. Outputs are cached by filename, so
// re-runs only encode images whose source or settings changed.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC_DIR = path.join(ROOT, 'assets-src');
const OUT_DIR = path.join(ROOT, 'public', 'media');
const MANIFEST = path.join(ROOT, 'lib', 'media-manifest.json');
const PIPELINE_VERSION = 1;

// Covers render at up to ~1100 device px (large retina screens); scene stickers are 696 px originals.
const PROFILES = {
  covers: {
    widths: [320, 480, 640, 800, 1024, 1280],
    avif: { quality: 55, effort: 2 },
    webp: { quality: 80, effort: 4 },
    placeholder: true,
  },
  scenes: {
    widths: [320, 480, 696],
    avif: { quality: 58, effort: 2 },
    webp: { quality: 82, alphaQuality: 90, effort: 4 },
    placeholder: false,
  },
  // Scrapwrk product photos: square, shown from grid tiles (~180 px) up to the full-screen gallery.
  store: {
    widths: [320, 480, 640, 800, 1080, 1440],
    avif: { quality: 55, effort: 2 },
    webp: { quality: 80, effort: 4 },
    placeholder: true,
  },
  // NonParallel tee mockups rendered by Printify (1200px squares on white).
  merch: {
    widths: [320, 480, 640, 800, 1080],
    avif: { quality: 58, effort: 2 },
    webp: { quality: 82, effort: 4 },
    placeholder: true,
  },
  icons: {
    widths: [96, 144],
    avif: { quality: 60, effort: 2 },
    webp: { quality: 85, effort: 4 },
    placeholder: false,
  },
};

const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff']);

async function listSources(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return SOURCE_EXT.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
  }));
  return files.flat().sort();
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function buildAsset(file) {
  const rel = path.relative(SRC_DIR, file).split(path.sep).join('/');
  const key = rel.replace(/\.[^.]+$/, '');
  const profile = PROFILES[rel.split('/')[0]];
  if (!profile) throw new Error(`No media profile for ${rel}; put it under covers/, scenes/, store/, merch/ or icons/`);

  const input = await fs.readFile(file);
  const hash = crypto.createHash('sha256')
    .update(input)
    .update(JSON.stringify({ profile, PIPELINE_VERSION }))
    .digest('hex')
    .slice(0, 10);

  const { width: srcWidth, height: srcHeight } = await sharp(input).rotate().metadata().then((meta) => (
    (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : meta
  ));
  const widths = [...new Set(profile.widths.map((w) => Math.min(w, srcWidth)))].sort((a, b) => a - b);
  const maxWidth = widths[widths.length - 1];

  // Decode and downscale the (possibly huge) original once, then derive every output from that.
  const { data, info } = await sharp(input)
    .rotate()
    .toColourspace('srgb')
    .resize({ width: maxWidth, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fromBase = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  const outputs = { avif: [], webp: [] };
  for (const width of widths) {
    for (const format of ['avif', 'webp']) {
      const name = `${key}.${hash}-${width}.${format}`;
      const outFile = path.join(OUT_DIR, name);
      if (!(await exists(outFile))) {
        await fs.mkdir(path.dirname(outFile), { recursive: true });
        const resized = width === info.width ? fromBase() : fromBase().resize({ width });
        await resized[format](profile[format]).toFile(outFile);
      }
      outputs[format].push(`/media/${name} ${width}w`);
    }
  }

  const asset = {
    width: info.width,
    height: Math.round((info.width / srcWidth) * srcHeight),
    src: outputs.webp[outputs.webp.length - 1].split(' ')[0],
    avif: outputs.avif.join(', '),
    webp: outputs.webp.join(', '),
  };

  if (profile.placeholder) {
    const tiny = await fromBase().resize({ width: 24 }).webp({ quality: 40 }).toBuffer();
    asset.placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;
  }

  return [key, asset];
}

async function prune(dir, keep) {
  if (!(await exists(dir))) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await prune(full, keep);
      if ((await fs.readdir(full)).length === 0) await fs.rmdir(full);
    } else if (!keep.has(full)) {
      await fs.unlink(full);
    }
  }
}

const started = Date.now();
const sources = await listSources(SRC_DIR);
const manifest = {};
for (const file of sources) {
  const [key, asset] = await buildAsset(file);
  if (manifest[key]) throw new Error(`Duplicate media key "${key}" (same name with different extensions?)`);
  manifest[key] = asset;
}

const keep = new Set(Object.values(manifest).flatMap((asset) => (
  [asset.avif, asset.webp].flatMap((set) => set.split(', ').map((entry) => path.join(ROOT, 'public', entry.split(' ')[0])))
)));
await prune(OUT_DIR, keep);

await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`media: ${sources.length} sources -> ${keep.size} files in ${((Date.now() - started) / 1000).toFixed(1)}s`);
