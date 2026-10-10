import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const polish = await import('../worker/shipped-polish.ts');
const changelog = await import('../worker/shipped-changelog.ts');
const ai = await import('../worker/shipped-ai.ts');
const repos = await import('../worker/shipped-repos.ts');
const dates = await import('../worker/shipped-dates.ts');

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
  assert.equal(polish.isJunkTitle('S JACK', { who: 'Jack Friks' }), true);
  assert.equal(polish.isJunkTitle('THE GUY WHO MADE POST BRIDGE'), true);
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
  assert.match(polish.cleanShipTitle('GRAPHITE IS JOINING CURSOR'), /graphite joining cursor/i);
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
  assert.equal(polish.cleanShipTitle('USE WINDOWS APPS AND CONTROL CODEX'), '');
  assert.match(polish.cleanShipTitle('IN THE CHATGPT MOBILE APP'), /chatgpt mobile app/i);
  assert.equal(polish.cleanShipTitle('LINES OF CODE IN TWO WEEKS WITH CURSOR'), '');
  assert.equal(polish.cleanShipTitle('START FROM SCRATCH, WITHOUT A REPO'), '');
  assert.equal(polish.cleanShipTitle('CURSOR BUILT A FLEET OF SECURITY'), '');
  assert.match(polish.cleanShipTitle('CURSOR ROUTER WORKS'), /cursor router/i);
  assert.equal(polish.cleanShipTitle('GPT-5'), '');
  assert.equal(polish.cleanShipTitle('GPT-5.4 MINI'), 'GPT-5.4 MINI');
  assert.equal(polish.cleanShipTitle('RUN CODEX NATIVELY ON WINDOWS'), '');
  assert.equal(polish.cleanShipTitle('CURSOR ANNOUNCES MAJOR UPDATE TO AI'), '');
  assert.match(polish.cleanShipTitle('A TECHNICAL REPORT ON COMPOSER 2'), /composer 2/i);
  assert.equal(polish.cleanShipTitle('JOINING SPACEX'), '');
  assert.equal(polish.cleanShipTitle('MY MACHINES CONNECTS A SINGLE LAPTOP'), '');
  assert.equal(polish.cleanShipTitle('AND PULLFROG'), '');
  assert.match(polish.cleanShipTitle('WINDOWS. IN THE CHATGPT MOBILE APP'), /chatgpt mobile app/i);
  assert.equal(polish.cleanShipTitle('THIS.CLASSLIST.REMOVE'), '');
  assert.equal(polish.isProductNounPhrase('ChatGPT Mobile App'), true);
  assert.equal(polish.isProductNounPhrase('USE WINDOWS APPS'), false);
});

