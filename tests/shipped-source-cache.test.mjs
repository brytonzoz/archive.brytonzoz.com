import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const cache = await import('../worker/shipped-source-cache.ts');

const item = (name, link) => ({ name, link });

test('a thin live harvest does not replace a fat cached tape', () => {
  const cached = [
    item('Vite 8', 'https://github.com/vitejs/vite/releases/tag/v8.0.0'),
    item('Vitest 4', 'https://github.com/vitest-dev/vitest/releases/tag/v4.0.0'),
    item('Rolldown 1', 'https://github.com/rolldown/rolldown/releases/tag/v1.0.0'),
  ];
  const live = [item('Vite 8', 'https://github.com/vitejs/vite/releases/tag/v8.0.0')];
  const picked = cache.preferSourceHarvest(live, cached);
  assert.equal(picked.from, 'cache');
  assert.equal(picked.items.length, 3);
  assert.ok(picked.items.some((row) => /vitest/i.test(row.name)));
  const grown = cache.preferSourceHarvest(
    [...live, item('Oxc 1', 'https://github.com/oxc-project/oxc/releases/tag/v1.0.0')],
    cached,
  );
  assert.equal(grown.from, 'merge');
  assert.ok(grown.items.some((row) => /oxc/i.test(row.name)));
});

test('an empty timeout falls back to the cached harvest', () => {
  const cached = [item('Nub', 'https://github.com/nubjs/nub'), item('Zod', 'https://github.com/colinhacks/zod')];
  const picked = cache.preferSourceHarvest([], cached);
  assert.equal(picked.from, 'cache');
  assert.equal(picked.items.length, 2);
  const none = cache.preferSourceHarvest(null, cached);
  assert.equal(none.from, 'cache');
  assert.equal(none.items.length, 2);
});

test('a live tape within 10% replaces the cache', () => {
  const cached = Array.from({ length: 30 }, (_, i) => item(`Ship ${i}`, `https://example.com/${i}`));
  const live = Array.from({ length: 28 }, (_, i) => item(`Ship ${i}`, `https://example.com/${i}`));
  const picked = cache.preferSourceHarvest(live, cached);
  assert.equal(picked.from, 'live');
  assert.equal(picked.items.length, 28);
});

test('GitHub conditional requests send If-None-Match and the token', () => {
  const headers = cache.githubRequestHeaders('token', 'ghp_test', '"abc"');
  assert.equal(headers.authorization, 'Bearer ghp_test');
  assert.equal(headers['if-none-match'], '"abc"');
  const anon = cache.githubRequestHeaders('anonymous', undefined, null);
  assert.equal(anon.authorization, undefined);
  assert.equal(anon['if-none-match'], undefined);
});

test('source harvest keys are stable per subject', () => {
  assert.equal(cache.sourceHarvestKey('oss', 2026, '@yyx990803'), cache.sourceHarvestKey('oss', 2026, 'yyx990803'));
  assert.match(cache.githubEtagCacheKey('token', '/repos/vitejs/vite/releases'), /gh:etag:v1:token:/);
});

test('a fresh harvest cache does not wait on a live refresh', () => {
  const fresh = { at: Date.now(), found: [item('Vite 8', 'https://github.com/vitejs/vite/releases/tag/v8.0.0')] };
  assert.equal(cache.sourceWaitMs(fresh, 28_000), 0);
  assert.equal(cache.sourceWaitMs({ at: Date.now() - 25 * 60 * 60 * 1000, found: fresh.found }, 28_000), 28_000);
  assert.equal(cache.sourceWaitMs(null, 6000), 6000);
});

test('journal harvest keeps hotelist when a live parse misses it', () => {
  const cached = [
    item('hotelist.com', 'https://levels.io/#hotelist-com'),
    item('nomads.com free', 'https://levels.io/#nomads-com'),
  ];
  const live = [item('infiniteslop.ai', 'https://levels.io/#infiniteslop')];
  const picked = cache.preferJournalHarvest(live, cached);
  assert.equal(picked.from, 'merge');
  assert.ok(picked.items.some((row) => /hotelist/i.test(row.name)), JSON.stringify(picked.items));
  assert.ok(picked.items.some((row) => /infiniteslop/i.test(row.name)));
});
