import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const modules = await import('../lib/shipped-modules.ts');

const item = (over) => ({
  name: over.name,
  description: over.description ?? 'A thing.',
  date: over.date ?? '2026-03-14',
  status: over.status ?? 'LIVE',
  link: over.link ?? 'https://example.com/x',
  logo: null,
  source: over.source,
});

const receipt = (over = {}) => ({
  id: over.id ?? 1,
  version: 2,
  year: 2026,
  subject: { kind: 'github', id: 'ada', display: 'Ada' },
  printedAt: '2026-10-09T14:00:00.000Z',
  items: over.items ?? [
    item({ name: 'Repo', source: 'github' }),
    item({ name: 'Show HN app', source: 'hn', description: 'A launch on HN.' }),
    item({ name: 'On npm', source: 'npm', date: '2026-06-01' }),
  ],
  note: 'Three public things. Strong Tuesday energy.',
  potential: false,
  demo: false,
  listed: true,
  layout: over.layout,
});

test('the tape is only items, cashier note and stamp', () => {
  const list = modules.catalogModules({ receipt: receipt(), printed: 40 });
  assert.deepEqual(list.map((row) => row.id), modules.KEEP_MODULES);
  assert.equal(list.length, 3);
  assert.equal(modules.pickDeepCut(receipt().items)?.name, 'Show HN app');
  assert.equal(modules.itemsForPrint(receipt().items)[0].name, 'Repo');
});

test('layout is ids only: HTML, unknown ids and filler bands are dropped; required bands stay', () => {
  const layout = modules.sanitizeLayout(['items', '<script>', 'not-a-module', 'deep-cut', 'friend', 'items', 'volume'], 7);
  assert.deepEqual(layout, ['items', 'cashier', 'stamp']);
  assert.ok(!layout.some((id) => /[<>]/.test(id)));
  for (const id of modules.REQUIRED_MODULES) assert.ok(layout.includes(id));
  assert.equal(layout.includes('deep-cut'), false);
  assert.deepEqual(modules.sanitizeLayout(['<b>items</b>', null, 12], 3), modules.seededLayout(3));
});

test('seeded layout is the short tape, and stored filler never prints', () => {
  assert.deepEqual(modules.seededLayout(42), modules.PRINT_LAYOUT);
  assert.deepEqual(modules.seededLayout(1), modules.seededLayout(99));
  const printed = modules.receiptModules({
    receipt: receipt({ id: 7, layout: ['deep-cut', 'friend', 'first-last', 'items', 'platforms', 'cashier', 'stamp'] }),
  });
  assert.deepEqual(printed.map((row) => row.id), ['items', 'cashier', 'stamp']);
});

test('ship score is 0–100 from sourced work, 0 for potential, never engagement', () => {
  assert.equal(modules.shipScore({ items: [], potential: true }), 0);
  const one = modules.shipScore(receipt({ items: [item({ name: 'Repo', source: 'github' })] }));
  const many = modules.shipScore(receipt());
  assert.ok(one > 0 && one <= 100);
  assert.ok(many > one && many <= 100);
});

test('nothing unsourced is a deep-cut; FIRST RUN is #0001–#0250; badges stay off the tape', () => {
  assert.equal(modules.pickDeepCut([item({ name: 'Guess', source: 'none', link: null })]), null);
  assert.equal(modules.isFirstRun(1), true);
  assert.equal(modules.isFirstRun(250), true);
  assert.equal(modules.isFirstRun(251), false);
  assert.deepEqual(modules.receiptBadges(modules.receiptModules({ receipt: receipt({ id: 1 }) })), []);
});