test('undated crumbs sort last and stay under a quarter of a dated tape', () => {
  const dated = ['Alpha', 'Beta', 'Gamma'].map((name, i) =>
    found({ name, date: `2026-0${i + 1}-01`, source: 'github', link: `https://github.com/ada/${name.toLowerCase()}` }),
  );
  const crumbs = Array.from({ length: 10 }, (_, i) =>
    found({ name: `Crumb ${i}`, date: null, source: 'site', link: `https://ada.dev/#c${i}`, thisYear: true }),
  );
  const inherited = polish.inheritDates([
    found({ name: 'Post Bridge CLI', date: null, source: 'site', link: 'https://jackfriks.com/#post-bridge' }),
    found({ name: 'postbridge-cli', date: '2026-09-09', source: 'github', link: 'https://github.com/jackfriks/postbridge-cli' }),
  ]);
  assert.equal(inherited.find((item) => /post bridge/i.test(item.name))?.date, '2026-09-09');
  const capped = polish.capUndated([...dated, ...crumbs]);
  assert.equal(capped.filter((item) => item.date).length, 3);
  assert.equal(capped.filter((item) => !item.date).length, 1);
  assert.ok(capped.slice(0, 3).every((item) => item.date));
  const onlyUndated = polish.capUndated(crumbs);
  assert.equal(onlyUndated.length, 10);
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
  const note = ai.groundedNote(items, 0, 'Tibo', [], { role: 'ceo', company: 'OpenAI', who: 'Tibo' });
  assert.match(note, /Ship/i);
  assert.doesNotMatch(note, /\b37\b|\b12 public\b|\blines\b|does one job|the pair is|opens on/i);
  assert.equal(ai.noteFailsVoice(note), false);
  assert.equal(polish.noteCountMismatch(note, 12), false);
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

test('flagship company launches survive the title gate with a logged keep', () => {
  const items = polish.polishCandidates(
    [
      found({ name: 'Meet the new Cursor', date: '2026-04-02', link: 'https://cursor.com/blog/cursor-3' }),
      found({ name: 'Introducing Composer 2', date: '2026-03-19', link: 'https://cursor.com/blog/composer-2' }),
      found({ name: 'A technical report on Composer 2', date: '2026-03-27', link: 'https://cursor.com/blog/composer-2-technical-report' }),
      found({ name: 'Graphite is joining Cursor', date: '2025-12-19', link: 'https://cursor.com/blog/graphite' }),
      found({ name: 'Graphite joining Cursor', date: '2026-05-22', link: 'https://cursor.com/blog/graphite' }),
      found({ name: 'Bugbot is now over 3x faster, 22% cheaper, and finds 10% more bugs', date: '2026-06-10', link: 'https://cursor.com/changelog/bugbot-updates-june-2026' }),
      found({ name: 'ORIGIN · SEP 14, 2026', date: '2026-09-14', link: 'https://cursor.com/changelog/origin' }),
      found({ name: 'CURSOR WEB · CLOUD AGENTS · SEP 14', date: '2026-09-14', link: 'https://cursor.com/changelog/cursor-web' }),
      found({ name: 'Introducing Grok 4.6', date: '2026-08-12', link: 'https://cursor.com/blog/grok-4-6' }),
      found({ name: 'Introducing Grok 4.7', date: '2026-09-21', link: 'https://cursor.com/blog/grok-4-7' }),
    ],
    { year: 2026, who: 'Michael Truell', affiliation: { name: 'Michael Truell', company: 'Cursor', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: 'https://cursor.com', typedCompany: false } },
  );
  const names = items.map((item) => item.name);
  assert.ok(names.some((name) => /cursor 3/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /composer 2/i.test(name)), JSON.stringify(names));
  assert.equal(items.find((item) => /composer 2/i.test(item.name))?.date, '2026-03-19');
  assert.equal(names.filter((name) => /graphite/i.test(name)).length, 0, JSON.stringify(names));
  assert.ok(names.some((name) => /^bugbot$/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /^origin$/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /cursor web/i.test(name) && !/sep/i.test(name)), JSON.stringify(names));
  assert.equal(names.filter((name) => /grok/i.test(name)).length, 0);
  assert.ok(names.some((name) => /new models in cursor/i.test(name)), JSON.stringify(names));
  const harvested = ai.harvestItems(
    {
      found: items,
      web: [],
      pages: [],
      site: null,
      profile: { name: 'Michael Truell', bio: '', site: null, x: null, github: 'truell20', affiliation: { name: 'Michael Truell', company: 'Cursor', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: 'https://cursor.com', typedCompany: false } },
      ran: [],
      failed: [],
      stats: [],
    },
    2026,
  );
  const tape = harvested.map((item) => item.name);
  assert.ok(tape.some((name) => /CURSOR 3/i.test(name)), JSON.stringify(tape));
  assert.ok(tape.some((name) => /COMPOSER 2/i.test(name)), JSON.stringify(tape));
  assert.equal(tape.filter((name) => /GRAPHITE/i.test(name)).length, 0, JSON.stringify(tape));
  assert.ok(tape.some((name) => /BUGBOT/i.test(name)), JSON.stringify(tape));
});

test('repro bench demo and profile repos are not ships; @shoojs rolls into SHOO', () => {
  assert.equal(repos.isJunkRepoName('nextjs-node-options-repro'), true);
  assert.equal(repos.isJunkRepoName('remix-gvs-repro'), true);
  assert.equal(repos.isJunkRepoName('hono-response-copy-benchmark'), true);
  assert.equal(repos.isJunkRepoName('shoo-vite-demo'), true);
  assert.equal(repos.isJunkRepoName('t3dotgg', 't3dotgg'), true);
  assert.equal(repos.isJunkRepoName('T3 - THEO', 't3dotgg', 'Theo'), true);
  assert.equal(repos.isJunkRepoName('yes'), true);
  assert.equal(repos.isJunkProductName('YES'), true);
  assert.equal(repos.isJunkProductName('t3dotgg', 't3dotgg'), true);
  assert.equal(repos.isJunkProductName('@zod/mini', 'colinhacks'), false);
  assert.equal(repos.isShipRepo({ name: 'zod', description: 'TypeScript-first schema validation', stars: 30000, homepage: 'https://zod.dev' }, 'colinhacks'), true);
  assert.equal(repos.isShipRepo({ name: 'bun-workspaces', description: 'wip', stars: 2, homepage: null }, 'colinhacks'), false);
  assert.equal(repos.isShipRepo({ name: 'turbopack-nested-namespace', description: '', stars: 1, homepage: null }, 'colinhacks'), false);
  const rolled = polish.rollupPlatformPackages([
    found({ name: '@shoojs/core', source: 'npm', link: 'https://www.npmjs.com/package/@shoojs/core' }),
    found({ name: '@shoojs/vite', source: 'npm', link: 'https://www.npmjs.com/package/@shoojs/vite' }),
  ]);
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].name, 'SHOO');
  assert.equal(repos.isKnownPackageFamily('@shoojs/core'), true);
  assert.equal(repos.isKnownPackageFamily('shoo'), true);
  assert.equal(repos.isShipRepo({ name: '@shoojs/core', description: '', stars: 0, homepage: null }, 't3dotgg'), true);
});

