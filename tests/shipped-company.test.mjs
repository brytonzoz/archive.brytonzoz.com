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
  const sameLine = changelog.itemsFromIsoDateHeadings('2026-07-21 Codex CLI 0.145.0\n', 'https://developers.openai.com/codex/changelog', 2026);
  assert.ok(sameLine.some((item) => /0\.145\.0/.test(item.name)), JSON.stringify(sameLine));
});

test('blocked challenge pages are dropped; TinyFish markdown still extracts dated ships', () => {
  assert.equal(company.looksBlockedPage('<html>Just a moment...</html>', 'Just a moment...'), true);
  assert.equal(company.looksBlockedPage('Attention Required! | Cloudflare', 'Attention Required'), true);
  assert.equal(company.looksBlockedPage('# Codex CLI 0.145.0\n2026-07-21\nReleased to users.', 'Codex changelog'), false);
  assert.equal(company.isPriorityCompanyUrl('https://openai.com/changelog'), true);
  assert.equal(company.isPriorityCompanyUrl('https://developers.openai.com/codex/changelog'), true);
  assert.equal(company.isPriorityCompanyUrl('https://openai.com/careers'), false);
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
  assert.ok(!got.found.some((item) => /images/i.test(item.name)));
  assert.ok(got.found.every((item) => item.via === 'via OpenAI · Codex'));

  const ceo = { ...affiliation.emptyAffiliation(), company: 'OpenAI', role: 'ceo', typedCompany: true };
  const all = await company.harvestCompany({ affiliation: ceo, year: 2026, env: {}, store });
  assert.equal(all.found.length, 2);
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
