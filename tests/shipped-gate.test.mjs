import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const polish = await import('../worker/shipped-polish.ts');
const ai = await import('../worker/shipped-ai.ts');
const affiliation = await import('../worker/shipped-affiliation.ts');

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shipped-junk.json'), 'utf8'));

function asItem(row) {
  return {
    description: row.description || '',
    date: row.date ?? null,
    link: row.link || 'https://example.com/ship',
    source: row.source || 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
    name: row.name,
  };
}

function gateRow(row) {
  return polish.gateReceiptItems([asItem(row)], {
    year: 2026,
    who: row.who || null,
    handle: row.handle || null,
    owner: row.owner || null,
  });
}

test('shipped-junk fixture: every flagged title drops; flagships stay', () => {
  const leaked = [];
  for (const row of fixture.drop) {
    const kept = gateRow(row);
    const hit = kept.some((item) => {
      const got = String(item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const want = String(row.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return got && want && (got === want || got.includes(want) || want.includes(got));
    });
    if (hit) leaked.push(`${row.name} → ${kept.map((item) => item.name).join(', ')}`);
  }
  assert.deepEqual(leaked, [], `junk leaked: ${JSON.stringify(leaked)}`);

  const missing = [];
  for (const row of fixture.keep) {
    const kept = gateRow(row);
    if (!kept.length) missing.push(row.name);
  }
  assert.deepEqual(missing, [], `flagships dropped: ${JSON.stringify(missing)}`);
});

test('print-time gate collapses OpenAI CEO Codex crumbs to company-wide ships', () => {
  const aff = {
    ...affiliation.emptyAffiliation(),
    name: 'Sam Altman',
    company: 'OpenAI',
    role: 'ceo',
    typedCompany: true,
  };
  const items = polish.gateReceiptItems(
    [
      asItem({ name: 'GPT-6', date: '2026-05-01', link: 'https://openai.com/index/gpt-6' }),
      asItem({ name: 'ChatGPT Images', date: '2026-02-01', link: 'https://openai.com/index/images' }),
      asItem({ name: 'Sora', date: '2026-03-01', link: 'https://openai.com/sora' }),
      asItem({ name: 'Codex app', date: '2026-02-14', link: 'https://openai.com/codex' }),
      asItem({ name: 'Codex CLI 0.145.0', date: '2026-07-21', link: 'https://developers.openai.com/codex/cli' }),
      asItem({ name: 'Codex long-running work', date: '2026-04-01', link: 'https://developers.openai.com/codex/long' }),
      asItem({ name: 'GitLab support in Codex', date: '2026-08-20', link: 'https://developers.openai.com/codex/gitlab' }),
    ],
    { year: 2026, who: 'Sam Altman', affiliation: aff },
  );
  const names = items.map((item) => item.name);
  assert.ok(names.some((name) => /gpt[-\s]?6/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /chatgpt images/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /sora/i.test(name)), JSON.stringify(names));
  assert.equal(names.filter((name) => /codex/i.test(name)).length, 1, JSON.stringify(names));
});

test('Vercel Agent truncated at and survives; GitHub handle drops TRUELL20', () => {
  const agent = polish.gateReceiptItems(
    [
      asItem({
        name: 'Vercel Agent now installs private packages from npm and',
        date: '2026-09-30',
        link: 'https://vercel.com/changelog/vercel-agent-now-installs-private-packages-from-npm-and-custom-registries',
      }),
    ],
    { year: 2026, who: 'Guillermo Rauch', handle: 'rauchg' },
  );
  assert.ok(agent.some((item) => /vercel agent/i.test(item.name)), JSON.stringify(agent));
  const self = polish.gateReceiptItems(
    [asItem({ name: 'TRUELL20', date: null, source: 'site', link: 'https://truell20.com/' })],
    {
      year: 2026,
      who: 'Michael Truell',
      handle: 'mntruell',
      owner: { name: 'Michael Truell', github: 'truell20', site: 'https://cursor.com' },
    },
  );
  assert.equal(self.length, 0, JSON.stringify(self));
});

test('docs-href keeps changelog cards and drops docs nav / blog categories', () => {
  assert.equal(polish.isDocsOrCategoryHref('https://vercel.com/docs/frameworks'), true);
  assert.equal(polish.isDocsOrCategoryHref('https://vercel.com/blog/category/security'), true);
  assert.equal(polish.isDocsOrCategoryHref('https://vercel.com/changelog/vercel-agent-now-in-slack'), false);
  assert.equal(polish.isDocsOrCategoryHref('https://developers.openai.com/api/docs/changelog'), false);
  assert.equal(polish.isChangelogEntryHref('https://vercel.com/changelog/v0-platform-api-now-in-beta'), true);
  assert.equal(polish.isChangelogEntryHref('https://vercel.com/changelog'), false);
});

test('Codex app updates rescues to Codex app; GPT-5.3-Codex stays a named model', () => {
  const aff = {
    ...affiliation.emptyAffiliation(),
    name: 'Tibo',
    company: 'OpenAI',
    role: 'lead',
    product: 'Codex',
    typedCompany: true,
  };
  const items = polish.gateReceiptItems(
    [
      asItem({ name: 'Codex app updates', date: '2026-08-04', link: 'https://developers.openai.com/codex/app' }),
      asItem({ name: 'GPT-5.3-Codex', date: '2026-03-12', link: 'https://developers.openai.com/codex/changelog#gpt-5-3-codex' }),
    ],
    { year: 2026, who: 'Tibo', handle: 'tibo_maker', affiliation: aff },
  );
  const names = items.map((item) => item.name);
  assert.ok(names.some((name) => /^codex app$/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /gpt-?5\.3-codex/i.test(name)), JSON.stringify(names));
});

test('lead tapes still keep the Codex changelog; harvestItems uses the print gate', () => {
  const aff = {
    ...affiliation.emptyAffiliation(),
    name: 'Tibo',
    company: 'OpenAI',
    role: 'lead',
    product: 'Codex',
    typedCompany: true,
  };
  const gathered = {
    found: [
      asItem({ name: 'Codex app', date: '2026-02-14', link: 'https://openai.com/codex' }),
      asItem({ name: 'Codex CLI', date: '2026-02-20', link: 'https://openai.com/codex-cli' }),
      asItem({ name: 'GPT-6', date: '2026-05-01', link: 'https://openai.com/index/gpt-6' }),
    ],
    web: [],
    pages: [],
    site: null,
    profile: { name: 'Tibo', bio: '', site: null, x: 'tibo_maker', github: null, affiliation: aff },
    ran: [],
    failed: [],
    stats: [],
  };
  const tape = ai.harvestItems(gathered, 2026).map((item) => item.name);
  assert.ok(tape.filter((name) => /codex/i.test(name)).length >= 2, JSON.stringify(tape));
});
