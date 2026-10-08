// Link-preview card for /shipped/: a 1200×630 JPEG of the master receipt (lib/shipped.ts), drawn by
// lib/receipt-svg.ts and rendered with resvg + IBM Plex Mono, the same way the Worker renders printed receipts.
// Run with --experimental-strip-types (see package.json "media").
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { masterReceiptSvg } from '../lib/receipt-svg.ts';
import {
  SHIPPED_BARCODE_VALUE,
  SHIPPED_STATUSES,
  chronological,
  receiptBarcodeUnits,
  receiptDate,
  shippedCounts,
  statusLabel,
  yearSpan,
} from '../lib/shipped.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'og-shipped.jpg');

async function main() {
  const [wasm, regular, semibold] = await Promise.all([
    fs.readFile(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-Regular.ttf')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-SemiBold.ttf')),
  ]);
  await initWasm(wasm);

  const counts = shippedCounts();
  const svg = masterReceiptSvg({
    date: receiptDate(),
    items: chronological().map((item) => ({ name: item.name, status: statusLabel(item.status), years: yearSpan(item) })),
    totals: [
      { label: 'ITEMS', value: String(counts.items) },
      ...SHIPPED_STATUSES.filter((status) => counts.byStatus[status]).map((status) => ({
        label: statusLabel(status),
        value: String(counts.byStatus[status]),
      })),
    ],
    totalLive: counts.live,
    barcode: receiptBarcodeUnits(SHIPPED_BARCODE_VALUE),
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
