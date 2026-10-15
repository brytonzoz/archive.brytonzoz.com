import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const upgrade = await import('../lib/shipped-upgrade.ts');
const xai = await import('../worker/shipped-xai.ts');

test('prices: $5 print, $3 full, $7 bundle', () => {
  assert.equal(upgrade.PRINT_PRICE_CENTS, 500);
  assert.equal(upgrade.FULL_PRICE_CENTS, 300);
  assert.equal(upgrade.BUNDLE_PRICE_CENTS, 700);
  assert.equal(upgrade.SALE_PRICE_CENTS.full, 300);
  assert.equal(upgrade.saleNeedsShipping('full'), false);
  assert.equal(upgrade.saleNeedsShipping('bundle'), true);
  assert.equal(upgrade.saleNeedsShipping('print'), true);
  assert.equal(upgrade.saleTriggersFull('full'), true);
  assert.equal(upgrade.saleTriggersFull('bundle'), true);
  assert.equal(upgrade.saleTriggersFull('print'), false);
  assert.equal(upgrade.FULL_SALE_ALLOWANCE_USD, 0.3);
});

test('Stripe pay kinds include full and bundle', async () => {
  assert.equal(upgrade.FULL_KIND, 'shipped_full');
  assert.equal(upgrade.BUNDLE_KIND, 'shipped_bundle');
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../worker/shipped-pay.ts', import.meta.url), 'utf8');
  assert.match(source, /FULL_KIND/);
  assert.match(source, /BUNDLE_KIND/);
  assert.match(source, /isPayKind/);
  assert.match(source, /payNeedsShipping/);
  assert.match(source, /shipped_full/);
  assert.match(source, /shipped_bundle/);
});

test('teaser never fakes a leftover count and stays off a complete tape', () => {
  assert.deepEqual(upgrade.upgradeOffer({ leftover: 0, leftoverKnown: false, capped: false, incomplete: false }), {
    offer: false,
    teaser: null,
    reason: null,
  });
  assert.deepEqual(upgrade.upgradeOffer({ leftover: 99, leftoverKnown: false, capped: true, incomplete: false }), {
    offer: true,
    teaser: '+ more ships likely found · run the full receipt $3',
    reason: 'capped',
  });
  const numbered = upgrade.upgradeOffer({ leftover: 4, leftoverKnown: true, capped: false, incomplete: true });
  assert.equal(numbered.offer, true);
  assert.equal(numbered.teaser, '+ 4 more ships likely found · run the full receipt $3');
  const fake = upgrade.upgradeOffer({ leftover: 12, leftoverKnown: false, capped: false, incomplete: true });
  assert.equal(fake.teaser?.includes('12'), false, 'unknown leftover must not print a number');
  assert.equal(upgrade.upgradeOffer({ full: true, leftover: 4, leftoverKnown: true, capped: true, incomplete: true }).offer, false);
});

test('paid deep pass uses ~40 posts and a $0.30 sale meter, not the free monthly cap', async () => {
  assert.equal(xai.XAI_DEEP_MAX_POSTS, 40);
  assert.ok(xai.xaiDeepMaxPosts({}) >= 40);
  assert.ok(xai.xaiMaxPosts({}) <= 10);
  const meter = xai.saleXaiMeter(0.3);
  assert.equal(await meter.allow(), true);
  await meter.record({ inputTokens: 0, outputTokens: 0, posts: 0, profiles: 0, web: 0, ticks: 0.3 * xai.XAI_TICKS_PER_USD, costMicros: 300_000 });
  assert.equal(await meter.allow(), false, 'sale meter closes at the $0.30 allowance');
});

test('thermal full stamp and wall FULL badge stay honest', async () => {
  const { receiptToDoc } = await import('../components/shipped/thermal/layout.ts');
  const doc = receiptToDoc({
    id: 'r9',
    year: 2026,
    who: 'Ada',
    date: '09 OCT 2026',
    number: '000009',
    items: [{ name: 'APP', status: 'LIVE', date: null, description: 'A ship.' }],
    count: 1,
    note: 'Note.',
    paidBy: ['HOUSE'],
    barcode: 'SH000009',
    full: true,
  });
  assert.match(doc.text, /VERIFIED FULL RUN/);
  assert.match(doc.text, /#000009 FULL/);
  const free = receiptToDoc({
    id: 'r10',
    year: 2026,
    who: 'Ada',
    date: '09 OCT 2026',
    number: '000010',
    items: [{ name: 'APP', status: 'LIVE', date: null, description: 'A ship.' }],
    count: 1,
    note: 'Note.',
    paidBy: ['HOUSE'],
    barcode: 'SH000010',
    teaser: '+ more ships likely found · run the full receipt $3',
  });
  assert.match(free.text, /more ships likely found/);
  assert.equal(free.text.includes('VERIFIED FULL RUN'), false);
});
