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
  assert.ok(identity.handleTokens('fofrAI').includes('fofr'));
  assert.equal(identity.handleVariants('fofrAI').includes('fofr'), false);
});

test('name queries split "Tibo from OpenAI"', () => {
  assert.deepEqual(identity.parsePersonName('Tibo from OpenAI'), { name: 'Tibo', company: 'OpenAI', tokens: ['Tibo'], product: null });
  assert.equal(identity.parsePersonName('Steven Tey').company, null);
  assert.equal(identity.prettyPersonName('tibo from open ai'), 'Tibo');
  assert.equal(identity.prettyPersonName('jack friks'), 'Jack Friks');
  assert.equal(identity.prettyPersonName('Michael Truell'), 'Michael Truell');
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
  const jackSite = sources.itemsFromWebEvidence({
    profile: { name: 'Jack Friks', bio: '', site: 'https://jackfriks.com/', x: 'jackfriks', github: 'jackfriks', sites: ['https://jackfriks.com/'] },
    site: {
      url: 'https://jackfriks.com/',
      title: 'Jack Friks',
      description: '',
      icon: null,
      text: 'tools I use',
      links: [
        { text: 'DataFast', url: 'https://datafa.st/' },
        { text: 'ShipFast', url: 'https://shipfa.st/' },
        { text: 'Lovelee', url: 'https://jackfriks.com/#lovelee' },
      ],
    },
    pages: [],
    web: [{ title: 'ShipFast — The NextJS boilerplate', url: 'https://shipfa.st/', snippet: '', date: null }],
    year: 2026,
  });
  assert.equal(jackSite.some((item) => /datafast|shipfast|unicorne|codefast|indiepage|gamifylist/i.test(item.name)), false);
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
  const note = ai.groundedNote(items, 1, 'levelsio', ['553 GitHub stars SuperLevels · github.com/levelsio/superlevels']);
  const clumsy = ai.groundedNote(
    [
      { name: 'LLM-MRCHATTERBOX', description: 'Chat', date: '2026-01', status: 'SHIPPED', link: 'https://github.com/simonw/llm-mrchatterbox', icon: null, source: 'github' },
      { name: 'datasette', description: 'Tool', date: '2026-02', status: 'SHIPPED', link: 'https://github.com/simonw/datasette', icon: null, source: 'github' },
    ],
    1,
    'simonw',
    ['13k GitHub stars llm · github.com/simonw/llm'],
  );
  assert.doesNotMatch(clumsy, /stars llm for/i);
  const ceo = ai.groundedNote(
    [
      { name: 'CODEX APP FOR MACOS', description: 'App', date: '2026-01', status: 'LAUNCHED', link: 'https://openai.com/codex', icon: null, source: 'changelog' },
      { name: 'CHATGPT IMAGES', description: 'Images', date: '2026-02', status: 'LAUNCHED', link: 'https://openai.com/index/images', icon: null, source: 'changelog' },
      { name: 'SORA', description: 'Video', date: '2026-03', status: 'LAUNCHED', link: 'https://openai.com/sora', icon: null, source: 'changelog' },
      { name: 'GPT-5', description: 'Model', date: '2026-04', status: 'LAUNCHED', link: 'https://openai.com/gpt-5', icon: null, source: 'changelog' },
    ],
    2,
    'Sam Altman',
    [],
    { role: 'ceo', company: 'OpenAI' },
  );
  assert.match(ceo, /OpenAI|4|company/i);
  assert.doesNotMatch(ceo, /^CODEX\s+APP/i);
  assert.match(ceo, /OpenAI|Sam|ChatGPT/i);
  const stats = ai.formatStats(items);
  assert.match(stats[0], /3 launches/);
  assert.match(stats[0], /GitHub/);
  assert.doesNotMatch(note, /Thank you for shipping|Come again|No refunds on momentum|Receipt paper running low|Someone likes the publish button|night shift|publish button|\bthe tape\b|\bthe register\b/i);
  assert.match(note, /PHOTOAI|INTERIORAI|SUPERLEVELS/i);
  assert.match(note, /553|stars/i);
  const one = ai.groundedNote(
    [{ name: 'POSTBRIDGE-CLI', description: 'CLI', date: '2026-09-09', status: 'SHIPPED', link: 'https://github.com/jackfriks/postbridge-cli', icon: null, source: 'github' }],
    0,
    'Jack Friks',
    [],
  );
  assert.doesNotMatch(one, /plus 0 more/i);
  assert.match(one, /POSTBRIDGE-CLI/i);
  assert.equal(ai.noteMisusesStats('44k GitHub stars on ZOD', 23, ['553 GitHub stars SuperLevels · github.com/x']), true);
  assert.equal(ai.noteMisusesStats('Zod sits at 326k npm weekly downloads.', 21, ['326k npm weekly downloads Zod · npmjs.com/package/zod']), false);
  assert.equal(ai.cashierNoteLooksCanned(note), false);
  assert.doesNotMatch(note, /supposed to be quiet|still be quoting|plus \d+ more, and /i);
  assert.equal(ai.cashierNoteLooksCanned('Hallmark passed 30k stars while the night shift counted receipts.'), true);
  assert.equal(ai.cashierNoteLooksCanned('553 GitHub stars on SUPERLEVELS. Not bad for a year that was supposed to be quiet.'), true);
  assert.equal(ai.cashierNoteLooksCanned('GPT-5.2-CODEX plus 60 more, and CODEX APP UPDATES is the one people will still be quoting.'), true);
  assert.equal(ai.cashierNoteLooksCanned('runs on a wish and a prayer'), true);
  assert.equal(ai.cashierNoteLooksCanned('Nobody asked for ChatGPT for Research.'), true);
  assert.equal(ai.cashierNoteLooksCanned('200/mo public revenue. Same maker, more SKUs.'), true);
  assert.equal(ai.noteFailsVoice("Tibo's year is CODEX APP through FASTER STEERING IN CODEX: 55 public lines, all theirs."), true);
  assert.equal(ai.noteFailsVoice("Jack's year lives at https://www.npmjs.com/package/postbridge-cli."), true);
  assert.equal(ai.noteFailsVoice('Codex grew long-running work this year, and Tibo\'s agents now stay clocked in overnight.'), false);
  assert.doesNotMatch(note, /\blines\b|https?:\/\/|CODEX APP/i);
  assert.doesNotMatch(one, /\blines\b|https?:\/\/|www\./i);
  assert.doesNotMatch(ceo, /\blines\b|https?:\/\/|\b\d+\s+public\s+ships\b/i);
  const draft = ai.validateDraft(
    {
      items: items.map((item) => ({ name: item.name, description: item.description, date: item.date, status: item.status, link: item.link })),
      note: 'workbench at 450 stars is the crowd favorite, and the night shift has counted a lot of publish buttons since April.',
      stats: ['450 GitHub stars workbench · github.com/pontusab/workbench'],
    },
    {
      found: items.map((item) => ({ ...item, name: item.name.toLowerCase(), score: 4, thisYear: !item.date })),
      web: [],
      pages: [],
      site: null,
      profile: { name: 'levelsio', bio: '', site: 'https://levels.io/', x: 'levelsio', github: 'levelsio' },
      ran: [],
      failed: [],
      stats: [],
    },
    items.map((item) => item.link),
    2026,
    2,
  );
  assert.ok(draft.items.length >= 3);
  assert.ok(draft.stats[0]);
  assert.doesNotMatch(draft.note, /night shift|publish button/i);
  assert.match(draft.note, /PHOTOAI|INTERIORAI|SUPERLEVELS|553|450/i);
  const okNote = ai.validateDraft(
    {
      items: [{ name: 'SuperX', description: 'Growth', date: '2026-02-09', status: 'LAUNCHED', link: 'https://www.producthunt.com/posts/superx' }],
      note: 'SuperX pulled 929 hunters in February. The other tabs are just the merch table.',
      stats: ['929 Product Hunt upvotes SuperX · producthunt.com/posts/superx'],
    },
    {
      found: [{ name: 'SuperX', description: 'Growth', date: '2026-02-09', link: 'https://www.producthunt.com/posts/superx', icon: null, source: 'producthunt', status: 'LAUNCHED', score: 8 }],
      web: [],
      pages: [],
      site: null,
      profile: { name: 'Tibo', bio: '', site: 'https://www.tmaker.io/', x: 'tibo_maker', github: null },
      ran: [],
      failed: [],
    },
    ['https://www.producthunt.com/posts/superx'],
    2026,
    1,
  );
  assert.match(okNote.note, /SuperX/i);
  assert.match(okNote.note, /929/);
  assert.doesNotMatch(okNote.note, /night shift|the tape|publish button/i);
});