test('owned pin dates keep 2026 first launches and drop pre-2026 evidence', () => {
  assert.equal(dates.parseCdxTimestamp([['timestamp'], ['20260315120000']]), '2026-03-15');
  assert.equal(dates.parseCdxTimestamp([['timestamp'], ['20240315120000']]), '2024-03-15');
  assert.equal(dates.parseRdapRegistration({ events: [{ eventAction: 'registration', eventDate: '2026-02-01T00:00:00Z' }] }), '2026-02-01');
  assert.equal(dates.parseCopyrightYear('© 2024 Jack Friks'), 2024);
  assert.equal(dates.parseCopyrightYear('Copyright 2026'), 2026);
  assert.equal(dates.parseAppStoreDate('"datePublished":"2026-03-11T00:00:00Z"'), '2026-03-11');
  assert.equal(dates.parseProductHuntDate('"launchedAt":"2026-05-09T12:00:00Z"'), '2026-05-09');
  assert.equal(dates.parseGithubCreated({ created_at: '2026-02-01T00:00:00Z' }), '2026-02-01');
  const keep = dates.verdictFromEvidence(2026, [{ source: 'archive.org', date: '2026-04-12' }]);
  assert.equal(keep.drop, false);
  assert.equal(keep.date, '2026-04-12');
  const drop = dates.verdictFromEvidence(2026, [{ source: 'archive.org', date: '2024-09-11' }, { source: 'rdap', date: '2024-09-08' }]);
  assert.equal(drop.drop, true);
  assert.equal(drop.reason, 'pre-2026');
  const unknown = dates.verdictFromEvidence(2026, []);
  assert.equal(unknown.drop, false);
  assert.equal(unknown.date, null);
  const html = 'https://www.lovelee-app.com/ https://ship-or-die.com https://post-bridge.com';
  assert.ok(dates.urlsFromPageText(html).some((url) => /lovelee-app/.test(url)));
  const lovelee = dates.productUrlsForPin({ name: 'lovelee' }, { pageText: html });
  assert.ok(lovelee.some((url) => /lovelee-app/.test(url)), JSON.stringify(lovelee));
  const wacko = dates.productUrlsForPin({ name: 'wacko' }, { pageText: 'no product url here' });
  assert.equal(wacko.some((url) => /wacko\.com/.test(url)), false);
  const shipGuesses = dates.datingHostGuesses('SHIP OR DIE');
  assert.ok(shipGuesses.some((url) => /ship-or-die\.com/.test(url)), JSON.stringify(shipGuesses));
  assert.equal(shipGuesses.some((url) => /shipordie\.com/.test(url)), false);
  const bridgeGuesses = dates.datingHostGuesses('POST BRIDGE');
  assert.ok(bridgeGuesses.some((url) => /post-bridge\.com/.test(url)), JSON.stringify(bridgeGuesses));
  assert.equal(bridgeGuesses.some((url) => /postbridge\.com/.test(url)), false);
  const shipUrls = dates.productUrlsForPin({ name: 'SHIP OR DIE' }, {});
  assert.ok(shipUrls.some((url) => /ship-or-die\.com/.test(url)), JSON.stringify(shipUrls));
  assert.equal(shipUrls.some((url) => /shipordie\.com/.test(url)), false);
  const ownedBridge = dates.productUrlsForPin(
    { name: 'POST BRIDGE', link: 'https://www.jackfriks.com/#postbridge' },
    { owner: { name: 'Jack Friks', site: 'https://jackfriks.com', sites: ['https://jackfriks.com', 'https://post-bridge.com'] } },
  );
  assert.ok(ownedBridge.some((url) => /post-bridge\.com/.test(url)), JSON.stringify(ownedBridge));
  assert.equal(dates.dropSameNameLeftovers([{ name: 'POST BRIDGE', source: 'npm' }], ['POST BRIDGE']).items.length, 0);
  const leftover = dates.dropSameNameLeftovers(
    [
      { name: 'POST BRIDGE', source: 'npm', date: '2026-09-09' },
      { name: 'POSTBRIDGE-CLI', source: 'npm', date: '2026-09-09' },
      { name: 'SHIP OR DIE', source: 'site', date: '2026-06-09' },
      { name: 'POST BRIDGE CHATGPT PLUGIN', source: 'web', date: '2026-09-11' },
    ],
    ['Post Bridge'],
  );
  assert.deepEqual(
    leftover.items.map((item) => item.name),
    ['POSTBRIDGE-CLI', 'SHIP OR DIE', 'POST BRIDGE CHATGPT PLUGIN'],
  );
  assert.equal(leftover.drops.length, 1);
  assert.equal(leftover.drops[0].name, 'POST BRIDGE');
  assert.equal(leftover.drops[0].reason, 'same-name-pre-2026');
});

