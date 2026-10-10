import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ai = await import('../worker/shipped-ai.ts');
const polish = await import('../worker/shipped-polish.ts');
const flagship = await import('../worker/shipped-flagship.ts');

const here = dirname(fileURLToPath(import.meta.url));
const tapes = JSON.parse(readFileSync(join(here, 'fixtures/shipped-golden/tapes.json'), 'utf8'));
const junk = JSON.parse(readFileSync(join(here, 'fixtures/shipped-junk.json'), 'utf8'));

function loose(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function junkKeys() {
  return new Set(junk.drop.map((row) => loose(row.name)).filter((key) => key.length >= 6));
}

function printTape(spec) {
  const drops = [];
  polish.gateReceiptItems(spec.found, {
    year: 2026,
    who: spec.who,
    handle: spec.handle,
    affiliation: spec.profile.affiliation,
    owner: spec.owner || null,
    onDrop: (drop) => drops.push(drop),
  });
  const items = ai.harvestItems(
    {
      found: spec.found,
      web: [],
      pages: [],
      site: spec.profile.site || null,
      profile: spec.profile,
      ran: [],
      failed: [],
      stats: [],
    },
    2026,
  );
  return { items, drops, names: items.map((item) => item.name) };
}

function hasRequired(names, needle) {
  const want = loose(needle);
  return names.some((name) => {
    const got = loose(name);
    return got === want || got.includes(want) || want.includes(got);
  });
}

function missingRequired(spec, names, drops) {
  const missing = [];
  for (const needle of spec.required || []) {
    if (hasRequired(names, needle)) continue;
    const hits = drops.filter((drop) => loose(drop.name).includes(loose(needle)) || loose(needle).includes(loose(drop.name)));
    const raw = (spec.found || []).filter((row) => loose(row.name).includes(loose(needle)) || loose(needle).includes(loose(row.name)));
    missing.push({
      needle,
      gate: hits.map((hit) => hit.reason),
      flagship: raw.map((row) => flagship.flagshipLaunchName(row)),
      raw: raw.map((row) => `${row.name} ${row.link}`),
    });
  }
  return missing;
}

test('E2E goldens: cached raw tapes keep flagships, hit floors, and drop junk', () => {
  const junkHit = junkKeys();
  const report = {};
  const failures = [];
  for (const [id, spec] of Object.entries(tapes)) {
    const { items, drops, names } = printTape(spec);
    const leaked = names.filter((name) => junkHit.has(loose(name)));
    const missing = missingRequired(spec, names, drops);
    const anyMissing = (spec.requiredAny || []).filter((row) => !names.some((name) => new RegExp(row.re, 'i').test(name)));
    const yearOk = !spec.requireYear || items.some((item) => String(item.date || '').startsWith(String(spec.requireYear)));
    report[id] = { count: items.length, names, drops: drops.slice(0, 40) };
    if (items.length < (spec.min || 0)) {
      failures.push(`${id}: count ${items.length} < ${spec.min}; drops=${JSON.stringify(drops.slice(0, 20))}`);
    }
    if (missing.length) failures.push(`${id}: missing ${JSON.stringify(missing)}`);
    if (anyMissing.length) failures.push(`${id}: missing any ${anyMissing.map((row) => row.key).join(', ')}`);
    if (leaked.length) failures.push(`${id}: junk leaked ${JSON.stringify(leaked)}`);
    if (!yearOk) failures.push(`${id}: no ${spec.requireYear} product`);
  }
  assert.deepEqual(failures, [], JSON.stringify({ failures, report: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { count: v.count, names: v.names }])) }, null, 2));
});
