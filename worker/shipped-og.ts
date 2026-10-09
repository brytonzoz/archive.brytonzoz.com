// Images for /shipped/: lib/receipt-svg.ts drawn by resvg (WebAssembly) with the bundled IBM Plex Mono.
// Share images of printed receipts are kept in R2 (SHIPPED bucket) per receipt and sponsor set.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import plexRegular from './fonts/IBMPlexMono-Regular.ttf';
import plexSemiBold from './fonts/IBMPlexMono-SemiBold.ttf';
import { yearCardSvg, yearRolloSvg, yearTallSvg, type YearOg } from '../lib/receipt-svg';
import { pdfFromRgb, rgbFlate, rgbaToRgb } from '../lib/rollo-pdf';
import { receiptBarcodeUnits, receiptDate } from '../lib/shipped';
import { isFirstRun, itemsForPrint, pickDeepCut, receiptBadges, receiptModules } from '../lib/shipped-modules';
import { qr } from '../lib/shipped-qr';
import { itemDate, itemsShipped, receiptNumber, subjectLabel, QR_PATH, RECEIPT_PATH, type SponsorBlock, type YearReceipt } from '../lib/shipped-year';

let ready: Promise<void> | null = null;

async function resvg(svg: string): Promise<InstanceType<typeof Resvg>> {
  ready ??= initWasm(resvgWasm).catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  return new Resvg(svg, {
    font: {
      fontBuffers: [new Uint8Array(plexRegular), new Uint8Array(plexSemiBold)],
      defaultFontFamily: 'IBM Plex Mono',
      loadSystemFonts: false,
    },
  });
}

export async function renderPng(svg: string): Promise<Uint8Array> {
  const renderer = await resvg(svg);
  const image = renderer.render();
  const png = image.asPng();
  image.free();
  renderer.free();
  return png;
}

/** RGBA pixels of an SVG (used to decode remote logos: an <image> with a data: URI inside an SVG). */
export async function decodePixels(svg: string): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const renderer = await resvg(svg);
  const image = renderer.render();
  const out = { pixels: new Uint8Array(image.pixels), width: image.width, height: image.height };
  image.free();
  renderer.free();
  return out;
}

/** Turns a same-origin logo path into a data: URI the renderer can embed (null: leave the logo out). */
export type LogoResolver = (path: string | null) => Promise<string | null>;

async function yearOg(receipt: YearReceipt, block: SponsorBlock, origin: string, logo: LogoResolver, maxItems: number): Promise<YearOg> {
  const ordered = itemsForPrint(receipt.potential ? [] : receipt.items);
  const items = (receipt.potential ? receipt.items : ordered).slice(0, maxItems);
  const logos = await Promise.all(items.map((item) => logo(item.logo).catch(() => null)));
  const sponsorLogos = await Promise.all(block.slots.map((slot) => logo(slot.logo).catch(() => null)));
  const cut = pickDeepCut(ordered);
  const modules = receiptModules({ receipt });
  return {
    number: receiptNumber(receipt.id),
    year: receipt.year,
    who: subjectLabel(receipt.subject),
    date: receiptDate(receipt.printedAt),
    items: items.map((item, i) => ({
      name: item.name,
      status: item.status,
      date: itemDate(item.date),
      description: item.description,
      logo: logos[i],
    })),
    count: itemsShipped(receipt),
    note: receipt.note,
    // QR codes only ever point at our own /q/<key>, which checks the slot again before redirecting.
    sponsors: block.slots.map((slot, i) => ({ name: slot.name, cta: slot.cta, logo: sponsorLogos[i], qr: qr(new URL(QR_PATH(slot.qr), origin).toString()) })),
    url: new URL(RECEIPT_PATH(receipt.id), origin).toString().replace(/^https?:\/\//, ''),
    barcode: receiptBarcodeUnits(`BZ${receiptNumber(receipt.id)}${receipt.year}`),
    deepCut: cut ? { name: cut.name, why: `Sourced from ${cut.source}` } : null,
    badges: receiptBadges(modules),
    firstRun: isFirstRun(receipt.id),
    modules: modules.map((band) => ({ id: band.id, title: band.title, lines: band.lines })),
    shipScore: receipt.shipScore,
  };
}

/** The 1200×675 card for X. */
export async function yearCardPng(receipt: YearReceipt, block: SponsorBlock, origin: string, logo: LogoResolver) {
  return renderPng(yearCardSvg(await yearOg(receipt, block, origin, logo, 20)));
}

/** The whole receipt, tall, for downloading. */
export async function yearTallPng(receipt: YearReceipt, block: SponsorBlock, origin: string, logo: LogoResolver) {
  return renderPng(yearTallSvg(await yearOg(receipt, block, origin, logo, 30)));
}

/** 4-inch Rollo PNG (812 dots wide at 203 dpi). */
export async function yearRolloPng(receipt: YearReceipt, block: SponsorBlock, origin: string, logo: LogoResolver) {
  return renderPng(yearRolloSvg(await yearOg(receipt, block, origin, logo, 30)));
}

/** 4-inch Rollo PDF: 203 dpi, 812 px wide, one receipt per page, page length matches the tape. */
export async function yearRolloPdf(receipt: YearReceipt, block: SponsorBlock, origin: string, logo: LogoResolver) {
  const svg = yearRolloSvg(await yearOg(receipt, block, origin, logo, 30));
  const { pixels, width, height } = await decodePixels(svg);
  return pdfFromRgb(width, height, await rgbFlate(rgbaToRgb(pixels)));
}