test('undated sitemap flagships survive harvest (the gate that dropped Cursor 3)', () => {
  const gathered = {
    found: [
      found({ name: 'cursor 3', date: null, link: 'https://cursor.com/blog/cursor-3', thisYear: true }),
      found({ name: 'composer 2', date: null, link: 'https://cursor.com/blog/composer-2', thisYear: true }),
      found({ name: 'graphite', date: null, link: 'https://cursor.com/blog/graphite', thisYear: true }),
      found({ name: 'bugbot updates june 2026', date: null, link: 'https://cursor.com/blog/bugbot-updates-june-2026', thisYear: true }),
    ],
    web: [],
    pages: [],
    site: null,
    profile: { name: 'Michael Truell', bio: '', site: null, x: null, github: 'truell20', affiliation: { name: 'Michael Truell', company: 'Cursor', role: 'ceo', product: null, companyX: null, companyGithub: null, companySite: 'https://cursor.com', typedCompany: false } },
    ran: [],
    failed: [],
    stats: [],
  };
  const tape = ai.harvestItems(gathered, 2026).map((item) => item.name);
  assert.ok(tape.some((name) => /CURSOR 3/i.test(name)), JSON.stringify(tape));
  assert.ok(tape.some((name) => /COMPOSER 2/i.test(name)), JSON.stringify(tape));
  assert.equal(tape.filter((name) => /GRAPHITE/i.test(name)).length, 0, JSON.stringify(tape));
  assert.ok(tape.some((name) => /BUGBOT/i.test(name)), JSON.stringify(tape));
});

test('versioned releases always roll into the monthly line; flagships keep real dates', () => {
  const rolled = polish.rollupVersions([
    found({ name: 'CURSOR SDK BRIDGE V1.0.26', date: '2026-07-30' }),
    found({ name: 'CURSOR SDK BRIDGE V1.0.31', date: '2026-09-03' }),
    found({ name: 'CURSOR SDK BRIDGE V1.0.32', date: '2026-09-22' }),
    found({ name: 'CURSOR SDK BRIDGE · 4 UPDATES IN AUG', date: '2026-08-27' }),
    found({ name: 'CURSOR V2026.09.15', date: '2026-09-16' }),
    found({ name: 'CURSOR 1.9.0', date: '2026-09-17' }),
    found({ name: 'CURSOR 1.12.0', date: '2026-10-01' }),
    found({ name: 'CURSOR 3', date: '2026-09-15', link: 'https://cursor.com/blog/cursor-3' }),
  ]);
  const names = rolled.map((item) => item.name);
  assert.equal(names.some((name) => /v1\.0\.|v2026|1\.9\.0|1\.12\.0/i.test(name)), false, JSON.stringify(names));
  assert.ok(names.some((name) => /^cursor sdk bridge$/i.test(name)), JSON.stringify(names));
  assert.equal(names.some((name) => /1 update in jul/i.test(name)), false, JSON.stringify(names));
  assert.ok(names.some((name) => /cursor sdk bridge · 4 updates in aug/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /cursor sdk bridge · 2 updates in sep/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /cursor · \d+ updates? in sep/i.test(name)), JSON.stringify(names));
  assert.ok(names.some((name) => /^cursor 3$/i.test(name)), JSON.stringify(names));
});

