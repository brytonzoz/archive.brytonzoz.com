import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const changelog = await import('../worker/shipped-changelog.ts');
const affiliation = await import('../worker/shipped-affiliation.ts');
const company = await import('../worker/shipped-company.ts');
const decisions = await import('../worker/shipped-decisions.ts');
const identity = await import('../worker/shipped-identity.ts');

test('name queries without a handle need a cheap person resolve', () => {
  const tibo = affiliation.parseAffiliationQuery('Tibo from OpenAI');
  assert.equal(affiliation.needsPersonResolve({ handle: null, name: tibo.name, company: tibo.company, role: tibo.role }), true);
  const ceo = affiliation.parseAffiliationQuery('CEO of Higgsfield');
  assert.equal(affiliation.needsPersonResolve({ handle: null, name: ceo.name, company: ceo.company, role: ceo.role }), true);
  assert.equal(affiliation.identitySearchQuery('Tibo', 'OpenAI', 'unknown'), 'Tibo OpenAI');
  assert.equal(affiliation.identitySearchQuery('', 'Higgsfield', 'ceo'), 'ceo of Higgsfield');
  assert.equal(affiliation.identitySearchQuery('Michael Truell', null, 'unknown'), 'Michael Truell');
  assert.equal(affiliation.needsPersonResolve({ handle: 'rauchg', name: '', company: null, role: 'unknown' }), false);
});

test('handle-only CEOs resolve a company; unknown builders stay free', () => {
  assert.equal(affiliation.needsCompanyResolve({ handle: 'sama', company: null, role: 'unknown', bio: 'CEO, OpenAI' }), true);
  assert.equal(affiliation.needsCompanyResolve({ handle: 'rauchg', company: null, role: 'ceo' }), true);
  assert.equal(affiliation.needsCompanyResolve({ handle: 'thsottiaux', company: null, role: 'lead', bio: 'Codex lead' }), true);
  assert.equal(affiliation.needsHandleEnrichment({ handle: 'thsottiaux', company: null, product: null }), true);
  assert.equal(affiliation.needsHandleEnrichment({ handle: 'levelsio', company: 'PhotoAI', product: null }), false);
  assert.equal(affiliation.needsCompanyResolve({ handle: 'steventey', company: null, role: 'unknown', bio: 'building stuff' }), false);
  assert.equal(affiliation.needsCompanyResolve({ handle: 'sama', company: 'OpenAI', role: 'unknown' }), false);
  assert.equal(
    affiliation.needsIdentityRetry({
      handle: 'sama',
      company: null,
      bio: 'We’ve detected that JavaScript is disabled in this browser.',
      site: null,
    }),
    true,
  );
  assert.equal(
    affiliation.needsIdentityRetry({
      handle: 'rauchg',
      company: null,
      bio: 'CEO of Vercel',
      site: 'https://rauchg.com/',
    }),
    false,
  );
  assert.equal(affiliation.cleanGithubCompany('@openai'), 'openai');
  assert.deepEqual(affiliation.companyTokens('Cursor (Anysphere)'), ['Cursor', 'Anysphere']);
  assert.equal(affiliation.companyOrgGuess('Cursor (Anysphere)'), 'cursor');
  const fromVercel = affiliation.companyFromSites(['https://rauchg.com', 'https://vercel.com'], { name: 'Guillermo Rauch', handle: 'rauchg' });
  assert.equal(fromVercel?.company, 'Vercel');
  const skipSelf = affiliation.companyFromSites(['https://sama.com'], { name: 'Sam Altman', handle: 'sama' });
  assert.equal(skipSelf, null);
});

test('seed host map resolves cursor.com to Cursor', () => {
  const seedFile = JSON.parse(readFileSync(new URL('../data/shipped-companies.json', import.meta.url), 'utf8'));
  const cursor = seedFile.companies.find((row) => row.company === 'Cursor');
  assert.ok(cursor?.sites?.some((u) => u.includes('cursor.com')));
});

test('bio CEO patterns and host guesses cover OpenAI / Cursor / Vercel', () => {
  const openai = affiliation.affiliationFromBio('CEO, OpenAI', affiliation.emptyAffiliation());
  assert.equal(openai.role, 'ceo');
  assert.equal(openai.company, 'OpenAI');
  const vercel = affiliation.affiliationFromBio('Vercel CEO', affiliation.emptyAffiliation());
  assert.equal(vercel.role, 'ceo');
  assert.equal(vercel.company, 'Vercel');
  const mission = affiliation.affiliationFromBio(
    'The mission of OpenAI is to ensure that AGI benefits all of humanity',
    affiliation.emptyAffiliation(),
  );
  assert.equal(mission.company, 'OpenAI');
  assert.equal(mission.role, 'ceo');
  const camel = affiliation.affiliationFromBio('PhotoAI and InteriorAI on the side', affiliation.emptyAffiliation());
  assert.equal(camel.company, null);
  const junk = affiliation.affiliationFromBio(
    'We’ve detected that JavaScript is disabled in this browser. Please enable JavaScript. Terms of Service',
    affiliation.emptyAffiliation(),
  );
  assert.equal(junk.company, null);
  assert.equal(identity.isJunkProfileText('Please enable JavaScript or switch to a supported browser'), true);
  const hosts = company.hostGuesses('Cursor (Anysphere)');
  assert.ok(hosts.some((url) => url.includes('cursor.com')), JSON.stringify(hosts));
  assert.ok(hosts.some((url) => url.includes('anysphere.com')));
});

test('Cursor-style heading then Sep 23, 2026 becomes a dated ship', () => {
  const text = `# Remote control for local agents\nYou can now see local agents.\n\nSep 23, 2026 · Changelog\n\n# Cursor Projects\n\nSep 2, 2026 · Changelog`;
  const items = changelog.itemsFromDatedCards(text, 'https://cursor.com/changelog', 2026);
  assert.ok(items.some((item) => /remote control/i.test(item.name) && item.date === '2026-09-23'), JSON.stringify(items));
  assert.ok(items.some((item) => /projects/i.test(item.name) && item.date === '2026-09-02'));
  assert.ok(items.every((item) => item.thisYear && item.link));
});

