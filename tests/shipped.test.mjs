import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHIPPED_ITEMS, SHIPPED_STATUSES, chronological, shippedCounts, yearSpan } from '../lib/shipped.ts';
import { GITHUB_USERNAME, chargesTotal, printedCounts } from '../lib/shipped-receipt.ts';
import { checkSponsorUrl, hasBlockedWord, priceCents, validateSponsor } from '../lib/shipped-sponsors.ts';

test('shipped receipt counts only real line items', () => {
  const counts = shippedCounts();
  assert.equal(counts.items, SHIPPED_ITEMS.length);
  assert.equal(Object.values(counts.byStatus).reduce((a, b) => a + b, 0), counts.items);
  assert.equal(counts.live, 5);
  assert.equal(counts.byStatus.PROTOTYPE, 2);
});

test('every item has a known status and a sane year span', () => {
  for (const item of SHIPPED_ITEMS) {
    assert.ok(SHIPPED_STATUSES.includes(item.status), item.name);
    assert.ok(item.start >= 2000 && item.start <= 2100, item.name);
    if (item.end !== undefined) assert.ok(item.end >= item.start, item.name);
  }
  assert.equal(yearSpan({ start: 2019, end: 2022 }), '2019–2022');
  assert.equal(yearSpan({ start: 2024, end: 2024 }), '2024');
  assert.equal(yearSpan({ start: 2025 }), '2025–');
});

test('the master receipt is chronological', () => {
  const years = chronological().map((item) => item.start);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
});

test('prototypes have no live links and are flagged for Bryton to confirm', () => {
  const prototypes = SHIPPED_ITEMS.filter((item) => item.status === 'PROTOTYPE');
  assert.deepEqual(prototypes.map((item) => item.name).sort(), ['LiveCaps', 'WellnessBuddy']);
  for (const item of prototypes) {
    assert.equal(item.links?.length ?? 0, 0);
    assert.equal(item.confirmStatus, true);
  }
});

test('live products point at public URLs, not GitHub', () => {
  for (const item of SHIPPED_ITEMS.filter((entry) => entry.status === 'LIVE')) {
    assert.ok(item.links?.length, `${item.name} needs a live link`);
    for (const link of item.links) assert.equal(link.href.includes('github.com'), false, `${item.name} must not link GitHub`);
  }
});

test('GitHub usernames follow GitHub rules', () => {
  for (const ok of ['octocat', 'a', 'brytonzoz', 'a-b-c', 'X'.repeat(39)]) assert.ok(GITHUB_USERNAME.test(ok), ok);
  for (const bad of ['', '-a', 'a-', 'a--b', 'a_b', 'a.b', '../etc', 'X'.repeat(40), 'a b', 'ünï']) assert.equal(GITHUB_USERNAME.test(bad), false, bad);
});

test('printed receipt tallies', () => {
  const receipt = {
    items: [{ status: 'SHIPPED' }, { status: 'SHIPPED' }, { status: 'ABANDONED' }, { status: 'IN PROGRESS' }],
    charges: [{ cents: 450 }, { cents: 1299 }],
  };
  assert.deepEqual(printedCounts(receipt), { shipped: 2, inProgress: 1, abandoned: 1 });
  assert.equal(chargesTotal(receipt), 1749);
});

test('sponsor prices step up per roll in whole dollars', () => {
  assert.equal(priceCents('name', 1), 500);
  assert.equal(priceCents('logo', 1), 2500);
  assert.equal(priceCents('header', 1), 10000);
  assert.equal(priceCents('name', 2), 600);
  assert.ok(priceCents('name', 3) > priceCents('name', 2));
  for (const roll of [1, 2, 5, 10]) assert.equal(priceCents('logo', roll) % 100, 0);
});

test('name lines reject links and profanity, keep normal names', () => {
  assert.equal(validateSponsor({ tier: 'name', text: '  Ada   Lovelace ' }).ok, true);
  assert.equal(validateSponsor({ tier: 'name', text: 'Ada Lovelace' }).text, 'Ada Lovelace');
  assert.equal(validateSponsor({ tier: 'name', text: 'Alfred Hitchcock' }).ok, true);
  assert.equal(validateSponsor({ tier: 'name', text: 'Spice Co' }).ok, true);
  for (const text of ['visit example.com', 'https://x.y', 'www.site', 'buy at shop(dot)io', 'f u c k', 'sh1t happens', 'a', 'x'.repeat(33), '<b>hi</b>']) {
    assert.equal(validateSponsor({ tier: 'name', text }).ok, false, text);
  }
});

test('logo and header links must be public https', () => {
  assert.equal(validateSponsor({ tier: 'logo', text: 'Acme', url: 'https://acme.dev/' }).url, 'https://acme.dev/');
  assert.equal(validateSponsor({ tier: 'name', text: 'Acme', url: 'https://acme.dev/' }).url, null);
  for (const url of ['http://acme.dev', 'javascript:alert(1)', 'https://localhost', 'https://127.0.0.1', 'https://user:pw@acme.dev', 'https://acme.dev:8080']) {
    assert.equal(checkSponsorUrl(url), null, url);
  }
  assert.equal(hasBlockedWord('Peacock Studio'), false);
});