test('pricing, token-efficiency, person names, and code identifiers never print', () => {
  assert.equal(polish.isPricingOrMetricNote('TEAMS PRICING JUNE 2026'), true);
  assert.equal(polish.isPricingOrMetricNote('IMPROVED TOKEN EFFICIENCY'), true);
  assert.equal(polish.isJunkTitle('TEAMS PRICING JUNE 2026'), true);
  assert.equal(polish.isJunkTitle('IMPROVED TOKEN EFFICIENCY'), true);
  assert.equal(polish.isJunkTitle('MATTIA ASTORINO'), true);
  assert.equal(polish.isJunkTitle('Agents Window'), false);
  assert.equal(repos.looksLikePersonName('Mattia Astorino'), true);
  assert.equal(repos.looksLikePersonName('MATTIA ASTORINO'), true);
  assert.equal(repos.looksLikePersonName('Agents Window'), false);
  assert.equal(repos.looksLikePersonName('Ship or Die'), false);
  assert.equal(repos.looksLikeCodeIdentifier('GREETING .QUERY'), true);
  assert.equal(repos.looksLikeCodeIdentifier('CREATEHTTPSERVER'), true);
  assert.equal(repos.looksLikeCodeIdentifier('LISTEN'), true);
  assert.equal(repos.looksLikeCodeIdentifier('BUN-TYPES'), true);
  assert.equal(repos.looksLikeCodeIdentifier('NUB'), false);
  assert.equal(repos.looksLikeCodeIdentifier('AWAIT ASYNCCODEC.ENCODEASYNC'), true);
  assert.equal(repos.looksLikeCodeIdentifier('AsyncCodec.encodeAsync'), true);
  assert.equal(repos.looksLikeCodeIdentifier('encodeAsync()'), true);
  assert.equal(repos.looksLikeCodeIdentifier('socket.io-client'), false);
  assert.equal(repos.looksLikeCodeIdentifier('hotelist.com'), false);
  assert.equal(repos.isJunkRepoName('emoji-todo'), true);
  assert.equal(repos.isJunkProductName('emoji-todo'), true);
  assert.equal(polish.isJunkTitle('AWAIT ASYNCCODEC.ENCODEASYNC'), true);
  assert.equal(repos.isJunkProductName('MATTIA ASTORINO'), true);
  assert.equal(repos.isJunkProductName('CREATEHTTPSERVER'), true);
  const items = polish.polishCandidates(
    [
      found({ name: 'Teams pricing June 2026', date: '2026-06-01', link: 'https://cursor.com/changelog/pricing' }),
      found({ name: 'Improved token efficiency', date: '2026-09-23', link: 'https://cursor.com/changelog/tokens' }),
      found({ name: 'Mattia Astorino', date: '2026-03-01', source: 'github', link: 'https://github.com/t3dotgg/mattia' }),
      found({ name: 'greeting.query', date: '2026-04-01', source: 'npm', link: 'https://www.npmjs.com/package/greeting.query' }),
      found({ name: 'Nub', date: '2026-02-01', source: 'github', link: 'https://github.com/colinhacks/nub' }),
      found({ name: 'NUB', date: '2026-02-08', source: 'npm', link: 'https://www.npmjs.com/package/nub' }),
      found({ name: 'Meet the new Cursor', date: '2026-09-15', link: 'https://cursor.com/blog/cursor-3' }),
    ],
    { year: 2026, who: 'Theo' },
  );
  const names = items.map((item) => item.name);
  assert.equal(names.some((name) => /pricing|token efficiency|mattia|greeting/i.test(name)), false, JSON.stringify(names));
  assert.equal(names.filter((name) => /^nub$/i.test(name)).length, 1, JSON.stringify(names));
  const cursor3 = items.find((item) => /cursor 3/i.test(item.name));
  assert.equal(cursor3?.date, '2026-04-02');
});

test('Codex titles lose the marketing clause and launch-notes suffix', () => {
  assert.match(polish.cleanShipTitle('CODEX, OUR CODE GENERATION CLI TOOL'), /codex cli/i);
  assert.match(polish.cleanShipTitle('CODEX FOR CHROME LAUNCH NOTES'), /^codex for chrome$/i);
});

