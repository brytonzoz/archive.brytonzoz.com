import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const oss = await import('../worker/shipped-oss.ts');
const polish = await import('../worker/shipped-polish.ts');
const ai = await import('../worker/shipped-ai.ts');

test('major/minor releases with notes become product lines; patches roll up by month', () => {
  const lines = oss.linesFromOssRepo(
    { owner: 'oven-sh', name: 'bun', homepage: 'https://bun.sh', html_url: 'https://github.com/oven-sh/bun', stargazers_count: 78000 },
    [
      { tag_name: 'v1.3.0', name: 'Bun 1.3', published_at: '2026-04-02T12:00:00Z', body: 'Bun 1.3 is out', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.0' },
      { tag_name: 'v1.3.1', published_at: '2026-04-08T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.1' },
      { tag_name: 'v1.3.2', published_at: '2026-04-14T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.2' },
      { tag_name: 'canary', published_at: '2026-04-15T12:00:00Z', body: 'nightly', html_url: 'https://github.com/oven-sh/bun/releases/tag/canary', prerelease: true },
      { tag_name: 'v1.3.3-canary.1', published_at: '2026-04-16T12:00:00Z', body: 'canary' },
      { tag_name: 'v1.2.0', name: 'Bun 1.2', published_at: '2026-01-08T12:00:00Z', body: 'Bun 1.2', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.2.0' },
    ],
    [{ name: 'v1.3.4', date: '2026-04-20' }],
    2026,
    'company',
  );
  const names = lines.map((item) => item.name);
  assert.ok(names.includes('Bun 1.3'));
  assert.ok(names.includes('Bun 1.2'));
  assert.ok(names.some((name) => /BUN · \d+ RELEASES IN APR/i.test(name) || /Bun · \d+ RELEASES IN APR/i.test(name)));
  assert.equal(names.some((name) => /canary/i.test(name)), false);
});

test('prefixed tags still parse as semver', () => {
  assert.deepEqual(oss.parseSemver('bun-v1.4.0'), { major: 1, minor: 4, patch: 0 });
  assert.deepEqual(oss.parseSemver('svelte@5.20.0'), { major: 5, minor: 20, patch: 0 });
  assert.deepEqual(oss.parseSemver('v1.3.2'), { major: 1, minor: 3, patch: 2 });
});

test('harvestOss follows a personal site to the product homepage when GitHub bio is empty', async () => {
  const get = async (path) => {
    if (path.startsWith('/users/Jarred-Sumner/repos')) return [];
    if (path.startsWith('/users/Jarred-Sumner/orgs')) return [{ login: 'codeblog' }];
    if (path.includes('/oven-sh/bun/releases')) {
      return [{ tag_name: 'bun-v1.4.0', name: 'Bun 1.4', published_at: '2026-08-20T12:00:00Z', body: 'Bun 1.4 notes', html_url: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0' }];
    }
    if (path === '/repos/oven-sh/bun') {
      return { name: 'bun', html_url: 'https://github.com/oven-sh/bun', homepage: 'https://bun.com', stargazers_count: 96000 };
    }
    return [];
  };
  const { found, ran } = await oss.harvestOss({
    login: 'Jarred-Sumner',
    year: 2026,
    get,
    orgs: ['codeblog'],
    sites: ['https://jarredsumner.com/'],
    readText: async (url) => {
      if (/jarredsumner\.com/i.test(url)) {
        return '<meta name="description" content="Creator of Bun. Working at Anthropic."><a href="https://bun.com">Bun</a>';
      }
      if (/bun\.com/i.test(url)) return 'Bun runtime <a href="https://github.com/oven-sh/bun">source</a>';
      return null;
    },
  });
  assert.ok(ran.some((tag) => /oss-site:oven-sh\/bun|oss-search:oven-sh\/bun/.test(tag)), JSON.stringify(ran));
  assert.ok(found.some((item) => /bun 1\.4/i.test(item.name)), JSON.stringify(found.map((item) => item.name)));
});

test('harvestOss takes a flagship repo linked from the maker site when the org is hidden', async () => {
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    if (path.startsWith('/users/Jarred-Sumner/repos')) {
      return [{ name: 'xmac', html_url: 'https://github.com/Jarred-Sumner/xmac', stargazers_count: 14, fork: false, pushed_at: '2026-05-25T00:00:00Z' }];
    }
    if (path.startsWith('/users/Jarred-Sumner/orgs')) return [{ login: 'codeblog' }];
    if (path.includes('/oven-sh/bun/releases')) {
      return [
        { tag_name: 'bun-v1.4.0', name: 'Bun 1.4', published_at: '2026-08-20T12:00:00Z', body: 'Bun 1.4 notes', html_url: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0' },
        { tag_name: 'bun-v1.4.1', published_at: '2026-09-04T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.1' },
        { tag_name: 'bun-v1.4.2', published_at: '2026-09-05T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2' },
      ];
    }
    return [];
  };
  const { found, ran } = await oss.harvestOss({
    login: 'Jarred-Sumner',
    year: 2026,
    get,
    affiliation: { company: 'Bun', role: 'founder' },
    bio: 'Creator of Bun. Working at Anthropic.',
    orgs: ['codeblog'],
    sites: ['https://jarredsumner.com/'],
    readText: async (url) => {
      if (/jarredsumner\.com/i.test(url)) return 'Creator of Bun. <a href="https://bun.com">Bun</a>';
      if (/bun\.com/i.test(url)) return 'Bun runtime <a href="https://github.com/oven-sh/bun">oven-sh/bun</a>';
      return null;
    },
  });
  assert.ok(ran.some((tag) => /oss-site:oven-sh\/bun/.test(tag)), JSON.stringify(ran));
  assert.ok(found.some((item) => /bun 1\.4/i.test(item.name)), JSON.stringify(found.map((item) => item.name)));
  assert.equal(calls.some((path) => path.includes('/stats/contributors')), false);
});

test('product names prefer the project, not github.com', () => {
  assert.equal(oss.productNameFromRepo('rails', 'https://rubyonrails.org'), 'Rails');
  assert.equal(oss.productNameFromRepo('preact', 'https://preactjs.com'), 'Preact');
  assert.equal(oss.productNameFromRepo('kit', 'https://svelte.dev'), 'SvelteKit');
  assert.equal(oss.productNameFromRepo('htm', 'https://github.com/developit/htm'), 'htm');
  assert.equal(oss.productNameFromRepo('bun-vscode', 'https://bun.sh'), 'Bun VS Code');
  assert.equal(oss.productNameFromRepo('query', 'https://tanstack.com/query'), 'TanStack Query');
});

test('Vite 7 / Svelte 5.20 stay as named majors', () => {
  const vite = oss.expandOssFixture(
    {
      owner: 'vitejs',
      name: 'vite',
      homepage: 'https://vite.dev',
      majors: [['v7.0.0', '2026-01-16', 'Vite 7']],
      patches: { '2026-01': 6 },
    },
    2026,
  );
  const svelte = oss.expandOssFixture(
    {
      owner: 'sveltejs',
      name: 'svelte',
      homepage: 'https://svelte.dev',
      majors: [['v5.20.0', '2026-01-09', 'Svelte 5.20']],
      patches: { '2026-01': 7 },
    },
    2026,
  );
  assert.ok(vite.some((item) => /^vite 7$/i.test(item.name)));
  assert.ok(vite.some((item) => /RELEASES IN JAN/i.test(item.name)));
  assert.ok(svelte.some((item) => /^svelte 5\.20$/i.test(item.name)));
});

test('new 2026 repos with ≥100 stars and a README count as launches', () => {
  const lines = oss.linesFromOssRepo(
    {
      owner: 'voidzero-dev',
      name: 'voidzero',
      homepage: 'https://voidzero.dev',
      created_at: '2026-03-12',
      stargazers_count: 2100,
      description: 'Toolchain studio',
      readme: true,
    },
    [],
    [],
    2026,
    'company',
  );
  assert.ok(lines.some((item) => /voidzero/i.test(item.name) && item.kind === 'oss-launch'));
});

test('monthly patch tags stay unique so every month rolls up', () => {
  const lines = oss.expandOssFixture(
    {
      owner: 'oven-sh',
      name: 'bun',
      homepage: 'https://bun.sh',
      majors: [['v1.3.0', '2026-04-02', 'Bun 1.3']],
      patches: { '2026-02': 8, '2026-03': 9, '2026-04': 7 },
    },
    2026,
  );
  const months = lines.filter((item) => /RELEASES IN/i.test(item.name)).map((item) => item.name);
  assert.ok(months.some((name) => /FEB/i.test(name)), JSON.stringify(months));
  assert.ok(months.some((name) => /MAR/i.test(name)), JSON.stringify(months));
  assert.ok(months.some((name) => /APR/i.test(name)), JSON.stringify(months));
});

test('founder orgs skip contributor stats; top-3 is 2026 commits', () => {
  assert.equal(
    oss.isOrgFounder({ org: 'oven-sh', bio: 'Creator of Bun.', company: 'Bun', companyGithub: 'oven-sh', role: 'founder' }),
    true,
  );
  assert.equal(oss.isOrgFounder({ org: 'vercel', bio: 'I write blogs.', role: 'unknown' }), false);
  assert.equal(oss.bioMentionsRepo('I write and ship React tools.', { name: 'react', homepage: 'https://react.dev' }), true);
  assert.equal(oss.bioMentionsRepo('I write blogs.', { name: 'react', homepage: 'https://react.dev' }), false);
  const stats = [
    { author: { login: 'other' }, weeks: [{ w: Date.UTC(2026, 2, 1) / 1000, c: 40 }] },
    { author: { login: 'yyx990803' }, weeks: [{ w: Date.UTC(2026, 3, 1) / 1000, c: 20 }] },
    { author: { login: 'patak-dev' }, weeks: [{ w: Date.UTC(2026, 3, 1) / 1000, c: 18 }] },
    { author: { login: 'sapphi-red' }, weeks: [{ w: Date.UTC(2025, 3, 1) / 1000, c: 90 }] },
  ];
  assert.equal(oss.isTopContributorInYear(stats, 'yyx990803', 2026, 3), true);
  assert.equal(oss.isTopContributorInYear(stats, 'sapphi-red', 2026, 3), false);
});

test('org membership owns harvested GitHub releases', async () => {
  const ownership = await import('../worker/shipped-ownership.ts');
  const item = {
    name: 'React 20',
    date: '2026-03-11',
    link: 'https://github.com/facebook/react/releases/tag/v20.0.0',
    source: 'github',
    kind: 'oss-release',
  };
  assert.equal(ownership.ownedByBuilder(item, { name: 'Dan Abramov', github: 'gaearon' }), true);
  assert.equal(
    ownership.ownedByBuilder(
      { ...item, kind: undefined },
      { name: 'Dan Abramov', github: 'gaearon', orgs: ['facebook'] },
    ),
    true,
  );
});

test('leftover cut-offs and customer-story+metric titles drop', () => {
  assert.equal(polish.looksCutOff('SPEED INSIGHTS NOW HAS'), true);
  assert.equal(polish.looksCutOff('VERCEL CONNECT NOW ACCEPTS SERVICE'), true);
  assert.equal(polish.looksCutOff('TEAMS &'), true);
  assert.equal(polish.isCustomerStoryTitle('Nokia analyzes 50M+ network events with Cursor'), true);
  assert.equal(polish.isBlogEssayTitle('Cursor is an applied research team building the best'), true);
  assert.equal(polish.isBlogEssayTitle('Both are available today on Teams and Enterprise'), true);
  assert.equal(polish.cleanShipTitle('SO VISIBLE-TAB ROUTING AND ANNOTATIONS PERSIST'), '');
  assert.equal(polish.isStaleBioProduct({ name: 'HeadshotPro', date: null }, { company: 'HeadshotPro', product: null }, 2026), true);
  assert.equal(polish.isStaleBioProduct({ name: 'HeadshotPro', date: '2024-08-01' }, { company: 'HeadshotPro' }, 2026), true);
  assert.equal(polish.isStaleBioProduct({ name: 'AgentBar', date: '2026-03-01' }, { company: 'HeadshotPro' }, 2026), false);
});

test('harvestOss reads owned + founder org releases and blog RSS', async () => {
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    if (path.startsWith('/users/jarredsumner/repos')) {
      return [{ name: 'notes', html_url: 'https://github.com/jarredsumner/notes', stargazers_count: 12, fork: false, pushed_at: '2026-02-01T00:00:00Z' }];
    }
    if (path.startsWith('/users/jarredsumner/orgs')) return [{ login: 'oven-sh' }];
    if (path.startsWith('/orgs/oven-sh/repos')) {
      return [
        {
          name: 'bun',
          html_url: 'https://github.com/oven-sh/bun',
          homepage: 'https://bun.sh',
          stargazers_count: 78000,
          fork: false,
          pushed_at: '2026-04-02T00:00:00Z',
          description: 'Incredibly fast JavaScript runtime',
        },
      ];
    }
    if (path.includes('/oven-sh/bun/releases')) {
      return [
        { tag_name: 'v1.3.0', name: 'Bun 1.3', published_at: '2026-04-02T12:00:00Z', body: 'Bun 1.3 notes', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.0' },
        { tag_name: 'v1.3.1', published_at: '2026-04-08T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.1' },
        { tag_name: 'v1.3.2', published_at: '2026-04-09T12:00:00Z', body: '', html_url: 'https://github.com/oven-sh/bun/releases/tag/v1.3.2' },
      ];
    }
    return [];
  };
  const { found, ran } = await oss.harvestOss({
    login: 'jarredsumner',
    year: 2026,
    get,
    affiliation: { company: 'Bun', companyGithub: 'oven-sh', role: 'founder' },
    bio: 'Creator of Bun.',
    orgs: ['oven-sh'],
    readText: async (url) => {
      if (!/blog/i.test(url)) return null;
      return `<?xml version="1.0"?><rss><channel><item><title>Bun v1.3</title><link>https://bun.sh/blog/bun-v1.3</link><pubDate>Thu, 02 Apr 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
    },
  });
  assert.ok(ran.some((tag) => /founder:oven-sh/.test(tag)));
  assert.ok(found.some((item) => /bun 1\.3/i.test(item.name)));
  assert.equal(calls.some((path) => path.includes('/stats/contributors')), false);
});

test('bio-mentioned org repos skip contributor stats', async () => {
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    if (path.startsWith('/users/yyx990803/repos')) return [];
    if (path.startsWith('/orgs/vitejs/repos')) {
      return [
        { name: 'vite', homepage: 'https://vite.dev', stargazers_count: 72000, fork: false, pushed_at: '2026-01-16T00:00:00Z' },
        { name: 'docs', homepage: 'https://vite.dev', stargazers_count: 800, fork: false, pushed_at: '2026-02-01T00:00:00Z' },
      ];
    }
    if (path.includes('/vitejs/vite/releases')) {
      return [{ tag_name: 'v7.0.0', name: 'Vite 7', published_at: '2026-01-16T12:00:00Z', body: 'Vite 7', html_url: 'https://github.com/vitejs/vite/releases/tag/v7.0.0' }];
    }
    return [];
  };
  const { found, ran } = await oss.harvestOss({
    login: 'yyx990803',
    year: 2026,
    get,
    bio: 'Creator of Vite.',
    orgs: ['vitejs'],
  });
  assert.ok(ran.some((tag) => /oss-(bio|founder):vitejs/.test(tag)), JSON.stringify(ran));
  assert.ok(found.some((item) => /vite 7/i.test(item.name)));
  assert.equal(calls.some((path) => path.includes('/stats/contributors')), false);
});

test('live prints keep the writer note; empty CI notes use the sentence fallback', () => {
  const items = [
    {
      name: 'BUN 1.3',
      spoken: 'Bun 1.3',
      description: 'JavaScript runtime',
      date: '2026-04-02',
      status: 'RELEASED',
      link: 'https://bun.sh/blog/bun-v1.3',
      source: 'company',
    },
  ];
  const live = ai.finish(items, 'Bun kept shipping every other week.', 1, undefined, [], {
    who: 'Jarred Sumner',
    handle: 'jarredsumner',
    year: 2026,
    apiDown: false,
  });
  assert.match(live.note, /every other week/i);
  assert.equal(ai.isBareProductNote(live.note, live.items), false);
  const ci = ai.finish(items, '', 1, undefined, [], { who: 'Jarred Sumner', year: 2026, apiDown: false });
  assert.ok(ci.note);
  assert.equal(ai.isBareProductNote(ci.note, ci.items), false);
});
