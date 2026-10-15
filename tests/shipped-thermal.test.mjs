import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLS, COLS_SMALL, docText, printable, receiptToDoc, wrap } from '../components/shipped/thermal/layout.ts';

const { paidByLines } = await import('../components/shipped/thermal/adapters.ts');
const { sampleReceipt } = await import('../components/shipped/thermal/samples.ts');

const RECEIPT = {
  id: 'r42',
  year: 2026,
  who: 'Ada Ships',
  kicker: 'SAMPLE · NAME',
  date: '08 OCT 2026',
  number: '000042',
  items: [
    { name: 'A VERY LONG PRODUCT NAME THAT WILL NOT FIT ON ONE LINE OF THE PRINTER', status: 'LIVE', date: 'MAR 14', description: 'Does a thing.' },
    { name: 'SHORT', status: 'SHIPPED', date: null, description: '' },
  ],
  count: 2,
  note: 'Proof over hype.',
  presented: null,
  paidBy: ['POCKET FACTORY', 'MOPKIN'],
  barcode: 'BZ000042',
};

test('wrap keeps every word, never exceeds the column count, and splits words longer than a line', () => {
  const text = 'the quick brown fox jumps over the lazy dog '.repeat(4) + 'x'.repeat(70);
  const lines = wrap(text, 20);
  assert.ok(lines.every((line) => line.length <= 20));
  assert.equal(lines.join('').replace(/ /g, ''), text.replace(/ /g, ''));
  assert.deepEqual(wrap('', 10), ['']);
});

test('printable maps typographic punctuation onto the printer code page', () => {
  assert.equal(printable('Cashier’s “note” – ok…'), 'Cashier\'s "note" - ok...');
  assert.equal(printable('emoji 🚀 gone'), 'emoji  gone');
});

test('the print job follows YearReceipt: store, inverse band, customer, items, total, paid-for box, barcode', () => {
  const doc = receiptToDoc(RECEIPT);
  const kinds = doc.lines.map((line) => line.kind);
  assert.equal(doc.seed, 'r42');
  const first = doc.lines[0];
  assert.equal(first.kind, 'text');
  assert.equal(first.text, 'SHIPPED 2026');
  assert.ok(first.tall);
  assert.ok(doc.lines.some((line) => line.kind === 'text' && line.invert && line.text === 'SHIPPED IN 2026'));
  assert.ok(doc.lines.some((line) => line.kind === 'text' && line.tall && line.text === 'ADA SHIPS'));
  assert.ok(kinds.indexOf('box-top') < kinds.indexOf('box-bottom'));
  assert.ok(kinds.indexOf('box-bottom') < kinds.indexOf('barcode'));
  const total = doc.lines.find((line) => line.kind === 'lead' && line.left === 'ITEMS SHIPPED');
  assert.ok(total && total.kind === 'lead' && total.right === '2');
});

test('vacant sponsor slots produce no paid attribution or empty sponsor frame', () => {
  const attribution = paidByLines({ slots: [
    { slot: 0, house: true, name: '', cta: '' },
    { slot: 1, house: true, name: 'Former house brand', cta: 'Not a paid ad' },
  ], frozen: false });
  assert.deepEqual(attribution, { presented: null, paidBy: [] });
  const doc = receiptToDoc({ ...RECEIPT, ...attribution });
  assert.doesNotMatch(doc.text, /PAID FOR BY|PRESENTED BY|Former house brand/);
  assert.equal(doc.lines.some((line) => line.kind === 'box-top' || line.kind === 'box-bottom'), false);
  assert.match(doc.text, /Proof over hype/);
  assert.match(doc.text, /\[barcode BZ000042\]/);
});

test('paid small ads keep their position when the wide ad is vacant', () => {
  const attribution = paidByLines({ slots: [
    { slot: 4, house: false, name: 'Fourth ad', cta: 'Four' },
    { slot: 0, house: true, name: '', cta: '' },
    { slot: 1, house: false, name: 'First ad', cta: 'One' },
    { slot: 2, house: false, name: '   ', cta: 'No name' },
  ], frozen: false });
  assert.deepEqual(attribution, { presented: null, paidBy: ['First ad', 'Fourth ad'] });
  assert.deepEqual(paidByLines({ slots: [{ slot: 0, house: false, name: 'Wide ad', cta: '' }], frozen: false }), { presented: 'Wide ad', paidBy: [] });
});

test('fictional lab receipts retain their content without implying paid sponsors', () => {
  const sample = sampleReceipt(0);
  assert.equal(sample.presented, null);
  assert.deepEqual(sample.paidBy, []);
  const doc = receiptToDoc(sample);
  assert.match(doc.text, /SAMPLE/);
  assert.match(doc.text, /ITEMS SHIPPED/);
  assert.doesNotMatch(doc.text, /PAID FOR BY|PRESENTED BY/);
});

test('long item names wrap and the status lands on the leader line', () => {
  const doc = receiptToDoc(RECEIPT);
  const lead = doc.lines.find((line) => line.kind === 'lead' && line.right === 'LIVE');
  assert.ok(lead && lead.kind === 'lead');
  assert.ok(lead.left.length + lead.right.length + 3 <= COLS);
  for (const line of doc.lines) {
    if (line.kind === 'text') assert.ok(line.text.length <= (line.small ? COLS_SMALL : COLS), line.text);
  }
});