test('removals, docs, handles, and generic updates are not ships', () => {
  assert.equal(polish.isNotAShipTitle('@CHATGPT'), true);
  assert.equal(polish.isNotAShipTitle('CURSOR INTO THE CHATGPT DESKTOP APP'), true);
  assert.equal(polish.isNotAShipTitle('CODEX MCP SERVER REMOVED'), true);
  assert.equal(polish.isNotAShipTitle('CODEX ANALYTICS GOVERNANCE DOCS UPDATE'), true);
  assert.equal(polish.isNotAShipTitle('CODEX MODELS FOR MODEL AVAILABILITY'), true);
  assert.equal(polish.isNotAShipTitle('CODEX APP UPDATES'), true);
  assert.equal(polish.isNotAShipTitle('GPT-5.5 AND CODEX APP UPDATES'), true);
  assert.equal(polish.isNotAShipTitle('CHATGPT FOR IOS UPDATES: REDESIGNED'), true);
  assert.equal(polish.isNotAShipTitle('Codex app · 26 updates in Feb'), false);
  assert.equal(polish.isJunkTitle('CODEX APP UPDATES'), true);
  assert.equal(polish.cleanShipTitle('CODEX MCP SERVER REMOVED'), '');
  const items = polish.polishCandidates(
    [
      found({ name: '@CHATGPT', date: '2026-08-01', link: 'https://openai.com/chatgpt' }),
      found({ name: 'CODEX MCP SERVER REMOVED', date: '2026-08-02', link: 'https://developers.openai.com/codex/mcp' }),
      found({ name: 'CODEX ANALYTICS GOVERNANCE DOCS UPDATE', date: '2026-08-03', link: 'https://developers.openai.com/codex/docs' }),
      found({ name: 'CODEX APP UPDATES', date: '2026-08-04', link: 'https://developers.openai.com/codex/app' }),
      found({ name: 'GPT-5.5 AND CODEX APP UPDATES', date: '2026-08-05', link: 'https://developers.openai.com/codex/gpt' }),
      found({ name: 'CHATGPT FOR IOS UPDATES: REDESIGNED', date: '2026-08-06', link: 'https://openai.com/chatgpt/ios' }),
      found({ name: 'CURSOR INTO THE CHATGPT DESKTOP APP', date: '2026-08-07', link: 'https://openai.com/chatgpt/desktop' }),
      found({ name: 'CODEX MODELS FOR MODEL AVAILABILITY', date: '2026-08-08', link: 'https://developers.openai.com/codex/models' }),
      found({ name: 'GitLab support', date: '2026-08-19', link: 'https://developers.openai.com/codex/changelog#gitlab-19' }),
      found({ name: 'GitLab support in Codex', date: '2026-08-20', link: 'https://developers.openai.com/codex/changelog#gitlab-20' }),
      found({ name: 'Codex CLI', date: '2026-02-14', link: 'https://openai.com/codex' }),
    ],
    { year: 2026, who: 'Tibo' },
  );
  const names = items.map((item) => item.name);
  assert.equal(names.some((name) => /@chatgpt|removed|docs update|app updates|redesigned|into the|model availability/i.test(name)), false, JSON.stringify(names));
  assert.ok(names.some((name) => /codex cli/i.test(name)), JSON.stringify(names));
  const tape = ai
    .harvestItems(
      {
        found: items,
        web: [],
        pages: [],
        site: null,
        profile: { name: 'Tibo', bio: '', site: null, x: 'tibo_maker', github: null },
        ran: [],
        failed: [],
        stats: [],
      },
      2026,
    )
    .map((item) => item.name);
  assert.equal(tape.filter((name) => /gitlab/i.test(name)).length, 1, JSON.stringify(tape));
});

test('undated changelog phrases drop; Composer 2 keeps the March launch day', () => {
  assert.equal(polish.isChangelogPhrase('Richer JavaScript representation', null), true);
  assert.equal(polish.isChangelogPhrase('Typed middleware', null), true);
  assert.equal(polish.isChangelogPhrase('New date', null), true);
  assert.equal(polish.isChangelogPhrase('Richer JavaScript representation', '2026-04-01'), false);
  assert.equal(polish.displayShipName('CODEX APP'), 'Codex app');
  assert.equal(polish.displayShipName('CURSOR 3'), 'Cursor 3');
  assert.equal(polish.displayShipName('CHATGPT IMAGES'), 'ChatGPT Images');
  const items = polish.polishCandidates(
    [
      found({ name: 'Richer JavaScript representation', date: null, source: 'changelog', link: 'https://zod.dev/changelog#richer' }),
      found({ name: 'Typed middleware', date: null, source: 'changelog', link: 'https://zod.dev/changelog#typed' }),
      found({ name: 'Zod', date: '2026-01-15', source: 'npm', link: 'https://www.npmjs.com/package/zod' }),
      found({ name: 'Composer 2', date: '2026-08-14', link: 'https://cursor.com/blog/composer-2' }),
      found({ name: 'SHOO', date: '2026-03-01', source: 'npm', link: 'https://www.npmjs.com/package/@shoojs/core' }),
    ],
    { year: 2026, who: 'Colin' },
  );
  const names = items.map((item) => item.name);
  assert.equal(names.some((name) => /richer|typed middleware/i.test(name)), false, JSON.stringify(names));
  assert.equal(items.find((item) => /composer 2/i.test(item.name))?.date, '2026-03-19');
  assert.ok(names.some((name) => /^shoo$/i.test(name)), JSON.stringify(names));
});

