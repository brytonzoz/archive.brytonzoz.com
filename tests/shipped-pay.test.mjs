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

test('slot bids are whole dollars: $1 on a house ad, then +$1 up to +max($5, 10% of current)', () => {
  assert.deepEqual(sponsors.bidRange(0), { min: 100, max: 100 });
  assert.equal(sponsors.slotPrice(0), 100);
  assert.deepEqual(sponsors.bidRange(100), { min: 200, max: 600 }, '$1 holder → +$1 to +$5');
  assert.deepEqual(sponsors.bidRange(1_000), { min: 1_100, max: 1_500 }, '$10 holder → +$5');
  assert.deepEqual(sponsors.bidRange(10_000), { min: 10_100, max: 11_000 }, '$100 holder → +$10');
  assert.deepEqual(sponsors.bidRange(4_200), { min: 4_300, max: 4_700 });
  assert.equal(sponsors.isValidBid(0, 100), true);
  assert.equal(sponsors.isValidBid(0, 200), false, 'house ads only take $1');
  assert.equal(sponsors.isValidBid(10_000, 10_050), false, 'whole dollars only');
  assert.equal(sponsors.isValidBid(10_000, 10_100), true);
  assert.equal(sponsors.isValidBid(10_000, 11_000), true);
  assert.equal(sponsors.isValidBid(10_000, 11_100), false, 'above the max raise');
  assert.equal(sponsors.isValidBid(10_000, 10_000), false, 'must raise');
  assert.equal(sponsors.slotPrice(-500), 100, 'junk current still opens at $1');
  assert.equal(sponsors.SLOT_COUNT, 10);
});

test('Shipped names itself in metadata, never Bryton Zoz', async () => {
  const brand = await import('../lib/shipped-brand.ts');
  for (const value of [brand.SHIPPED_APP_TITLE, brand.SHIPPED_TITLE, brand.SHIPPED_DESCRIPTION, brand.SHIPPED_MANIFEST_NAME, brand.SHIPPED_MANIFEST_SHORT]) {
    assert.equal(/bryton/i.test(value), false, value);
  }
});

test('there is no floor ladder: a house hero and a small slot both open at $1', () => {
  assert.equal(sponsors.slotPrice(0), 100);
  assert.equal(sponsors.maximumBid(0), 100);
  assert.equal('DEFAULT_LADDER' in sponsors, false);
  assert.equal('parseLadder' in sponsors, false);
});

test('ticker interpolation never shows more than the confirmed count', async () => {
  const { stepCount } = await import('../lib/shipped-ticker.ts');
  assert.equal(stepCount(0, 0, 1), 0);
  assert.equal(stepCount(12, 10, 1), 10, 'drops to the confirmed number, never stays high');
  let n = 0;
  for (let i = 0; i < 40; i++) n = stepCount(n, 100, 0.016);
  assert.ok(n <= 100, n);
  assert.ok(n > 0, 'moves toward the target');
  assert.equal(stepCount(99.99, 100, 1), 100);
});

test('takeovers stay open until that slot closes; prorated refunds never exceed what was paid', () => {
  const close = Date.UTC(2026, 9, 26, 16);
  assert.equal(sponsors.takeoversOpen(close - 1, close), true);
  assert.equal(sponsors.takeoversOpen(close, close), false);
  const live = close - 10 * 86_400_000;
  assert.equal(sponsors.proratedRefund(1000, live, live + 5 * 86_400_000, close), 500);
  assert.equal(sponsors.proratedRefund(1000, live, live, close), 1000);
  assert.equal(sponsors.proratedRefund(1000, live, close + 1, close), 0);
  assert.equal(sponsors.proratedRefund(1000, live, live - 1e9, close), 1000, 'never more than paid');
});

test('bidding guardrails: same holder, per-slot cooldown, 10-minute anti-snipe, SPONSOR #001', () => {
  assert.equal(sponsors.sameHolder('Ada@example.com', 'ada@example.com'), true);
  assert.equal(sponsors.sameHolder('ada@example.com', 'other@example.com'), false);
  assert.equal(sponsors.sameHolder('', ''), false);
  assert.equal(sponsors.sameHolder(null, 'ada@example.com'), false);

  const live = Date.UTC(2026, 9, 20, 12);
  assert.equal(sponsors.slotCooling(live, live + 59_000), true);
  assert.equal(sponsors.slotCooling(live, live + 60_000), false);
  assert.equal(sponsors.slotCooling(null, live), false);
  assert.equal(sponsors.cooldownUntil(live), live + sponsors.BID_RULES.cooldownSeconds * 1000);

  const close = Date.UTC(2026, 9, 26, 16);
  assert.equal(sponsors.inAntiSnipeWindow(close - 10 * 60_000, close), true);
  assert.equal(sponsors.inAntiSnipeWindow(close - 10 * 60_000 + 1, close), true);
  assert.equal(sponsors.inAntiSnipeWindow(close - 11 * 60_000, close), false);
  assert.equal(sponsors.inAntiSnipeWindow(close, close), false);
  assert.equal(sponsors.extendClose(close), close + 10 * 60_000);
  assert.equal(sponsors.takeoversOpen(close - 1, close), true);
  assert.equal(sponsors.takeoversOpen(close, close), false);

  assert.equal(sponsors.sponsorTag(1), 'SPONSOR #001');
  assert.equal(sponsors.sponsorTag(42), 'SPONSOR #042');
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
