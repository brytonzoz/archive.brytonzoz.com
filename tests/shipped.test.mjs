import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { SHIPPED_STATUSES, shippedCounts, toItems, yearGroups } from '../lib/shipped.ts';
import { GITHUB_USERNAME, chargesTotal, printedCounts } from '../lib/shipped-receipt.ts';
import { checkSponsorUrl, hasBlockedWord, priceCents, validateSponsor } from '../lib/shipped-sponsors.ts';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const DATA = read('../data/shipped/businesses.json');
const LOGOS = read('../lib/shipped-logos.json');
const ITEMS = toItems(DATA, LOGOS);

test('the master receipt prints every entry in the data, in its order', () => {
  assert.equal(ITEMS.length, DATA.meta.count);
  assert.equal(ITEMS.length, 35);
  assert.deepEqual(ITEMS.map((item) => item.name), DATA.entries.map((entry) => entry.name));
  assert.equal(new Set(ITEMS.map((item) => item.name)).size, ITEMS.length, 'names are unique (React keys)');
  const years = ITEMS.map((item) => item.start);
  const dated = years.filter((year) => year !== null);
  assert.deepEqual(dated, [...dated].sort((a, b) => a - b), 'timeline order');
  assert.ok(years.indexOf(null) === -1 || years.slice(years.indexOf(null)).every((year) => year === null), 'undated entries print last');
});

test('statuses match the data and the totals add up', () => {
  assert.deepEqual([...DATA.meta.statuses].sort(), [...SHIPPED_STATUSES].sort());
  const counts = shippedCounts(ITEMS);
  assert.equal(Object.values(counts.byStatus).reduce((a, b) => a + b, 0), counts.items);
  assert.deepEqual(
    { live: counts.byStatus.LIVE, active: counts.byStatus.ACTIVE, prototype: counts.byStatus.PROTOTYPE, hiatus: counts.byStatus.HIATUS, deceased: counts.byStatus.DECEASED },
    { live: 7, active: 5, prototype: 8, hiatus: 2, deceased: 13 },
  );
  assert.equal(counts.running, 12);
  assert.equal(counts.first, 2020);
  assert.equal(counts.last, 2026);
  assert.throws(() => toItems({ meta: DATA.meta, entries: [{ ...DATA.entries[0], status: 'RIP' }] }, LOGOS));
});

test('year dividers run 2020 to 2026, then UNDATED', () => {
  const groups = yearGroups(ITEMS);
  assert.deepEqual(groups.map((group) => group.label), ['2020', '2021', '2022', '2023', '2024', '2025', '2026', 'UNDATED']);
  assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), ITEMS.length);
});

test('links only where the data has a url, never for DECEASED, never GitHub', () => {
  DATA.entries.forEach((entry, index) => {
    const item = ITEMS[index];
    if (entry.status === 'DECEASED') {
      assert.equal(item.link, null, entry.name);
      assert.equal(item.appStore, null, entry.name);
    } else {
      assert.equal(Boolean(item.link), Boolean(entry.url), entry.name);
    }
    for (const href of [item.link?.href, item.appStore].filter(Boolean)) assert.equal(href.includes('github.com'), false, entry.name);
  });
  const site = ITEMS.find((item) => item.name === 'brytonzoz.com');
  assert.deepEqual(site.link, { href: '/', internal: true });
  assert.deepEqual(ITEMS.find((item) => item.name === 'NONPARALLEL v3').link, { href: '/nonparallel/', internal: true });
});

test('every logo in the data has a small dithered print in public/shipped/logos', () => {
  for (const entry of DATA.entries.filter((e) => e.logo)) {
    const logo = LOGOS[entry.logo];
    assert.ok(logo, entry.logo);
    assert.match(logo.src, /^\/shipped\/logos\/[a-z0-9-]+\.png$/);
    const file = new URL(`../public${logo.src}`, import.meta.url);
    assert.ok(fs.statSync(file).size < 4096, `${logo.src} stays tiny`);
    assert.ok(logo.width <= 72 && logo.height <= 28, logo.src);
  }
  assert.equal(ITEMS.filter((item) => item.logo).length, 15);
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
