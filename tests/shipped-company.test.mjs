import './resolve-ts.mjs';
import assert from 'node:assert/strict';
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

test('Vercel day headings plus bullets assume the harvest year', () => {
  const text = `9 October\n\n- New Pro teams now default to 30-day deployment retention\n- Liquid AI's d1 is available on AI Gateway\n\n8 October\n\n- Skip sending request bodies to Routing Middleware`;
  const items = changelog.itemsFromMonthHeadings(text, 'https://vercel.com/changelog', 2026);
  assert.ok(items.length >= 3, JSON.stringify(items));
  assert.ok(items.some((item) => /30-day/i.test(item.name) && item.date === '2026-10-09'));
  assert.ok(items.some((item) => /Routing Middleware/i.test(item.name) && item.date === '2026-10-08'));
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
  assert.equal(changelog.shipName('Replit introduces Free Mode'), 'Replit Free Mode');
  assert.equal(changelog.shipName('NEW INSTANT ROLLBACK FLOW'), 'INSTANT ROLLBACK');
  assert.equal(changelog.shipName('Replit Agent v0.213.1'), 'Replit Agent v0.213.1');
  assert.equal(changelog.shipName('v0.213.1'), '');
  assert.equal(changelog.shipName('2026'), '');
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
  assert.ok(changelog.productPaths('Codex').includes('/codex/changelog'));
  assert.ok(changelog.COMPANY_PATHS.includes('/changelog'));
  assert.ok(changelog.FEED_PATHS.includes('/atom'));
});