test('archive.org/RDAP product hosts beat an npm publish day for the product itself', () => {
  const npmUrls = dates.productLaunchUrlsForNpm(
    { name: 'POST BRIDGE', link: 'https://www.npmjs.com/package/post-bridge' },
    { pageText: 'https://post-bridge.com https://zod.dev' },
  );
  assert.ok(npmUrls.some((url) => /post-bridge\.com/.test(url)), JSON.stringify(npmUrls));
  assert.equal(npmUrls.some((url) => /npmjs|zod\.dev/.test(url)), false, JSON.stringify(npmUrls));
  const zodUrls = dates.productLaunchUrlsForNpm({ name: 'ZOD', link: 'https://www.npmjs.com/package/zod' }, { pageText: 'https://zod.dev' });
  assert.equal(zodUrls.length, 0);
  const cliUrls = dates.productLaunchUrlsForNpm({ name: 'POSTBRIDGE-CLI', link: 'https://www.npmjs.com/package/postbridge-cli' }, { pageText: 'https://post-bridge.com' });
  assert.equal(cliUrls.some((url) => /post-bridge\.com/.test(url)), false);
  const socketUrls = dates.productLaunchUrlsForNpm({ name: 'socket.io-client', link: 'https://www.npmjs.com/package/socket.io-client' }, {});
  assert.deepEqual(socketUrls, ['https://socket.io/']);
  const engineUrls = dates.npmFamilyProductUrls('engine.io-client');
  assert.deepEqual(engineUrls, ['https://engine.io/']);
  assert.equal(dates.isLegacyNpmFamily('socket.io-client'), true);
  assert.equal(dates.isLegacyNpmFamily('Engine.io-Client'), true);
  assert.equal(dates.isLegacyNpmFamily('socket.io-adapter'), true);
  assert.equal(dates.isLegacyNpmFamily('@zod/mini'), false);
  const socketTape = polish.polishCandidates(
    [
      found({ name: 'Serve', date: '2026-03-03', source: 'changelog', link: 'https://vercel.com/blog/serve' }),
      found({ name: 'socket.io-client', date: '2026-04-01', source: 'npm', link: 'https://www.npmjs.com/package/socket.io-client' }),
      found({ name: 'emoji-todo', date: '2026-04-24', source: 'github', link: 'https://github.com/rauchg/emoji-todo' }),
      found({ name: 'AWAIT ASYNCCODEC.ENCODEASYNC', date: null, source: 'site', link: 'https://colinhacks.com/' }),
    ],
    { year: 2026, who: 'Guillermo Rauch' },
  );
  const socketNames = socketTape.map((item) => item.name);
  assert.equal(socketNames.some((name) => /socket\.io|emoji-todo|encodeasync|asynccodec/i.test(name)), false, JSON.stringify(socketNames));
  assert.ok(socketNames.some((name) => /serve/i.test(name)), JSON.stringify(socketNames));
});

