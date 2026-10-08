// Link-preview card for /shipped/: a 1200×630 JPEG of the master receipt hanging from the printer (data/shipped/businesses.json),
// drawn by lib/receipt-svg.ts and rendered with resvg + IBM Plex Mono, the same way the Worker renders
// printed receipts. Run with --experimental-strip-types (see package.json "media").
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { masterReceiptSvg } from '../lib/receipt-svg.ts';
import { SHIPPED_STATUSES, receiptDate, shippedCounts, toItems, yearGroups } from '../lib/shipped.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'og-shipped.jpg');

async function main() {
  const [wasm, regular, semibold, data, logos] = await Promise.all([
    fs.readFile(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-Regular.ttf')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-SemiBold.ttf')),
    fs.readFile(path.join(ROOT, 'data/shipped/businesses.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(ROOT, 'lib/shipped-logos.json'), 'utf8').then(JSON.parse),
  ]);
  await initWasm(wasm);

  const items = toItems(data, logos);
  const counts = shippedCounts(items);
  const svg = masterReceiptSvg({
    date: receiptDate(data.meta.updated),
    items: counts.items,
    span: counts.first && counts.last ? `${counts.first}–${counts.last}` : null,
    counts: SHIPPED_STATUSES.filter((status) => counts.byStatus[status]).map((status) => ({
      label: status,
      value: String(counts.byStatus[status]),
    })),
    groups: yearGroups(items).map((group) => ({
      label: group.label,
      items: group.items.map((item) => ({ name: item.name, status: item.status })),
    })),
  });

  const png = new Resvg(svg, {
    font: { fontBuffers: [regular, semibold], defaultFontFamily: 'IBM Plex Mono', loadSystemFonts: false },
  })
    .render()
    .asPng();
  await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(OUT);
  const info = await sharp(OUT).metadata();
  console.log(`shipped og: ${OUT} (${info.width}×${info.height})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
