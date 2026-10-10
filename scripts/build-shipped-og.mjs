// Link-preview card for the Shipped home page: a 1200×630 JPEG of the "how it works" slip hanging from the
// printer, drawn by lib/receipt-svg.ts and rendered with resvg + IBM Plex Mono, the same way the Worker
// renders printed receipts. Run with --experimental-strip-types (see package.json "media").
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { masterReceiptSvg } from '../lib/receipt-svg.ts';
import { receiptBarcodeUnits, receiptDate } from '../lib/shipped.ts';
import { DEFAULT_CLOSES_AT, DEFAULT_OPENS_AT, closingLabel } from '../lib/shipped-event.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'og-shipped.jpg');

async function main() {
  const [wasm, regular, semibold] = await Promise.all([
    fs.readFile(path.join(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-Regular.ttf')),
    fs.readFile(path.join(ROOT, 'worker/fonts/IBMPlexMono-SemiBold.ttf')),
  ]);
  await initWasm(wasm);

  const year = new Date(DEFAULT_OPENS_AT).getUTCFullYear();
  const svg = masterReceiptSvg({
    year,
    date: receiptDate(new Date(DEFAULT_OPENS_AT).toISOString()),
    closes: closingLabel(DEFAULT_CLOSES_AT),
    url: 'shipped.brytonzoz.com',
    barcode: receiptBarcodeUnits(`SHIPPED${year}`),
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
