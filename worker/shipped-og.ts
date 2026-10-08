// Link-preview images for printed receipts: lib/receipt-svg.ts drawn by resvg (WebAssembly) with the
// bundled IBM Plex Mono. Rendered once per receipt and kept in R2 (SHIPPED bucket, og/<id>.png).
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import plexRegular from './fonts/IBMPlexMono-Regular.ttf';
import plexSemiBold from './fonts/IBMPlexMono-SemiBold.ttf';
import { printedReceiptSvg } from '../lib/receipt-svg';
import { chargesTotal, money, printedCounts, receiptNumber, type PrintedReceipt } from '../lib/shipped-receipt';
import { receiptBarcodeUnits, receiptDate } from '../lib/shipped';

let ready: Promise<void> | null = null;

export function printedSvg(receipt: PrintedReceipt): string {
  const counts = printedCounts(receipt);
  return printedReceiptSvg({
    number: receiptNumber(receipt.id),
    login: receipt.login,
    mode: receipt.mode,
    date: receiptDate(receipt.printedAt),
    headline: receipt.headline,
    items: receipt.items.map((item) => ({ name: item.name, status: item.status })),
    counts: [
      { label: 'SHIPPED', value: String(counts.shipped) },
      { label: 'IN PROGRESS', value: String(counts.inProgress) },
      { label: 'ABANDONED', value: String(counts.abandoned) },
    ],
    total: money(chargesTotal(receipt)),
    barcode: receiptBarcodeUnits(`BZ${receiptNumber(receipt.id)}${receipt.login}`),
  });
}

export async function renderPng(svg: string): Promise<Uint8Array> {
  ready ??= initWasm(resvgWasm).catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers: [new Uint8Array(plexRegular), new Uint8Array(plexSemiBold)],
      defaultFontFamily: 'IBM Plex Mono',
      loadSystemFonts: false,
    },
  });
  const image = resvg.render();
  const png = image.asPng();
  image.free();
  resvg.free();
  return png;
}
