import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';

const pdf = await import('../lib/rollo-pdf.ts');
const svg = await import('../lib/receipt-svg.ts');

test('4-inch Rollo is 812 dots at 203 dpi, with a tear guide', () => {
  assert.equal(svg.ROLLO_DOTS, 812);
  assert.equal(svg.ROLLO_DPI, 203);
  assert.equal(pdf.ROLLO_WIDTH_PX, 812);
  assert.equal(pdf.pagePoints(812, 203).w, 288);
  assert.equal(pdf.pagePoints(812, 203).h, 72);
  const mark = svg.yearRolloSvg({
    number: '000001',
    year: 2026,
    who: 'Ada',
    date: '08 OCT 2026',
    items: [{ name: 'Keepawake', status: 'LIVE', date: 'MAR 14', description: 'A thing.', logo: null }],
    count: 1,
    note: 'One line.',
    sponsors: [],
    url: 'shipped.brytonzoz.com/r/1/',
    barcode: [1, 1, 2, 1],
  });
  assert.match(mark, /width="812"/);
  assert.match(mark, />TEAR</);
});

test('PDF is one page, 812 px wide, length matches the image', () => {
  const width = 812;
  const height = 40;
  const rgb = new Uint8Array(width * height * 3);
  const bytes = pdf.pdfFromRgb(width, height, deflateSync(rgb));
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(String.fromCharCode(...bytes.slice(0, 8)), '%PDF-1.4');
  assert.match(text, /\/Width 812/);
  assert.match(text, /\/Height 40/);
  assert.match(text, /\/MediaBox \[0 0 288 14\.187\]/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /startxref/);
});

test('transparent pixels fall back to paper, never invent ink', () => {
  const pixels = new Uint8Array([0, 0, 0, 0, 29, 27, 25, 255]);
  const rgb = pdf.rgbaToRgb(pixels);
  assert.deepEqual([...rgb.slice(0, 3)], [242, 238, 230]);
  assert.deepEqual([...rgb.slice(3, 6)], [29, 27, 25]);
});
