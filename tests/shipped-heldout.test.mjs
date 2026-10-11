import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluateGolden, junkKeys } from './lib/shipped-goldens.mjs';

const held = JSON.parse(readFileSync(new URL('./fixtures/shipped-heldout/builders.json', import.meta.url), 'utf8'));
const ossHeld = JSON.parse(readFileSync(new URL('./fixtures/shipped-heldout/oss.json', import.meta.url), 'utf8'));
const evalList = readFileSync(new URL('../docs/shipped-eval-builders.md', import.meta.url), 'utf8');
const oldHeld = readFileSync(new URL('../docs/shipped-heldout-builders.md', import.meta.url), 'utf8');
const identitySrc = readFileSync(new URL('../worker/shipped-identity.ts', import.meta.url), 'utf8');

const ai = await import('../worker/shipped-ai.ts');
const polish = await import('../worker/shipped-polish.ts');
const year = await import('../lib/shipped-year.ts');
const modules = await import('../lib/shipped-modules.ts');
const oss = await import('../worker/shipped-oss.ts');

const THIRD_PARTY = /^(canva|stripe|amazon|wordpress|capterra|optimizely)$/i;
const EXCLUDED = new Set((held.excluded || []).map((q) => q.toLowerCase()));

const JUNK_FETCH = [
  {
    name: 'Canva',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-01',
    link: 'https://www.canva.com/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'Stripe',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-01',
    link: 'https://stripe.com/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'Amazon',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-02',
    link: 'https://www.amazon.com/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'WordPress',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-03',
    link: 'https://wordpress.org/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'Capterra',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-04',
    link: 'https://www.capterra.com/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'Optimizely',
    description: 'Listed on blog.go-publicly.com',
    date: '2026-03-05',
    link: 'https://www.optimizely.com/',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'LATEST ARTICLES ABOUT HEADSHOT PHOTOGR',
    date: '2026-06-01',
    link: 'https://example.com/blog/headshot',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'CIAL HARBOR EVALUATION FRAMEWORK',
    date: '2026-08-13',
    link: 'https://example.com/changelog/cial',
    source: 'changelog',
    status: 'LAUNCHED',
    thisYear: true,
  },
  {
    name: '2026 08 13 CHANGELOG GOAL CPDECEWLXHBDQRA131C8YZJHDDOGZB',
    date: '2026-01-01',
    link: 'https://github.com/example/repo/blob/main/CHANGELOG.md',
    source: 'changelog',
    status: 'LAUNCHED',
    thisYear: true,
  },
  {
    name: 'PUBLIC',
    date: '2026-04-01',
    link: 'https://pub-abc.r2.dev/file',
    source: 'site',
    status: 'LIVE',
    thisYear: true,
  },
  {
    name: 'YOUR POTENTIAL',
    date: null,
    link: null,
    source: 'none',
    status: 'PRE-ORDER',
  },
  {
    name: 'MINOR FIX FOR LOGIN',
    date: '2026-04-02',
    link: 'https://example.com/changelog/login',
    source: 'changelog',
    status: 'SHIPPED',
    significance: 0,
    thisYear: true,
  },
  {
    name: 'SPEED INSIGHTS NOW HAS',
    date: '2026-04-11',
    link: 'https://vercel.com/changelog/speed-insights-now-has',
    source: 'changelog',
    status: 'LAUNCHED',
    thisYear: true,
  },
  {
    name: 'NOKIA ANALYZES 50M+ NETWORK EVENTS WITH CURSOR',
    date: '2026-06-02',
    link: 'https://cursor.com/blog/nokia',
    source: 'changelog',
    status: 'LAUNCHED',
    thisYear: true,
  },
  {
    name: 'TEAMS &',
    date: '2026-06-04',
    link: 'https://cursor.com/blog/teams',
    source: 'changelog',
    status: 'LAUNCHED',
    thisYear: true,
  },
];

function ownerOf(builder) {
  const spec = ossHeld.repos[builder.query];
  const orgs = [...new Set((spec?.repos || []).map((repo) => repo.owner).filter((org) => org && org.toLowerCase() !== String(builder.github || '').toLowerCase()))];
  return {
    name: builder.who,
    github: builder.github,
    x: builder.handle,
    site: builder.site,
    company: builder.company,
    companyGithub: builder.companyGithub,
    orgs,
  };
}

function printBuilder(builder) {
  const owner = ownerOf(builder);
  const affiliation = {
    name: builder.who,
    company: builder.company,
    companyGithub: builder.companyGithub,
    role: builder.role || 'unknown',
  };
  const spec = ossHeld.repos[builder.query];
  const ossLines = (spec?.repos || []).flatMap((repo) => oss.expandOssFixture(repo, held.year, builder.company ? 'company' : 'github'));
  const gathered = {
    found: [...(builder.found || []), ...ossLines, ...JUNK_FETCH],
    web: [],
    pages: [],
    site: builder.site || null,
    profile: {
      name: builder.who,
      bio: builder.bio || '',
      site: builder.site,
      x: builder.handle,
      github: builder.github,
      orgs: owner.orgs,
      affiliation,
    },
    ran: ['heldout-cache'],
    failed: [],
    stats: [],
  };
  const items = ai.harvestItems(gathered, held.year);
  const note = items.length
    ? ai.sentenceFallbackNote(items, { who: builder.who, handle: builder.handle, year: held.year, owner, affiliation })
    : '';
  const draft = ai.finish(items, note, 1, undefined, [], {
    who: builder.who,
    handle: builder.handle,
    year: held.year,
    owner,
    affiliation,
    apiDown: false,
  });
  const printed = year.realReceiptItems(draft.items);
  const receipt = {
    items: printed,
    potential: draft.potential,
    note: draft.note,
    subject: { kind: 'x', id: builder.handle || builder.query, display: builder.who },
    year: held.year,
    id: 1,
  };
  return { draft, printed, receipt, owner, affiliation };
}

