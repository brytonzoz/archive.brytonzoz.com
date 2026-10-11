import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const curate = await import('../worker/shipped-curate.ts');
const polish = await import('../worker/shipped-polish.ts');
const year = await import('../lib/shipped-year.ts');
const sources = await import('../worker/shipped-sources.ts');

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
  assert.equal(polish.titleSanityOk('Find deployments faster with redesigned filters now live'), false);
});

test('harvest wins when Claude keeps a highlight reel of a fat company tape', () => {
  assert.equal(curate.harvestShouldWin(38, 3, 'lead', 'OpenAI'), true);
  assert.equal(curate.harvestShouldWin(40, 1, 'lead', 'OpenAI', 8), true);
  assert.equal(curate.harvestShouldWin(96, 18, 'ceo', 'Cursor'), true);
  assert.equal(curate.harvestShouldWin(95, 26, 'ceo', 'Cursor'), true);
  assert.equal(curate.harvestShouldWin(96, 42, 'ceo', 'Cursor'), false);
  assert.equal(curate.harvestShouldWin(171, 60, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(193, 3, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(193, 11, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(193, 31, 'ceo', 'Vercel'), false);
  assert.equal(curate.harvestShouldWin(60, 8, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(15, 15, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(20, 15, 'ceo', 'Vercel'), true);
  assert.equal(curate.harvestShouldWin(60, 31, 'ceo', 'Vercel'), false);
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
  assert.equal(curate.harvestLooksLikeOssTape([
    { name: 'DUB TS 0.70' },
    { name: 'DUB GO 0.23' },
    { name: 'DUB PYTHON 0.34' },
    { name: 'DUB TS 0.71' },
    { name: 'DUB GO 0.24' },
    { name: 'DUB PYTHON 0.35' },
    { name: 'DUB PHP 0.15' },
    { name: 'DUB RUBY 0.12' },
    { name: 'DUB TS 0.72' },
    { name: 'DUB GO 0.25' },
  ]), false);
  const bunPlusEssays = [
    { name: 'Bun 1.4', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0' },
    { name: 'Bun 1.3.6', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.6' },
    { name: 'Bun · 3 RELEASES IN JAN', kind: 'oss-release' },
    { name: 'Bun 1.3.11', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.11' },
    { name: 'Bun · 2 RELEASES IN FEB', kind: 'oss-release' },
    { name: 'Bun 1.3.14', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14' },
    { name: 'Bun · 2 RELEASES IN APR', kind: 'oss-release' },
    { name: 'Bun 1.4.3', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3' },
    { name: 'Bun · 2 RELEASES IN SEP', kind: 'oss-release' },
    { name: 'Bun 1.3.8', kind: 'oss-release', link: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.3.8' },
    { name: "Brazil's CPF catch-22 makes booking hotels impossible" },
    { name: 'Tech insiders avoid touchscreens and smart homes because' },
    { name: 'Europeans are all captivated by the mind virus' },
    { name: 'Winning my first big Stripe dispute in a decade' },
    { name: 'Leiden might be the best Dutch city to visit instead' },
    { name: 'Hotel in the Netherlands sets AC minimum at 23' },
    { name: 'Luxury products are really just meant for poor people' },
    { name: 'Ignoring mind viruses leads to a slippery slope' },
  ];
  assert.equal(curate.harvestLooksLikeOssTape(bunPlusEssays), true);
  assert.equal(curate.harvestLooksLikeCommentaryTape(bunPlusEssays), false);
  assert.ok(sources.OSS_TIMEOUT_MS >= 28_000);
  assert.equal(curate.harvestLooksLikeCommentaryTape([
    { name: "Brazil's CPF catch-22 makes booking hotels impossible" },
    { name: 'Tech insiders avoid touchscreens and smart homes because' },
    { name: 'Europeans are all captivated by the mind virus' },
    { name: 'Winning my first big Stripe dispute in a decade' },
    { name: 'Leiden might be the best Dutch city to visit instead' },
    { name: 'Hotel in the Netherlands sets AC minimum at 23' },
    { name: 'Luxury products are really just meant for poor people' },
    { name: 'Ignoring mind viruses leads to a slippery slope' },
  ]), true);
  assert.equal(curate.harvestLooksLikeCommentaryTape([
    { name: 'Bun 1.4', kind: 'oss-release' },
    { name: 'Bun 1.3.6', kind: 'oss-release' },
    { name: 'Vite 8' },
    { name: 'Vue 3.5.27' },
  ]), false);
  const svelteRecaps = [
    { name: "What's new in Svelte: January 2026", kind: 'oss-blog', link: 'https://svelte.dev/blog/whats-new-in-svelte-january-2026' },
    { name: "What's new in Svelte: February 2026", kind: 'oss-blog', link: 'https://svelte.dev/blog/whats-new-in-svelte-february-2026' },
    { name: 'Svelte 5.29', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.29.0' },
    { name: 'Svelte 5.30', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.30.0' },
    { name: 'SvelteKit 2.49', kind: 'oss-release', link: 'https://github.com/sveltejs/kit/releases/tag/2.49.0' },
    { name: 'Svelte 5.31', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.31.0' },
    { name: 'Svelte 5.32', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.32.0' },
    { name: 'SvelteKit 2.50', kind: 'oss-release', link: 'https://github.com/sveltejs/kit/releases/tag/2.50.0' },
    { name: 'Svelte 5.33', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.33.0' },
    { name: 'Svelte 5.34', kind: 'oss-release', link: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.34.0' },
  ];
  const ossOnly = curate.ossWinTape(svelteRecaps);
  assert.equal(ossOnly.every((item) => !/what.?s new in/i.test(item.name)), true, JSON.stringify(ossOnly));
  assert.ok(ossOnly.length >= 8, JSON.stringify(ossOnly));
  const expanded = curate.expandCeoHarvestWin(
    [
      { name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4', source: 'changelog' },
      { name: 'V0 PLATFORM API', link: 'https://vercel.com/changelog/v0-platform-api', source: 'changelog' },
    ],
    [
      { name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4', source: 'changelog' },
      { name: 'Vercel Sandbox routing', link: 'https://vercel.com/changelog/sandbox-routing', source: 'changelog' },
      { name: 'Persistent memory for eve agents', link: 'https://vercel.com/changelog/persistent-memory', source: 'changelog' },
      { name: "What's new in Svelte: January 2026", link: 'https://svelte.dev/blog/whats-new-in-svelte-january-2026' },
    ],
    'ceo',
    'Vercel',
    30,
  );
  assert.ok(expanded.some((item) => /sandbox routing/i.test(item.name)), JSON.stringify(expanded));
  assert.ok(expanded.some((item) => /persistent memory/i.test(item.name)), JSON.stringify(expanded));
  assert.equal(expanded.some((item) => /what.?s new in svelte/i.test(item.name)), false, JSON.stringify(expanded));
  const wordyWin = curate.expandCeoHarvestWin(
    [{ name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4', source: 'changelog' }],
    [
      {
        name: 'Protect production deployments for free on every plan',
        link: 'https://vercel.com/changelog/protect-production',
        source: 'changelog',
      },
      {
        name: 'Agents can now buy domains with the Vercel CLI',
        link: 'https://vercel.com/changelog/agents-buy-domains',
        source: 'changelog',
      },
    ],
    'ceo',
    'Vercel',
    30,
  );
  assert.ok(
    wordyWin.every((item) => item.name.trim().split(/\s+/).length < 8 || /\d+\.\d+/.test(item.name)),
    JSON.stringify(wordyWin.map((item) => item.name)),
  );
  const cleanedNowLive = curate.expandCeoHarvestWin(
    [{ name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4', source: 'changelog' }],
    [
      {
        name: 'AI SDK 6 is now available for everyone',
        link: 'https://vercel.com/changelog/ai-sdk-6',
        source: 'changelog',
      },
      {
        name: 'Workflow is now available',
        link: 'https://vercel.com/changelog/workflow',
        source: 'changelog',
      },
      { name: 'AI Gateway', link: 'https://vercel.com/changelog/ai-gateway', source: 'changelog' },
    ],
    'ceo',
    'Vercel',
    30,
  );
  assert.ok(cleanedNowLive.some((item) => /^ai sdk 6$/i.test(item.name)), JSON.stringify(cleanedNowLive));
  assert.ok(cleanedNowLive.some((item) => /^workflow$/i.test(item.name)), JSON.stringify(cleanedNowLive));
  assert.ok(cleanedNowLive.some((item) => /^ai gateway$/i.test(item.name)), JSON.stringify(cleanedNowLive));
  assert.equal(cleanedNowLive.some((item) => /is now available/i.test(item.name)), false, JSON.stringify(cleanedNowLive));
  const ossHeavyVercel = [
    { name: 'Next.js 16.4.0', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.4.0' },
    { name: 'Next.js 16.3.2', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.3.2' },
    { name: 'Next.js 16.3.1', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.3.1' },
    { name: 'Next.js 16.3.0', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.3.0' },
    { name: 'Next.js 16.2.1', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.2.1' },
    { name: 'Next.js 16.2.0', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.2.0' },
    { name: 'Next.js 16.1.4', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.1.4' },
    { name: 'Next.js 16.1.3', kind: 'oss-release', link: 'https://github.com/vercel/next.js/releases/tag/v16.1.3' },
    { name: 'V0 PLATFORM API', source: 'changelog', link: 'https://vercel.com/changelog/v0-platform-api' },
    { name: 'AI GATEWAY', source: 'changelog', link: 'https://vercel.com/changelog/ai-gateway' },
    { name: 'VERCEL AGENT', source: 'changelog', link: 'https://vercel.com/changelog/vercel-agent' },
    { name: 'SANDBOX', source: 'changelog', link: 'https://vercel.com/changelog/sandbox' },
    { name: 'WORKFLOW', source: 'changelog', link: 'https://vercel.com/changelog/workflow' },
    { name: 'NEXT.JS 16.4', source: 'changelog', link: 'https://vercel.com/changelog/next-16-4' },
    { name: 'BOTID', source: 'changelog', link: 'https://vercel.com/changelog/botid' },
  ];
  const vercelFound = [
    ...ossHeavyVercel,
    {
      name: 'Persistent memory for eve agents is now available',
      source: 'changelog',
      link: 'https://vercel.com/changelog/persistent-memory',
    },
    { name: 'Fluid compute', source: 'changelog', link: 'https://vercel.com/changelog/fluid' },
    { name: 'Rolling releases', source: 'changelog', link: 'https://vercel.com/changelog/rolling-releases' },
  ];
  assert.equal(curate.harvestLooksLikeOssTape(ossHeavyVercel), true);
  const ossOnlyVercel = curate.ossWinTape(ossHeavyVercel);
  assert.ok(ossOnlyVercel.length < 15, JSON.stringify(ossOnlyVercel));
  const vercelWin = curate.harvestWinSource(ossHeavyVercel, vercelFound, 'ceo', 'Vercel');
  assert.ok(vercelWin.length >= 15, JSON.stringify(vercelWin.map((item) => item.name)));
  assert.ok(vercelWin.some((item) => /v0 platform api/i.test(item.name)), JSON.stringify(vercelWin));
  assert.ok(vercelWin.some((item) => /ai gateway/i.test(item.name)), JSON.stringify(vercelWin));
  assert.ok(vercelWin.some((item) => /persistent memory/i.test(item.name)), JSON.stringify(vercelWin));
  assert.ok(vercelWin.some((item) => /fluid compute/i.test(item.name)), JSON.stringify(vercelWin));
  assert.equal(curate.harvestShouldWin(vercelWin.length, 15, 'ceo', 'Vercel'), true);
  const openaiHarvested = Array.from({ length: 33 }, (_, i) => ({
    name: `CODEX CLI 0.${100 + i}`,
    kind: 'oss-release',
    link: `https://github.com/openai/codex/releases/tag/0.${100 + i}`,
  }));
  const openaiFound = [
    ...openaiHarvested,
    { name: 'Codex Cloud is now available', source: 'changelog', link: 'https://developers.openai.com/codex/cloud' },
    { name: 'GPT-5.3-Codex', source: 'changelog', link: 'https://developers.openai.com/codex/gpt-5-3' },
    { name: 'Codex app for macOS', source: 'changelog', link: 'https://openai.com/codex' },
    { name: 'How Oracle turns days of work into minutes with ChatGPT', link: 'https://openai.com/index/oracle' },
  ];
  assert.equal(curate.harvestLooksLikeOssTape(openaiHarvested), true);
  const openaiWin = curate.harvestWinSource(openaiHarvested, openaiFound, 'lead', 'OpenAI');
  assert.ok(openaiWin.length >= 35, JSON.stringify(openaiWin.map((item) => item.name).slice(-8)));
  assert.ok(openaiWin.some((item) => /codex cloud/i.test(item.name)), JSON.stringify(openaiWin.slice(-8)));
  assert.ok(openaiWin.some((item) => /gpt-5\.3-codex/i.test(item.name)), JSON.stringify(openaiWin.slice(-8)));
  assert.equal(openaiWin.some((item) => /oracle turns days/i.test(item.name)), false);
  assert.equal(curate.harvestShouldWin(openaiWin.length, 33, 'lead', 'OpenAI'), true);
  const bunWin = curate.harvestWinSource(bunPlusEssays, bunPlusEssays, null, null);
  assert.ok(bunWin.every((item) => !/cpf catch-22|mind virus|stripe dispute/i.test(item.name)), JSON.stringify(bunWin));
  assert.ok(bunWin.length >= 8, JSON.stringify(bunWin));
  const journalBack = curate.unionJournalShips(
    [{ name: 'INFINITESLOP.AI', link: 'https://github.com/levelsio/infiniteslop', kind: 'oss-release' }],
    [
      { name: 'hotelist.com', link: 'https://levels.io/#hotelist-com', source: 'site', kind: 'journal-ship' },
      { name: 'nomads.com free', link: 'https://levels.io/#nomads-com', source: 'site' },
      { name: 'Photo AI feature', link: 'https://levels.io/#photo-ai-feature', source: 'site' },
      { name: 'Luxury hotels are mathematically bad value', link: 'https://levels.io/luxury-hotels', source: 'site' },
    ],
  );
  assert.ok(journalBack.some((item) => /hotelist/i.test(item.name)), JSON.stringify(journalBack));
  assert.ok(journalBack.some((item) => /nomads/i.test(item.name)), JSON.stringify(journalBack));
  assert.ok(journalBack.some((item) => /photo ai/i.test(item.name)), JSON.stringify(journalBack));
  assert.equal(journalBack.some((item) => /luxury hotels/i.test(item.name)), false, JSON.stringify(journalBack));
  const essayRss = [
    { name: 'Luxury hotels are mathematically bad value', kind: 'oss-blog', link: 'https://levels.io/luxury-hotels' },
    { name: "I've been coding almost solely on my VPS", kind: 'oss-blog', link: 'https://levels.io/vps' },
    { name: 'Europe has gotten very poor fast', kind: 'oss-blog', link: 'https://levels.io/europe' },
    { name: 'Congratulations Europe you killed 1000 people', kind: 'oss-blog', link: 'https://levels.io/heat' },
    { name: 'Places the most attractive rich nomads visit', kind: 'oss-blog', link: 'https://levels.io/nomads-visit' },
    { name: 'This is how you do a great startup video', kind: 'oss-blog', link: 'https://levels.io/video' },
    { name: 'Bitcoin 4-year cycles are not dead', kind: 'oss-blog', link: 'https://levels.io/bitcoin' },
    { name: 'Smartest people I know have strong opinions', kind: 'oss-blog', link: 'https://levels.io/opinions' },
  ];
  assert.equal(curate.harvestLooksLikeOssTape(essayRss), false);
  assert.equal(curate.harvestLooksLikeCommentaryTape(essayRss), true);
  const restored = curate.unionHarvestWin(
    [
      { name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4' },
      { name: 'V0 PLATFORM API', link: 'https://vercel.com/changelog/v0-platform-api' },
    ],
    [
      { name: 'AI GATEWAY', link: 'https://vercel.com/changelog/ai-gateway' },
      { name: 'VERCEL AGENT', link: 'https://vercel.com/changelog/vercel-agent' },
      { name: 'v0', link: 'https://vercel.com/blog/introducing-the-new-v0' },
      { name: 'NEXT.JS 16.4', link: 'https://vercel.com/changelog/next-16-4' },
    ],
  );
  const restoredNames = restored.map((item) => item.name);
  assert.ok(restoredNames.some((name) => /ai gateway/i.test(name)), JSON.stringify(restoredNames));
  assert.ok(restoredNames.some((name) => /vercel agent/i.test(name)), JSON.stringify(restoredNames));
  assert.equal(restoredNames.filter((name) => /v0/i.test(name)).length, 1, JSON.stringify(restoredNames));
  assert.equal(restoredNames.filter((name) => /next\.js 16\.4/i.test(name)).length, 1, JSON.stringify(restoredNames));
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

test('applyCuration drops listicle raw titles even when Claude renames them', () => {
  const packed = [
    {
      id: 'c0',
      raw_title: 'BEST AI HEADSHOT GENERATORS 2026',
      short_desc: '',
      source_host: 'dannypostma.com',
      date: '2026-01-08',
      kind: 'web',
      found: found({
        name: 'BEST AI HEADSHOT GENERATORS 2026',
        date: '2026-01-08',
        link: 'https://dannypostma.com/best-ai-headshot-generators-2026',
        source: 'site',
      }),
    },
    {
      id: 'c1',
      raw_title: 'AgentBar',
      short_desc: 'I made a launch bar',
      source_host: 'github.com',
      date: '2026-08-13',
      kind: 'repo',
      found: found({
        name: 'AgentBar',
        date: '2026-08-13',
        link: 'https://github.com/dannypostma/agentbar',
        source: 'github',
      }),
    },
  ];
  const tape = curate.applyCuration(
    {
      items: [
        { id: 'c0', title: 'Headshot Tools', group: null, owned: true, significance: 2 },
        { id: 'c1', title: 'AgentBar', group: null, owned: true, significance: 2 },
      ],
      notes: ['AgentBar is the one with a date on it.'],
    },
    packed,
  );
  assert.ok(tape);
  const names = tape.items.map((item) => item.name);
  assert.equal(names.some((name) => /headshot/i.test(name)), false, JSON.stringify(names));
  assert.ok(names.some((name) => /agentbar/i.test(name)), JSON.stringify(names));
});
