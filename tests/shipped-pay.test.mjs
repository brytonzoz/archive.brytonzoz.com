import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';

const { verifySignature } = await import('../worker/stripe-signature.ts');
const sponsors = await import('../lib/shipped-sponsors.ts');

const SECRET = 'whsec_test_secret';
const sign = (payload, t, secret = SECRET) => createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');

test('webhook signatures: valid passes; tampered, foreign, stale, or malformed ones fail', async () => {
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  const t = Math.floor(now / 1000);
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { amount_subtotal: 500 } } });
  assert.equal(await verifySignature(payload, `t=${t},v1=${sign(payload, t)}`, SECRET, now), true);
  assert.equal(await verifySignature(payload, `t=${t},v1=${'0'.repeat(64)},v1=${sign(payload, t)}`, SECRET, now), true, 'any v1 (secret rotation)');
  assert.equal(await verifySignature(payload.replace('500', '1'), `t=${t},v1=${sign(payload, t)}`, SECRET, now), false, 'tampered amount');
  assert.equal(await verifySignature(payload, `t=${t},v1=${sign(payload, t, 'whsec_other')}`, SECRET, now), false, 'signed by someone else');
  assert.equal(await verifySignature(payload, `t=${t - 301},v1=${sign(payload, t - 301)}`, SECRET, now), false, 'replayed after 5 minutes');
  assert.equal(await verifySignature(payload, `t=${t + 301},v1=${sign(payload, t + 301)}`, SECRET, now), false, 'from the future');
  assert.equal(await verifySignature(payload, `v1=${sign(payload, t)}`, SECRET, now), false, 'no timestamp');
  assert.equal(await verifySignature(payload, `t=${t},v0=${sign(payload, t)}`, SECRET, now), false, 'only v1 counts');
  assert.equal(await verifySignature(payload, '', SECRET, now), false);
  assert.equal(await verifySignature(payload, `t=${t},v1=${sign(payload, t)}`, '', now), false, 'no secret configured');
});

test('slot prices are fixed and set by the server: $1 for a house slot, holder + $1 after that', () => {
  assert.equal(sponsors.slotPrice(0), 100);
  assert.equal(sponsors.slotPrice(100), 200);
  assert.equal(sponsors.slotPrice(4_200), 4_300);
  assert.equal(sponsors.slotPrice(-500), 100, 'never below the floor');
  assert.equal(sponsors.SLOT_COUNT, 10);
});

test('floors rise with receipts printed; a house hero never sells below the current floor', () => {
  const floors = sponsors.floorsAt(sponsors.DEFAULT_LADDER, 0);
  assert.equal(floors.hero, 500);
  assert.equal(floors.slot, 100);
  assert.equal(sponsors.slotPrice(0, floors.hero), 500);
  assert.equal(sponsors.slotPrice(0, floors.slot), 100);
  const later = sponsors.floorsAt(sponsors.DEFAULT_LADDER, 250);
  assert.equal(later.hero, 2_500);
  assert.equal(later.slot, 300);
  assert.equal(sponsors.slotPrice(400, later.slot), 500, 'holder plus $1 still wins if it is above the floor');
  assert.equal(sponsors.parseLadder('nope'), null);
  assert.ok(sponsors.parseLadder(sponsors.DEFAULT_LADDER));
});

test('takeovers lock an hour before close; prorated refunds never exceed what was paid', () => {
  const close = Date.UTC(2026, 9, 26, 16);
  assert.equal(sponsors.takeoversOpen(close - 61 * 60_000, close), true);
  assert.equal(sponsors.takeoversOpen(close - 59 * 60_000, close), false);
  const live = close - 10 * 86_400_000;
  assert.equal(sponsors.proratedRefund(1000, live, live + 5 * 86_400_000, close), 500);
  assert.equal(sponsors.proratedRefund(1000, live, live, close), 1000);
  assert.equal(sponsors.proratedRefund(1000, live, close + 1, close), 0);
  assert.equal(sponsors.proratedRefund(1000, live, live - 1e9, close), 1000, 'never more than paid');
});

test('sponsor links: https, a real public domain of their own, no shorteners, redirects or lookalikes', () => {
  assert.deepEqual(sponsors.sponsorUrlProblem('acme.dev'), { url: 'https://acme.dev/' });
  assert.deepEqual(sponsors.sponsorUrlProblem('https://www.acme.dev/pricing#top'), { url: 'https://www.acme.dev/pricing' });
  assert.deepEqual(sponsors.sponsorUrlProblem('https://acme.dev./'), { url: 'https://acme.dev/' }, 'a trailing dot is not a different site');
  const cases = {
    'https://127.0.0.1.nip.io/': 'host',
    'https://10-0-0-1.sslip.io/': 'host',
    'https://bit.ly./abc': 'shortener',
    'http://acme.dev': 'https',
    'javascript:alert(1)': 'https',
    'data:text/html,<script>alert(1)</script>': 'format',
    'https://127.0.0.1/': 'host',
    'https://[::1]/': 'host',
    'https://localhost/': 'host',
    'https://user:pw@acme.dev': 'format',
    'https://acme.dev:8443': 'format',
    'https://bit.ly/abc': 'shortener',
    'https://linktr.ee/acme': 'shortener',
    'https://acme.xyz': 'risky',
    'https://abc.ngrok-free.app': 'risky',
    'https://acme.pages.dev': 'risky',
    'https://acme.dev/?redirect=https://evil.example': 'risky',
    'https://paypal-login.com': 'lookalike',
    'https://xn--pypal-4ve.com': 'lookalike',
    'https://stripe.secure-pay.co': 'lookalike',
  };
  for (const [url, problem] of Object.entries(cases)) assert.deepEqual(sponsors.sponsorUrlProblem(url), { problem }, url);
  assert.ok('url' in sponsors.sponsorUrlProblem('https://stripe.com/'), 'the brand itself is fine');
});

test('sponsor text: scam, giveaway, crypto, payment-company, link and slur wording is refused', () => {
  const base = { slot: 3, name: 'Acme', cta: 'Tools for makers.', url: 'https://acme.dev' };
  assert.equal(sponsors.validateBid(base).ok, true);
  const bad = [
    { name: 'Free BTC' },
    { cta: 'Claim your airdrop now' },
    { cta: 'Connect your wallet' },
    { cta: 'Verify your account' },
    { name: 'PayPal Support' },
    { cta: 'Visit acme.com today' },
    { cta: 'https://acme.dev' },
    { name: 'sh1t co' },
    { name: '<b>Acme</b>' },
    { name: 'A' },
    { name: 'X'.repeat(17) },
    { cta: 'Best online casino' },
    { url: 'https://bit.ly/x' },
    { url: 'https://free-crypto.dev' },
  ];
  for (const change of bad) assert.equal(sponsors.validateBid({ ...base, ...change }).ok, false, JSON.stringify(change));
  assert.equal(sponsors.validateBid({ ...base, slot: 0, name: 'X'.repeat(26) }).ok, true, 'the hero slot has room for longer names');
  const invisible = sponsors.validateBid({ ...base, name: 'Ac\u202eme\u200b' });
  assert.equal(invisible.ok && invisible.name, 'Acme', 'bidi and zero-width characters are stripped');
});
