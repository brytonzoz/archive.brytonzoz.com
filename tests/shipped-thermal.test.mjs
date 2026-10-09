import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLS, COLS_SMALL, docText, printable, receiptToDoc, wrap } from '../components/shipped/thermal/layout.ts';

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

test('long item names wrap and the status lands on the leader line', () => {
  const doc = receiptToDoc(RECEIPT);
  const lead = doc.lines.find((line) => line.kind === 'lead' && line.right === 'LIVE');
  assert.ok(lead && lead.kind === 'lead');
  assert.ok(lead.left.length + lead.right.length + 3 <= COLS);
  for (const line of doc.lines) {
    if (line.kind === 'text') assert.ok(line.text.length <= (line.small ? COLS_SMALL : COLS), line.text);
  }
});

test('the sourced deep-cut prints first as HOW DID IT KNOW', () => {
  const doc = receiptToDoc({
    ...RECEIPT,
    firstRun: true,
    deepCut: { name: 'SHOW HN APP', why: 'Sourced · hn' },
    badges: ['FIRST RUN', 'DEEP CUT'],
  });
  const text = doc.text;
  assert.match(text, /HOW DID IT KNOW\?/);
  assert.match(text, /SHOW HN APP/);
  assert.match(text, /FIRST RUN/);
  const how = doc.lines.findIndex((line) => line.kind === 'text' && line.invert && line.text === 'HOW DID IT KNOW?');
  const itemsHead = doc.lines.findIndex((line) => line.kind === 'text' && line.text.startsWith('ITEM'));
  assert.ok(how >= 0 && how < itemsHead);
});

test('the plain-text copy carries every item and the note', () => {
  const text = docText(receiptToDoc(RECEIPT).lines);
  assert.match(text, /SHORT: SHIPPED/);
  assert.match(text, /Proof over hype\./);
  assert.match(text, /\[barcode BZ000042\]/);
});
