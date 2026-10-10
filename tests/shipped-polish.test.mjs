import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const polish = await import('../worker/shipped-polish.ts');
const changelog = await import('../worker/shipped-changelog.ts');
const ai = await import('../worker/shipped-ai.ts');

const found = (item) => ({
  description: '',
  date: '2026-03-01',
  link: 'https://cursor.com/changelog/item',
  source: 'changelog',
  status: 'LAUNCHED',
  score: 7,
  thisYear: true,
  ...item,
});

test('bylines, docs nav, week-of roundups, and articles about the person are junk', () => {
  assert.equal(polish.isJunkTitle('AUTHOR : CURSOR TEAM'), true);
  assert.equal(polish.isJunkTitle('AUTHOR : SASHA RUSH'), true);
  assert.equal(polish.isJunkTitle('OVERVIEW'), true);
  assert.equal(polish.isJunkTitle('PROMPTING'), true);
  assert.equal(polish.isJunkTitle('POOL'), true);
  assert.equal(polish.isJunkTitle('WEEK OF OCTOBER 6'), true);
  assert.equal(polish.isJunkTitle('MICHAEL TRUELL', { who: 'Michael Truell' }), true);
  assert.equal(polish.isJunkTitle('MELKEY MOKSYAKOV, ESTEBAN SUÁREZ'), true);
  assert.equal(polish.isJunkTitle('Cursor 2.0'), false);
});

test('title cleaner extracts a short product name or drops the line', () => {
  assert.equal(polish.cleanShipTitle('GROK 4 6'), 'Grok-4.6');
  assert.equal(polish.cleanShipTitle('GPT-5.4 MINI ,'), 'GPT-5.4 MINI');
  assert.equal(polish.cleanShipTitle('READ THE CHANGELOG'), '');
  assert.equal(polish.cleanShipTitle('RESPECTIVELY.'), '');
  assert.equal(polish.cleanShipTitle('SETTINGS BROWSER , TURN ON ENABLE FULL'), '');
  assert.equal(polish.cleanShipTitle('CODEX APP RELEASE NOTES.'), 'CODEX APP');
  assert.equal(polish.cleanShipTitle('ONTROL IS AVAILABLE TODAY IN THE CURSOR'), '');
  assert.equal(polish.cleanShipTitle('CURSOR IS ROLLING OUT A NEW KIND OF'), '');
  assert.equal(polish.cleanShipTitle('CODEX APP LAUNCHED AS A DESKTOP'), 'CODEX APP');
  assert.equal(polish.cleanShipTitle('BOOTSTRAPPING COMPOSER WITH'), '');
  assert.equal(polish.cleanShipTitle('IMPROVING COMPOSER THROUGH REAL-TIME'), '');
  assert.equal(polish.cleanShipTitle('IF YOU DON’T SEE GPT-5.4 YET, UPDATE'), '');
  assert.equal(polish.cleanShipTitle('GRAPHITE IS JOINING CURSOR'), '');
  assert.equal(polish.cleanShipTitle('RILLET SHIPS 3× FASTER WITH AI AGENTS'), '');
  assert.equal(polish.cleanShipTitle('TRUSTMRR REVENUECAT INTEGRATION (API'), '');
  assert.ok(polish.cleanShipTitle('Remote control for local agents').length <= 38);
  assert.equal(polish.cleanShipTitle('Introducing Codex long-running work'), 'Codex long-running work');
  assert.equal(polish.cleanShipTitle('VISIT OUR YOUTUBE CHANNEL ↗'), '');
  assert.equal(polish.cleanShipTitle('TRY CURSOR NOW'), '');
  assert.equal(polish.cleanShipTitle('EXPLORE ENTERPRISE →'), '');
  assert.equal(polish.cleanShipTitle('IES A AND MAGIC'), '');
  assert.equal(polish.cleanShipTitle('DOWNLOAD ON THE APP STORE'), '');
  assert.equal(polish.cleanShipTitle('24K+ GITHUB STARS'), '');
  assert.equal(polish.cleanShipTitle('FILED UNDER: COMPANY'), '');
  assert.match(polish.cleanShipTitle('RELEASED GPT-4O IN THE API. GPT-4O IS') || 'GPT-4O', /gpt-?4o/i);
  assert.equal(polish.isJunkTitle('USE A WEBSITE’S TOOLS: WITH SITE'), true);
  const cli = polish.cleanShipTitle('CODEX CLI CAN ALSO IMPORT SUPPORTED');
  assert.ok(!cli || /^codex cli$/i.test(cli));
});