test('filler bands never print, even if a stored layout still names them', () => {
  const doc = receiptToDoc({
    ...RECEIPT,
    firstRun: true,
    deepCut: { name: 'SHOW HN APP', why: 'Sourced · hn' },
    badges: ['FIRST RUN', 'DEEP CUT'],
    shipScore: 18,
    printedAt: '2026-10-09T01:00:19.000Z',
    modules: [
      { id: 'deep-cut', title: 'HOW DID IT KNOW?', lines: ['SHOW HN APP'] },
      { id: 'items', title: 'ITEMS', lines: [] },
      { id: 'friend', title: 'PRINT A FRIEND', lines: ['Type someone else'] },
      { id: 'volume', title: 'TAPE', lines: ['One public thing.'] },
      { id: 'cashier', title: "CASHIER'S NOTE", lines: [] },
      { id: 'stamp', title: 'STAMP', lines: [] },
    ],
  });
  const text = doc.text;
  assert.equal(text.includes('HOW DID IT KNOW'), false);
  assert.equal(text.includes('PRINT A FRIEND'), false);
  assert.equal(text.includes('TAPE'), false);
  assert.equal(text.includes('DEEP CUT'), false);
  assert.match(text, /CASHIER'S NOTE/);
  assert.match(text, /ITEMS SHIPPED · SCORE 18/);
  assert.match(text, /FIRST RUN/);
});

test('long tapes print significance group headers without a status tilde', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    name: `SHIP ${i + 1}`,
    status: 'SHIPPED',
    date: 'MAR 1',
    description: 'A real line.',
    via: i === 0 ? 'via OpenAI · Codex' : null,
    confidence: i === 1 ? 0.72 : 0.95,
    significance: i < 2 ? 4 : i < 5 ? 2 : 0,
  }));
  const doc = receiptToDoc({ ...RECEIPT, items, count: items.length });
  const text = doc.text;
  assert.ok(text.includes('LANDMARK'), text);
  assert.ok(text.includes('NOTABLE LAUNCH'), text);
  assert.ok(text.includes('MINOR FIX'), text);
  assert.ok(text.includes('via OpenAI · Codex'), text);
  assert.equal(text.includes('via OpenAI · Codex  A real line'), false, 'via and the description are not one run-on line');
  assert.equal(
    doc.lines.some((line) => line.kind === 'lead' && String(line.right).includes('~')),
    false,
    'status words stay clean — no trailing ~',
  );
});

test('a paid full tape prints the verified stamp and FULL serial', () => {
  const doc = receiptToDoc({ ...RECEIPT, full: true });
  assert.match(doc.text, /VERIFIED FULL RUN/);
  assert.match(doc.text, /#000042 FULL/);
});

test('an empty receipt prints 0 items, score 0, and no placeholder line', () => {
  const doc = receiptToDoc({
    ...RECEIPT,
    items: [{ name: 'YOUR POTENTIAL', status: 'PRE-ORDER', source: 'none', significance: 0 }],
    count: 0,
    shipScore: 0,
    note: 'Empty drawer. Go ship.',
  });
  assert.equal(doc.text.includes('YOUR POTENTIAL'), false, doc.text);
  assert.equal(doc.text.includes('MINOR FIX'), false, doc.text);
  const total = doc.lines.find((line) => line.kind === 'lead' && String(line.left).includes('ITEMS SHIPPED'));
  assert.ok(total && total.right === '0', JSON.stringify(total));
  assert.match(doc.text, /Empty drawer/);
});

test('mixed 0–4 and 0–100 significance scores print one header per band', () => {
  const doc = receiptToDoc({
    ...RECEIPT,
    items: [
      { name: 'ONE', status: 'LIVE', significance: 2, description: 'a' },
      { name: 'TWO', status: 'LIVE', significance: 40, description: 'b' },
      { name: 'THREE', status: 'LIVE', significance: 2, description: 'c' },
      { name: 'FOUR', status: 'LIVE', significance: 45, description: 'd' },
      { name: 'FIVE', status: 'LIVE', significance: 2, description: 'e' },
      { name: 'SIX', status: 'LIVE', significance: 38, description: 'f' },
      { name: 'SEVEN', status: 'LIVE', significance: 2, description: 'g' },
      { name: 'EIGHT', status: 'LIVE', significance: 0, description: 'h' },
    ],
    count: 8,
  });
  const headers = doc.lines.filter((line) => line.kind === 'text' && line.text === 'NOTABLE LAUNCH');
  assert.equal(headers.length, 1, doc.text);
  assert.ok(doc.text.includes('MINOR FIX'), doc.text);
  assert.ok(doc.text.includes('EIGHT'), doc.text);
});

test('the plain-text copy carries every item and the note', () => {
  const text = docText(receiptToDoc(RECEIPT).lines);
  assert.match(text, /SHORT: SHIPPED/);
  assert.match(text, /Proof over hype\./);
  assert.match(text, /\[barcode BZ000042\]/);
});