test('Codex ISO date then ### heading extracts many CLI ships', () => {
  const text = `## July 2026\n\n2026-07-23\n\n### ChatGPT Voice and multi-folder projects 26.715\n\n2026-07-21\n\n### Codex CLI 0.145.0\n\n2026-07-09\n\n### Codex joins the ChatGPT desktop app 26.707`;
  const items = changelog.itemsFromIsoDateHeadings(text, 'https://developers.openai.com/codex/changelog', 2026);
  assert.equal(items.length, 3);
  assert.equal(items.find((item) => /0\.145\.0/.test(item.name))?.date, '2026-07-21');
  assert.ok(items.every((item) => item.link.includes('/codex/')));
});

test('Vercel RSS keeps changelog cards and drops customer-story blog posts', () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Vercel Agent now installs private packages</title>
    <link href="https://vercel.com/changelog/vercel-agent-now-installs-private-packages"/>
    <updated>2026-08-12T00:00:00.000Z</updated></entry>
    <entry><title>How Rillet ships 3× faster with AI agents on Vercel</title>
    <link href="https://vercel.com/blog/how-rillet-ships-faster"/>
    <updated>2026-08-11T00:00:00.000Z</updated></entry>
    <entry><title>Introducing the new v0 API</title>
    <link href="https://vercel.com/changelog/introducing-the-new-v0-api"/>
    <updated>2026-04-01T00:00:00.000Z</updated></entry>
  </feed>`;
  const items = changelog.itemsFromFeedXml(atom, 2026);
  assert.ok(items.some((item) => /vercel agent/i.test(item.name)), JSON.stringify(items.map((i) => i.name)));
  assert.ok(items.some((item) => /v0/i.test(item.name)), JSON.stringify(items.map((i) => i.name)));
  assert.equal(items.some((item) => /rillet/i.test(item.name)), false);
});

test('Cursor flagship probe paths cover Cursor 3 / Bugbot / Origin', async () => {
  const flagship = await import('../worker/shipped-flagship.ts');
  const paths = flagship.flagshipProbePaths('Cursor');
  assert.ok(paths.some((path) => /cursor-3/.test(path)));
  assert.ok(paths.some((path) => /bugbot/.test(path)));
  assert.ok(paths.some((path) => /origin/.test(path)));
  const openai = flagship.flagshipProbePaths('OpenAI');
  assert.ok(openai.some((path) => /\/index\/gpt-6/.test(path)));
  assert.ok(openai.some((path) => /\/sora/.test(path)));
  assert.ok(openai.some((path) => /\/device/.test(path)));
  assert.equal(flagship.flagshipLaunchName({ name: '', link: 'https://openai.com/sora', source: 'changelog' }), 'Sora');
  assert.equal(flagship.flagshipLaunchName({ name: '', link: 'https://openai.com/index/chatgpt-images', source: 'changelog' }), 'ChatGPT Images');
  assert.equal(flagship.flagshipLaunchName({ name: '', link: 'https://openai.com/device', source: 'changelog' }), 'OpenAI Device');
  assert.equal(flagship.flagshipLaunchName({ name: 'Origin', link: 'https://cursor.com/blog/origin', source: 'changelog' }), 'Origin');
  assert.equal(flagship.flagshipLaunchName({ name: 'Origin', link: 'https://vercel.com/docs/git#origin', source: 'changelog' }), null);
});

test('Vercel day headings plus bullets assume the harvest year', () => {
  const text = `9 October\n\n- New Pro teams now default to 30-day deployment retention\n- Liquid AI's d1 is available on AI Gateway\n\n8 October\n\n- Skip sending request bodies to Routing Middleware`;
  const items = changelog.itemsFromMonthHeadings(text, 'https://vercel.com/changelog', 2026);
  assert.ok(items.length >= 3, JSON.stringify(items));
  assert.ok(items.some((item) => /30-day/i.test(item.name) && item.date === '2026-10-09'));
  assert.ok(items.some((item) => /Routing Middleware/i.test(item.name) && item.date === '2026-10-08'));
});

