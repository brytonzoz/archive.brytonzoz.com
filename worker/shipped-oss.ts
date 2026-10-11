/** Free GitHub OSS harvest: owned repos + founder/top-3 org repos → 2026 releases, tags, blogs, launches. */

import { itemsFromFeedXml } from './shipped-changelog';
import { affiliationFromBio } from './shipped-affiliation';
import { githubReposFromText, productHostGuesses } from './shipped-identity';
import { isBlogEssayTitle, isPrereleaseShip, looksLikeEssayTitle } from './shipped-polish';
import { pinnedReposFromHtml } from './shipped-products';
import { journalShipName, looksLikePersonalShip } from './shipped-research';
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
  const tail = text.match(/v?(\d{1,4}\.\d{1,4}(?:\.\d{1,4})?)\s*$/i)?.[1] || '';
  const candidates = [text.replace(/^v/i, ''), text.replace(/^[A-Za-z][\w.-]*?[@/-]v?/i, ''), tail];
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

/** Employer platform orgs — harvest only when this person founded them. */
export function isEmployerOrg(org: string): boolean {
  return /^(vercel|openai|cursor|anthropic)$/i.test(String(org || '').replace(/^@/, ''));
}

const OSS_ORG_ALIASES: Record<string, string[]> = {
  bun: ['ovensh', 'oven'],
  svelte: ['sveltejs'],
  sveltekit: ['sveltejs'],
  vue: ['vuejs'],
  vite: ['vitejs'],
  react: ['react', 'facebook'],
  rails: ['rails', 'rubyonrails'],
};

const OSS_FLAGSHIP_REPOS = [
  'vite',
  'vue',
  'core',
  'rolldown',
  'vitepress',
  'vitest',
  'oxc',
  'tsdown',
  'vue-router',
  'pinia',
  'bun',
  'svelte',
  'kit',
  'rollup',
  'nub',
];

function ossRepoPriority(name: string): number {
  const key = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const idx = OSS_FLAGSHIP_REPOS.indexOf(key);
  return idx >= 0 ? idx : 50;
}

/** Vite / Vue / Rolldown before docs and event crumbs so a fat canary feed does not starve sibling repos. */
export function rankOssHarvestRepos<T extends { name: string; stargazers_count?: number }>(repos: T[]): T[] {
  return repos.slice().sort((a, b) => {
    const rank = ossRepoPriority(a.name) - ossRepoPriority(b.name);
    if (rank) return rank;
    return (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0);
  });
}