test('same article href collapses to the best title; changelog index cards stay distinct', () => {
  const article = polish.collapseSameHref([
    found({ name: 'Origin CLI', link: 'https://cursor.com/blog/origin-cli' }),
    found({ name: 'Origin CLI is available today in the Cursor', link: 'https://cursor.com/blog/origin-cli#section' }),
  ]);
  assert.equal(article.length, 1);
  const index = polish.collapseSameHref([
    found({ name: 'Codex CLI 0.1', date: '2026-02-01', link: 'https://developers.openai.com/codex/changelog' }),
    found({ name: 'Codex CLI 0.2', date: '2026-02-02', link: 'https://developers.openai.com/codex/changelog' }),
  ]);
  assert.equal(index.length, 2);
  const journal = polish.collapseSameHref([
    found({ name: 'hotelist.com', link: 'https://levels.io/', source: 'site' }),
    found({ name: 'infiniteslop.ai', link: 'https://levels.io/', source: 'site' }),
    found({ name: 'Photo AI feature', link: 'https://levels.io/#photo-ai', source: 'site' }),
  ]);
  assert.equal(journal.length, 3);
  assert.equal(polish.isShipListHref('https://levels.io/projects'), true);
  assert.equal(polish.isShipListHref('https://levels.io/'), true);
});

test('indie polish drops are labeled per item', () => {
  const drops = [];
  const kept = polish.polishCandidates(
    [
      found({ name: 'hotelist.com', date: '2026-10-05', source: 'site', link: 'https://levels.io/#hotelist' }),
      found({ name: 'GPT-3.5 turbo leftover', date: '2026-01-01', source: 'site', link: 'https://levels.io/#old' }),
      found({ name: 'READ THE CHANGELOG', date: '2026-02-01', source: 'site', link: 'https://levels.io/#read' }),
    ],
    { year: 2026, who: 'levelsio', handle: 'levelsio', onDrop: (drop) => drops.push(drop) },
  );
  assert.ok(kept.some((item) => /hotelist/i.test(item.name)));
  assert.ok(drops.some((drop) => drop.reason === 'year-other' || drop.reason === 'junk-title' || drop.reason === 'title-empty'));
});

test('point releases roll up to one line per product per month unless named', () => {
  const items = Array.from({ length: 26 }, (_, i) =>
    found({
      name: `Codex app 26.${String(203 + i)}`,
      date: `2026-02-${String((i % 27) + 1).padStart(2, '0')}`,
      link: `https://developers.openai.com/codex/changelog#${203 + i}`,
    }),
  );
  const rolled = polish.rollupVersions(items);
  assert.equal(rolled.length, 1);
  assert.match(rolled[0].name, /Codex app · 26 updates in Feb/i);
  const named = polish.rollupVersions([
    found({ name: 'Codex app 26.203 long-running agents', date: '2026-02-01' }),
    found({ name: 'Codex app 26.204', date: '2026-02-02' }),
    found({ name: 'Codex app 26.205', date: '2026-02-03' }),
  ]);
  assert.ok(named.some((item) => /long-running/i.test(item.name)));
  const commas = polish.rollupVersions([
    found({ name: 'CODEX APP 26.318, 26.319', date: '2026-03-19' }),
    found({ name: 'CODEX APP 26.325, 26.331, 26.401', date: '2026-04-01' }),
  ]);
  assert.equal(commas.length, 2);
  assert.match(commas.find((item) => item.date?.startsWith('2026-03'))?.name ?? '', /Codex app · 2 updates in Mar/i);
  assert.match(commas.find((item) => item.date?.startsWith('2026-04'))?.name ?? '', /Codex app · 3 updates in Apr/i);
});

test('2026 dates are required for changelog cards and older models are dropped', () => {
  const items = polish.polishCandidates(
    [
      found({ name: 'GPT-3.5-turbo-0125', date: '2026-10-01', link: 'https://openai.com/blog/gpt-3-5' }),
      found({ name: 'embedding v3', date: '2026-10-01', link: 'https://openai.com/blog/embeddings' }),
      found({ name: 'Old launch', date: '2024-11-20', link: 'https://openai.com/blog/old' }),
      found({ name: 'ADDED NEW MODELS FOR O1', date: '2026-12-17', link: 'https://developers.openai.com/codex/o1' }),
      found({ name: 'Codex app for macOS', date: '2026-02-14', link: 'https://openai.com/codex' }),
      found({ name: 'AUTHOR : CURSOR TEAM', date: '2026-08-13', link: 'https://cursor.com/blog/author' }),
    ],
    { year: 2026, who: 'Tibo', affiliation: { name: 'Tibo', company: 'OpenAI', role: 'lead', product: 'Codex', companyX: null, companyGithub: null, companySite: null, typedCompany: true } },
  );
  assert.equal(items.length, 1);
  assert.match(items[0].name, /codex app/i);
  assert.equal(items[0].date, '2026-02-14');
});

