import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const affiliation = await import('../worker/shipped-affiliation.ts');
const decisions = await import('../worker/shipped-decisions.ts');
const xai = await import('../worker/shipped-xai.ts');
const year = await import('../lib/shipped-year.ts');
const ai = await import('../worker/shipped-ai.ts');

const found = (over = {}) => ({
  name: 'Codex',
  description: 'Agent that writes code',
  date: '2026-04-12',
  link: 'https://openai.com/codex',
  icon: null,
  source: 'x',
  status: 'LAUNCHED',
  score: 8,
  thisYear: true,
  ...over,
});

test('needsPersonResolve fires when a company is known but the handle is not', () => {
  assert.equal(affiliation.needsPersonResolve({ handle: null, name: 'Tibo', company: 'OpenAI', role: 'unknown' }), true);
  assert.equal(affiliation.needsPersonResolve({ handle: null, name: '', company: 'Higgsfield', role: 'ceo' }), true);
  assert.equal(affiliation.needsPersonResolve({ handle: 'amasad', name: 'Amjad', company: 'Replit', role: 'ceo' }), false);
});

test('typed queries become person → role → company', () => {
  assert.deepEqual(affiliation.parseAffiliationQuery('CEO of Higgsfield'), {
    ...affiliation.emptyAffiliation(),
    role: 'ceo',
    company: 'Higgsfield',
    typedCompany: true,
  });
  assert.equal(affiliation.parseAffiliationQuery('Higgsfield CEO').role, 'ceo');
  assert.equal(affiliation.parseAffiliationQuery('Higgsfield CEO').company, 'Higgsfield');
  const tibo = affiliation.parseAffiliationQuery('Tibo from OpenAI');
  assert.equal(tibo.name, 'Tibo');
  assert.equal(tibo.company, 'OpenAI');
  assert.equal(tibo.typedCompany, true);
  assert.equal(affiliation.defaultAttribution(tibo.role, tibo.typedCompany), 'company-founded-by-person');
  const lead = affiliation.parseAffiliationQuery('Codex lead at OpenAI');
  assert.equal(lead.role, 'lead');
  assert.equal(lead.product, 'Codex');
  assert.equal(lead.company, 'OpenAI');
  assert.equal(affiliation.companyScope('ceo'), 'all');
  assert.equal(affiliation.companyScope('lead'), 'product');
  assert.equal(affiliation.companyScope('unknown'), 'none');
  assert.equal(affiliation.companyScope('employee'), 'none');
  assert.equal(affiliation.companyScope(tibo), 'all');
  assert.equal(affiliation.companyScope(lead), 'product');
  assert.equal(affiliation.shouldInferCompany(affiliation.emptyAffiliation()), false);
  assert.equal(affiliation.shouldInferCompany(tibo), true);
  assert.equal(affiliation.shouldInferCompany({ ...affiliation.emptyAffiliation(), role: 'founder' }), false);
  assert.equal(affiliation.shouldInferCompany({ ...affiliation.emptyAffiliation(), role: 'ceo' }), true);
  assert.deepEqual(affiliation.leadProductTokens('ChatGPT & Codex', 'OpenAI'), ['Codex']);
  assert.equal(affiliation.primaryProduct('ChatGPT & Codex', 'OpenAI'), 'Codex');
  assert.equal(affiliation.viaLabel({ ...affiliation.emptyAffiliation(), company: 'OpenAI', product: 'Codex', role: 'lead' }, 'company-led-by-person'), 'via OpenAI · Codex');
});

test('bio lines upgrade a typed "from Company" into a lead or CEO', () => {
  const typed = affiliation.parseAffiliationQuery('Tibo from OpenAI');
  const bio = affiliation.affiliationFromBio('Codex lead at OpenAI. Shipping agents.', typed);
  assert.equal(bio.role, 'lead');
  assert.equal(bio.product, 'Codex');
  assert.equal(bio.company, 'OpenAI');
  const ceo = affiliation.affiliationFromBio('CEO @higgsfield', affiliation.emptyAffiliation());
  assert.equal(ceo.role, 'ceo');
  assert.equal(ceo.company, 'higgsfield');
});

test('heuristic keep/drop matches the Decisions product threshold', () => {
  const person = affiliation.emptyAffiliation();
  const keep = decisions.heuristicMark(found(), 2026, person);
  assert.ok(decisions.shouldKeep(keep), JSON.stringify(keep));
  assert.ok(keep.isRealShip * keep.inYear >= decisions.KEEP_PRODUCT);
  const tease = decisions.heuristicMark(found({ name: 'Coming soon', description: 'we are hiring', date: null, thisYear: false, link: null }), 2026, person);
  assert.equal(decisions.shouldKeep(tease), false);
  const old = decisions.heuristicMark(found({ date: '2025-11-01', thisYear: false }), 2026, person);
  assert.equal(decisions.shouldKeep(old), false);
});

