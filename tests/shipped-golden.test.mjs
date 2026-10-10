import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateGolden, junkKeys, tapes } from './lib/shipped-goldens.mjs';

const ai = await import('../worker/shipped-ai.ts');
const polish = await import('../worker/shipped-polish.ts');
const flagship = await import('../worker/shipped-flagship.ts');

function loose(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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

function missingRequired(spec, names, drops) {
  const missing = [];
  for (const needle of spec.required || []) {
    if (names.some((name) => {
      const got = loose(name);
      const want = loose(needle);
      return got === want || got.includes(want) || want.includes(got);
    })) continue;
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
  const helpers = {
    junkHit: junkKeys(),
    endsWithCutOffWord: polish.endsWithCutOffWord,
    isBareProductNote: ai.isBareProductNote,
  };
  const report = {};
  const failures = [];
  for (const [id, spec] of Object.entries(tapes)) {
    const { items, drops, names } = printTape(spec);
    let note = '';
    if (items.length) {
      const sealed = ai.finish(items, '', 1, undefined, [], {
        who: spec.who,
        handle: spec.handle,
        year: 2026,
        affiliation: spec.profile.affiliation,
        owner: spec.owner || null,
        apiDown: false,
      });
      note = sealed.note;
    }
    const result = evaluateGolden(spec, items, note, helpers);
    report[id] = { count: items.length, names, drops: drops.slice(0, 40) };
    if (!result.ok) failures.push(`${id}: ${result.failures.join('; ')}`);
    const missing = missingRequired(spec, names, drops);
    if (missing.length) failures.push(`${id}: missing ${JSON.stringify(missing)}`);
  }
  assert.deepEqual(failures, [], JSON.stringify({ failures, report: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { count: v.count, names: v.names }])) }, null, 2));
});