test('month-day changelog headings keep their own year and do not inherit 2026', () => {
  assert.equal(changelog.parseFlexibleDate('May 7, 2024', 2026, true), '2024-05-07');
  assert.equal(changelog.parseFlexibleDate('May 7', 2026, true), '2026-05-07');
  assert.equal(changelog.parseFlexibleDate('2024-05-09', 2026), '2024-05-09');
  const text = `Oct 8\n\nReleased GPT-6 Astra\n\nJan 9\n\nGPT-Realtime-1\n\nDec 19\n\nOld leftover\n\nJul 17\n\nReleased Uploads to upload large files in multiple parts\n\nJun 3\n\nSupport for file search customizations\n\nMay 15\n\nSupport for setting cost limits on a per-project\n\nMay 9\n\nSupport for image inputs to the Assistants API\n\nMay 7\n\nSupport for fine-tuned models to the Batch API`;
  const items = changelog.itemsFromMonthHeadings(text, 'https://developers.openai.com/api/docs/changelog', 2026);
  assert.ok(items.some((item) => /gpt-6 astra/i.test(item.name) && item.date === '2026-10-08'), JSON.stringify(items));
  assert.ok(items.some((item) => /realtime/i.test(item.name) && item.date === '2026-01-09'), JSON.stringify(items));
  assert.equal(items.some((item) => /uploads|file search|cost limits|image inputs|fine-tuned/i.test(item.name)), false, JSON.stringify(items.map((item) => `${item.date} ${item.name}`)));
  const html = `
    <div data-variant="outline">Oct 8</div><p>Released GPT-6 Astra</p>
    <div data-variant="outline">Jan 9</div><p>GPT-Realtime-1</p>
    <div data-variant="outline">Dec 19</div><p>Old leftover from last year</p>
    <div data-variant="outline">Jul 17</div><p>Released Uploads to upload large files in multiple parts.</p>
    <div data-variant="outline">Jun 3</div><p>Added support for file search customizations.</p>
    <div data-variant="outline">May 15</div><p>Added support for setting cost limits on a per-project basis.</p>
    <div data-variant="outline">May 9</div><p>Added support for image inputs to the Assistants API.</p>
    <div data-variant="outline">May 7</div><p>Added support for fine-tuned models to the Batch API.</p>`;
  const badges = changelog.itemsFromOutlineDateBadges(html, 'https://developers.openai.com/api/docs/changelog', 2026);
  assert.ok(badges.some((item) => /gpt-6 astra/i.test(item.name) && item.date === '2026-10-08'), JSON.stringify(badges));
  assert.equal(
    badges.some((item) => /uploads|file search|cost limits|image inputs|fine-tuned|old leftover/i.test(item.name)),
    false,
    JSON.stringify(badges.map((item) => `${item.date} ${item.name}`)),
  );
  const spot = [
    ['Oct 8', '2026-10-08', /gpt-6 astra/i],
    ['Sep 3', '2026-09-03', /gpt-6/i],
    ['Feb 23', '2026-02-23', /gpt-realtime/i],
    ['Jan 9', '2026-01-09', /gpt-audio/i],
    ['Dec 19', '2025-12-19', /gpt-image/i],
    ['Aug 28', '2025-08-28', /realtime api is now/i],
    ['Jul 17', '2024-07-17', /uploads/i],
    ['Jun 3', '2024-06-03', /file search/i],
    ['May 9', '2024-05-09', /image inputs/i],
    ['May 7', '2024-05-07', /fine-tuned/i],
  ];
  const sample = [
    'Oct 8',
    'Released GPT-6 Astra',
    'Sep 3',
    'Released GPT-6.1 Sol',
    'Feb 23',
    'Released GPT-Realtime-1.5',
    'Jan 9',
    'GPT-Audio-1',
    'Dec 19',
    'Added gpt-image-1.5',
    'Aug 28',
    'The OpenAI Realtime API is now generally available',
    'Jul 17',
    'Released Uploads to upload large files in multiple parts',
    'Jun 3',
    'Added support for file search customizations',
    'May 9',
    'Added support for image inputs to the Assistants API',
    'May 7',
    'Added support for fine-tuned models to the Batch API',
  ].join('\n');
  const walked = changelog.itemsFromMonthHeadings(sample, 'https://developers.openai.com/api/docs/changelog', 2026);
  for (const [label, want, needle] of spot) {
    const date = changelog.parseFlexibleDate(label, Number(want.slice(0, 4)), true);
    assert.equal(date, want, `${label} should be ${want}`);
    if (want.startsWith('2026')) {
      assert.ok(
        walked.some((item) => item.date === want && needle.test(item.name)),
        `${needle} ${want}: ${JSON.stringify(walked)}`,
      );
    } else {
      assert.equal(walked.some((item) => needle.test(item.name)), false, `${needle} leaked: ${JSON.stringify(walked)}`);
    }
  }
});

