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
});

test('the 12 modules are all present; deep-cut prefers a sourced surprise', () => {
  const list = modules.receiptModules({ receipt: receipt(), printed: 40 });
  assert.deepEqual(list.map((row) => row.id), modules.MODULE_ORDER);
  assert.equal(list.length, 12);
  const cut = modules.pickDeepCut(receipt().items);
  assert.equal(cut?.name, 'Show HN app');
  assert.equal(list[0].lines[0], 'Show HN app');
  assert.equal(modules.itemsForPrint(receipt().items)[0].name, 'Show HN app');
});

test('nothing unsourced is a deep-cut; FIRST RUN is #0001–#0250', () => {
  assert.equal(modules.pickDeepCut([item({ name: 'Guess', source: 'none', link: null })]), null);
  assert.equal(modules.isFirstRun(1), true);
  assert.equal(modules.isFirstRun(250), true);
  assert.equal(modules.isFirstRun(251), false);
  const badges = modules.receiptBadges(modules.receiptModules({ receipt: receipt({ id: 1 }) }));
  assert.ok(badges.includes('FIRST RUN'));
  assert.ok(badges.includes('DEEP CUT'));
});

test('volume labels are honest counts, not fake percentiles', () => {
  const tape = (n) =>
    modules.receiptModules({
      receipt: receipt({
        items: Array.from({ length: n }, (_, i) => item({ name: `P${i}`, source: 'github' })),
      }),
    }).find((row) => row.id === 'volume');
  assert.match(tape(1).lines[0], /One public thing/);
  assert.match(tape(12).lines[0], /long tape/);
  assert.equal(tape(12).rarity, 'rare');
});
