import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const identity = await import('../worker/shipped-identity.ts');
const sources = await import('../worker/shipped-sources.ts');
const ai = await import('../worker/shipped-ai.ts');
const research = await import('../worker/shipped-research.ts');

test('handle variants stitch X spellings to GitHub logins', () => {
  assert.ok(identity.handleVariants('dannypostmaa').includes('dannypostma'));
  assert.ok(identity.handleVariants('tdinh_me').includes('tdinhme'));
  assert.ok(identity.handleVariants('tibo_maker').includes('tibo-maker'));
  assert.equal(identity.handleVariants('tibo_maker').includes('tibo'), false);
});

test('name queries split "Tibo from OpenAI"', () => {
  assert.deepEqual(identity.parsePersonName('Tibo from OpenAI'), { name: 'Tibo', company: 'OpenAI', tokens: ['Tibo'], product: null });
  assert.equal(identity.parsePersonName('Steven Tey').company, null);
});

test('bio text yields product URLs and skips social hosts', () => {
  const urls = identity.urlsFromText('PhotoAI.com $86K/m and https://x.com/levelsio plus nomads.com');
  assert.ok(urls.some((u) => /photoai\.com/i.test(u)));
  assert.ok(urls.some((u) => /nomads\.com/i.test(u)));
  assert.equal(urls.some((u) => /x\.com/i.test(u)), false);
});

test('public X payloads parse without a person table', () => {
  const vx = identity.xUserFromPayload({
    screen_name: 'tdinh_me',
    name: 'Tony Dinh',
    description: 'Creating software I love to use. https://t.co/p4T2vFYQTt',
  });
  assert.equal(vx?.screen_name, 'tdinh_me');
  const fx = identity.xUserFromPayload({
    code: 200,
    user: { screen_name: 'fofrAI', name: 'fofr', description: 'models', website: { url: 'https://fofr.ai' } },
  });
  assert.equal(fx?.name, 'fofr');
});

test('a 0-repo decoy GitHub account scores below the real one', () => {
  const decoy = { login: 'Dannypostmaa', name: '', bio: '', blog: null, x: null, repos: 0 };
  const real = { login: 'dannypostma', name: 'Danny Postma', bio: 'HeadshotPro', blog: 'https://www.headshotpro.com', x: 'dannypostma', repos: 18 };
  const decoyScore = identity.scoreGithubMatch({ user: decoy, wantX: 'dannypostmaa' });
  const realScore = identity.scoreGithubMatch({ user: real, wantX: 'dannypostmaa', wantName: 'Danny Postma' });
  assert.ok(realScore > decoyScore, `${realScore} vs ${decoyScore}`);
  assert.ok(realScore >= 8);
  const otherTibo = identity.scoreGithubMatch({
    user: { login: 'T-Dnzt', name: 'Tibo', bio: '', blog: null, x: null, repos: 40 },
    wantX: 'tibo_maker',
    wantName: 'Tibo',
  });
  assert.ok(otherTibo < 8, `wrong Tibo scored ${otherTibo}`);
  const nameOnly = identity.scoreGithubMatch({
    user: { login: 'T-Dnzt', name: 'Tibo', bio: '', blog: null, x: null, repos: 40 },
    wantName: 'Tibo',
    wantCompany: 'OpenAI',
  });
  assert.ok(nameOnly < 8, `OpenAI-less Tibo scored ${nameOnly}`);
  const copiedBlog = identity.scoreGithubMatch({
    user: { login: 'fofrai', name: 'fofrAI', bio: '', blog: 'https://fofr.ai', x: 'fofrai', repos: 0 },
    wantX: 'fofrAI',
    wantName: 'fofr',
    wantSite: 'https://fofr.ai/',
  });
  const realFofr = identity.scoreGithubMatch({
    user: { login: 'fofr', name: 'fofr', bio: '', blog: null, x: 'fofrAI', repos: 164 },
    wantX: 'fofrAI',
    wantName: 'fofr',
    wantSite: 'https://fofr.ai/',
  });
  assert.ok(copiedBlog <= 6, `0-repo blog copy scored ${copiedBlog}`);
  assert.ok(realFofr > copiedBlog, `${realFofr} vs ${copiedBlog}`);
});

test('undated own-site products become found items; other years do not', () => {
  const profile = { name: 'Pieter', bio: '', site: 'https://levels.io/', x: 'levelsio', github: 'levelsio', sites: ['https://photoai.com/'] };
  const items = sources.itemsFromWebEvidence({
    profile,
    site: {
      url: 'https://levels.io/',
      title: 'blog',
      description: '',
      icon: null,
      text: 'PhotoAI',
      links: [
        { text: 'PhotoAI', url: 'https://photoai.com/' },
        { text: 'Home', url: 'https://levels.io/' },
      ],
    },
    pages: [],
    web: [{ title: 'Old Thing', url: 'https://old.example/', snippet: '', date: '2024-01-01' }],
    year: 2026,
  });
  assert.ok(items.some((item) => /photoai/i.test(item.name)));
  assert.equal(items.some((item) => /old thing/i.test(item.name)), false);
  const photo = items.find((item) => /photoai/i.test(item.name));
  assert.equal(photo.date, null);
  assert.ok(photo.dateConfidence === 'unknown' || photo.thisYear);
});

