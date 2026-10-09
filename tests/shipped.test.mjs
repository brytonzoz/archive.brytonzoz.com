import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { SHIPPED_STATUSES, shippedCounts, toItems, yearGroups } from '../lib/shipped.ts';
import { isGithubLogin, itemDate, itemsShipped, readQuery, receiptPageTitle, shareText, shippedYear, subjectKey, subjectLabel } from '../lib/shipped-year.ts';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const DATA = read('../data/shipped/businesses.json');
const LOGOS = read('../lib/shipped-logos.json');
const ITEMS = toItems(DATA, LOGOS);

test('the master receipt prints every entry in the data, in its order', () => {
  assert.equal(ITEMS.length, DATA.meta.count);
  assert.equal(ITEMS.length, 34);
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
    { live: 7, active: 5, prototype: 8, hiatus: 2, deceased: 12 },
  );
  assert.equal(counts.running, 12);
  assert.equal(counts.first, 2020);
  assert.equal(counts.last, 2026);
  assert.throws(() => toItems({ meta: DATA.meta, entries: [{ ...DATA.entries[0], status: 'RIP' }] }, LOGOS));
});

test('year dividers run 2020 to 2026', () => {
  const groups = yearGroups(ITEMS);
  assert.deepEqual(groups.map((group) => group.label), ['2020', '2021', '2022', '2023', '2024', '2025', '2026']);
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
  assert.equal(ITEMS.some((item) => item.name === 'Phyra'), false, 'Phyra is part of Physiquify');
  assert.equal(ITEMS.find((item) => item.name === 'Physiquify').logo.src, '/shipped/logos/phyra.png');
});

test('GitHub usernames follow GitHub rules', () => {
  for (const ok of ['octocat', 'a', 'brytonzoz', 'a-b-c', 'X'.repeat(39)]) assert.ok(isGithubLogin(ok), ok);
  for (const bad of ['', '-a', 'a-', 'a--b', 'a_b', 'a.b', '../etc', 'X'.repeat(40), 'a b', 'ünï']) assert.equal(isGithubLogin(bad), false, bad);
});

test('one field reads as a domain, a handle or a name', () => {
  assert.deepEqual(readQuery('levelsio'), { kind: 'handle', value: 'levelsio' });
  assert.deepEqual(readQuery('@rauchg'), { kind: 'handle', value: 'rauchg' });
  assert.deepEqual(readQuery('https://x.com/levelsio'), { kind: 'handle', value: 'levelsio' });
  assert.deepEqual(readQuery('twitter.com/@rauchg/'), { kind: 'handle', value: 'rauchg' });
  assert.deepEqual(readQuery('github.com/torvalds'), { kind: 'handle', value: 'torvalds' });
  assert.deepEqual(readQuery('https://www.Mopkin.app/about'), { kind: 'domain', value: 'mopkin.app' });
  assert.deepEqual(readQuery('getpocketfactory.com'), { kind: 'domain', value: 'getpocketfactory.com' });
  assert.deepEqual(readQuery('  Pieter   Levels '), { kind: 'name', value: 'Pieter Levels' });
  assert.deepEqual(readQuery('José Martí'), { kind: 'name', value: 'José Martí' });
  for (const bad of ['', 'a', 'x'.repeat(81), '<script>', 'a@b.com', 'rm -rf /']) assert.equal(readQuery(bad), null, bad);
});

test('subjects key the 7-day cache and takedowns whatever the case', () => {
  assert.equal(subjectKey({ kind: 'github', id: 'RauchG' }), subjectKey({ kind: 'github', id: 'rauchg' }));
  assert.notEqual(subjectKey({ kind: 'github', id: 'rauchg' }), subjectKey({ kind: 'x', id: 'rauchg' }));
  assert.equal(subjectLabel({ kind: 'x', id: 'levelsio', display: 'Pieter' }), '@levelsio');
  assert.equal(subjectLabel({ kind: 'domain', id: 'mopkin.app', display: 'mopkin.app' }), 'mopkin.app');
});