test('Product Hunt lookups follow X, handle tokens, and product sites', () => {
  const profile = { name: 'Tibo', bio: '', site: 'https://superx.so/', x: 'tibo_maker', github: null, sites: ['https://superx.so/', 'https://www.tmaker.io/'], phUsers: ['tibo_maker'] };
  const handles = sources.phLookupHandles(profile);
  assert.ok(handles.some((h) => h.username.toLowerCase() === 'tibo_maker' && !h.guessed));
  assert.ok(handles.some((h) => h.username.toLowerCase() === 'tibo' && h.guessed));
  assert.equal(handles.some((h) => h.username.toLowerCase() === 'maker'), false);
  assert.ok(sources.phTwitterUrls('tibo_maker').includes('https://twitter.com/tibo_maker'));
  const sites = sources.phSiteLookups(profile.sites);
  assert.ok(sites.urls.some((u) => /superx\.so/i.test(u)));
  assert.ok(sites.slugs.includes('superx'));
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
  assert.ok(identity.nameLogins('Steven Tey').includes('steven-tey'));
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
  const news = research.itemsFromProjectList({
    text: 'Introducing Codex — January 15, 2026\nSora 2 · 2026-08-07\nLegacy Widget — December 1, 2025',
    url: 'https://openai.com/news',
    year: 2026,
  });
  assert.ok(news.some((item) => /codex/i.test(item.name)), JSON.stringify(news.map((i) => i.name)));
  assert.ok(news.some((item) => /sora/i.test(item.name)));
  assert.equal(news.some((item) => /legacy/i.test(item.name)), false);
  const pins = research.itemsFromProjectList({
    text: "things i'm working on\n📌  post bridge ( social media scheduler )\n📌  lovelee ( couples app )\ncuriosity quench ( quit scrolling app )",
    url: 'https://www.jackfriks.com/',
    year: 2026,
  });
  assert.ok(pins.some((item) => /post bridge/i.test(item.name)), JSON.stringify(pins.map((i) => i.name)));
  assert.ok(pins.some((item) => /lovelee/i.test(item.name)));
  assert.ok(pins.some((item) => /curiosity quench/i.test(item.name)));
  const tight = research.itemsFromProjectList({
    text: '📌 post bridge(social media scheduler)→📌 lovelee(couples app)→ curiosity quench(quit scrolling app)→ deep work depot(deep work timer)→ you talk to jack (the founder)',
    url: 'https://jackfriks.com/',
    year: 2026,
  });
  assert.ok(tight.some((item) => /post bridge/i.test(item.name)), JSON.stringify(tight.map((i) => i.name)));
  assert.ok(tight.some((item) => /deep work depot/i.test(item.name)));
  assert.equal(tight.some((item) => /you talk to/i.test(item.name)), false);
  const friends = research.itemsFromProjectList({
    text: "things i'm working on\n📌 lovelee (couples app)\n\ntools I use\nDataFast (analytics for makers)\nShipFast (nextjs boilerplate)\nIndiePage (portfolio)",
    url: 'https://jackfriks.com/',
    year: 2026,
  });
  assert.ok(friends.some((item) => /lovelee/i.test(item.name)));
  assert.equal(friends.some((item) => /datafast|shipfast|indiepage/i.test(item.name)), false);
  assert.equal(identity.guessHandleDotCom('jackfriks'), 'https://jackfriks.com/');
  assert.equal(identity.guessHandleDotCom('www'), null);
});