test('source lines are via Brand · host with no sitemap metadata', () => {
  const [item] = polish.polishCandidates(
    [
      found({
        name: 'Cursor 2',
        description: 'Sitemap lastmod 2026-10-10',
        date: '2026-09-10',
        link: 'https://cursor.com/changelog',
        via: 'via Anysphere · cursor.com',
      }),
    ],
    { year: 2026, who: 'Michael Truell', affiliation: { name: 'Michael Truell', company: 'Anysphere (Cursor)', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: 'https://cursor.com', typedCompany: false } },
  );
  assert.equal(item.description, '');
  assert.equal(item.via, 'via Cursor · cursor.com');
  assert.equal(polish.sourceVia({ name: 'Cursor 2', date: '2026-10-10', link: 'https://cursor.com/changelog' }, { name: 'Michael Truell', company: 'Anysphere (Cursor)', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: null, typedCompany: false }), 'via Cursor · cursor.com');
  assert.equal(polish.sourceVia({ name: 'Codex', date: '2026-02-01', link: 'https://learn.chatgpt.com/codex', via: 'via open ai · learn.chatgpt.com' }, { name: 'Tibo', company: 'open ai', role: 'lead', product: 'Codex', companyX: null, companyGithub: null, companySite: null, typedCompany: true }), 'via OpenAI · Codex');
  assert.equal(polish.sourceVia({ name: 'PhotoAI', date: '2026-03-01', link: 'https://github.com/levelsio/photo-ai', source: 'github' }, { name: 'levelsio', company: 'Readmake', role: 'founder', product: null, companyX: null, companyGithub: null, companySite: null, typedCompany: false }), 'via github.com');
  assert.equal(polish.prettyBrand('vercel'), 'Vercel');
  assert.equal(polish.prettyBrand('open ai'), 'OpenAI');
  assert.equal(polish.cleanStatus('LAUNCHED~'), 'LAUNCHED');
  assert.equal(polish.cleanDescription('learn.chatgpt.com'), '');
  assert.equal(polish.cleanDescription('p align="center" h1 TypeScript loader'), '');
  assert.equal(polish.cleanDescription('picture source media="(prefers-color-scheme: dark)" srcset=" 25px" alt="G'), '');
  const clipped = polish.cleanDescription('Standalone TypeScript loader for Node.js from the Nub project — TypeScript, JSX, tsconfig paths, and data-format imports through a native transform');
  assert.ok(clipped.length <= 91);
  assert.ok(/…$/.test(clipped) || clipped.length < 90);
  assert.doesNotMatch(clipped, /tr$/);
});

test('platform npm packages roll into the parent name', () => {
  const rolled = polish.rollupPlatformPackages([
    found({ name: '@tsc-rs/linux-x64', source: 'npm', link: 'https://www.npmjs.com/package/@tsc-rs/linux-x64' }),
    found({ name: '@tsc-rs/darwin-arm64', source: 'npm', link: 'https://www.npmjs.com/package/@tsc-rs/darwin-arm64' }),
    found({ name: '@nubjs/loader-win32-arm64', source: 'npm', link: 'https://www.npmjs.com/package/@nubjs/loader-win32-arm64' }),
    found({ name: '@nubjs/loader-linux-x64-musl', source: 'npm', link: 'https://www.npmjs.com/package/@nubjs/loader-linux-x64-musl' }),
    found({ name: '@nubjs/types', source: 'npm', link: 'https://www.npmjs.com/package/@nubjs/types' }),
    found({ name: '@nubjs/nub', source: 'npm', link: 'https://www.npmjs.com/package/@nubjs/nub' }),
    found({ name: 'fs2-cli-linux-x64-musl', source: 'npm', link: 'https://www.npmjs.com/package/fs2-cli-linux-x64-musl' }),
  ]);
  const names = rolled.map((item) => item.name.toLowerCase());
  assert.ok(names.some((n) => n === 'tsc-rs'));
  assert.ok(names.some((n) => n === 'fs2-cli'));
  assert.equal(names.filter((n) => n === 'nub' || n === 'nubjs').length, 1);
  assert.equal(names.some((n) => /linux|darwin|win32|types|musl/.test(n)), false);
});

