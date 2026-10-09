import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const identity = await import('../worker/shipped-identity.ts');
const sources = await import('../worker/shipped-sources.ts');
const ai = await import('../worker/shipped-ai.ts');

test('handle variants stitch X spellings to GitHub logins', () => {
  assert.ok(identity.handleVariants('dannypostmaa').includes('dannypostma'));
  assert.ok(identity.handleVariants('tdinh_me').includes('tdinh'));
  assert.ok(identity.handleVariants('tibo_maker').includes('tibo-maker'));
});

test('name queries split "Tibo from OpenAI"', () => {
  assert.deepEqual(identity.parsePersonName('Tibo from OpenAI'), { name: 'Tibo', company: 'OpenAI', tokens: ['Tibo'] });
  assert.equal(identity.parsePersonName('Steven Tey').company, null);
});

test('bio text yields product URLs and skips social hosts', () => {
  const urls = identity.urlsFromText('PhotoAI.com $86K/m and https://x.com/levelsio plus nomads.com');
  assert.ok(urls.some((u) => /photoai\.com/i.test(u)));
  assert.ok(urls.some((u) => /nomads\.com/i.test(u)));
  assert.equal(urls.some((u) => /x\.com/i.test(u)), false);
});

test('a 0-repo decoy GitHub account scores below the real one', () => {
  const decoy = { login: 'Dannypostmaa', name: '', bio: '', blog: null, x: null, repos: 0 };
  const real = { login: 'dannypostma', name: 'Danny Postma', bio: 'HeadshotPro', blog: 'https://www.headshotpro.com', x: 'dannypostma', repos: 18 };
  const decoyScore = identity.scoreGithubMatch({ user: decoy, wantX: 'dannypostmaa' });
  const realScore = identity.scoreGithubMatch({ user: real, wantX: 'dannypostmaa', wantName: 'Danny Postma' });
  assert.ok(realScore > decoyScore, `${realScore} vs ${decoyScore}`);
  assert.ok(realScore >= 8);
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

test('paid search is allowed below 4 items and capped at 3 uses', () => {
  assert.equal(ai.SEARCH_BELOW, 4);
  assert.equal(ai.maxSearches({}), 3);
  assert.equal(ai.maxSearches({ SHIPPED_MAX_SEARCHES: '9' }), 3);
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
