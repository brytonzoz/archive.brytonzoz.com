import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const curate = await import('../worker/shipped-curate.ts');
const polish = await import('../worker/shipped-polish.ts');
const year = await import('../lib/shipped-year.ts');

const found = (item) => ({
  description: '',
  date: '2026-03-01',
  link: 'https://example.com/ship',
  source: 'changelog',
  status: 'LAUNCHED',
  score: 7,
  thisYear: true,
  icon: null,
  ...item,
});

test('packCandidates keeps cheap filters and assigns stable ids', () => {
  const packed = curate.packCandidates(
    [
      found({ name: 'Composer 2', date: '2026-03-19', link: 'https://cursor.com/blog/composer-2' }),
      found({ name: 'eslint-plugin-vue@10.7.0-canary.1', date: '2026-04-01', link: 'https://www.npmjs.com/package/eslint-plugin-vue' }),
      found({ name: '### Minor Changes', date: '2026-05-01', link: 'https://github.com/vuejs/core/releases/10', description: '### Minor Changes - 17ee736' }),
    ],
    2026,
  );
  assert.ok(packed.some((row) => row.id === 'c0' && row.raw_title === 'Composer 2'));
  assert.equal(packed.some((row) => /canary/i.test(row.raw_title)), false);
  const minor = packed.find((row) => /minor/i.test(row.raw_title));
  assert.ok(minor);
  assert.equal(minor.short_desc.includes('###'), false);
});

test('applyCuration keeps owned ids, rewrites titles, and rolls up groups', () => {
  const packed = curate.packCandidates(
    [
      found({ name: 'eslint-plugin-vue 10.7', date: '2026-04-01', link: 'https://www.npmjs.com/package/eslint-plugin-vue/10.7' }),
      found({ name: 'eslint-plugin-vue 10.8', date: '2026-04-08', link: 'https://www.npmjs.com/package/eslint-plugin-vue/10.8' }),
      found({ name: 'eslint-plugin-vue 10.11', date: '2026-04-20', link: 'https://www.npmjs.com/package/eslint-plugin-vue/10.11' }),
      found({ name: 'Vite 8', date: '2026-03-02', link: 'https://vite.dev/blog/announcing-vite8' }),
      found({ name: 'Vercel blog post', date: '2026-06-01', link: 'https://vercel.com/blog/something' }),
    ],
    2026,
  );
  const byTitle = Object.fromEntries(packed.map((row) => [row.raw_title, row.id]));
  const tape = curate.applyCuration(
    {
      items: [
        { id: byTitle['eslint-plugin-vue 10.7'], title: 'ESLint plugin Vue', group: 'VUE · 3 UPDATES IN APR', owned: true, significance: 1 },
        { id: byTitle['eslint-plugin-vue 10.8'], title: 'ESLint plugin Vue', group: 'VUE · 3 UPDATES IN APR', owned: true, significance: 1 },
        { id: byTitle['eslint-plugin-vue 10.11'], title: 'ESLint plugin Vue', group: 'VUE · 3 UPDATES IN APR', owned: true, significance: 1 },
        { id: byTitle['Vite 8'], title: 'Vite 8', group: null, owned: true, significance: 3 },
        { id: byTitle['Vercel blog post'], title: 'Vercel blog post', group: null, owned: false, significance: 1 },
      ],
      notes: ['Vite 8 is the one that changed the compile.', 'Vue spent April on the linter.', 'A quiet year except for Vite 8.'],
    },
    packed,
  );
  assert.ok(tape);
  const names = tape.items.map((item) => item.name);
  assert.ok(names.some((name) => /vite 8/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /vue/i.test(name) && /3 updates/i.test(name)), JSON.stringify(names));
  assert.equal(names.some((name) => /vercel blog/i.test(name)), false);
  assert.equal(tape.items.length, 2);
  assert.equal(tape.notes.length, 3);
});

test('applyCuration fails closed on unknown ids or cut titles from a fat harvest', () => {
  const packed = curate.packCandidates(
    Array.from({ length: 8 }, (_, i) => found({ name: `Ship ${i}`, date: `2026-03-0${(i % 8) + 1}`, link: `https://example.com/s${i}` })),
    2026,
  );
  assert.equal(curate.applyCuration({ items: [{ id: 'nope', title: 'X', owned: true, significance: 2 }], notes: [] }, packed), null);
  const cut = curate.applyCuration(
    {
      items: packed.map((row) => ({ id: row.id, title: 'Commission analytics you can', owned: true, significance: 2 })),
      notes: [],
    },
    packed,
  );
  assert.equal(cut, null);
});

test('wall count equals every real stored line', () => {
  const items = [
    { name: 'VITE 8', source: 'changelog', significance: 3 },
    { name: 'MINOR FIX FOR LOGIN', source: 'changelog', significance: 0 },
    { name: 'YOUR POTENTIAL', source: 'none', significance: 0 },
  ];
  const receipt = { items, potential: false };
  assert.equal(year.itemsShipped(receipt), 2);
  assert.equal(year.realReceiptItems(items).length, year.itemsShipped(receipt));
  const groups = year.groupItemsBySignificance(year.realReceiptItems(items));
  assert.equal(groups.reduce((n, group) => n + group.items.length, 0), 2);
});

test('title sanity is the only post-LLM title check', () => {
  assert.equal(polish.titleSanityOk('Composer 2'), true);
  assert.equal(polish.titleSanityOk('Commission analytics you can'), false);
  assert.equal(polish.titleSanityOk('Teams &'), false);
  assert.equal(polish.titleSanityOk('### Minor Changes'), false);
});
