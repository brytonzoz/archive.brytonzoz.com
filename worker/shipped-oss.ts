/** Free GitHub OSS harvest: owned repos + founder/top-3 org repos → 2026 releases, tags, blogs, launches. */

import { itemsFromFeedXml } from './shipped-changelog';
import { affiliationFromBio } from './shipped-affiliation';
import { githubReposFromText, productHostGuesses } from './shipped-identity';
import { isPrereleaseShip } from './shipped-polish';
import { looksLikeProductReadme } from './shipped-repos';

export type OssRelease = {
  name?: string;
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  prerelease?: boolean;
  draft?: boolean;
};

export type OssTag = {
  name?: string;
  commit?: { sha?: string; url?: string };
  date?: string | null;
};

export type OssRepo = {
  owner: string;
  name: string;
  html_url?: string;
  description?: string;
  homepage?: string | null;
  created_at?: string | null;
  pushed_at?: string | null;
  stargazers_count?: number;
  fork?: boolean;
  readme?: boolean;
};

export type OssFound = {
  name: string;
  description: string;
  date: string | null;
  dateConfidence: 'exact' | 'year' | 'inferred' | 'unknown';
  link: string | null;
  icon: string | null;
  source: 'github' | 'company' | 'changelog';
  status: 'RELEASED' | 'SHIPPED' | 'LAUNCHED' | 'LIVE';
  score: number;
  thisYear: boolean;
  kind?: string;
};

export type OssGet = <T>(path: string) => Promise<T>;
export type OssCache = <T>(key: string, ttlSec: number, load: () => Promise<T>) => Promise<T>;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const PRE = /\b(canary|alpha|beta|rc|nightly)\b/i;
const REPO_OK = /^[A-Za-z0-9._-]{1,100}$/;
const SKIP_REPO =
  /\b(starter|course|action|example|template|foundations|academy|rules?|dotfiles|repro|demo|playground)\b/i;

export function parseSemver(raw: string): { major: number; minor: number; patch: number } | null {
  const text = String(raw || '').trim();
  const candidates = [text.replace(/^v/i, ''), text.replace(/^[A-Za-z][\w.-]*?[@/-]v?/i, '')];
  for (const candidate of candidates) {
    const match = candidate.match(/^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?:[-+].*)?$/);
    if (match) return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) };
  }
  return null;
}

export function isPrereleaseTag(tag: string): boolean {
  const text = String(tag || '');
  if (!text) return false;
  if (PRE.test(text)) return true;
  return isPrereleaseShip(text);
}

const KNOWN_OSS: Record<string, string> = {
  bun: 'Bun',
  vite: 'Vite',
  vue: 'Vue',
  svelte: 'Svelte',
  sveltekit: 'SvelteKit',
  rails: 'Rails',
  rubyonrails: 'Rails',
  preact: 'Preact',
  preactjs: 'Preact',
  nitro: 'Nitro',
  oxc: 'Oxc',
  react: 'React',
  query: 'TanStack Query',
  partykit: 'PartyKit',
  codehike: 'Code Hike',
  kamal: 'Kamal',
  htm: 'htm',
  dust: 'Dust',
  listhen: 'listhen',
};

function prettyOssToken(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (KNOWN_OSS[key]) return KNOWN_OSS[key];
  const spaced = raw.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return raw;
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\bVs\s*Code\b/i, 'VS Code').replace(/\bVscode\b/i, 'VS Code');
}