test('item dates and the share text', () => {
  assert.equal(itemDate('2026-03-14'), 'MAR 14');
  assert.equal(itemDate('2026-11'), 'NOV 2026');
  assert.equal(itemDate(null), null);
  assert.equal(itemDate('soon'), null);
  const receipt = { year: 2026, potential: false, subject: { kind: 'x', id: 'levelsio', display: '@levelsio' }, items: [{}, {}, {}] };
  assert.equal(shareText(receipt), 'I shipped 3 things in 2026. Receipt attached.');
  assert.doesNotMatch(shareText(receipt), /@/, 'sharing never tags the person on the receipt');
  assert.equal(itemsShipped({ ...receipt, potential: true, items: [{}] }), 1);
  assert.match(shareText({ ...receipt, potential: true, items: [{}] }), /potential/);
  assert.equal(receiptPageTitle(receipt), '@levelsio shipped 3 things in 2026 | Shipped');
  assert.equal(receiptPageTitle({ ...receipt, potential: true, items: [{}] }), '@levelsio: shipped in 2026 (potential) | Shipped');
});

test('the year is configurable and falls back to this year', () => {
  assert.equal(shippedYear('2025'), 2025);
  assert.equal(shippedYear(undefined), new Date().getUTCFullYear());
  assert.equal(shippedYear('banana'), new Date().getUTCFullYear());
  const RealDate = Date;
  class EpochDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(0);
      else super(...args);
    }
    static now() {
      return 0;
    }
  }
  globalThis.Date = EpochDate;
  try {
    assert.equal(shippedYear(undefined), 2026);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('the receipt feed reveals the header first, never the footer', async () => {
  const { feedFrames } = await import('../components/shipped/physics.ts');
  const { frames } = feedFrames(180, 'seed', 0.8);
  assert.match(frames[0].clipPath, /inset\(0 0 180px 0\)/);
  assert.match(frames[frames.length - 1].clipPath, /inset\(0 0 0px 0\)/);
  let hidden = 180;
  for (const frame of frames) {
    const n = Number(/inset\(0 0 (\d+)px 0\)/.exec(frame.clipPath)?.[1]);
    assert.ok(Number.isFinite(n) && n <= hidden, frame.clipPath);
    hidden = n;
  }
  assert.equal(hidden, 0);
});

test('share pages fill a placeholder instead of appending head scripts', () => {
  const page = fs.readFileSync(new URL('../app/shipped/r/page.tsx', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../worker/shipped.ts', import.meta.url), 'utf8');
  assert.match(page, /id="shipped-receipt-data"/);
  assert.match(worker, /#shipped-receipt-data/);
  assert.match(worker, /isShareBot/);
  assert.equal(worker.includes("el.append(`<script>window.__SHIPPED_RECEIPT__"), false);
});

test('the printer mouth and receipt sponsor cells do not share a class (absolute slot must not stack ads on the header)', () => {
  const machine = fs.readFileSync(new URL('../components/shipped/Machine.tsx', import.meta.url), 'utf8');
  const year = fs.readFileSync(new URL('../components/shipped/YearReceipt.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../app/shipped/receipt.css', import.meta.url), 'utf8');
  assert.match(machine, /shipped-aperture/);
  assert.match(machine, /webkitClipPath/);
  assert.equal(machine.includes('className="shipped-slot"'), false);
  assert.match(year, /className="shipped-slot"/);
  assert.match(css, /\.shipped-aperture\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.shipped-receipt\s*>\s*\*\s*\{[^}]*position:\s*relative/s);
  const mouth = css.match(/\.shipped-slot\s*\{[^}]+\}/g) ?? [];
  for (const block of mouth) {
    assert.equal(/position:\s*absolute/.test(block), false, block);
    assert.match(block, /position:\s*relative/);
  }
});