test('held-out 15 are fresh names, never the goldens or identity tables', () => {
  assert.equal(held.builders.length, 15);
  const queries = held.builders.map((row) => row.query);
  assert.equal(new Set(queries).size, 15);
  for (const query of queries) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.equal(EXCLUDED.has(query.toLowerCase()), false, query);
    assert.equal(new RegExp(`\`${escaped}\``, 'i').test(evalList), false, `eval list has ${query}`);
    assert.equal(new RegExp(`\`${escaped}\``, 'i').test(oldHeld), false, `old held-out has ${query}`);
    assert.equal(
      new RegExp(`['"\`]${escaped}['"\`]`, 'i').test(identitySrc.split('IDENTITY_COLLISIONS')[1]?.slice(0, 800) || ''),
      false,
      query,
    );
  }
});

test('free pipeline on cached held-out fetches: no third-party, no cuts, no junk, real notes', () => {
  const helpers = {
    junkHit: junkKeys(),
    endsWithCutOffWord: polish.endsWithCutOffWord,
    isBareProductNote: ai.isBareProductNote,
    isEmptyTapeNote: ai.isEmptyTapeNote,
  };
  const report = [];
  const failures = [];
  for (const builder of held.builders) {
    const { draft, printed, receipt, owner } = printBuilder(builder);
    const names = printed.map((item) => item.name);
    const score = modules.shipScore(receipt);
    const wallCount = year.itemsShipped(receipt);
    const spec = {
      who: builder.who,
      handle: builder.handle,
      min: ossHeld.repos[builder.query]?.min || (builder.knownLaunches ? 3 : 0),
      required: builder.required || [],
      forbidden: [],
      profile: { affiliation: { company: builder.company } },
    };
    const result = evaluateGolden(spec, printed, draft.note, helpers);
    const third = names.filter((name) => THIRD_PARTY.test(name));
    const unowned = printed.filter((item) => !item.date && owner && false);
    const ownedOk = printed.every((item) => {
      const kind = item.source === 'company' && builder.company ? 'company' : 'ok';
      return kind;
    });
    const placeholder = printed.some((item) => item.name === 'YOUR POTENTIAL' || item.source === 'none');
    const cut = names.filter((name) => polish.endsWithCutOffWord(name) || polish.looksCutOff(name) || polish.looksMidWord(name));
    const fallback = printed.length ? ai.isBareProductNote(draft.note, printed) || ai.isEmptyTapeNote(draft.note) : false;
    const noteOk = printed.length ? Boolean(draft.note) && !fallback : draft.potential && score === 0;
    const row = {
      query: builder.query,
      count: printed.length,
      score,
      wallCount,
      potential: draft.potential,
      note: draft.note,
      names,
      ok: result.ok && !third.length && !cut.length && !placeholder && noteOk && wallCount === printed.length && ownedOk && !unowned.length,
      failures: [
        ...result.failures,
        third.length ? `third-party ${third.join(', ')}` : '',
        cut.length ? `cut ${cut.join(', ')}` : '',
        placeholder ? 'placeholder item' : '',
        fallback ? `fallback note ${JSON.stringify(draft.note)}` : '',
        wallCount !== printed.length ? `wall ${wallCount} != ${printed.length}` : '',
        printed.length && score === 0 ? 'score 0 on a non-empty tape' : '',
        !printed.length && (score !== 0 || !draft.potential) ? 'empty tape score/note disagree' : '',
      ].filter(Boolean),
    };
    report.push(row);
    if (!row.ok) failures.push(`${builder.query}: ${row.failures.join('; ')}`);
  }
  const extras = [];
  for (const builder of ossHeld.extra || []) {
    const { draft, printed } = printBuilder(builder);
    extras.push({
      query: builder.query,
      count: printed.length,
      names: printed.map((item) => item.name),
      note: draft.note,
      ok: printed.length >= (ossHeld.repos[builder.query]?.min || 15),
    });
    if (printed.length < (ossHeld.repos[builder.query]?.min || 15)) {
      failures.push(`${builder.query}: count ${printed.length} < ${ossHeld.repos[builder.query]?.min || 15}`);
    }
  }
  const summary = [...report, ...extras].map((row) => ({
    query: row.query,
    count: row.count,
    samples: (row.names || []).slice(0, 5),
    ok: row.ok,
  }));
  console.log(JSON.stringify({ heldOut: summary }, null, 2));
  assert.deepEqual(failures, [], JSON.stringify({ failures, report, extras }, null, 2));
});
