import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryD1 } from './d1.mjs';
import { bundleWorker } from './lib/bundle-worker.mjs';

const origin = 'https://shipped.example.org';
const pending = [];
const ctx = { waitUntil: (promise) => pending.push(promise) };
const stateRequest = () => new Request(`${origin}/api/shipped/state`);

function assertEmpty(slot, index) {
  assert.equal(slot.slot, index);
  assert.equal(slot.house, true, 'legacy house flag denotes a vacant slot');
  for (const field of ['name', 'cta', 'url', 'qr']) assert.equal(slot[field], '', `${field} stays empty`);
  assert.equal(slot.logo, null);
  assert.equal(slot.cents, 0);
  assert.equal(slot.next, 100);
  assert.equal(slot.maxNext, 100);
  assert.equal(slot.serial, null);
}

test('actual Worker state opens every empty ad slot at $1 without invented advertisers or QR links', async () => {
  const worker = await bundleWorker('worker/shipped.ts');
  const response = await worker.handleShipped(stateRequest(), {}, ctx);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.sponsors.slots.length, 10);
  state.sponsors.slots.forEach(assertEmpty);
});

test('actual Worker preserves a paid holder, approved logo, price and QR destination while other slots stay empty', async () => {
  const worker = await bundleWorker('worker/shipped.ts');
  const DB = memoryD1();
  const env = { DB, SHIPPED_HOST: 'shipped.example.org' };
  // Run the real migrations before inserting local fixtures; no payment APIs are involved.
  await worker.qrRedirect(env, '9999', ctx);
  const now = Date.now() - 120_000;
  const insert = DB.raw.prepare(`INSERT INTO shipped_bids
    (id, slot, name, cta, url, amount_cents, status, provider, created_at, paid_at, live_at, logo_key, logo_ok, serial)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'stripe', ?, ?, ?, ?, ?, ?)`);
  insert.run(41, 4, 'REAL ADVERTISER', 'See the real product', 'https://example.org/product?source=receipt', 1000, 'live', now, now, now, 'logos/41.png', 1, 7);
  insert.run(42, 0, 'NOT PAID', 'Checkout is still open', 'https://example.org/checkout', 100, 'checkout', now, null, null, null, 0, null);
  insert.run(43, 5, 'REMOVED AD', 'Refunded advertisement', 'https://example.org/removed', 100, 'refunded', now, now, now, null, 0, 6);
  const before = DB.raw.prepare('SELECT * FROM shipped_bids ORDER BY id').all();
  const response = await worker.handleShipped(stateRequest(), env, ctx);
  const state = await response.json();
  assert.equal(state.sponsors.slots.length, 10);
  state.sponsors.slots.forEach((slot, index) => {
    if (index !== 4) assertEmpty(slot, index);
  });
  const paid = state.sponsors.slots[4];
  assert.equal(paid.house, false);
  assert.equal(paid.name, 'REAL ADVERTISER');
  assert.equal(paid.cta, 'See the real product');
  assert.equal(paid.url, 'https://example.org/product?source=receipt');
  assert.equal(paid.qr, '41');
  assert.equal(paid.logo, '/api/shipped/logo/41.png');
  assert.equal(paid.cents, 1000);
  assert.equal(paid.next, 1100);
  assert.equal(paid.maxNext, 1500);
  assert.equal(paid.since, now);
  assert.equal(paid.serial, 7);
  assert.deepEqual(DB.raw.prepare('SELECT * FROM shipped_bids ORDER BY id').all(), before, 'reading inventory does not change paid or pending bids');
  const redirect = await worker.qrRedirect(env, paid.qr, ctx);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), paid.url);
  await Promise.all(pending.splice(0));
  assert.equal(DB.raw.prepare('SELECT scans FROM shipped_bids WHERE id=41').get().scans, 1);
});

test('printed legacy house QR links lead to the ad board without promoting an invented advertiser', async () => {
  const worker = await bundleWorker('worker/shipped.ts');
  for (let slot = 0; slot < 10; slot += 1) {
    const response = await worker.qrRedirect({ SHIPPED_HOST: 'shipped.example.org' }, `h${slot}`, ctx);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `${origin}/#board`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