function orgMatchesProduct(org: string, raw: string): boolean {
  const slug = org.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const token = String(raw || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]/g, '');
  if (!slug || token.length < 2) return false;
  if (token === slug || slug.includes(token) || (token.length >= 4 && token.includes(slug))) return true;
  return (OSS_ORG_ALIASES[token] || []).includes(slug);
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
  const phrase = String(opts.bio || '').match(
    /\b(?:creator|founder|co-?founder|maker|author)\s+(?:of|at|for|@)?\s*([A-Za-z][A-Za-z0-9._-]*)/i,
  );
  if (phrase?.[1] && orgMatchesProduct(org, phrase[1])) return true;
  if (roleFounder) {
    return [opts.company, opts.product, opts.companyGithub].filter(Boolean).some((value) => orgMatchesProduct(org, String(value)));
  }
  return false;
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
  opts?: { includePrereleases?: boolean },
): OssFound[] {
  const product = productNameFromRepo(repo.name, repo.homepage);
  const repoUrl = publicUrl(repo.html_url) || `https://github.com/${repo.owner}/${repo.name}`;
  const seen = new Set<string>();
  const dated: { tag: string; date: string; url: string; body: string; notable: boolean }[] = [];
  const includePre = Boolean(opts?.includePrereleases);

  const take = (tag: string, date: string | null, url: string | null, body: string, notable: boolean) => {
    const key = tag.replace(/^v/i, '').toLowerCase();
    if (!key || seen.has(key) || !inYear(date, year)) return;
    if (isPrereleaseTag(tag) && !includePre) return;
    seen.add(key);
    dated.push({ tag, date: date!, url: url || repoUrl, body, notable });
  };

  for (const release of releases) {
    if (release.draft || (release.prerelease && !includePre)) continue;
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
    if (sem && sem.patch === 0) {
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
  if (includePre && !found.length && inYear(repo.pushed_at, year) && !SKIP_REPO.test(repo.name) && REPO_OK.test(repo.name)) {
    found.push(
      asFound({
        name: product,
        description: tidy(repo.description, 140) || `${product} activity in ${year}`,
        date: day(repo.pushed_at),
        link: publicUrl(repo.homepage) || repoUrl,
        icon: null,
        source,
        status: 'SHIPPED',
        score: 6,
        kind: 'oss-pin',
      }),
    );
  }
  return found.filter((item) => item.name);
}

function resolveHref(pageUrl: string, href?: string | null): string | null {
  if (!href) return null;
  try {
    return publicUrl(new URL(href, pageUrl).toString());
  } catch {
    return publicUrl(href);
  }
}

/** `<link rel="alternate" type="application/rss+xml" href="/rss.xml">` on the project blog. */
export function alternateFeedUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const tag of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const text = tag[0];
    if (!/rss|atom|feed/i.test(text)) continue;
    if (!/alternate|application\/(rss|atom)|rss\+xml|atom\+xml/i.test(text)) continue;
    const abs = resolveHref(pageUrl, text.match(/\bhref=["']([^"']+)/i)?.[1]);
    if (abs) out.push(abs);
  }
  return [...new Set(out)];
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
    for (const suffix of [
      '/rss.xml',
      '/feed.xml',
      '/atom.xml',
      '/blog/rss.xml',
      '/blog/feed.xml',
      '/blog/atom.xml',
      '/blog/rss',
      '/blog/feed',
      '/rss',
      '/feed',
      '/blog/index.xml',
    ]) {
      out.push(`${root}${suffix}`);
    }
  }
  return [...new Set(out)];
}

export function linesFromBlogFeed(xml: string, year: number, source: OssFound['source'] = 'changelog'): OssFound[] {
  return itemsFromFeedXml(xml, year)
    .filter((item) => item.name && !isPrereleaseTag(item.name))
    .filter((item) => {
      const blob = `${item.name} ${item.description || ''}`;
      if (looksLikePersonalShip(item.name) || looksLikePersonalShip(blob)) return true;
      if (/\d+\.\d+/.test(item.name) || /·\s*\d+\s+releases?\s+in\s+/i.test(item.name)) return true;
      if (looksLikeEssayTitle(item.name) || isBlogEssayTitle(item.name)) return false;
      return item.name.trim().split(/\s+/).filter(Boolean).length <= 5;
    })
    .map((item) => {
      const personal = looksLikePersonalShip(item.name) || looksLikePersonalShip(`${item.name} ${item.description || ''}`);
      const name = personal ? journalShipName(item.name) || item.name : item.name;
      return asFound({
        name,
        description: item.description,
        date: item.date,
        link: item.link,
        icon: null,
        source,
        status: item.status === 'LIVE' ? 'LIVE' : 'SHIPPED',
        score: 6,
        kind: personal ? 'journal-ship' : 'oss-blog',
      });
    });
}

const MONTH_NAME: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function dateNear(text: string, year: number): string | null {
  const iso = text.match(new RegExp(`\\b(${year})-(\\d{2})-(\\d{2})\\b`));
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = text.match(
    new RegExp(
      `\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+${year}\\b`,
      'i',
    ),
  );
  if (named) {
    const month = MONTH_NAME[named[1]!.toLowerCase()];
    if (month) return `${year}-${month}-${named[2]!.padStart(2, '0')}`;
  }
  return null;
}

/** Project blog listing when RSS 404s: dated `/blog/slug` cards. */
export function linesFromBlogHtml(html: string, year: number, pageUrl: string): OssFound[] {
  const found: OssFound[] = [];
  const seen = new Set<string>();
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = resolveHref(pageUrl, match[1]);
    if (!href || !/\/blog\/[A-Za-z0-9._-]+/i.test(href) || /\/blog\/(tag|page|category|author)\b/i.test(href)) continue;
    const name = tidy(match[2]!.replace(/<[^>]+>/g, ' '), 80);
    if (!name || isPrereleaseTag(name) || name.length < 4) continue;
    const around = String(html || '').slice(Math.max(0, match.index! - 240), (match.index || 0) + match[0].length + 240);
    const date = dateNear(around.replace(/<[^>]+>/g, ' '), year);
    if (!date) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push(
      asFound({
        name,
        description: `${name} on the project blog`,
        date,
        link: href,
        icon: null,
        source: 'changelog',
        status: 'SHIPPED',
        score: 6,
        kind: 'oss-blog',
      }),
    );
  }
  return found;
}

function sameOssVersion(a: string, b: string): boolean {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return a.toLowerCase().replace(/[^a-z0-9]+/g, '') === b.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const product = (name: string) =>
    name
      .replace(/v?\d+\.\d+(?:\.\d+)?.*$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch && product(a) === product(b);
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

export function eventReposFromEvents(
  events: { repo?: { name?: string }; type?: string }[] | null | undefined,
  login: string,
): { owner: string; name: string }[] {
  const self = login.replace(/^@/, '').toLowerCase();
  const out: { owner: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const event of Array.isArray(events) ? events : []) {
    const full = String(event.repo?.name || '');
    const [owner, name] = full.split('/');
    if (!owner || !name || !REPO_OK.test(name) || !/^[A-Za-z0-9-]{1,39}$/.test(owner)) continue;
    if (owner.toLowerCase() === self) continue;
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, name });
    if (out.length >= 8) break;
  }
  return out;
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
  pins?: { owner: string; name: string }[];
  products?: string[];
}): Promise<{ found: OssFound[]; ran: string[]; orgs: string[] }> {
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
  const events = await memo(`oss:events:${login.toLowerCase()}`, 180 * 60, () =>
    opts.get<{ repo?: { name?: string }; type?: string }[]>(`/users/${encodeURIComponent(login)}/events?per_page=30`).catch(() => []),
  );
  const eventHits = eventReposFromEvents(events, login);
  for (const hit of eventHits) {
    if (isEmployerOrg(hit.owner) && !isOrgFounder({
      org: hit.owner,
      bio: opts.bio,
      company: opts.affiliation?.company,
      companyGithub: opts.affiliation?.companyGithub,
      role: opts.affiliation?.role,
      product: opts.affiliation?.product,
    })) {
      continue;
    }
    if (!orgs.some((row) => row.toLowerCase() === hit.owner.toLowerCase())) orgs.push(hit.owner);
  }
  if (eventHits.length) ran.push(`oss-events:${eventHits.map((hit) => `${hit.owner}/${hit.name}`).slice(0, 8).join(',')}`);
  ran.push(`oss-orgs:${orgs.slice(0, 8).join(',') || 'none'}`);

  const started = Date.now();
  const overBudget = () => Date.now() - started > 6_000;
  const orgRepos: OssRepo[] = [];
  const takeRepo = (repo: OssRepo | null | undefined) => {
    if (!repo) return;
    const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (orgRepos.some((row) => `${row.owner.toLowerCase()}/${row.name.toLowerCase()}` === key)) return;
    orgRepos.push(repo);
  };

  const pins = [...(opts.pins || [])];
  if (!pins.length && opts.readText) {
    const html = await memo(`oss:pinhtml:${login.toLowerCase()}`, 360 * 60, () =>
      opts.readText!(`https://github.com/${login}`).catch(() => null),
    );
    if (html) {
      pins.push(...pinnedReposFromHtml(html));
      if (pins.length) ran.push(`oss-pins-html:${pins.map((pin) => `${pin.owner}/${pin.name}`).slice(0, 8).join(',')}`);
    }
  }

  const eventMetas = await Promise.all(
    eventHits.slice(0, 8).map(async (hit) => {
      if (isEmployerOrg(hit.owner) && !isOrgFounder({
        org: hit.owner,
        bio: opts.bio,
        company: opts.affiliation?.company,
        companyGithub: opts.affiliation?.companyGithub,
        role: opts.affiliation?.role,
        product: opts.affiliation?.product,
      })) {
        return null;
      }
      const meta = await memo(`oss:repo:${hit.owner}/${hit.name}`, 360 * 60, () =>
        opts.get<Record<string, unknown>>(`/repos/${encodeURIComponent(hit.owner)}/${encodeURIComponent(hit.name)}`).catch(() => null),
      );
      return { hit, meta };
    }),
  );
  for (const row of eventMetas) {
    if (!row) continue;
    const { hit, meta } = row;
    const repo =
      asRepo(hit.owner, meta || { name: hit.name, html_url: `https://github.com/${hit.owner}/${hit.name}`, stargazers_count: 1 }) ||
      ({
        owner: hit.owner,
        name: hit.name,
        html_url: `https://github.com/${hit.owner}/${hit.name}`,
        stargazers_count: 1,
      } satisfies OssRepo);
    if (meta && (meta as { fork?: boolean }).fork) continue;
    takeRepo(repo);
    ran.push(`oss-event-repo:${hit.owner}/${hit.name}`);
  }

  const pendingStats: { org: string; repos: OssRepo[] }[] = [];
  const orgPages = await Promise.all(
    orgs.slice(0, 8).map(async (org) => {
      const founder = isOrgFounder({
        org,
        bio: opts.bio,
        company: opts.affiliation?.company,
        companyGithub: opts.affiliation?.companyGithub,
        role: opts.affiliation?.role,
        product: opts.affiliation?.product,
      });
      if (isEmployerOrg(org) && !founder) return null;
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
      return { org, founder, repos, mentioned };
    }),
  );
  for (const page of orgPages) {
    if (!page) continue;
    if (page.founder || page.mentioned.length) {
      for (const repo of page.founder ? page.repos.slice(0, 20) : page.mentioned) takeRepo(repo);
      ran.push(page.founder ? `oss-founder:${page.org}` : `oss-bio:${page.org}/${page.mentioned.map((row) => row.name).slice(0, 4).join(',')}`);
      continue;
    }
    pendingStats.push({ org: page.org, repos: page.repos.slice(0, 3) });
  }

  const pinFounderOpts = {
    bio: opts.bio,
    company: opts.affiliation?.company,
    companyGithub: opts.affiliation?.companyGithub,
    role: opts.affiliation?.role,
    product: opts.affiliation?.product,
  };
  const leftoverPins = pins
    .filter((pin) => !(isEmployerOrg(pin.owner) && !isOrgFounder({ org: pin.owner, ...pinFounderOpts })))
    .filter((pin) => {
      const key = `${pin.owner.toLowerCase()}/${pin.name.toLowerCase()}`;
      return !orgRepos.some((row) => `${row.owner.toLowerCase()}/${row.name.toLowerCase()}` === key);
    })
    .slice(0, 4);

  const pinKeys = new Set(pins.map((pin) => `${pin.owner}/${pin.name}`.toLowerCase()));
  const productKeys = [...(opts.products || []), opts.affiliation?.product]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((value) => value.length >= 2);
  const isExactProductRepo = (repo: OssRepo) => {
    const name = repo.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const owner = repo.owner.toLowerCase().replace(/[^a-z0-9]/g, '');
    return productKeys.some((product) => product && (product === name || product === owner));
  };

  const seenHarvest = new Set<string>();
  const harvestOne = async (repo: OssRepo, tag: string) => {
      const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
      if (seenHarvest.has(key) || overBudget()) return;
      seenHarvest.add(key);
      const source: OssFound['source'] = repo.owner.toLowerCase() === login.toLowerCase() ? 'github' : 'company';
      let releases = await memo(`oss:rel:${repo.owner}/${repo.name}`, 180 * 60, () =>
        opts
          .get<OssRelease[]>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/releases?per_page=40`)
          .catch(() => []),
      );
      if (!Array.isArray(releases)) releases = [];
      const yearStable = () =>
        releases
          .filter((row) => !row.draft && !row.prerelease && !isPrereleaseTag(String(row.tag_name || row.name || '')))
          .filter((row) => inYear(day(row.published_at), year));
      const walkedBeforeYear = () =>
        releases.some((row) => {
          const when = day(row.published_at);
          return Boolean(when && when < `${year}-01-01`);
        });
      // Recent stables plus canaries can fill page 1 (and 2) without reaching January.
      // Stop deepening a fat canary feed once we have a year's worth of stables so
      // sibling flagships (vitest, oxc, vue-router) still get a first page.
      let releasePage = 1;
      while (!walkedBeforeYear() && releases.length >= 30 && releasePage < 4 && !overBudget()) {
        const stablesSoFar = yearStable().length;
        if (stablesSoFar >= 12 || (stablesSoFar >= 8 && releasePage >= 2)) break;
        releasePage += 1;
        const more = await memo(`oss:rel${releasePage}:${repo.owner}/${repo.name}`, 180 * 60, () =>
          opts
            .get<OssRelease[]>(
              `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/releases?per_page=40&page=${releasePage}`,
            )
            .catch(() => []),
        );
        if (!Array.isArray(more) || !more.length) break;
        releases = [...releases, ...more];
        if (more.length < 30) break;
      }
      const stables = yearStable();
      const yearPublished = releases.filter((row) => !row.draft && inYear(day(row.published_at), year));
      const canaryOwn =
        stables.length === 0 &&
        (isExactProductRepo(repo) || pinKeys.has(`${repo.owner}/${repo.name}`.toLowerCase()));
      const yearReleases = canaryOwn ? yearPublished : stables;
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
      const lines = linesFromOssRepo(repo, yearReleases, tags, year, source, { includePrereleases: canaryOwn });
      if (lines.length) {
        found.push(...lines);
        ran.push(`${tag}:${repo.owner}/${repo.name}:${lines.length}`);
      }
  };

  const harvestRepos = async (repos: OssRepo[], tag: string) => {
    const queue = repos.filter((repo) => !seenHarvest.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`));
    for (let i = 0; i < queue.length; i += 6) {
      if (overBudget()) {
        ran.push('oss-budget');
        return;
      }
      await Promise.all(queue.slice(i, i + 6).map((repo) => harvestOne(repo, tag)));
    }
  };

  const loadPins = async (pinsToLoad: typeof leftoverPins) => {
    if (!pinsToLoad.length) return;
    const loaded = await Promise.all(
      pinsToLoad.map(async (pin) => {
        const meta = await memo(`oss:repo:${pin.owner}/${pin.name}`, 360 * 60, () =>
          opts.get<Record<string, unknown>>(`/repos/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.name)}`).catch(() => null),
        );
        return { pin, meta };
      }),
    );
    for (const { pin, meta } of loaded) {
      const repo =
        asRepo(pin.owner, meta || { name: pin.name, html_url: `https://github.com/${pin.owner}/${pin.name}`, stargazers_count: 1 }) ||
        ({
          owner: pin.owner,
          name: pin.name,
          html_url: `https://github.com/${pin.owner}/${pin.name}`,
          stargazers_count: 1,
        } satisfies OssRepo);
      takeRepo(repo);
      ran.push(`oss-pin:${pin.owner}/${pin.name}`);
    }
    await harvestRepos(
      pinsToLoad
        .map((pin) => orgRepos.find((row) => row.owner.toLowerCase() === pin.owner.toLowerCase() && row.name.toLowerCase() === pin.name.toLowerCase()))
        .filter((row): row is OssRepo => Boolean(row)),
      'oss-rel',
    );
  };

  const pinName = (pin: { name: string }) => pin.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const flagshipPins = leftoverPins.filter((pin) => OSS_FLAGSHIP_REPOS.includes(pinName(pin)));
  const laterPins = leftoverPins.filter((pin) => !OSS_FLAGSHIP_REPOS.includes(pinName(pin)));
  // Flagship leftover pins (Nub) before a fat founder tape spends the 6s budget.
  // Personal leftover pins (notes) stay after so Vite / Vitest are not starved.
  await loadPins(flagshipPins);
  const rankedRepos = rankOssHarvestRepos(orgRepos);
  await harvestRepos(rankedRepos.slice(0, 16), 'oss-rel');
  if (!overBudget()) await loadPins(laterPins);

  const alreadyHave = (item: OssFound): boolean =>
    found.some((row) => sameOssVersion(row.name, item.name) || row.link === item.link);

  const harvestBlogs = async (homes: string[]) => {
    if (!opts.readText || overBudget()) return;
    for (const home of homes) {
      if (overBudget()) break;
      let origin = '';
      try {
        origin = new URL(home).origin;
      } catch {
        continue;
      }
      const blogPage = /\/blog\b/i.test(home) ? home.replace(/\/+$/, '') : `${origin}/blog`;
      const html = await memo(`oss:blogpage:${blogPage}`, 180 * 60, () => opts.readText!(blogPage).catch(() => null));
      const feeds = [
        ...(html ? alternateFeedUrls(html, blogPage) : []),
        ...blogFeedUrls(home),
        ...blogFeedUrls(origin),
      ].filter((url, i, all) => all.indexOf(url) === i);
      let usedFeed = false;
      for (const feed of feeds.slice(0, 8)) {
        if (overBudget()) break;
        const xml = await memo(`oss:feed:${feed}`, 180 * 60, () => opts.readText!(feed).catch(() => null));
        if (!xml || !/<item\b|<entry\b/i.test(xml)) continue;
        const items = linesFromBlogFeed(xml, year, 'changelog').filter((item) => !alreadyHave(item));
        if (items.length) {
          found.push(...items);
          ran.push(`oss-blog:${new URL(home).hostname}:${items.length}`);
        }
        usedFeed = true;
        break;
      }
      if (!usedFeed && html) {
        const items = linesFromBlogHtml(html, year, blogPage).filter((item) => !alreadyHave(item));
        if (items.length) {
          found.push(...items);
          ran.push(`oss-blog-html:${new URL(home).hostname}:${items.length}`);
        }
      }
    }
  };

  const earlyHomes = [
    ...orgRepos.map((repo) => publicUrl(repo.homepage)).filter((url): url is string => Boolean(url)),
    ...(opts.sites || []).map((url) => publicUrl(url)).filter((url): url is string => Boolean(url)),
  ].filter((url, i, all) => all.indexOf(url) === i);
  await harvestBlogs(earlyHomes.slice(0, 6));

  let bio = opts.bio || '';
  const products = [...(opts.products || []), opts.affiliation?.product, opts.affiliation?.company].filter(
    (value): value is string => Boolean(value),
  );
  const probeHomes = [...(opts.sites || [])].filter((url, i, all) => url && all.indexOf(url) === i);
  if (opts.readText && !overBudget()) {
    const extraHomes = found.length ? 2 : 4;
    for (let i = 0; i < probeHomes.length && i < extraHomes && !overBudget(); i++) {
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
      }
      for (const href of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
        const next = publicUrl(href[0]);
        if (!next || probeHomes.includes(next)) continue;
        if (/github\.com|twitter\.com|x\.com|linkedin\.com/i.test(next)) continue;
        probeHomes.push(next);
      }
      if (found.length === 0 && products.length) {
        for (const next of products.flatMap((product) => productHostGuesses(product)).slice(0, 2)) {
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
        takeRepo(repo);
        ran.push(`oss-site:${hit.owner}/${hit.name}`);
      }
    }
  }

  if (products.length && opts.get && !orgRepos.some((repo) => products.some((product) => product.toLowerCase().replace(/[^a-z0-9]+/g, '') === repo.name.toLowerCase().replace(/[^a-z0-9]+/g, ''))) && !overBudget()) {
    for (const product of products.slice(0, 2)) {
      const q = product.replace(/[^A-Za-z0-9._-]+/g, ' ').trim();
      if (q.length < 2) continue;
      const data = await memo(`oss:search:${q.toLowerCase()}:${login.toLowerCase()}`, 180 * 60, () =>
        opts
          .get<{ items?: Record<string, unknown>[] }>(
            `/search/repositories?q=${encodeURIComponent(`${q} in:name user:${login}`)}&per_page=5`,
          )
          .catch(() =>
            opts.get<{ items?: Record<string, unknown>[] }>(`/search/repositories?q=${encodeURIComponent(`${q} in:name stars:>200`)}&per_page=5`).catch(() => null),
          ),
      );
      for (const row of data?.items || []) {
        const repo = asRepo(String((row.owner as { login?: string } | undefined)?.login || ''), row);
        if (!repo) continue;
        const mentioned =
          bioMentionsRepo(bio, repo) ||
          products.some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '') === repo.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
        if (!mentioned) continue;
        takeRepo(repo);
        ran.push(`oss-search:${repo.owner}/${repo.name}`);
        break;
      }
    }
  }

  await harvestRepos(
    rankOssHarvestRepos(
      orgRepos.filter((repo) => !seenHarvest.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`)),
    ).slice(0, 8),
    'oss-rel',
  );

  if (found.length < 8 && !overBudget()) {
    for (const pending of pendingStats) {
      if (overBudget() || found.length >= 8) break;
      for (const repo of pending.repos) {
        const stats = await Promise.race([
          memo(`oss:stats:${pending.org}/${repo.name}:${year}`, 360 * 60, () =>
            opts.get<ContributorStat[]>(`/repos/${encodeURIComponent(pending.org)}/${encodeURIComponent(repo.name)}/stats/contributors`).catch(() => []),
          ),
          new Promise<ContributorStat[]>((resolve) => setTimeout(resolve, 2500, [])),
        ]);
        if (isTopContributorInYear(Array.isArray(stats) ? stats : [], login, year, 3)) {
          takeRepo(repo);
          ran.push(`oss-top3:${pending.org}/${repo.name}`);
          continue;
        }
        const since = await memo(`oss:authored:${pending.org}/${repo.name}:${login}:${year}`, 360 * 60, () =>
          opts
            .get<{ sha?: string }[]>(
              `/repos/${encodeURIComponent(pending.org)}/${encodeURIComponent(repo.name)}/commits?author=${encodeURIComponent(login)}&since=${year}-01-01T00:00:00Z&per_page=1`,
            )
            .catch(() => []),
        );
        if (Array.isArray(since) && since.length) {
          takeRepo(repo);
          ran.push(`oss-authored:${pending.org}/${repo.name}`);
        }
      }
    }
  }

  const leftover = rankOssHarvestRepos(
    orgRepos.filter((repo) => !seenHarvest.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`)),
  );
  const ownedLeft = owned
    .filter((repo) => !seenHarvest.has(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`))
    .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
    .slice(0, 8);
  await harvestRepos([...leftover, ...ownedLeft].slice(0, 8), 'oss-rel');

  if (!ran.some((tag) => /^oss-blog/.test(tag))) {
    const lateHomes = [
      ...orgRepos.map((repo) => publicUrl(repo.homepage)).filter((url): url is string => Boolean(url)),
      ...earlyHomes,
    ].filter((url, i, all) => all.indexOf(url) === i);
    await harvestBlogs(lateHomes.slice(0, 6));
  }

  ran.push(`oss-lines:${found.length}`);
  return { found, ran, orgs };
}