test('indie blog month archives become dated ships and skip commentary', () => {
  const text = `October 2026

- 8 Oct I discovered that thousands of bots monitor every new link posted on X
- 5 Oct I made hotelist.com to fix Airbnb's 4.5 to 5.0 rating scale
- 1 Oct An Apple Store in Dubai leaves Apple Watches lying freely

September 2026

- 23 Sep I passed $10M/y in revenue and investment gains with a 94.5% profit margin
- 5 Sep After a decade, I have made nomads.com free for everyone now

August 2026

- 30 Aug I made infiniteslop.ai yesterday completely on my phone
- 29 Aug I built Infinite Slop, an infinite interactive AI generated live stream
- 1 Aug I vibecoded a full video editor into Photo AI that generates and edits videos
`;
  const items = research.itemsFromDatedJournal({ text, url: 'https://levels.io/', year: 2026 });
  const names = items.map((item) => item.name).join(' | ');
  assert.ok(items.some((item) => /hotelist/i.test(item.name)), names);
  assert.ok(items.some((item) => /infiniteslop/i.test(item.name)), names);
  assert.ok(items.some((item) => /nomads/i.test(item.name)), names);
  assert.ok(items.some((item) => /photo ai/i.test(item.name)), names);
  assert.ok(items.some((item) => /10m|milestone/i.test(item.name)), names);
  assert.equal(items.some((item) => /bots monitor/i.test(item.name)), false);
  assert.equal(items.some((item) => /apple store/i.test(item.name)), false);
  assert.ok(items.every((item) => item.date && item.date.startsWith('2026-')));
  assert.ok(items.find((item) => /hotelist/i.test(item.name))?.date === '2026-10-05');
  const flat = research.itemsFromDatedJournal({
    text: 'October 2026 - 5 Oct I made hotelist.com to fix Airbnb ratings - 8 Oct I discovered bots September 2026 - 23 Sep I passed $10M/y in revenue',
    url: 'https://levels.io/',
    year: 2026,
  });
  assert.ok(flat.some((item) => /hotelist/i.test(item.name)), flat.map((item) => item.name).join(' | '));
  assert.ok(research.looksLikePersonalShip('I made hotelist.com to fix ratings'));
  assert.equal(research.looksLikePersonalShip('I discovered that thousands of bots monitor X'), false);
  assert.ok(research.extraResearchPaths('https://levels.io').some((url) => /\/blog$/.test(url)));
  assert.ok(research.extraResearchPaths('https://levels.io').some((url) => /\/rss$/.test(url)));
});