test('tutorials, case studies, and research writeups are not ships', () => {
  const person = affiliation.emptyAffiliation();
  const drop = [
    'HOW COOLEY IS ACCELERATING IPO WORK',
    'FULL AI CAR COMMERCIAL TUTORIAL',
    'HOW TO USE AGENTIC AI FOR CONTENT CREATION',
    'POLIMILL BUILDS A FACTORY',
    'ACCELERATING ANTIBIOTIC DISCOVERY',
    'HOW TO MAKE REALISTIC VFX SHOTS',
    'USING CODEX CHATGPT TO SEARCH FOR NEW ANTIBIOTICS',
    'RAPIDLY SCALING ONLINE STORAGE',
  ];
  for (const name of drop) {
    const mark = decisions.heuristicMark(found({ name, description: 'blog', link: 'https://openai.com/index/post' }), 2026, person);
    assert.equal(decisions.shouldKeep(mark), false, name);
    assert.equal(mark.kind, 'NOT_A_SHIP');
  }
  const lead = { ...affiliation.parseAffiliationQuery('Tibo from OpenAI'), role: 'lead', product: 'Codex' };
  const health = decisions.heuristicMark(
    found({ name: 'ChatGPT Health', description: 'via OpenAI', link: 'https://openai.com/index/chatgpt-health', via: 'via OpenAI · Codex' }),
    2026,
    lead,
  );
  assert.equal(health.attribution, 'unrelated');
  assert.equal(decisions.shouldKeep(health), false);
  const codex = decisions.heuristicMark(
    found({ name: 'Codex long-running work', description: 'agents', link: 'https://developers.openai.com/codex/changelog', via: 'via OpenAI · Codex' }),
    2026,
    lead,
  );
  assert.equal(codex.attribution, 'company-led-by-person');
  assert.ok(decisions.shouldKeep(codex), JSON.stringify(codex));
  const indie = { ...affiliation.emptyAffiliation(), company: 'Readmake', role: 'founder' };
  const photo = found({
    name: 'PhotoAI',
    description: 'Listed under 2026',
    date: '2026-03-01',
    link: 'https://github.com/levelsio/photo-ai',
    source: 'github',
    via: 'via Readmake',
  });
  const photoMark = decisions.heuristicMark(photo, 2026, indie);
  assert.equal(photoMark.attribution, 'personal');
  assert.equal(decisions.shouldKeep(photoMark, photo), true);

  const story = decisions.heuristicMark(
    found({ name: 'Datadog uses Codex for system-level work', description: 'customer', link: 'https://openai.com/index/datadog', via: 'via OpenAI · Codex' }),
    2026,
    lead,
  );
  assert.equal(decisions.shouldKeep(story), false);
  const repo = found({ name: 'skillbox', source: 'github', link: 'https://github.com/kitze/skillbox', date: '2026-09-17' });
  const repoMark = { ...decisions.heuristicMark(repo, 2026, person), kind: 'NOT_A_SHIP', isRealShip: 0.2 };
  assert.ok(decisions.shouldKeep(repoMark, repo), 'personal github repos stay on the tape');
  const homepage = found({ name: 'Feather', source: 'web', link: 'https://feather.so/', date: null, thisYear: true });
  assert.equal(decisions.isPersonalShipSource(homepage), true);
  const jack = { name: 'Jack Friks', github: 'jackfriks', x: 'jackfriks', site: 'https://jackfriks.com/', sites: ['https://jackfriks.com/'] };
  assert.equal(decisions.isPersonalShipSource(found({ name: 'ShipFast', source: 'web', link: 'https://shipfa.st/', description: 'Public page on shipfa.st' }), jack), false);
  const datafast = found({
    name: 'DataFast',
    description: 'Public page on datafa.st',
    date: null,
    thisYear: true,
    link: 'https://datafa.st/',
    source: 'site',
  });
  const datafastMark = decisions.heuristicMark(datafast, 2026, indie, jack);
  assert.equal(datafastMark.attribution, 'unrelated');
  assert.equal(decisions.shouldKeep(datafastMark, datafast, jack), false);
  const lovelee = found({
    name: 'Lovelee',
    description: 'Pinned on jackfriks.com',
    date: null,
    thisYear: true,
    link: 'https://jackfriks.com/#lovelee',
    source: 'site',
  });
  assert.equal(decisions.shouldKeep(decisions.heuristicMark(lovelee, 2026, indie, jack), lovelee, jack), true);
  const repoJack = found({
    name: 'postbridge-cli',
    source: 'github',
    link: 'https://github.com/jackfriks/postbridge-cli',
    date: '2026-09-09',
  });
  assert.equal(decisions.shouldKeep(decisions.heuristicMark(repoJack, 2026, indie, jack), repoJack, jack), true);
  const virgin = decisions.heuristicMark(
    found({ name: 'Virgin Atlantic ships faster with Codex', link: 'https://openai.com/index/virgin', via: 'via OpenAI · Codex' }),
    2026,
    lead,
  );
  assert.equal(decisions.shouldKeep(virgin), false);
  const journal = found({
    name: 'hotelist.com',
    date: '2026-10-05',
    link: 'https://levels.io/#hotelist',
    source: 'site',
    thisYear: true,
  });
  const unrelated = { ...decisions.heuristicMark(journal, 2026, indie), attribution: 'unrelated', isRealShip: 0.2, inYear: 0.2 };
  assert.equal(decisions.shouldKeep(unrelated, journal), true);
  const leadNoProduct = { ...affiliation.emptyAffiliation(), role: 'lead', company: 'OpenAI', product: null };
  const anyOpenAi = decisions.heuristicMark(
    found({ name: 'Codex app', link: 'https://developers.openai.com/codex/changelog', via: 'via OpenAI' }),
    2026,
    leadNoProduct,
  );
  assert.notEqual(anyOpenAi.attribution, 'unrelated');
});