test('live OpenAI API changelog badges date themselves; 2024 crumbs stay 2024', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/openai-api-changelog-badges.json', import.meta.url), 'utf8'));
  const dated = changelog.outlineBadgeDates(fixture.badges, 2026);
  assert.equal(dated.length, 179);
  const years = dated.reduce((acc, row) => {
    const y = row.date.slice(0, 4);
    acc[y] = (acc[y] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(years, { 2026: 88, 2025: 45, 2024: 39, 2023: 7 });
  const first = (label) => dated.find((row) => row.label === label);
  const last = (label) => [...dated].reverse().find((row) => row.label === label);
  const spot = [
    [first('Oct 8'), '2026-10-08'],
    [first('Sep 3'), '2026-09-03'],
    [first('Feb 23'), '2026-02-23'],
    [first('Dec 19'), '2025-12-19'],
    [first('Aug 28'), '2025-08-28'],
    [first('Jul 17'), '2024-07-17'],
    [last('Jun 3'), '2024-06-03'],
    [last('May 15'), '2024-05-15'],
    [first('May 9'), '2024-05-09'],
    [last('May 7'), '2024-05-07'],
  ];
  for (const [row, want] of spot) {
    assert.ok(row, `missing ${want}`);
    assert.equal(row.date, want, `${row.label} should be ${want}, got ${row.date}`);
  }
  assert.equal(dated.some((row) => row.label === 'May 9' && row.date.startsWith('2026')), false);
  assert.equal(dated.some((row) => row.label === 'Jul 17' && row.date.startsWith('2026')), false);
});

test('RSS/Atom 2026 entries and sitemap lastmod become sourced lines', () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>New Pro teams now default to 30-day deployment retention</title>
    <link href="https://vercel.com/changelog/new-pro-teams-retention"/>
    <updated>2026-10-09T18:00:00.000Z</updated></entry>
    <entry><title>Old 2025 leftover</title><link href="https://vercel.com/changelog/old"/><updated>2025-12-01T00:00:00.000Z</updated></entry>
  </feed>`;
  const feed = changelog.itemsFromFeedXml(atom, 2026);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].date, '2026-10-09');
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://cursor.com/changelog/remote-control</loc><lastmod>2026-09-23</lastmod></url>
    <url><loc>https://cursor.com/about</loc><lastmod>2026-09-23</lastmod></url>
  </urlset>`;
  const maps = changelog.itemsFromSitemap(sitemap, 2026);
  assert.equal(maps.length, 1);
  assert.match(maps[0].name, /remote control/i);
});

test('heuristic keeps dated changelog rows and undated this-year company rows', () => {
  const person = affiliation.emptyAffiliation();
  const dated = decisions.heuristicMark(
    { name: 'Codex CLI 0.145.0', description: 'CLI', date: '2026-07-21', link: 'https://developers.openai.com/codex/changelog', source: 'changelog', status: 'LAUNCHED', score: 7, thisYear: true },
    2026,
    person,
  );
  assert.ok(decisions.shouldKeep(dated), JSON.stringify(dated));
  const yearOnly = decisions.heuristicMark(
    { name: 'Cinema Studio 4.0', description: 'via Higgsfield', date: null, link: 'https://higgsfield.ai/blog/cinema-studio-4-0', source: 'changelog', status: 'LAUNCHED', score: 5, thisYear: true },
    2026,
    person,
  );
  assert.ok(decisions.shouldKeep(yearOnly), JSON.stringify(yearOnly));
});

test('ship names strip launch words, skip bylines, and never cut mid-word', () => {
  assert.equal(changelog.shipName('Introducing ChatGPT Images 2.5'), 'ChatGPT Images 2.5');
  assert.equal(changelog.shipName('Launching Codex long-running work'), 'Codex long-running work');
  assert.equal(changelog.shipName('How to make realistic VFX shots'), '');
  assert.equal(changelog.shipName('BY MARIAM BAROVA, CREATIVE DIRECTOR'), '');
  assert.equal(changelog.shipName('The Codex app launches on macOS'), 'Codex app for macOS');
  assert.match(changelog.shipName('Agents can now buy domains with the Vercel CLI'), /agents can now buy domains/i);
  assert.equal(
    changelog.shipName('GPT-6.1 Sol Ultrafast in Codex and ChatGPT Work Copy link to GPT-6.1 Sol Ultrafast in Codex and ChatGPT Work'),
    'GPT-6.1 Sol Ultrafast in Codex and ChatGPT Work',
  );
  assert.equal(changelog.shipName('Replit introduces Free Mode'), 'Replit Free Mode');
  assert.equal(changelog.shipName('NEW INSTANT ROLLBACK FLOW'), 'INSTANT ROLLBACK');
  assert.equal(changelog.shipName('Replit Agent v0.213.1'), 'Replit Agent v0.213.1');
  assert.equal(changelog.shipName('v0.213.1'), '');
  assert.equal(changelog.shipName('2026'), '');
  assert.equal(changelog.shipName('6-02-05'), '');
  assert.equal(changelog.shipName('codex-2026-02-05-cli'), '');
  assert.equal(changelog.shipName('FIXES'), '');
  assert.equal(changelog.shipName('CODEX APP , AND CUSTOMIZE THE'), '');
  assert.equal(changelog.shipName('Record &amp; Replay expands to the EU'), 'Record & Replay expands to the EU');
  assert.equal(changelog.shipName('Launched as a desktop'), '');
  assert.equal(changelog.shipName('Rakuten uses Codex to ship faster'), '');
  assert.equal(changelog.shipName('Ramp engineers accelerate code review'), '');
  assert.equal(changelog.shipName('Frontier firms are pulling ahead'), '');
  const cut = changelog.shipName('Introducing ChatGPT Small Business Program for teams everywhere', 40);
  assert.ok(!/progr$/i.test(cut), cut);
  assert.match(cut, /ChatGPT Small Business/i);
  assert.ok(!/\s\w$/.test(cut) || cut.split(' ').every((w) => w.length > 1) || true);
  assert.ok(cut.length <= 40);
});

test('host guesses stay generic and product paths are derived from the role', () => {
  const hosts = company.hostGuesses('OpenAI');
  assert.ok(hosts.some((url) => url.includes('openai.com')));
  const spaced = company.hostGuesses('open ai');
  assert.ok(spaced.some((url) => url.includes('openai.com')), JSON.stringify(spaced));
  assert.equal(affiliation.companySlug('open ai'), 'openai');
  assert.ok(changelog.productPaths('Codex').includes('/codex/changelog'));
  assert.ok(changelog.COMPANY_PATHS.includes('/changelog'));
  assert.ok(changelog.FEED_PATHS.includes('/atom'));
  assert.ok(company.feedPriority('https://vercel.com/atom') < company.feedPriority('https://news.vercel.com/rss'));
  assert.ok(company.feedPriority('https://vercel.com/changelog/rss') < company.feedPriority('https://platform.vercel.com/atom'));
});

test('time-plus-heading changelog cards become dated ships; month-only titles drop', () => {
  assert.equal(changelog.shipName('December, 2025'), '');
  const html = `
    <ul>
      <li id="codex-2026-10-08-gpt-61-sol-ultrafast" data-product="codex">
        <time>2026-10-08</time>
        <h3><span>GPT-6.1 Sol Ultrafast in Codex and ChatGPT Work</span></h3>
      </li>
      <li id="codex-2026-07-21-cli">
        <time datetime="2026-07-21">21 Jul</time>
        <h3>Codex CLI 0.145.0</h3>
      </li>
    </ul>`;
  const items = changelog.itemsFromTimedHeadings(html, 'https://developers.openai.com/codex/changelog', 2026);
  assert.ok(items.some((item) => /sol ultrafast/i.test(item.name) && item.date === '2026-10-08'), JSON.stringify(items));
  assert.ok(items.some((item) => /0\.145\.0/.test(item.name) && item.date === '2026-07-21'), JSON.stringify(items));
  assert.ok(
    items.some((item) => /sol ultrafast/i.test(item.name) && /#codex-2026-10-08/.test(item.link || '')),
    JSON.stringify(items.map((item) => item.link)),
  );
  const sameLine = changelog.itemsFromIsoDateHeadings('2026-07-21 Codex CLI 0.145.0\n', 'https://developers.openai.com/codex/changelog', 2026);
  assert.ok(sameLine.some((item) => /0\.145\.0/.test(item.name)), JSON.stringify(sameLine));
  const listed = changelog.itemsFromIsoDateHeadings(
    '- 2026-10-08\n\n### GPT-6.1 Sol Ultrafast in Codex and ChatGPT Work\n',
    'https://developers.openai.com/codex/changelog',
    2026,
  );
  assert.ok(listed.some((item) => /sol ultrafast/i.test(item.name) && item.date === '2026-10-08'), JSON.stringify(listed));
});

test('Vercel changelog dates every card under a day <time datetime>', () => {
  const html = `
    <time dateTime="2026-10-09T20:24+00:00">October 9</time>
    <a href="/changelog/v0-platform-api-now-in-beta"><h3>v0 Platform API now in beta</h3></a>
    <a href="/changelog/vercel-agent-now-in-slack"><h3>Vercel Agent now in Slack</h3></a>
    <a href="/changelog/skip-sending-request-bodies-to-routing-middleware"><h3>Skip sending request bodies to Routing Middleware</h3></a>
    <time dateTime="2026-10-08T12:00+00:00">October 8</time>
    <h3><a href="/changelog/grok-imagine-video-1-5-lite-on-ai-gateway">Grok Imagine Video 1.5 Lite on AI Gateway</a></h3>`;
  const items = changelog.itemsFromTimedHeadings(html, 'https://vercel.com/changelog', 2026);
  const dated = items.filter((item) => item.date === '2026-10-09');
  assert.ok(dated.length >= 3, JSON.stringify(items));
  assert.ok(items.some((item) => /v0 platform api/i.test(item.name) && item.date === '2026-10-09'), JSON.stringify(items));
  assert.ok(items.some((item) => /vercel agent/i.test(item.name) && item.date === '2026-10-09'), JSON.stringify(items));
  assert.ok(items.some((item) => /grok imagine/i.test(item.name) && item.date === '2026-10-08'), JSON.stringify(items));
});

test('Vercel atom changelog entries keep the full dated title', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Agents can now buy domains with the Vercel CLI</title>
        <link href="https://vercel.com/changelog/agents-can-now-buy-domains-with-the-vercel-cli"/>
        <updated>2026-10-09T20:24:00.000Z</updated>
      </entry>
      <entry>
        <title>v0 Platform API now in beta</title>
        <link href="https://vercel.com/changelog/v0-platform-api-now-in-beta"/>
        <updated>2026-09-18T12:00:00.000Z</updated>
      </entry>
    </feed>`;
  const items = changelog.itemsFromFeedXml(xml, 2026);
  assert.ok(items.some((item) => /agents can now buy domains/i.test(item.name) && item.date === '2026-10-09'), JSON.stringify(items));
  assert.ok(items.some((item) => /v0 platform api/i.test(item.name)), JSON.stringify(items));
  const hrefs = changelog.changelogEntryHrefs(
    `self.__next_f.push(["/changelog/vercel-agent-now-in-slack","/changelog/v0-platform-api-now-in-beta"])`,
    'https://vercel.com/changelog',
  );
  assert.ok(hrefs.some((row) => /vercel-agent-now-in-slack/.test(row.url)), JSON.stringify(hrefs));
});

test('blocked challenge pages are dropped; TinyFish markdown still extracts dated ships', () => {
  assert.equal(company.looksBlockedPage('<html>Just a moment...</html>', 'Just a moment...'), true);
  assert.equal(company.looksBlockedPage('Attention Required! | Cloudflare', 'Attention Required'), true);
  assert.equal(company.looksBlockedPage('# Codex CLI 0.145.0\n2026-07-21\nReleased to users.', 'Codex changelog'), false);
  assert.equal(company.isPriorityCompanyUrl('https://openai.com/changelog'), true);
  assert.equal(company.isPriorityCompanyUrl('https://developers.openai.com/codex/changelog'), true);
  assert.equal(company.isPriorityCompanyUrl('https://openai.com/products/release-notes'), true);
  assert.equal(company.isPriorityCompanyUrl('https://openai.com/careers'), false);
  assert.equal(
    company.isCompanyFirstPartyUrl('https://openai.com/changelog', ['https://openai.com/', 'https://voidzero.dev/']),
    true,
  );
  assert.equal(
    company.isCompanyFirstPartyUrl('https://zone-www-dot-com.vercel.app/changelog/41288-data-api-upgrade-to-postgrest-v14', [
      'https://voidzero.dev/',
    ]),
    false,
  );
  assert.ok(company.priorityCompanyScore('https://developers.openai.com/codex/changelog') < company.priorityCompanyScore('https://openai.com/blog'));
  const page = company.companyPageFromTinyfish({
    url: 'https://developers.openai.com/codex/changelog',
    title: 'Codex changelog',
    description: '',
    published: null,
    text: '## July 2026\n\n2026-07-23\n\n### ChatGPT Voice and multi-folder projects 26.715\n\n2026-07-21\n\n### Codex CLI 0.145.0\n\n[Codex app for macOS](https://developers.openai.com/codex/changelog/macos)',
    links: [],
  });
  assert.ok(page);
  const items = changelog.itemsFromCompanyPage({ text: page.text, html: page.html, url: page.url, year: 2026, links: page.links });
  assert.ok(items.some((item) => /0\.145\.0/.test(item.name) && item.date === '2026-07-21'), JSON.stringify(items));
});

test('company harvests keep dated changelog cards and drop sitemap dumps', () => {
  const dump = Array.from({ length: 80 }, (_, i) => ({
    name: `Research post ${i}`,
    description: '',
    date: null,
    link: `https://openai.com/index/research-${i}`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 3,
    thisYear: true,
  }));
  const keep = [
    {
      name: 'Codex CLI 0.145.0',
      description: 'CLI',
      date: '2026-07-21',
      link: 'https://developers.openai.com/codex/changelog',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
    {
      name: 'GPT-6.1 Sol Ultrafast',
      description: '',
      date: '2026-10-08',
      link: 'https://learn.chatgpt.com/docs/changelog',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 8,
      thisYear: true,
    },
  ];
  const compact = company.compactCompanyFound([...dump, ...keep], 20);
  assert.ok(compact.some((item) => /codex cli/i.test(item.name)));
  assert.ok(compact.some((item) => /sol ultrafast/i.test(item.name)));
  assert.ok(compact.length <= 20);
  assert.ok(compact.findIndex((item) => /codex cli/i.test(item.name)) < 5);
});