test('cashier note and stats are specific to the items, never stock copy', () => {
  const items = [
    { name: 'PHOTOAI', description: 'Headshots', date: '2026-03', status: 'LIVE', link: 'https://photoai.com/', icon: null, source: 'web' },
    { name: 'INTERIORAI', description: 'Rooms', date: '2026-04', status: 'LIVE', link: 'https://interiorai.com/', icon: null, source: 'site' },
    { name: 'SUPERLEVELS', description: 'Repo', date: '2026-04-23', status: 'SHIPPED', link: 'https://github.com/levelsio/superlevels', icon: null, source: 'github' },
  ];
  const note = ai.groundedNote(items, 1, 'levelsio');
  const stats = ai.formatStats(items);
  assert.match(stats[0], /3 launches/);
  assert.match(stats[0], /GitHub/);
  assert.doesNotMatch(note, /Thank you for shipping|Come again|No refunds on momentum/i);
  assert.match(note, /PHOTOAI|3 launch|publish|tape|receipt/i);
  const draft = ai.demoReceipt(
    {
      found: items.map((item) => ({ ...item, name: item.name.toLowerCase(), score: 4, thisYear: !item.date })),
      web: [],
      pages: [],
      site: null,
      profile: { name: 'levelsio', bio: '', site: 'https://levels.io/', x: 'levelsio', github: 'levelsio' },
      ran: [],
      failed: [],
    },
    2026,
    2,
  );
  assert.ok(draft.items.length >= 3);
  assert.ok(draft.stats[0]);
  assert.match(draft.note, /launch/i);
});

test('paid search still runs when harvest is gappy, not only when the tape is empty', () => {
  assert.equal(ai.SEARCH_BELOW, 8);
  assert.equal(ai.maxSearches({}), 3);
  assert.equal(ai.maxSearches({ SHIPPED_MAX_SEARCHES: '9' }), 5);
  assert.equal(ai.maxSearches({ SHIPPED_MAX_SEARCHES: '0' }), 0);
  const gathered = {
    found: [
      { name: 'A', description: '', date: '2026-01-01', link: 'https://example.com/a', icon: null, source: 'github', status: 'SHIPPED', score: 1, thisYear: true },
      { name: 'B', description: '', date: '2026-02-01', link: 'https://example.com/b', icon: null, source: 'github', status: 'SHIPPED', score: 1, thisYear: true },
    ],
    web: [],
    pages: [],
    site: null,
    profile: { name: '', bio: '', site: null, x: null, github: 'ada' },
    ran: [],
    failed: [],
  };
  assert.ok(sources.inYearCount(gathered, 2026) < ai.SEARCH_BELOW);
});

test('identity tables are not an eval cheat sheet', () => {
  assert.deepEqual(identity.IDENTITY_COLLISIONS, {});
  assert.equal(identity.parseProductQuery('the guy who made Photo AI'), 'Photo AI');
  assert.ok(identity.productHostGuesses('Photo AI').some((u) => /photoai\.com/i.test(u)));
  assert.ok(identity.githubLoginsFromText('see github.com/tony-dinh/app').includes('tony-dinh'));
  assert.ok(identity.xHandlesFromText('built by @levelsio on photoai.com').includes('levelsio'));
  assert.ok(identity.makerMentions('Built by @levelsio').x.includes('levelsio'));
  assert.ok(identity.companyLogins('Tibo', 'OpenAI').includes('tibo-openai'));
});

test('a /projects page dated 2026 becomes found items', () => {
  const items = research.itemsFromProjectList({
    text: '2026\n●2026-07 pieter.com Windows XP PC Active\n●2026-04 XDR Boost Active\n2025-03 Old Thing',
    url: 'https://levels.io/projects',
    year: 2026,
  });
  assert.ok(items.some((item) => /xdr boost/i.test(item.name)));
  assert.ok(items.some((item) => /pieter/i.test(item.name)));
  assert.equal(items.some((item) => /old thing/i.test(item.name)), false);
});

test('public MRR and stars keep their source URL', () => {
  const stats = research.extractPublicStats(
    'photoai.com is making $105,000/mo revenue and SuperLevels has 553 stars',
    'https://levels.io/photoai-40870-line-index-php-105k-mo-revenue',
    'Photo AI',
  );
  assert.ok(stats.some((s) => s.kind === 'mrr' && s.value === 105000 && s.url.includes('levels.io')));
  const lines = research.formatReceiptStats(stats);
  assert.ok(lines[0].includes('levels.io'));
  const junk = research.extractPublicStats('Save $70 on monitors and 0000M impressions', 'https://interiorai.com/', 'Interior AI');
  assert.equal(junk.some((s) => s.kind === 'mrr'), false);
});