export function productNameFromRepo(repo: string, homepage?: string | null): string {
  const key = String(repo || '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  let host = '';
  let path = '';
  try {
    if (homepage) {
      const url = new URL(homepage);
      host = url.hostname.replace(/^www\./, '').toLowerCase();
      path = url.pathname.replace(/\/+$/, '');
    }
  } catch {
    host = '';
  }
  const hostLabel = host.split('.')[0] || '';
  const genericHost = /^(github|gitlab|npmjs|bitbucket)$/i.test(hostLabel);
  if (key === 'kit' && /svelte/i.test(`${host}${path}`)) return 'SvelteKit';
  if (key === 'core' && /vue/i.test(`${host}${path}`)) return 'Vue';
  if (key === 'query' && /tanstack/i.test(`${host}${path}`)) return 'TanStack Query';
  if (KNOWN_OSS[key]) return KNOWN_OSS[key];
  if (hostLabel && key.startsWith(`${hostLabel}-`)) return prettyOssToken(repo);
  if (!genericHost && KNOWN_OSS[hostLabel] && (key === hostLabel || hostLabel.startsWith(key))) {
    return KNOWN_OSS[hostLabel];
  }
  if (genericHost || !hostLabel) return prettyOssToken(repo);
  return prettyOssToken(hostLabel.length >= 2 && hostLabel.length <= 24 ? hostLabel : repo);
}

/** `1.3.0` → `1.3`; `7.0.0` → `7`; `5.20.0` → `5.20`. */
export function formatOssVersion(version: string): string {
  const sem = parseSemver(version);
  if (!sem) return version.replace(/^v/i, '');
  if (sem.minor === 0 && sem.patch === 0) return String(sem.major);
  if (sem.patch === 0) return `${sem.major}.${sem.minor}`;
  return `${sem.major}.${sem.minor}.${sem.patch}`;
}

export function formatOssLine(product: string, version: string): string {
  return `${product} ${formatOssVersion(version)}`.replace(/\s+/g, ' ').trim();
}

export function formatOssMonthRollup(product: string, count: number, month: string): string {
  const mon = MONTHS[Number(month.slice(5, 7)) - 1] || month;
  if (count <= 1) return product;
  return `${product} · ${count} RELEASES IN ${mon}`;
}

export function isOssRolledTitle(name: string): boolean {
  return /·\s*\d+\s+releases?\s+in\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(name);
}

export type ContributorWeek = { w?: number; a?: number; d?: number; c?: number };
export type ContributorStat = {
  author?: { login?: string | null };
  total?: number;
  weeks?: ContributorWeek[];
};

export function commitsInYear(stat: ContributorStat, year: number): number {
  const start = Date.UTC(year, 0, 1) / 1000;
  const end = Date.UTC(year + 1, 0, 1) / 1000;
  return (stat.weeks || []).reduce((sum, week) => {
    const w = Number(week.w || 0);
    if (!w || w < start || w >= end) return sum;
    return sum + (Number(week.c) || 0);
  }, 0);
}

export function isTopContributorInYear(stats: ContributorStat[], login: string, year: number, rank = 3): boolean {
  const want = login.replace(/^@/, '').toLowerCase();
  const scored = (Array.isArray(stats) ? stats : [])
    .map((row) => ({ login: String(row.author?.login || ''), commits: commitsInYear(row, year) }))
    .filter((row) => row.login && row.commits > 0)
    .sort((a, b) => b.commits - a.commits);
  return scored.slice(0, rank).some((row) => row.login.toLowerCase() === want);
}

export function bioMentionsRepo(bio: string | undefined, repo: { name: string; homepage?: string | null }): boolean {
  const hay = String(bio || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  if (!hay.trim()) return false;
  const names = [repo.name, productNameFromRepo(repo.name, repo.homepage)].map((value) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  );
  return names.some((name) => name.length >= 3 && hay.includes(name));
}

export function isOrgFounder(opts: {
  org: string;
  bio?: string;
  company?: string | null;
  companyGithub?: string | null;
  role?: string | null;
  product?: string | null;
}): boolean {
  const org = opts.org.replace(/^@/, '').toLowerCase();
  const roleFounder = opts.role === 'founder' || opts.role === 'ceo';
  const gh = (opts.companyGithub || '').replace(/^@/, '').toLowerCase();
  if (gh && gh === org && roleFounder) return true;
  const hay = `${opts.bio || ''}`;
  const saidFounder = /\b(creator|founder|co-?founder|maker|author)\b/i.test(hay) || roleFounder;
  if (!saidFounder) return false;
  const tokens = [opts.company, opts.product, opts.companyGithub, ...((opts.bio || '').match(/[A-Za-z][A-Za-z0-9._-]{1,39}/g) || [])]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9]/g, ''),
    )
    .filter((value) => value.length >= 2);
  const slug = org.replace(/[^a-z0-9]/g, '');
  return tokens.some((token) => token === slug || slug.includes(token) || (token.length >= 4 && token.includes(slug)));
}