test('xAI is a keyword gap-fill with a hard post cap and monthly fail-closed', async () => {
  assert.equal(xai.xaiMaxPosts({}), 10);
  assert.equal(xai.xaiMaxPosts({ XAI_MAX_POSTS: '10' }), 10);
  assert.equal(
    xai.xaiKeywordQuery('sama', 2026),
    'from:sama (shipped OR launched OR live OR released OR built OR made OR "just shipped" OR "now live") since:2026-01-01',
  );
  assert.equal(xai.xaiShouldGapFill(1, true), true);
  assert.equal(xai.xaiShouldGapFill(9, true), true);
  assert.equal(xai.xaiShouldGapFill(10, true), false);
  assert.equal(xai.xaiShouldGapFill(6, true), true);
  assert.equal(xai.xaiShouldGapFill(1, false), false);
  assert.equal(xai.ticksToMicros(37_756_000), 3776);
  assert.equal(xai.ticksToUsd(10_000_000_000), 1);
  const meter = xai.memoryXaiMeter(0);
  assert.equal(await meter.allow(), false);
  const empty = await xai.searchXShips({
    env: { XAI_API_KEY: 'sk-test', xaiMeter: meter },
    year: 2026,
    handles: ['sama'],
    who: 'sama',
    kind: 'person',
  });
  assert.equal(empty.found.length, 0);
  assert.equal(empty.spend.costMicros, 0);
  const unmetered = await xai.searchXShips({
    env: { XAI_API_KEY: 'sk-test' },
    year: 2026,
    handles: ['sama'],
    who: 'sama',
    kind: 'person',
  });
  assert.equal(unmetered.spend.costMicros, 0);
  assert.equal(xai.xaiConfigured({ XAI_API_KEY: 'sk-test', SHIPPED_XAI_OFF: '1' }), false);
  const script = xai.scriptXaiMeter({ maxCalls: 0 });
  assert.equal(await script.allow(), false);
  assert.equal(await xai.denyXaiMeter().allow(), false);
  const freeIdent = await xai.resolvePersonWithXai({ env: { XAI_API_KEY: 'sk-test', xaiMeter: xai.memoryXaiMeter(15), xaiMode: 'free' }, who: 'Tibo' });
  assert.equal(freeIdent.handle, null);
  assert.equal(freeIdent.spend.costMicros, 0);
});

test('Decisions and xAI skip when the key is missing', async () => {
  assert.equal(decisions.decisionsEnabled({}), false);
  assert.equal(xai.xaiEnabled({}), false);
  const verified = await decisions.verifyCandidates({
    env: {},
    items: [found(), found({ name: 'Hiring thread', description: 'we are hiring', date: null, thisYear: false, link: null, score: 1 })],
    year: 2026,
    who: 'Tibo',
    affiliation: affiliation.parseAffiliationQuery('Tibo from OpenAI'),
    via: 'via OpenAI',
  });
  assert.equal(verified.usedDecisions, false);
  assert.equal(verified.spend.costMicros, 0);
  assert.ok(verified.items.some((item) => item.name === 'Codex'));
  assert.equal(verified.items.some((item) => /hiring/i.test(item.name)), false);
  const x = await xai.searchXShips({ env: {}, year: 2026, handles: ['sama'], who: 'sama', kind: 'person' });
  assert.deepEqual(x.found, []);
  assert.equal(x.spend.costMicros, 0);
});