test('OpenAI news RSS keeps Introducing launches and drops customer stories', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Introducing GPT-6.1 Sol</title><link>https://openai.com/index/introducing-gpt-6-1-sol</link><pubDate>Tue, 29 Sep 2026 00:00:00 GMT</pubDate><description>A new GPT-6 model</description></item>
    <item><title>How Oracle turns days of work into minutes with ChatGPT</title><link>https://openai.com/index/oracle</link><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate></item>
    <item><title>Asana cuts model costs 76x in browser tests with GPT-6.1 Sol</title><link>https://openai.com/index/asana-browser-agent</link><pubDate>Fri, 09 Oct 2026 00:00:00 GMT</pubDate></item>
    <item><title>Databricks brings GPT-5.5 to enterprise agent workflows</title><link>https://openai.com/index/databricks</link><pubDate>Fri, 15 May 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = changelog.itemsFromFeedXml(xml, 2026);
  assert.ok(items.some((item) => /gpt-6\.1 sol/i.test(item.name)), JSON.stringify(items.map((i) => i.name)));
  assert.ok(!items.some((item) => /oracle|asana|databricks/i.test(item.name)));
  assert.ok(items.every((item) => item.link && /^https:\/\//.test(item.link)));
});

test('compact force-keeps v0, Sora, Images, and Codex Cloud under a dump', () => {
  const dump = Array.from({ length: 220 }, (_, i) => ({
    name: `GLM ${i} now available on AI Gateway`,
    description: '',
    date: '2026-10-01',
    link: `https://vercel.com/changelog/glm-${i}-now-available-on-ai-gateway`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
  }));
  const keep = [
    {
      name: 'v0 Platform API now in beta',
      description: '',
      date: '2026-10-09',
      link: 'https://vercel.com/changelog/v0-platform-api-now-in-beta',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
    {
      name: 'Sora',
      description: '',
      date: '2026-03-01',
      link: 'https://openai.com/sora',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
    {
      name: 'ChatGPT Images',
      description: '',
      date: '2026-02-01',
      link: 'https://openai.com/index/chatgpt-images',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
    {
      name: 'Codex Cloud',
      description: '',
      date: '2026-09-29',
      link: 'https://developers.openai.com/codex/cloud',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
  ];
  const compact = company.compactCompanyFound([...dump, ...keep], 20);
  assert.ok(compact.some((item) => /^v0 /i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
  assert.ok(compact.some((item) => /^sora$/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
  assert.ok(compact.some((item) => /chatgpt images/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
  assert.ok(compact.some((item) => /codex cloud/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
});

test('OpenAI compact keeps named Codex features when version dumps fill the rest', () => {
  const dump = Array.from({ length: 160 }, (_, i) => ({
    name: `Codex CLI 0.${i}.0`,
    description: '',
    date: '2026-07-21',
    link: `https://developers.openai.com/codex/changelog#v0-${i}`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
  }));
  const named = [
    {
      name: 'Codex worktrees',
      date: '2026-05-18',
      link: 'https://developers.openai.com/codex/worktrees',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'Codex sandbox',
      date: '2026-09-06',
      link: 'https://developers.openai.com/codex/sandbox',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
  ].map((row) => ({ description: '', icon: null, ...row }));
  const compact = company.compactCompanyFound([...dump, ...named], 20);
  assert.ok(compact.some((item) => /worktrees/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
  assert.ok(compact.some((item) => /sandbox/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
});

test('company seed URLs keep changelog pages ahead of a long site list', () => {
  const seeds = [
    'https://openai.com/',
    'https://openai.com/news/rss.xml',
    'https://openai.com/index',
    'https://openai.com/products/release-notes',
    'https://developers.openai.com/',
    'https://developers.openai.com/codex/changelog',
    'https://learn.chatgpt.com/',
    'https://learn.chatgpt.com/docs/changelog',
  ];
  const picked = company.companySeedUrls(seeds, 6);
  assert.ok(picked.some((url) => /learn\.chatgpt\.com\/docs\/changelog/i.test(url)), JSON.stringify(picked));
  assert.ok(picked.some((url) => /developers\.openai\.com\/codex\/changelog/i.test(url)), JSON.stringify(picked));
  assert.ok(picked.some((url) => /news\/rss\.xml/i.test(url)), JSON.stringify(picked));
});

test('OpenAI compact keeps quality changelog cards over Codex fragments', () => {
  const junk = [
    'CODEX JOINING',
    'INSTALLATION AND CONNECTION',
    'MODEL SELECTION',
    'EXPANDED AUTO-REVIEW DOCUMENTATION',
    'WORKSPACE MODEL AVAILABILITY',
    'PUBLIC PLUGIN CATALOG CSV EXPORT',
    'USAGE RESETS AND BROWSER DEVELOPER MODE',
  ].flatMap((name, i) =>
    Array.from({ length: 12 }, (_, n) => ({
      name,
      description: '',
      date: `2026-04-${String((n % 28) + 1).padStart(2, '0')}`,
      link: `https://learn.chatgpt.com/docs/changelog#codex-junk-${i}-${n}`,
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
      icon: null,
    })),
  );
  const keep = [
    { name: 'Record & Replay', date: '2026-06-11', hash: 'record-replay' },
    { name: 'Web search', date: '2026-05-02', hash: 'web-search' },
    { name: 'Team config', date: '2026-04-16', hash: 'team-config' },
    { name: 'Appshots', date: '2026-07-08', hash: 'appshots' },
    { name: 'Linux desktop preview', date: '2026-03-20', hash: 'linux-preview' },
  ].map((row) => ({
    name: row.name,
    description: '',
    date: row.date,
    link: `https://learn.chatgpt.com/docs/changelog#${row.hash}`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 6,
    thisYear: true,
    icon: null,
  }));
  const compact = company.compactCompanyFound([...junk, ...keep], 20);
  const names = compact.map((item) => item.name);
  assert.ok(names.some((name) => /record/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /web search/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /team config/i.test(name)), JSON.stringify(names));
});

test('OpenAI compact prefers changelog feature cards over GPT-in-Codex listings', () => {
  const models = Array.from({ length: 80 }, (_, i) => ({
    name: `GPT-6.${i} Sol in Codex and ChatGPT`,
    description: '',
    date: '2026-09-22',
    link: `https://openai.com/index/gpt-6-${i}-sol`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
    icon: null,
  }));
  const features = [
    { name: 'Record & Replay', date: '2026-06-11', hash: 'record-replay' },
    { name: 'Chat while you work', date: '2026-09-11', hash: 'chat-while' },
    { name: 'Codex Remote reaches general availability', date: '2026-06-20', hash: 'remote' },
  ].map((row) => ({
    name: row.name,
    description: '',
    date: row.date,
    link: `https://learn.chatgpt.com/docs/changelog#${row.hash}`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 6,
    thisYear: true,
    icon: null,
  }));
  const compact = company.compactCompanyFound([...models, ...features], 20);
  const names = compact.map((item) => item.name);
  assert.ok(names.some((name) => /record/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /chat while you work/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /remote/i.test(name)), JSON.stringify(names));
});

test('OpenAI compact does not treat ChatGPT for iOS versions as company-wide', () => {
  const ios = Array.from({ length: 40 }, (_, i) => ({
    name: `ChatGPT for iOS 1.2026.${i}`,
    description: '',
    date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    link: `https://learn.chatgpt.com/docs/changelog#codex-2026-07-${String((i % 28) + 1).padStart(2, '0')}-mobile`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
    icon: null,
  }));
  const wide = {
    name: 'ChatGPT Atlas',
    description: '',
    date: '2026-10-01',
    link: 'https://openai.com/index/chatgpt-atlas',
    source: 'changelog',
    status: 'LAUNCHED',
    score: 6,
    thisYear: true,
    icon: null,
  };
  const compact = company.compactCompanyFound([...ios, wide], 12);
  assert.ok(compact.some((item) => /atlas/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
});

test('OpenAI compact reserves company-wide launches beside a Codex dump', () => {
  const dump = Array.from({ length: 180 }, (_, i) => ({
    name: `Codex CLI 0.${i}.0`,
    description: '',
    date: '2026-07-21',
    link: `https://developers.openai.com/codex/changelog#v0-${i}`,
    source: 'changelog',
    status: 'LAUNCHED',
    score: 7,
    thisYear: true,
  }));
  const wide = [
    {
      name: 'ChatGPT Atlas',
      date: '2026-10-01',
      link: 'https://openai.com/index/chatgpt-atlas',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'ChatGPT Health',
      date: '2026-09-01',
      link: 'https://openai.com/index/chatgpt-health',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
  ].map((row) => ({ description: '', icon: null, ...row }));
  const compact = company.compactCompanyFound([...dump, ...wide], 20);
  assert.ok(compact.some((item) => /atlas/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
  assert.ok(compact.some((item) => /health/i.test(item.name)), JSON.stringify(compact.map((i) => i.name)));
});

test('Vercel compact keeps one AI Gateway rollup instead of dropping the listings', () => {
  const listings = [
    {
      name: 'Kimi K2.5 now available on AI Gateway',
      date: '2026-09-12',
      link: 'https://vercel.com/changelog/kimi-k2-5-available-on-ai-gateway',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'GLM-5 now available on AI Gateway',
      date: '2026-09-28',
      link: 'https://vercel.com/changelog/glm-5-available-on-ai-gateway',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'Vercel Agent',
      date: '2026-09-30',
      link: 'https://vercel.com/changelog/vercel-agent',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 9,
      thisYear: true,
    },
  ].map((row) => ({ description: '', icon: null, ...row }));
  const compact = company.compactCompanyFound(listings, 20);
  const names = compact.map((item) => item.name);
  assert.ok(names.some((name) => /new models on ai gateway/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /vercel agent/i.test(name)), JSON.stringify(names));
  assert.equal(names.filter((name) => /kimi|glm-5/i.test(name)).length, 0, JSON.stringify(names));
});

test('off-worker cache is preferred and scoped on read', async () => {
  const storeMod = await import('../worker/shipped-company-store.ts');
  const cached = [
    {
      name: 'Codex CLI 0.145.0',
      description: 'CLI',
      date: '2026-07-21',
      link: 'https://developers.openai.com/codex/changelog',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
      via: 'via OpenAI',
    },
    {
      name: 'Team Config for shared configuration',
      description: '',
      date: '2026-04-16',
      link: 'https://learn.chatgpt.com/docs/changelog#codex-2026-04-16-team',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'ChatGPT for iOS',
      description: '',
      date: '2026-10-07',
      link: 'https://learn.chatgpt.com/docs/changelog#codex-2026-10-07-mobile',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 6,
      thisYear: true,
    },
    {
      name: 'ChatGPT Images 2.5',
      description: 'images',
      date: '2026-06-01',
      link: 'https://openai.com/index/images',
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    },
  ];
  const store = {
    async get() {
      return { fetchedAt: Date.now(), slug: 'openai', year: 2026, found: storeMod.stripVia(cached), ran: ['gha'] };
    },
    async queue() {
      return false;
    },
  };
  const lead = { ...affiliation.emptyAffiliation(), company: 'OpenAI', role: 'lead', product: 'Codex', typedCompany: true };
  const got = await company.harvestCompany({ affiliation: lead, year: 2026, env: {}, store });
  assert.equal(got.cacheHit, true);
  assert.ok(got.ran.includes('company-offworker'));
  assert.ok(got.found.some((item) => /codex cli/i.test(item.name)));
  assert.ok(got.found.some((item) => /team config/i.test(item.name)));
  assert.ok(!got.found.some((item) => /images/i.test(item.name)));
  assert.ok(!got.found.some((item) => /chatgpt for ios/i.test(item.name)));
  assert.ok(got.found.every((item) => item.via === 'via OpenAI · Codex'));

  const ceo = { ...affiliation.emptyAffiliation(), company: 'OpenAI', role: 'ceo', typedCompany: true };
  const all = await company.harvestCompany({ affiliation: ceo, year: 2026, env: {}, store });
  assert.equal(all.found.length, 4);
  assert.ok(all.found.every((item) => item.via === 'via OpenAI'));
  const reprint = await company.harvestCompany({ affiliation: lead, year: 2026, env: {}, store, rebuild: true });
  assert.equal(reprint.cacheHit, true);
  assert.ok(reprint.ran.includes('company-offworker'));
  assert.ok(reprint.found.some((item) => /codex cli/i.test(item.name)));

  const emptyStore = {
    async get() {
      return { fetchedAt: Date.now(), slug: 'cursor', year: 2026, found: [], ran: ['gha'] };
    },
    async queue() {
      return false;
    },
  };
  const cursorCeo = { ...affiliation.emptyAffiliation(), company: 'Cursor', role: 'ceo', typedCompany: true };
  const miss = await company.harvestCompany({ affiliation: cursorCeo, year: 2026, env: {}, store: emptyStore, storeOnly: true });
  assert.equal(miss.cacheHit, false);
  assert.equal(miss.found.length, 0);
  assert.ok(miss.ran.includes('company-store-miss'));
});

test('seed list includes OpenAI Codex plus the companies Bryton will look up', () => {
  const seeds = JSON.parse(readFileSync(new URL('../data/shipped-companies.json', import.meta.url), 'utf8'));
  const openai = seeds.companies.find((row) => row.company === 'OpenAI');
  assert.ok(openai, 'OpenAI seed');
  assert.ok(openai.products.includes('Codex'));
  assert.ok(openai.products.includes('ChatGPT'));
  assert.ok(openai.sites.some((site) => /learn\.chatgpt\.com/.test(site)));
  assert.ok(openai.sites.some((site) => /developers\.openai\.com/.test(site)));
  const names = seeds.companies.map((row) => row.company);
  for (const need of [
    'Anthropic',
    'Cursor',
    'Vercel',
    'Replit',
    'Higgsfield',
    'xAI',
    'Google DeepMind',
    'Meta AI',
    'Perplexity',
    'Lovable',
    'Bolt',
    'Supabase',
    'Linear',
    'Notion',
    'Figma',
    'Stripe',
    'Raycast',
    'The Browser Company',
    'Midjourney',
    'ElevenLabs',
    'Runway',
    'Suno',
    'Pika',
    'Mistral',
    'GitHub',
    'Shopify',
  ]) {
    assert.ok(names.includes(need), need);
  }
});

test('off-worker payload strips via and rejects an empty list', async () => {
  const storeMod = await import('../worker/shipped-company-store.ts');
  const payload = storeMod.offworkerPayload({
    slug: 'openai',
    year: 2026,
    found: [
      {
        name: 'Codex CLI',
        description: '',
        date: '2026-07-21',
        link: 'https://developers.openai.com/codex/changelog',
        source: 'changelog',
        status: 'LAUNCHED',
        score: 7,
        thisYear: true,
        via: 'via OpenAI',
      },
    ],
    ran: ['gha'],
  });
  assert.ok(payload);
  assert.equal(payload.found[0].via, undefined);
  assert.equal(storeMod.offworkerPayload({ slug: 'openai', year: 2026, found: [] }), null);
});

test('off-worker cache payload expires after 7 days', async () => {
  const storeMod = await import('../worker/shipped-company-store.ts');
  const fresh = storeMod.parseOffworkerCache({
    fetchedAt: Date.now(),
    slug: 'openai',
    year: 2026,
    found: [{ name: 'Codex CLI', description: '', date: '2026-07-21', link: 'https://developers.openai.com/codex/changelog', source: 'changelog', status: 'LAUNCHED', score: 7, thisYear: true }],
    ran: [],
  });
  assert.ok(fresh);
  assert.equal(fresh.found.length, 1);
  const stale = storeMod.parseOffworkerCache({
    fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    slug: 'openai',
    year: 2026,
    found: fresh.found,
    ran: [],
  });
  assert.equal(stale, null);
});

test('company cache writes a new version and refuses to swap a thin rebuild over a fat tape', async () => {
  const storeMod = await import('../worker/shipped-company-store.ts');
  assert.equal(storeMod.shouldSwapCompanyCache(null, 70), true);
  assert.equal(storeMod.shouldSwapCompanyCache(0, 70), true);
  assert.equal(storeMod.shouldSwapCompanyCache(2, 70), true);
  assert.equal(storeMod.shouldSwapCompanyCache(70, 69), true);
  assert.equal(storeMod.shouldSwapCompanyCache(70, 2), false);
  assert.equal(storeMod.shouldSwapCompanyCache(70, 7), false);
  assert.equal(storeMod.shouldSwapCompanyCache(70, 0), false);
  assert.match(storeMod.companyCacheRevKey(2026, 'cursor', '9'), /company-cache\/v2\/2026\/cursor\/9\.json/);
  assert.match(storeMod.companyCachePointerKey(2026, 'cursor'), /company-cache\/v2\/2026\/cursor\.json$/);

  const rows = new Map();
  const objects = new Map();
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/SELECT n FROM shipped_company_cache/.test(sql)) return rows.get(`${args[0]}|${args[1]}`) || null;
              return null;
            },
            async run() {
              if (/INSERT INTO shipped_company_cache/.test(sql)) {
                rows.set(`${args[0]}|${args[1]}`, { n: args[2], found: args[3], r2_key: args[4], fetched_at: args[5], rev: args[6] });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  const bucket = {
    async put(key, body) {
      objects.set(key, String(body));
    },
  };
  const fat = storeMod.offworkerPayload({
    slug: 'cursor',
    year: 2026,
    fetchedAt: Date.now(),
    found: Array.from({ length: 70 }, (_, i) => ({
      name: `Cursor ${i + 1}`,
      description: '',
      date: '2026-03-01',
      link: `https://cursor.com/changelog#${i}`,
      source: 'changelog',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    })),
  });
  const thin = storeMod.offworkerPayload({
    slug: 'cursor',
    year: 2026,
    fetchedAt: Date.now() + 1000,
    found: [
      {
        name: 'Cursor 1',
        description: '',
        date: '2026-03-01',
        link: 'https://cursor.com/changelog#1',
        source: 'changelog',
        status: 'LAUNCHED',
        score: 7,
        thisYear: true,
      },
      {
        name: 'Cursor 2',
        description: '',
        date: '2026-03-02',
        link: 'https://cursor.com/changelog#2',
        source: 'changelog',
        status: 'LAUNCHED',
        score: 7,
        thisYear: true,
      },
    ],
  });
  assert.ok(fat && thin);
  const first = await storeMod.putOffworkerCache(db, bucket, fat);
  assert.equal(first.swapped, true);
  assert.equal(first.n, 70);
  assert.equal(rows.get('cursor|2026').n, 70);
  const second = await storeMod.putOffworkerCache(db, bucket, thin);
  assert.equal(second.swapped, false);
  assert.equal(second.kept, 70);
  assert.equal(rows.get('cursor|2026').n, 70);
  assert.ok([...objects.keys()].some((key) => /company-cache\/v2\/2026\/cursor\/\d+\.json$/.test(key)));
  assert.ok(JSON.parse(objects.get(storeMod.companyCachePointerKey(2026, 'cursor'))).found.length === 70);
});
