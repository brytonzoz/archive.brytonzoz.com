import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { bundleWorker } from './lib/bundle-worker.mjs';
import { yearCardSvg, yearPortraitSvg, yearRolloSvg } from '../lib/receipt-svg.ts';
import { qr } from '../lib/shipped-qr.ts';

const ORIGIN = 'https://shipped.brytonzoz.com';
const BLUE_LOGO = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="#0000ff"/></svg>').toString('base64')}`;
const receipt = {
  id: 42, version: 2, year: 2026,
  subject: { kind: 'name', id: 'Ada Ships', display: 'Ada Ships' },
  printedAt: '2026-10-15T12:00:00Z',
  items: [{ name: 'Tide Tables', status: 'SHIPPED', date: '2026-03-03', description: 'Tide forecasts.', logo: null, link: 'https://example.com/tides', source: 'site' }],
  note: 'Proof over hype.', potential: false, demo: false, listed: true,
};
const vacantSlots = () => Array.from({ length: 10 }, (_, slot) => ({ slot, house: true, name: '', cta: '', logo: null, qr: null }));
const data = (sponsors) => ({
  number: '000042', year: 2026, who: 'Ada Ships', date: '15 OCT 2026',
  items: receipt.items, count: 1, note: receipt.note, sponsors,
  url: 'shipped.brytonzoz.com/r/42/', barcode: [1, 1, 2, 1],
});
const paidSlot = (slot) => ({
  slot, house: false, name: `ADVERTISER ${slot}`, cta: `Visit advertiser ${slot}`, logo: BLUE_LOGO,
  qr: qr(`${ORIGIN}/q/paid-${slot}`),
});

// Reverting vacancy handling must print these stale brands/QRs and fail the assertions.
for (const [kind, render] of [['card', yearCardSvg], ['portrait', yearPortraitSvg], ['Rollo', yearRolloSvg]]) {
  test(`${kind} export draws ten vacant ad slots without stale house brands or QR codes`, () => {
    const slots = vacantSlots().map((slot) => ({ ...slot, name: 'OLD HOUSE BRAND', cta: 'Old house promotion', logo: BLUE_LOGO, qr: qr(`${ORIGIN}/q/house-${slot.slot}`) }));
    const svg = render(data([...slots].reverse()));
    assert.doesNotMatch(svg, /OLD HOUSE|Old house promotion|data:image/);
    assert.equal((svg.match(/>EMPTY · \$1</g) || []).length, 10);
    for (let i = 0; i <= 9; i++) assert.match(svg, new RegExp(`>AD SLOT ${i}<`));
    assert.doesNotMatch(svg, /shape-rendering="crispEdges"/);
  });

  // Late paid slots must remain visible; filtering to the first four names loses them.
  test(`${kind} export retains actual paid logos and QR codes in hero, middle, and last slots`, () => {
    const slots = vacantSlots();
    for (const slot of [0, 5, 9]) slots[slot] = paidSlot(slot);
    const svg = render(data(slots));
    for (const slot of [0, 5, 9]) {
      assert.match(svg, new RegExp(`>ADVERTISER ${slot}<`));
      assert.ok(svg.includes(`d="${slots[slot].qr.path}"`), `slot ${slot} has its own QR`);
    }
    assert.equal((svg.match(/href="data:image/g) || []).length, 3);
    assert.equal((svg.match(/>EMPTY · \$1</g) || []).length, 7);
    assert.ok(svg.indexOf('ADVERTISER 0') < svg.indexOf('ADVERTISER 5'));
    assert.ok(svg.indexOf('ADVERTISER 5') < svg.indexOf('ADVERTISER 9'));
  });
}

test('actual Worker PNG and PDF exports include the last paid logo and never resolve vacant logos', async () => {
  const worker = await bundleWorker('worker/shipped-og.ts');
  const slots = vacantSlots().map((slot) => ({ ...slot, qr: '', logo: '/stale-house.png', name: 'OLD HOUSE BRAND' }));
  slots[9] = { ...paidSlot(9), logo: '/approved/paid-9.png', qr: 'paid-9' };
  const seen = [];
  const logo = async (value) => {
    if (value) seen.push(value);
    return value === '/approved/paid-9.png' ? BLUE_LOGO : null;
  };
  const block = { slots, frozen: false };
  let rollo;
  for (const [kind, render, width, height] of [
    ['card', worker.yearCardPng, 1200, 630],
    ['portrait', worker.yearTallPng, 1080, 1350],
    ['Rollo', worker.yearRolloPng, 812, null],
  ]) {
    const png = await render(receipt, block, ORIGIN, logo);
    const { data: pixels, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    if (height) assert.equal(info.height, height);
    let logoPixels = 0;
    for (let i = 0; i < pixels.length; i += info.channels) {
      if (pixels[i + 2] > 120 && pixels[i + 2] > pixels[i + 1] * 2 && pixels[i + 2] > pixels[i] * 2) logoPixels++;
    }
    assert.ok(logoPixels > 50, `${kind}: last paid logo must be inside the exported image, got ${logoPixels} pixels`);
    if (kind === 'Rollo') rollo = { pixels, info };
  }
  const pdf = Buffer.from(await worker.yearRolloPdf(receipt, block, ORIGIN, logo));
  const text = pdf.toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Width 812/);
  const imageHeader = /\/Subtype \/Image[\s\S]*?\/Length (\d+) >>\nstream\n/.exec(text);
  assert.ok(imageHeader);
  const start = imageHeader.index + imageHeader[0].length;
  const rgb = inflateSync(pdf.subarray(start, start + Number(imageHeader[1])));
  assert.deepEqual(rgb, rollo.pixels, 'PDF embeds the same complete receipt pixels as Rollo PNG');
  assert.deepEqual([...new Set(seen)], ['/approved/paid-9.png']);
});