function tidy(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function inYear(date: string | null | undefined, year: number): boolean {
  return Boolean(date && date.startsWith(String(year)));
}

function day(iso: unknown): string | null {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

function hasNotes(body: string | undefined): boolean {
  const text = tidy(body, 400);
  return text.length >= 12;
}

function asFound(row: Omit<OssFound, 'thisYear' | 'dateConfidence'> & { date: string | null; kind?: string }): OssFound {
  return {
    ...row,
    dateConfidence: row.date ? 'exact' : 'year',
    thisYear: true,
    kind: row.kind,
  };
}

export function linesFromOssRepo(
  repo: OssRepo,
  releases: OssRelease[],
  tags: OssTag[],
  year: number,
  source: OssFound['source'] = 'github',
): OssFound[] {
  const product = productNameFromRepo(repo.name, repo.homepage);
  const repoUrl = publicUrl(repo.html_url) || `https://github.com/${repo.owner}/${repo.name}`;
  const seen = new Set<string>();
  const dated: { tag: string; date: string; url: string; body: string; notable: boolean }[] = [];

  const take = (tag: string, date: string | null, url: string | null, body: string, notable: boolean) => {
    const key = tag.replace(/^v/i, '').toLowerCase();
    if (!key || seen.has(key) || !inYear(date, year)) return;
    if (isPrereleaseTag(tag)) return;
    seen.add(key);
    dated.push({ tag, date: date!, url: url || repoUrl, body, notable });
  };

  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const tag = String(release.tag_name || release.name || '');
    take(tag, day(release.published_at), publicUrl(release.html_url), String(release.body || ''), hasNotes(release.body) || Boolean(release.name && release.name !== release.tag_name));
  }
  for (const tag of tags) {
    const name = String(tag.name || '');
    take(name, day(tag.date), `${repoUrl.replace(/\/+$/, '')}/releases/tag/${encodeURIComponent(name)}`, '', false);
  }

  const found: OssFound[] = [];
  const patches = new Map<string, typeof dated>();
  for (const row of dated) {
    const sem = parseSemver(row.tag);
    const majorMinor = Boolean(sem && sem.patch === 0 && row.notable);
    if (majorMinor && sem) {
      found.push(
        asFound({
          name: formatOssLine(product, row.tag),
          description: tidy(row.body, 140) || `${product} ${formatOssVersion(row.tag)}`,
          date: row.date,
          link: row.url,
          icon: null,
          source,
          status: 'RELEASED',
          score: 8,
          kind: 'oss-release',
        }),
      );
      continue;
    }
    const month = row.date.slice(0, 7);
    const list = patches.get(month) ?? [];
    list.push(row);
    patches.set(month, list);
  }

  for (const [month, list] of patches) {
    const latest = list.slice().sort((a, b) => b.date.localeCompare(a.date))[0]!;
    if (list.length === 1) {
      const sem = parseSemver(latest.tag);
      found.push(
        asFound({
          name: sem ? formatOssLine(product, latest.tag) : product,
          description: tidy(latest.body, 140) || `${product} release`,
          date: latest.date,
          link: latest.url,
          icon: null,
          source,
          status: 'RELEASED',
          score: 6,
          kind: 'oss-release',
        }),
      );
      continue;
    }
    found.push(
      asFound({
        name: formatOssMonthRollup(product, list.length, month),
        description: `${list.length} ${product} releases in ${MONTHS[Number(month.slice(5, 7)) - 1] || month}`,
        date: latest.date,
        link: latest.url,
        icon: null,
        source,
        status: 'RELEASED',
        score: 7,
        kind: 'oss-release',
      }),
    );
  }

  if (inYear(repo.created_at, year) && (repo.stargazers_count ?? 0) >= 100 && repo.readme !== false) {
    const home = publicUrl(repo.homepage);
    if (!SKIP_REPO.test(repo.name) && REPO_OK.test(repo.name)) {
      found.push(
        asFound({
          name: product,
          description: tidy(repo.description, 140) || `New ${year} repository`,
          date: day(repo.created_at),
          link: home || repoUrl,
          icon: null,
          source,
          status: 'LAUNCHED',
          score: 6 + Math.log10(1 + (repo.stargazers_count ?? 0)),
          kind: 'oss-launch',
        }),
      );
    }
  }
  return found.filter((item) => item.name);
}

export function blogFeedUrls(homepage: string): string[] {
  const raw = publicUrl(homepage);
  if (!raw) return [];
  let origin = '';
  let path = '';
  try {
    const url = new URL(raw);
    if (/github\.com$/i.test(url.hostname)) return [];
    origin = url.origin;
    path = url.pathname.replace(/\/+$/, '');
  } catch {
    return [];
  }
  const roots = new Set([origin]);
  if (/\/blog\b/i.test(path)) roots.add(`${origin}${path.split('/blog')[0]}`);
  const out: string[] = [];
  for (const root of roots) {
    for (const suffix of ['/blog/rss.xml', '/blog/feed.xml', '/blog/atom.xml', '/blog/rss', '/blog/feed', '/rss.xml', '/feed.xml', '/atom.xml', '/rss', '/feed']) {
      out.push(`${root}${suffix}`);
    }
  }
  return [...new Set(out)];
}

export function linesFromBlogFeed(xml: string, year: number, source: OssFound['source'] = 'changelog'): OssFound[] {
  return itemsFromFeedXml(xml, year)
    .filter((item) => item.name && !isPrereleaseTag(item.name))
    .map((item) =>
      asFound({
        name: item.name,
        description: item.description,
        date: item.date,
        link: item.link,
        icon: null,
        source,
        status: item.status === 'LIVE' ? 'LIVE' : 'SHIPPED',
        score: 6,
        kind: 'oss-blog',
      }),
    );
}

export type OssFixtureRepo = {
  owner: string;
  name: string;
  homepage?: string | null;
  description?: string;
  stars?: number;
  created?: string | null;
  html_url?: string;
  readme?: boolean;
  majors?: [string, string, string?][];
  patches?: Record<string, number>;
};

/** Compact test/CI fixture → the same lines live harvest emits. */
export function expandOssFixture(repo: OssFixtureRepo, year: number, source: OssFound['source'] = 'github'): OssFound[] {
  const releases: OssRelease[] = [];
  for (const [tag, date, body] of repo.majors || []) {
    releases.push({
      tag_name: tag,
      name: formatOssLine(productNameFromRepo(repo.name, repo.homepage), tag),
      published_at: `${date}T12:00:00Z`,
      body: body || `${productNameFromRepo(repo.name, repo.homepage)} ${tag}`,
      html_url: `https://github.com/${repo.owner}/${repo.name}/releases/tag/${encodeURIComponent(tag)}`,
    });
  }
  for (const [month, count] of Object.entries(repo.patches || {})) {
    const [y, m] = month.split('-').map(Number);
    const base = parseSemver((repo.majors || []).find((row) => row[1].startsWith(month.slice(0, 7)))?.[0] || '1.0.0') || {
      major: 1,
      minor: 0,
      patch: 0,
    };
    for (let i = 0; i < count; i += 1) {
      const dayNum = Math.min(28, 2 + i);
      const tag = `v${base.major}.${m}.${i + 1}`;
      releases.push({
        tag_name: tag,
        published_at: `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}T12:00:00Z`,
        body: '',
        html_url: `https://github.com/${repo.owner}/${repo.name}/releases/tag/${encodeURIComponent(tag)}`,
      });
    }
  }
  return linesFromOssRepo(
    {
      owner: repo.owner,
      name: repo.name,
      homepage: repo.homepage,
      description: repo.description,
      created_at: repo.created,
      stargazers_count: repo.stars,
      html_url: repo.html_url || `https://github.com/${repo.owner}/${repo.name}`,
      readme: repo.readme !== false,
    },
    releases,
    [],
    year,
    source,
  );
}

function asRepo(owner: string, row: Record<string, unknown>): OssRepo | null {
  const name = typeof row.name === 'string' ? row.name : '';
  if (!REPO_OK.test(name) || row.fork || row.private || row.archived) return null;
  if (SKIP_REPO.test(name)) return null;
  return {
    owner,
    name,
    html_url: typeof row.html_url === 'string' ? row.html_url : `https://github.com/${owner}/${name}`,
    description: tidy(row.description, 140),
    homepage: typeof row.homepage === 'string' ? row.homepage : null,
    created_at: day(row.created_at),
    pushed_at: day(row.pushed_at),
    stargazers_count: Number(row.stargazers_count) || 0,
    fork: Boolean(row.fork),
  };
}

export async function harvestOss(opts: {
  login: string;
  year: number;
  get: OssGet;
  cache?: OssCache;
  readText?: (url: string) => Promise<string | null>;
  affiliation?: { company?: string | null; companyGithub?: string | null; role?: string | null; product?: string | null };
  bio?: string;
  orgs?: string[];
  sites?: string[];
}): Promise<{ found: OssFound[]; ran: string[] }> {
  const login = opts.login.replace(/^@/, '');
  const year = opts.year;
  const memo = opts.cache || (<T,>(_key: string, _ttl: number, load: () => Promise<T>) => load());
  const ran: string[] = [];
  const found: OssFound[] = [];

  const own = await memo(`oss:repos:${login.toLowerCase()}`, 360 * 60, () =>
    opts.get<Record<string, unknown>[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`).catch(() => []),
  );
  const owned = (Array.isArray(own) ? own : []).map((row) => asRepo(login, row)).filter((row): row is OssRepo => Boolean(row));

  let orgs = (opts.orgs || []).map((org) => org.replace(/^@/, '')).filter((org) => /^[A-Za-z0-9-]{1,39}$/.test(org));
  if (!orgs.length) {
    const rows = await memo(`oss:orgs:${login.toLowerCase()}`, 360 * 60, () =>
      opts.get<{ login?: string }[]>(`/users/${encodeURIComponent(login)}/orgs?per_page=30`).catch(() => []),
    );
    orgs = (rows || []).map((row) => String(row.login || '')).filter((org) => /^[A-Za-z0-9-]{1,39}$/.test(org));
  }
  if (orgs.length < 8) {
    const events = await memo(`oss:events:${login.toLowerCase()}`, 180 * 60, () =>
      opts.get<{ repo?: { name?: string }; type?: string }[]>(`/users/${encodeURIComponent(login)}/events?per_page=30`).catch(() => []),
    );
    for (const event of Array.isArray(events) ? events : []) {
      const full = String(event.repo?.name || '');
      const org = full.split('/')[0] || '';
      if (!org || org.toLowerCase() === login.toLowerCase() || !/^[A-Za-z0-9-]{1,39}$/.test(org)) continue;
      if (!orgs.some((row) => row.toLowerCase() === org.toLowerCase())) orgs.push(org);
      if (orgs.length >= 8) break;
    }
    if (events?.length) ran.push(`oss-events:${orgs.slice(0, 8).join(',')}`);
  }
  ran.push(`oss-orgs:${orgs.slice(0, 8).join(',') || 'none'}`);

  const orgRepos: OssRepo[] = [];
  for (const org of orgs.slice(0, 8)) {
    const founder = isOrgFounder({
      org,
      bio: opts.bio,
      company: opts.affiliation?.company,
      companyGithub: opts.affiliation?.companyGithub,
      role: opts.affiliation?.role,
      product: opts.affiliation?.product,
    });
    const rows = await memo(`oss:org-repos:${org.toLowerCase()}`, 360 * 60, () =>
      opts.get<Record<string, unknown>[]>(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=50`).catch(() => []),
    );
    const repos = (Array.isArray(rows) ? rows : [])
      .map((row) => asRepo(org, row))
      .filter((row): row is OssRepo => Boolean(row))
      .filter((row) => inYear(row.pushed_at, year) || inYear(row.created_at, year) || (row.stargazers_count ?? 0) >= 200)
      .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
    const mentioned = repos.filter(
      (repo) =>
        bioMentionsRepo(opts.bio, repo) ||
        bioMentionsRepo(opts.affiliation?.product || opts.affiliation?.company || '', repo),
    );
    if (founder || mentioned.length) {
      orgRepos.push(...(founder ? repos.slice(0, 20) : mentioned));
      ran.push(founder ? `oss-founder:${org}` : `oss-bio:${org}/${mentioned.map((row) => row.name).slice(0, 4).join(',')}`);
      continue;
    }
    const checked = repos.slice(0, 3);
    for (const repo of checked) {
      const stats = await Promise.race([
        memo(`oss:stats:${org}/${repo.name}:${year}`, 360 * 60, () =>
          opts.get<ContributorStat[]>(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/stats/contributors`).catch(() => []),
        ),
        new Promise<ContributorStat[]>((resolve) => setTimeout(resolve, 2500, [])),
      ]);
      if (isTopContributorInYear(Array.isArray(stats) ? stats : [], login, year, 3)) {
        orgRepos.push(repo);
        ran.push(`oss-top3:${org}/${repo.name}`);
        continue;
      }
      const since = await memo(`oss:authored:${org}/${repo.name}:${login}:${year}`, 360 * 60, () =>
        opts
          .get<{ sha?: string }[]>(
            `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo.name)}/commits?author=${encodeURIComponent(login)}&since=${year}-01-01T00:00:00Z&per_page=1`,
          )
          .catch(() => []),
      );
      if (Array.isArray(since) && since.length) {
        orgRepos.push(repo);
        ran.push(`oss-authored:${org}/${repo.name}`);
      }
    }
  }

  let bio = opts.bio || '';
  const products = [opts.affiliation?.product, opts.affiliation?.company].filter((value): value is string => Boolean(value));
  const probeHomes = [
    ...(opts.sites || []),
    ...products.flatMap((product) => productHostGuesses(product)),
  ].filter((url, i, all) => url && all.indexOf(url) === i);
  if (opts.readText) {
    for (let i = 0; i < probeHomes.length && i < 8; i++) {
      const home = probeHomes[i]!;
      const html = await memo(`oss:site:${home}`, 180 * 60, () => opts.readText!(home).catch(() => null));
      if (!html) continue;
      if (!bio) {
        const fromSite = html.match(/<meta[^>]+(?:name|property)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i)?.[1]
          || html.match(/content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:description|description)["']/i)?.[1]
          || '';
        if (fromSite) bio = fromSite;
      }
      if (!products.length && bio) {
        const fromBio = affiliationFromBio(bio);
        if (fromBio.company) products.push(fromBio.company);
        if (fromBio.product) products.push(fromBio.product);
        for (const next of products.flatMap((product) => productHostGuesses(product))) {
          if (next && !probeHomes.includes(next)) probeHomes.push(next);
        }
      }
      for (const hit of githubReposFromText(html)) {
        const mentioned =
          bioMentionsRepo(bio, hit) ||
          products.some((product) => product.toLowerCase().replace(/[^a-z0-9]+/g, '') === hit.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
        const founder = isOrgFounder({
          org: hit.owner,
          bio,
          company: opts.affiliation?.company,
          companyGithub: opts.affiliation?.companyGithub,
          role: opts.affiliation?.role,
          product: opts.affiliation?.product,
        });
        if (!mentioned && !founder) continue;
        const meta = await memo(`oss:repo:${hit.owner}/${hit.name}`, 360 * 60, () =>
          opts.get<Record<string, unknown>>(`/repos/${encodeURIComponent(hit.owner)}/${encodeURIComponent(hit.name)}`).catch(() => null),
        );
        const repo =
          asRepo(hit.owner, meta || { name: hit.name, html_url: `https://github.com/${hit.owner}/${hit.name}`, homepage: home, stargazers_count: 1 }) ||
          ({
            owner: hit.owner,
            name: hit.name,
            html_url: `https://github.com/${hit.owner}/${hit.name}`,
            homepage: home,
            stargazers_count: 1,
          } satisfies OssRepo);
        repo.homepage = repo.homepage || home;
        orgRepos.push(repo);
        ran.push(`oss-site:${hit.owner}/${hit.name}`);
      }
    }
  }

  if (products.length && opts.get && !orgRepos.some((repo) => products.some((product) => product.toLowerCase().replace(/[^a-z0-9]+/g, '') === repo.name.toLowerCase().replace(/[^a-z0-9]+/g, '')))) {
    for (const product of products.slice(0, 2)) {
      const q = product.replace(/[^A-Za-z0-9._-]+/g, ' ').trim();
      if (q.length < 2) continue;
      const data = await memo(`oss:search:${q.toLowerCase()}`, 180 * 60, () =>
        opts.get<{ items?: Record<string, unknown>[] }>(`/search/repositories?q=${encodeURIComponent(`${q} in:name stars:>500`)}&per_page=5`).catch(() => null),
      );
      for (const row of data?.items || []) {
        const repo = asRepo(String((row.owner as { login?: string } | undefined)?.login || ''), row);
        if (!repo) continue;
        const mentioned =
          bioMentionsRepo(bio, repo) ||
          products.some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '') === repo.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
        if (!mentioned) continue;
        orgRepos.push(repo);
        ran.push(`oss-search:${repo.owner}/${repo.name}`);
        break;
      }
    }
  }

  const seenRepo = new Set<string>();
  const targets: OssRepo[] = [];
  const pinned = new Set(orgRepos.map((repo) => `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`));
  for (const repo of [...orgRepos, ...owned]) {
    const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (seenRepo.has(key)) continue;
    seenRepo.add(key);
    targets.push(repo);
  }
  const ranked = [
    ...targets.filter((repo) => pinned.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`)).slice(0, 8),
    ...targets
      .filter((repo) => !pinned.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`))
      .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
      .slice(0, 8),
  ];

  const started = Date.now();
  for (const repo of ranked) {
    if (Date.now() - started > 28_000) {
      ran.push('oss-budget');
      break;
    }
    const source: OssFound['source'] = repo.owner.toLowerCase() === login.toLowerCase() ? 'github' : 'company';
    const releases = await memo(`oss:rel:${repo.owner}/${repo.name}`, 180 * 60, () =>
      opts
        .get<OssRelease[]>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/releases?per_page=40`)
        .catch(() => []),
    );
    const yearReleases = (Array.isArray(releases) ? releases : []).filter((row) => inYear(day(row.published_at), year));
    let tags: OssTag[] = [];
    if (yearReleases.length < 5) {
      const rawTags = await memo(`oss:tags:${repo.owner}/${repo.name}`, 180 * 60, () =>
        opts.get<OssTag[]>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/tags?per_page=30`).catch(() => []),
      );
      const unused = (Array.isArray(rawTags) ? rawTags : [])
        .filter((tag) => tag.name && !yearReleases.some((row) => String(row.tag_name || '').toLowerCase() === String(tag.name).toLowerCase()))
        .filter((tag) => parseSemver(String(tag.name || '')) && !isPrereleaseTag(String(tag.name || '')))
        .slice(0, 12);
      tags = await Promise.all(
        unused.map(async (tag) => {
          const sha = tag.commit?.sha;
          if (!sha) return { ...tag, date: null };
          const commit = await memo(`oss:commit:${repo.owner}/${repo.name}/${sha}`, 360 * 60, () =>
            opts
              .get<{ commit?: { committer?: { date?: string }; author?: { date?: string } } }>(
                `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${encodeURIComponent(sha)}`,
              )
              .catch(() => null),
          );
          return { ...tag, date: day(commit?.commit?.committer?.date || commit?.commit?.author?.date) };
        }),
      );
    }
    if (inYear(repo.created_at, year) && (repo.stargazers_count ?? 0) >= 100 && repo.readme == null) {
      const readme = await memo(`oss:readme:${repo.owner}/${repo.name}`, 360 * 60, () =>
        opts
          .get<{ content?: string }>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/readme`)
          .then((row) => Boolean(row?.content || looksLikeProductReadme(repo.description || '')))
          .catch(() => looksLikeProductReadme(repo.description || '')),
      );
      repo.readme = Boolean(readme);
    }
    found.push(...linesFromOssRepo(repo, yearReleases, tags, year, source));
  }

  const homes = [...new Set(ranked.map((repo) => publicUrl(repo.homepage)).filter((url): url is string => Boolean(url)))].slice(0, 6);
  if (opts.readText) {
    for (const home of homes) {
      for (const feed of blogFeedUrls(home).slice(0, 4)) {
        const xml = await memo(`oss:feed:${feed}`, 180 * 60, () => opts.readText!(feed).catch(() => null));
        if (!xml || !/<item\b|<entry\b/i.test(xml)) continue;
        const items = linesFromBlogFeed(xml, year, 'changelog');
        if (items.length) {
          found.push(...items);
          ran.push(`oss-blog:${new URL(home).hostname}`);
          break;
        }
      }
    }
  }

  ran.push(`oss-lines:${found.length}`);
  return { found, ran };
}