test('sitemap slugs become flagship names and june-2026 slugs get a day', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://cursor.com/blog/cursor-3</loc></url>
    <url><loc>https://cursor.com/blog/composer-2</loc></url>
    <url><loc>https://cursor.com/blog/graphite</loc></url>
    <url><loc>https://cursor.com/changelog/bugbot-updates-june-2026</loc></url>
  </urlset>`;
  const items = changelog.itemsFromSitemap(xml, 2026);
  assert.ok(items.some((item) => /cursor 3/i.test(item.name)), JSON.stringify(items.map((i) => i.name)));
  assert.ok(items.some((item) => /composer 2/i.test(item.name)));
  assert.equal(items.filter((item) => /graphite/i.test(item.name)).length, 0);
  const bugbot = items.find((item) => /bugbot/i.test(item.name));
  assert.ok(bugbot);
  assert.equal(bugbot.date, '2026-06-01');
});

test('vague leftover headings drop; spoken names keep source casing', () => {
  assert.equal(polish.isVagueOrCutTitle('CHATGPT WORK OR CODEX CHAT AND WORK'), true);
  assert.equal(polish.isVagueOrCutTitle('PETS CONTROLS IN THE CHATGPT DESKTOP'), true);
  assert.equal(polish.isVagueOrCutTitle('CLOUD WORK'), true);
  assert.equal(polish.isVagueOrCutTitle('NEW CONTROLS FOR LONG-RUNNING WORK'), true);
  assert.equal(polish.isJunkTitle('NUMBER'), true);
  assert.equal(polish.spokenShipName('TSC-RS'), 'tsc-rs');
  assert.equal(polish.spokenShipName('BOTID'), 'BotID');
  assert.equal(polish.spokenShipName('TSC-RS', 'tsc-rs'), 'tsc-rs');
  assert.equal(polish.spokenShipName('BOTID', 'BotID'), 'BotID');
  assert.equal(polish.displayShipName('CODEX APP'), 'Codex app');
  const leftover = polish.polishCandidates(
    [
      found({ name: 'CHATGPT WORK OR CODEX CHAT AND WORK', date: '2026-04-01', link: 'https://developers.openai.com/codex/or' }),
      found({ name: 'PETS CONTROLS IN THE CHATGPT DESKTOP', date: '2026-04-02', link: 'https://openai.com/chatgpt/pets' }),
      found({ name: 'CLOUD WORK', date: '2026-04-03', link: 'https://developers.openai.com/codex/cloud-work' }),
      found({ name: 'NEW CONTROLS FOR LONG-RUNNING WORK', date: '2026-04-04', link: 'https://developers.openai.com/codex/controls' }),
      found({ name: 'Codex CLI', date: '2026-02-14', link: 'https://openai.com/codex' }),
    ],
    { year: 2026, who: 'Tibo' },
  );
  const leftoverNames = leftover.map((item) => item.name);
  assert.equal(leftoverNames.some((name) => / or |pets controls|cloud work|new controls/i.test(name)), false, JSON.stringify(leftoverNames));
  assert.ok(leftoverNames.some((name) => /codex cli/i.test(name)));
});

test('undated crumbs need ownership plus a description', async () => {
  const ownership = await import('../worker/shipped-ownership.ts');
  const colin = { name: 'Colin McDonnell', github: 'colinhacks' };
  assert.equal(
    ownership.undatedPassesGate(
      { name: 'TRPC', description: '', date: null, source: 'npm', link: 'https://www.npmjs.com/package/@trpc/server' },
      colin,
    ),
    false,
  );
  assert.equal(
    ownership.undatedPassesGate(
      { name: 'NUMBER', description: '', date: null, source: 'npm', link: 'https://www.npmjs.com/package/number' },
      colin,
    ),
    false,
  );
  assert.equal(
    ownership.undatedPassesGate(
      { name: 'ZOD', description: 'TypeScript-first schema validation', date: '2026-01-15', source: 'npm', link: 'https://www.npmjs.com/package/zod' },
      colin,
    ),
    true,
  );
  const items = polish.polishCandidates(
    [
      found({ name: 'TRPC', date: null, source: 'npm', link: 'https://www.npmjs.com/package/@trpc/server', description: '' }),
      found({ name: 'NUMBER', date: null, source: 'npm', link: 'https://www.npmjs.com/package/number', description: '' }),
      found({ name: 'Zod', date: '2026-01-15', source: 'npm', link: 'https://www.npmjs.com/package/zod', description: 'Schema' }),
      found({ name: 'Boron', date: '2026-02-01', source: 'github', link: 'https://github.com/colinhacks/boron', description: 'Schema core' }),
      found({ name: 'Nub', date: '2026-02-08', source: 'github', link: 'https://github.com/colinhacks/nub', description: 'Tiny helper' }),
      found({ name: 'Frizz', date: null, source: 'github', link: 'https://github.com/colinhacks/frizz', description: 'A small CSS helper Colin ships' }),
    ],
    { year: 2026, who: 'Colin McDonnell', handle: 'colinhacks', owner: colin },
  );
  const names = items.map((item) => item.name);
  assert.equal(names.some((name) => /trpc|number/i.test(name)), false, JSON.stringify(names));
  assert.ok(names.some((name) => /^zod$/i.test(name)), JSON.stringify(names));
});
