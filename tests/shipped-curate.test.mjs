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

test('applyCuration skips unknown ids and fails closed on cut titles from a fat harvest', () => {
  const packed = curate.packCandidates(
    Array.from({ length: 8 }, (_, i) => found({ name: `Ship ${i}`, date: `2026-03-0${(i % 8) + 1}`, link: `https://example.com/s${i}` })),
    2026,
  );
  assert.equal(curate.applyCuration({ items: [{ id: 'nope', title: 'X', owned: true, significance: 2 }], notes: [] }, packed), null);
  const mixed = curate.applyCuration(
    {
      items: [
        { id: 'nope', title: 'Ghost', owned: true, significance: 2 },
        { id: packed[0].id, title: 'Ship 0', owned: true, significance: 2 },
      ],
      notes: ['Ship 0 stayed.', 'The ghost id was ignored.', 'Still a real tape.'],
    },
    packed,
  );
  assert.ok(mixed);
  assert.equal(mixed.items.some((item) => /ship 0/i.test(item.name)), true);
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
  assert.equal(polish.titleSanityOk("I've been coding almost solely on my VPS with Claude"), false);
  assert.equal(polish.titleSanityOk('@dub/embed-react'), false);
  assert.equal(polish.titleSanityOk("What's new in Svelte: January 2026"), false);
  assert.equal(polish.titleSanityOk('Dub vs Tolt:'), false);
  assert.equal(polish.looksLikeEssayTitle('Rimowa suitcase broke after Copenhagen to Lisbon flight and then some more'), true);
  assert.equal(polish.looksLikeEssayTitle('We launched AI Gateway'), false);
  assert.equal(polish.titleSanityOk('We launched AI Gateway'), false);
  assert.equal(polish.titleSanityOk('WE BUILT EMOJI SEARCH'), false);
  assert.equal(polish.titleSanityOk('AI Gateway'), true);
});

test('harvest wins when Claude keeps a highlight reel of a fat company tape', () => {
  assert.equal(curate.harvestShouldWin(38, 3, 'lead', 'OpenAI'), true);
  assert.equal(curate.harvestShouldWin(40, 1, 'lead', 'OpenAI', 8), true);
  assert.equal(curate.harvestShouldWin(96, 18, 'ceo', 'Cursor'), true);
  assert.equal(curate.harvestShouldWin(95, 26, 'ceo', 'Cursor'), true);
  assert.equal(curate.harvestShouldWin(96, 42, 'ceo', 'Cursor'), false);
  assert.equal(curate.harvestShouldWin(171, 60, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(193, 3, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(193, 11, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(193, 31, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(60, 8, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(38, 32, 'lead', 'OpenAI'), true);
  assert.equal(curate.harvestShouldWin(38, 36, 'lead', 'OpenAI'), false);
  assert.equal(curate.harvestShouldWin(9, 3, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(118, 5, 'ceo', 'Remote OK', 8), false);
  assert.equal(curate.harvestShouldWin(101, 15, 'lead', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(14, 8, null), false);
  assert.equal(curate.harvestShouldWin(16, 2, null), false);
  assert.equal(curate.harvestShouldWin(13, 4, null), false);
  assert.equal(curate.harvestShouldWin(8, 5, null), false);
  assert.equal(curate.harvestShouldWin(20, 16, null), false);
  assert.equal(curate.harvestShouldWin(101, 9, null, null, 90), false);
  assert.equal(curate.harvestShouldWin(97, 18, 'founder', 'VoidZero'), false);
  assert.equal(curate.harvestShouldWin(101, 15, null, null, 100), false);
  assert.equal(curate.harvestShouldWin(16, 1, null, null, 16, { ossHeavy: true }), true);
  assert.equal(curate.harvestShouldWin(16, 16, null, null, 16, { ossHeavy: true }), false);
  assert.equal(curate.harvestShouldWin(13, 4, null, null, 13, { ossHeavy: true }), true);
  assert.equal(curate.harvestShouldWin(20, 16, null, null, 20, { ossHeavy: true }), false);
  assert.equal(curate.harvestLooksLikeOssTape([
    { name: 'Bun 1.4', kind: 'oss-release' },
    { name: 'Bun 1.3.6', kind: 'oss-release' },
    { name: 'Bun · 3 RELEASES IN JAN', kind: 'oss-release' },
    { name: 'Bun 1.3.11', kind: 'oss-release' },
    { name: 'Bun · 2 RELEASES IN FEB', kind: 'oss-release' },
    { name: 'Bun 1.3.14', kind: 'oss-release' },
    { name: 'Bun · 2 RELEASES IN APR', kind: 'oss-release' },
    { name: 'Bun 1.4.3', kind: 'oss-release' },
    { name: 'Bun · 2 RELEASES IN SEP', kind: 'oss-release' },
    { name: 'Bun 1.3.8', kind: 'oss-release' },
  ]), true);
  assert.equal(curate.harvestLooksLikeOssTape([
    { name: 'I flew to Lisbon', kind: 'post' },
    { name: 'Best tools 2026', kind: 'post' },
    { name: 'A thread', kind: 'post' },
  ]), false);
});

test('rollup keeps an existing monthly RELEASES IN label', () => {
  const packed = curate.packCandidates(
    [
      found({ name: 'Bun 1.3.6', date: '2026-01-08', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.6' }),
      found({ name: 'Bun 1.3.7', date: '2026-01-15', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.7' }),
      found({ name: 'Bun 1.3.8', date: '2026-01-22', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.8' }),
    ],
    2026,
  );
  const tape = curate.applyCuration(
    {
      items: packed.map((row) => ({
        id: row.id,
        title: 'Bun',
        group: 'BUN · 3 RELEASES IN JAN',
        owned: true,
        significance: 1,
      })),
      notes: ['Bun kept shipping in January.'],
    },
    packed,
  );
  assert.ok(tape);
  assert.deepEqual(
    tape.items.map((item) => item.name),
    ['BUN · 3 RELEASES IN JAN'],
  );
});