test('same_ship pairs share keywords; weaker duplicate is dropped', async () => {
  assert.equal(decisions.shareKeywords(found(), found({ name: 'OpenAI Codex', link: 'https://github.com/openai/codex' })), true);
  assert.equal(decisions.shareKeywords(found(), found({ name: 'Sora', link: 'https://openai.com/sora' })), false);
  assert.equal(
    decisions.shareKeywords(
      found({ name: 'Replit introduces Free Mode', link: 'https://blog.replit.com/free-mode' }),
      found({ name: 'Replit Free Mode', link: 'https://replit.com/free-mode' }),
    ),
    true,
  );
  assert.equal(
    decisions.shareKeywords(found({ name: 'Origin CLI', link: 'https://replit.com/origin' }), found({ name: 'Origin CLI', link: 'https://blog.replit.com/origin-cli' })),
    true,
  );
  assert.equal(
    decisions.shareKeywords(
      found({ name: 'Codex CLI 0.145.0', link: 'https://learn.chatgpt.com/docs/changelog' }),
      found({ name: 'GPT-6.1 Sol Ultrafast', link: 'https://learn.chatgpt.com/docs/changelog' }),
    ),
    false,
  );
  assert.equal(
    decisions.shareKeywords(
      found({ name: 'Codex app 26.608', date: '2026-06-09', link: 'https://learn.chatgpt.com/docs/changelog' }),
      found({ name: 'Codex app updates 26.602', date: '2026-06-04', link: 'https://learn.chatgpt.com/docs/changelog' }),
    ),
    false,
  );
  assert.equal(
    decisions.shareKeywords(
      found({ name: 'Codex', date: '2026-10-09', link: 'https://learn.chatgpt.com/docs/changelog' }),
      found({ name: 'Codex app 26.608', date: '2026-06-09', link: 'https://learn.chatgpt.com/docs/changelog' }),
    ),
    false,
  );
  const typed = affiliation.parseAffiliationQuery('Tibo from OpenAI');
  const typedMark = decisions.heuristicMark(
    found({ name: 'Codex app 26.608', date: '2026-06-09', source: 'changelog', via: 'via OpenAI', link: 'https://learn.chatgpt.com/docs/changelog' }),
    2026,
    typed,
  );
  assert.equal(typedMark.attribution, 'company-founded-by-person');
  assert.ok(decisions.shouldKeep(typedMark), JSON.stringify(typedMark));
  assert.equal(decisions.looksLikeNotAShip({ name: 'Ramp engineers accelerate code review', link: 'https://openai.com/index/ramp' }), true);
  assert.equal(decisions.looksLikeNotAShip({ name: 'Frontier firms are pulling ahead' }), true);
  const same = await decisions.dedupeSameShips({
    env: {},
    items: [
      decisions.applyMark(found({ score: 9, significance: 3 }), decisions.heuristicMark(found(), 2026, affiliation.emptyAffiliation()), null),
      decisions.applyMark(found({ name: 'codex', score: 2, significance: 1, link: 'https://github.com/openai/codex' }), decisions.heuristicMark(found({ name: 'codex' }), 2026, affiliation.emptyAffiliation()), null),
    ],
  });
  assert.equal(same.items.length, 1);
  assert.equal(same.items[0].name, 'Codex');
});

test('long tapes group by significance and month', () => {
  const items = [
    { name: 'A', date: '2026-01-02', significance: 4 },
    { name: 'B', date: '2026-03-01', significance: 2 },
    { name: 'C', date: null, significance: 2 },
    { name: 'D', date: '2026-01-20', significance: 0 },
  ];
  const bySig = year.groupItemsBySignificance(items);
  assert.equal(bySig[0].label, 'LANDMARK');
  assert.equal(bySig[0].items[0].name, 'A');
  assert.ok(bySig.some((g) => g.label === 'NOTABLE LAUNCH' && g.items.length === 2));
  const byMonth = year.groupItemsByMonth(items);
  assert.equal(byMonth[0].label, 'JANUARY 2026');
  assert.equal(byMonth.at(-1).label, 'UNDATED');
});

test('harvest prints up to 200 verified lines without asking Claude to list them', () => {
  assert.equal(ai.MAX_ITEMS, 200);
  const many = Array.from({ length: 40 }, (_, i) =>
    found({ name: `Ship ${i}`, link: `https://example.com/p${i}`, date: `2026-0${(i % 9) + 1}-01`, significance: i % 5 }),
  );
  const gathered = {
    found: many,
    web: [],
    pages: [],
    site: null,
    profile: { name: 'Ada', bio: '', site: null, x: null, github: 'ada' },
    ran: ['decisions:heuristic'],
    failed: [],
    stats: [],
  };
  const items = ai.harvestItems(gathered, 2026);
  assert.equal(items.length, 40);
  assert.ok(items[0].link.startsWith('https://example.com/'));
  const demo = ai.demoReceipt(gathered, 2026, 1);
  assert.equal(demo.items.length, 40);
  assert.equal(demo.potential, false);
});