test('Indie Page __NEXT_DATA__ keeps 2026 startups and drops older ones', () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        user: {
          name: 'Marc Lou',
          startups: [
            { name: 'ShipFast', url: 'https://shipfa.st', createdAt: '2023-08-28T00:00:00.000Z', bio: 'Ship your startup' },
            { name: 'Ship or Die', url: 'https://www.ship-or-die.com/', createdAt: '2026-05-25T00:00:00.000Z', bio: 'Ship in 30 days' },
            { name: 'Stalkr', url: 'https://stalkr.ai', createdAt: '2026-06-05T12:00:00.000Z', isShown: true },
            { name: 'Hidden App', url: 'https://hidden.example', createdAt: '2026-03-01T00:00:00.000Z', isShown: false },
            { name: 'DataRadar', url: 'https://dataradar.datafa.st/', createdAt: '2026-03-02T00:00:00.000Z' },
          ],
        },
      },
    },
  })}</script></html>`;
  const items = research.itemsFromEmbeddedPortfolio({ html, url: 'https://marclou.com/', year: 2026 });
  const names = items.map((item) => item.name).join(' | ');
  assert.ok(items.some((item) => /ship or die/i.test(item.name) && item.date === '2026-05-25'), names);
  assert.ok(items.some((item) => /stalkr/i.test(item.name) && item.date === '2026-06-05'), names);
  assert.ok(items.some((item) => /dataradar/i.test(item.name)), names);
  assert.equal(items.some((item) => /shipfast/i.test(item.name)), false);
  assert.equal(items.some((item) => /hidden app/i.test(item.name)), false);
  assert.ok(items.every((item) => item.date && item.date.startsWith('2026-')));
});

test('personal RSS keeps dated ships and drops commentary', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item><title>I made hotelist.com to fix Airbnb ratings</title><link>https://levels.io/hotelist</link><pubDate>Sun, 05 Oct 2026 12:00:00 GMT</pubDate></item>
    <item><title>I discovered that thousands of bots monitor X</title><link>https://levels.io/bots</link><pubDate>Wed, 08 Oct 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = research.itemsFromPersonalFeed({ text: xml, url: 'https://levels.io/rss', year: 2026 });
  assert.ok(items.some((item) => /hotelist/i.test(item.name) && item.date === '2026-10-05'));
  assert.equal(items.some((item) => /bots/i.test(item.name)), false);
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