test('scrape-dated changelog cards are dropped', () => {
  const today = new Date().toISOString().slice(0, 10);
  const items = polish.polishCandidates(
    [
      found({ name: 'Visit our YouTube channel', date: '2026-06-01', link: 'https://cursor.com/youtube' }),
      found({ name: 'Cursor 2', date: today, link: 'https://cursor.com/changelog/today' }),
      found({ name: 'Agents Window', date: '2026-04-02', link: 'https://cursor.com/changelog/agents' }),
      found({ name: 'Codex App', date: null, link: 'https://developers.openai.com/codex/app', source: 'changelog', thisYear: true }),
      found({ name: 'Vicent Martí · 27M', date: '2026-08-14', link: 'https://cursor.com/blog/vicent' }),
      found({ name: 'UNDER: COMPANY', date: '2026-07-06', link: 'https://cursor.com/blog/firetiger' }),
      found({ name: 'CURSOR WEB ·', date: '2026-09-28', link: 'https://cursor.com/docs/release-notes' }),
      found({ name: 'PULL REQUESTS', date: '2026-10-01', link: 'https://cursor.com/docs/release-notes' }),
    ],
    { year: 2026, who: 'Michael Truell' },
  );
  assert.equal(items.some((item) => /youtube|visit our/i.test(item.name)), false);
  assert.equal(items.some((item) => item.date === today), false);
  assert.ok(items.some((item) => /agents window/i.test(item.name)));
  assert.ok(items.some((item) => /codex app/i.test(item.name) && item.date == null && item.thisYear));
  assert.equal(items.some((item) => /vicent|under:|cursor web\s*·|pull requests/i.test(item.name)), false);
});

test('notes must use the final post-filter count', () => {
  assert.equal(polish.noteCountMismatch("Tibo's OpenAI crew put 37 public ships on the year.", 162), true);
  assert.equal(polish.noteCountMismatch("Tibo's OpenAI crew put 162 public ships on the year.", 162), false);
  assert.equal(polish.noteCountMismatch('OpenAI shipped 40 public updates to keep it moving.', 54), true);
  assert.equal(polish.noteCountMismatch('vercel put 37 items on the year.', 146), true);
  const items = Array.from({ length: 12 }, (_, i) => ({
    name: `SHIP ${i}`,
    description: '',
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    status: 'LAUNCHED',
    link: `https://openai.com/p/${i}`,
    icon: null,
    source: 'changelog',
  }));
  const note = ai.groundedNote(items, 0, 'Tibo', [], { role: 'ceo', company: 'OpenAI' });
  assert.match(note, /12/);
  assert.doesNotMatch(note, /\b37\b/);
});

test('changelog rows no longer print sitemap lastmod and docs nav slugs stay out of sitemaps', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://cursor.com/docs/agent/overview</loc><lastmod>2026-10-09</lastmod></url>
    <url><loc>https://cursor.com/changelog/cursor-2</loc><lastmod>2026-10-10</lastmod></url>
  </urlset>`;
  const items = changelog.itemsFromSitemap(xml, 2026);
  assert.equal(items.some((item) => /overview/i.test(item.name)), false);
  assert.ok(items.some((item) => /cursor 2/i.test(item.name)));
  const cursor2 = items.find((item) => /cursor 2/i.test(item.name));
  assert.equal(cursor2?.date, null);
  assert.equal(cursor2?.thisYear, true);
  assert.doesNotMatch(cursor2?.description ?? '', /sitemap lastmod/i);
});

test('harvest drops other-year changelog dates and sorts remaining lines chronologically', () => {
  const gathered = {
    found: [
      found({ name: 'Later', date: '2026-09-01', link: 'https://openai.com/later' }),
      found({ name: 'Earlier', date: '2026-02-01', link: 'https://openai.com/earlier' }),
      found({ name: 'Old', date: '2024-11-20', link: 'https://openai.com/old' }),
    ],
    web: [],
    pages: [],
    site: null,
    profile: { name: 'Tibo', bio: '', site: null, x: null, github: null, affiliation: { name: 'Tibo', company: 'OpenAI', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: null, typedCompany: true } },
    ran: [],
    failed: [],
    stats: [],
  };
  const items = ai.harvestItems(gathered, 2026);
  assert.deepEqual(items.map((item) => item.name), ['EARLIER', 'LATER']);
  const demo = ai.demoReceipt(gathered, 2026, 1);
  assert.equal(demo.items.length, 2);
  assert.doesNotMatch(demo.note, /\b37\b|\b3 public ships\b/i);
});
