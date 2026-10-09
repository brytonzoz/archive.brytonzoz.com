// Where "Shipped in <year>" finds things, all free: GitHub's public pages (no token needed), public APIs (the
// App Store, Hacker News, npm, Product Hunt with a token), the subject's own site, and TinyFish's free Search + Fetch for launch pages
// (worker/shipped-tinyfish.ts). Claude only assembles the receipt from this; its paid web search is a
// last resort (worker/shipped-ai.ts). Every source returns plain Found items; nothing here is trusted text.
//
// Optional keys (each source is skipped without its key):
//   GITHUB_TOKEN          GitHub API without the anonymous quota (repo secret SHIPPED_GITHUB_TOKEN). Tried first;
//                         when it's missing, rejected or rate-limited: the anonymous API, then github.com's pages
//   PRODUCTHUNT_KEY       Product Hunt OAuth app client id + secret: a public-scope token from the
//   PRODUCTHUNT_SECRET    client_credentials grant, cached until it expires (PRODUCTHUNT_TOKEN also works)
//   TINYFISH_API_KEY      TinyFish Search + Fetch (free endpoints only)
//   BRANDFETCH_API        Brandfetch Brand API: a brand's real icon before the site's own icon or favicon
//   XAI_API_KEY           xAI gap-fill only (x_keyword_search). Absent or monthly cap closed → skip
//   OPENAI_API_KEY        OpenAI Decisions only (POST /v1/decisions, gpt-6-luna). Never any other OpenAI endpoint
import type { Candidate, ItemSource, ItemStatus, Subject } from '../lib/shipped-year';
import { isDomain, isGithubLogin, isXHandle } from '../lib/shipped-year';
import { hasBlockedWord } from '../lib/shipped-sponsors';
import { tinyfishFetch, tinyfishSearch, type TinyfishMeter, type TinyfishPage } from './shipped-tinyfish';
import { safeFetch } from './shipped-fetch';
import {
  collisionOverride,
  companyLogins,
  extraSitePaths,
  githubLoginsFromText,
  handleTokens,
  handleVariants,
  nameLogins,
  makerMentions,
  mergeSites,
  parsePersonName,
  parseProductQuery,
  productHostGuesses,
  productNameFromHost,
  readXProfile,
  scoreGithubMatch,
  urlsFromText,
  type XProfile,
} from './shipped-identity';
import {
  describeWithStat,
  detectGaps,
  extraResearchPaths,
  extractPublicStats,
  formatReceiptStats,
  githubContributions,
  itemsFromProjectList,
  mergeStats,
  sourcedStat,
  trustmrrUrls,
  withMetrics,
  type SourcedStat,
} from './shipped-research';

export interface SourceEnv {
  GITHUB_TOKEN?: string;
  PRODUCTHUNT_TOKEN?: string;
  PRODUCTHUNT_KEY?: string;
  PRODUCTHUNT_SECRET?: string;
  TINYFISH_API_KEY?: string;
  BRANDFETCH_API?: string;
  XAI_API_KEY?: string;
  XAI_API_BASE?: string;
  SHIPPED_XAI_MODEL?: string;
  XAI_MAX_POSTS?: string;
  SHIPPED_XAI_MAX_POSTS?: string;
  SHIPPED_XAI_DEEP_MAX_POSTS?: string;
  XAI_MONTHLY_CAP_USD?: string;
  SHIPPED_XAI_MONTHLY_CAP_USD?: string;
  SHIPPED_FULL_ALLOWANCE_USD?: string;
  xaiMeter?: import('./shipped-xai').XaiMeter;
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE?: string;
}

export type DateConfidence = 'exact' | 'year' | 'inferred' | 'unknown';

export type Found = {
  name: string;
  description: string;
  date: string | null;
  /** How sure we are the date is this year's ship date. Missing date is `unknown`, not a drop. */
  dateConfidence?: DateConfidence;
  link: string | null;
  /** Remote image to dither into the logo (app icon, favicon, og:image). */
  icon: string | null;
  source: ItemSource;
  status: ItemStatus;
  /** Higher sorts first when there are too many. */
  score: number;
  /** From this year even without a date (GitHub search said it was created this year). */
  thisYear?: boolean;
  /** Proven public numbers for this line (stars, downloads, votes…), each with a source URL. */
  metrics?: import('./shipped-research').SourcedStat[];
  /** Company/product attribution printed on the tape. */
  via?: string | null;
  /** is_real_ship × in_2026 from Decisions (or the heuristic fallback). */
  confidence?: number;
  isRealShip?: number;
  inYear?: number;
  significance?: number;
  attribution?: import('./shipped-affiliation').Attribution;
};

export type WebResult = { title: string; url: string; snippet: string; date: string | null };

export type SiteInfo = { url: string; title: string; description: string; icon: string | null; text: string; links: { text: string; url: string }[] };

/** What the subject is, filled in as sources learn it (GitHub, X bio, personal sites). */
export type Profile = {
  name: string;
  bio: string;
  site: string | null;
  x: string | null;
  github: string | null;
  /** Every personal / company site we should crawl (homepage, X website, bio URLs). */
  sites?: string[];
  phUsers?: string[];
  npmUsers?: string[];
  affiliation?: import('./shipped-affiliation').Affiliation;
};

export const emptyProfile = (): Profile => ({
  name: '',
  bio: '',
  site: null,
  x: null,
  github: null,
  sites: [],
  phUsers: [],
  npmUsers: [],
});

const sitesOf = (profile: Profile) => profile.sites ?? [];
const phUsersOf = (profile: Profile) => profile.phUsers ?? [];
const npmUsersOf = (profile: Profile) => profile.npmUsers ?? [];

/** A page TinyFish read for us (their site, a launch post), cut down for the prompt. */
export type PageInfo = { url: string; title: string; description: string; published: string | null; text: string };

export type Gathered = {
  found: Found[];
  web: WebResult[];
  pages: PageInfo[];
  site: SiteInfo | null;
  profile: Profile;
  ran: string[];
  failed: string[];
  stats?: import('./shipped-research').SourcedStat[];
  gaps?: string[];
  coverageCapped?: boolean;
  /** Free cheap pass vs paid deep pass. */
  mode?: 'free' | 'full';
  /** Candidates we actually saw and did not print. Never a guess. */
  leftover?: number;
  leftoverKnown?: boolean;
  /** Decisions / harvest say the free tape is incomplete. */
  incomplete?: boolean;
  costs?: { xaiMicros: number; decisionsMicros: number; xaiTicks?: number; xaiHit?: boolean; xaiPosts?: number };
};

export type SourceContext = {
  subject: Subject;
  profile: Profile;
  year: number;
  env: SourceEnv;
  tinyfish: TinyfishAccess;
  /** Extra product/site URLs to look up on Product Hunt (gap-fill after harvest). */
  extraUrls?: string[];
};

export interface SourceProvider {
  id: string;
  enabled(ctx: SourceContext): boolean;
  run(ctx: SourceContext): Promise<Found[]>;
}

const UA = 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)';
const TIMEOUT = 7000;

export class SourceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT) });
  if (response.status === 403 || response.status === 429) throw new SourceError('rate-limited');
  if (!response.ok) throw new SourceError(`http-${response.status}`);
  return (await response.json()) as T;
}

/** Untrusted text: no control/bidi characters, no markup, no links or emails, short. */
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[<>`{}]/g, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** A public https URL we'd link to (no credentials, ports, IPs or local hosts). */
export function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') return null;
  url.hash = '';
  return url.toString();
}

export const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
};

const inYear = (date: string | null | undefined, year: number) => Boolean(date && date.startsWith(String(year)));
const day = (iso: unknown) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const loose = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function siteFromProfile(blog: unknown): string | null {
  if (typeof blog !== 'string' || !blog.trim()) return null;
  const url = publicUrl(/^https?:\/\//i.test(blog) ? blog : `https://${blog}`);
  return url && !/(^|\.)(github\.com|x\.com|twitter\.com|linkedin\.com|instagram\.com|facebook\.com)$/.test(hostOf(url) ?? '') ? url : null;
}

// ---- GitHub, without a token ----------------------------------------------------------------------
// github.com's public pages (profile, repositories tab, the .atom activity feed) are read directly; when
// github.com turns the Worker away, TinyFish's free Fetch reads them instead. GitHub's own search (which
// repos were created this year) only renders in a browser, so that one always goes through TinyFish. The
// REST API is used only while its anonymous quota (60 an hour per IP, shared with all of Cloudflare) has
// room. Everything is cached, and each step fails on its own without holding up the receipt.

const GH = 'https://github.com';
const MIN = 60;

/** TinyFish key + meter, when the free Fetch may be used. */
export type TinyfishAccess = { key: string; meter: TinyfishMeter } | null;

export const tinyfishAccess = (env: SourceEnv, meter: TinyfishMeter | null): TinyfishAccess =>
  env.TINYFISH_API_KEY && meter ? { key: env.TINYFISH_API_KEY, meter } : null;

const memo = new Map<string, { until: number; value: unknown }>();

/** This isolate's memory, then the data center's cache. Failures aren't cached; a definite "no" (null) is. */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const url = `https://shipped-cache.brytonzoz.com/v1/${encodeURIComponent(key)}`;
  const store = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: Cache }).default;
  const stored = await store?.match(url).catch(() => undefined);
  if (stored) {
    const value = (await stored.json()) as T;
    memo.set(key, { until: Date.now() + 5 * MIN * 1000, value });
    return value;
  }
  const value = await load();
  memo.set(key, { until: Date.now() + ttl * 1000, value });
  if (memo.size > 400) memo.delete(memo.keys().next().value as string);
  await store?.put(url, new Response(JSON.stringify(value ?? null), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } })).catch(() => {});
  return value;
}

/** What the API last said about each quota (per isolate, which is close enough): with the token and without. */
const quotas = { token: { remaining: Infinity, reset: 0 }, anonymous: { remaining: Infinity, reset: 0 } };
let tokenRejected = false;
const open = (quota: { remaining: number; reset: number }) => quota.remaining > 3 || Date.now() > quota.reset;

/** The token first; the anonymous API when there's no token, it was rejected, or its quota ran out. */
function githubAuth(env: SourceEnv): 'token' | 'anonymous' | null {
  if (env.GITHUB_TOKEN && !tokenRejected && open(quotas.token)) return 'token';
  return open(quotas.anonymous) ? 'anonymous' : null;
}

const apiOpen = (env: SourceEnv) => githubAuth(env) !== null;

async function githubApi<T>(path: string, env: SourceEnv): Promise<T> {
  const auth = githubAuth(env);
  if (!auth) throw new SourceError('rate-limited');
  const quota = quotas[auth];
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      'user-agent': UA,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(auth === 'token' ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (remaining !== null && Number.isFinite(Number(remaining))) quota.remaining = Number(remaining);
  if (reset) quota.reset = reset * 1000;
  if (auth === 'token' && response.status === 401) {
    tokenRejected = true;
    console.warn('shipped: GITHUB_TOKEN was rejected; using the anonymous API and public pages');
    return githubApi<T>(path, env);
  }
  if (response.status === 404) throw new SourceError('not-found');
  if (response.status === 403 || response.status === 429) {
    quota.remaining = 0;
    quota.reset = Math.max(quota.reset, Date.now() + 10 * MIN * 1000);
    if (auth === 'token') return githubApi<T>(path, env);
    throw new SourceError('rate-limited');
  }
  if (!response.ok) throw new SourceError(`http-${response.status}`);
  return (await response.json()) as T;
}

/** A github.com page read directly: its text, or null when GitHub says it doesn't exist. Throws when unsure. */
async function githubPage(path: string): Promise<string | null> {
  const response = await fetch(`${GH}${path}`, {
    headers: { 'user-agent': UA, accept: 'text/html,application/atom+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new SourceError(response.status === 429 ? 'rate-limited' : `http-${response.status}`);
  return (await response.text()).slice(0, 800_000);
}

async function tinyfishPage(url: string, tinyfish: TinyfishAccess): Promise<TinyfishPage> {
  if (!tinyfish) throw new SourceError('no-tinyfish');
  const [page] = await tinyfishFetch([url], tinyfish.key, tinyfish.meter);
  if (!page || /sign in to github|too many requests/i.test(page.title)) throw new SourceError('tinyfish-empty');
  return page;
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** Toys and placeholders that are not a ship. */
const SKIP_REPOS =
  /^(my-app|throwaway(-\d+)?|test[-_.]?|tmp|demo|dotfiles|playground|sandbox)(-|$)/i;
/** github.com/<these> are GitHub's own pages, not people. */
const NOT_USERS = new Set(
  'about apps blog collections contact customer-stories dashboard enterprise events explore features github issues join login logout marketplace new notifications orgs organizations pricing pulls readme search security sessions settings signup site sponsors stars team topics trending users codespaces copilot solutions resources premium-support git-guides mobile partners password_reset watching'.split(' '),
);

/** The owner's repositories named on a page (links like github.com/<login>/<repo>[/...]), in page order. */
function reposLinked(login: string, urls: string[]): string[] {
  const names: string[] = [];
  for (const raw of urls) {
    const match = raw.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i);
    if (!match || match[1].toLowerCase() !== login.toLowerCase()) continue;
    const name = decodeURIComponent(match[2]).replace(/\.git$/, '');
    if (REPO_NAME.test(name) && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

type RepoRow = { name: string; description: string; stars: number; created: string | null; updated: string | null; homepage: string | null };

const count = (text: string | undefined) => {
  const value = (text ?? '').trim().toLowerCase().replace(/,/g, '');
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(value.endsWith('k') ? n * 1000 : n) : 0;
};

/** The repositories tab (sources only, most recently updated first): names, descriptions, stars. */
function parseRepoList(html: string, login: string): RepoRow[] {
  const rows: RepoRow[] = [];
  for (const block of html.split('itemprop="owns"').slice(1)) {
    const name = block.match(/href="\/[^/"]+\/([^/"]+)"\s+itemprop="name codeRepository"/)?.[1];
    if (!name || !REPO_NAME.test(name) || /Label[^>]*>\s*Public archive/i.test(block)) continue;
    const stars = block.match(new RegExp(`href="/${login}/${name.replace(/\./g, '\\.')}/stargazers"[^>]*>[\\s\\S]*?</svg>\\s*([\\d.,k]+)`, 'i'))?.[1];
    rows.push({
      name,
      description: clean(decode(block.match(/itemprop="description">([\s\S]*?)<\/p>/)?.[1] ?? ''), 140),
      stars: count(stars),
      created: null,
      updated: day(block.match(/<relative-time[^>]*datetime="([^"]+)"/)?.[1]),
      homepage: null,
    });
  }
  return rows;
}

async function repoList(login: string, tinyfish: TinyfishAccess): Promise<RepoRow[]> {
  const path = `/${login}?tab=repositories&type=source`;
  try {
    const html = await githubPage(path);
    return html ? parseRepoList(html, login) : [];
  } catch {
    const page = await tinyfishPage(`${GH}${path}`, tinyfish);
    return reposLinked(login, page.links).map((name) => ({ name, description: '', stars: 0, created: null, updated: null, homepage: null }));
  }
}

async function apiRepos(login: string, env: SourceEnv): Promise<RepoRow[]> {
  const repos = await githubApi<Record<string, unknown>[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=created&per_page=100`, env);
  return repos
    .filter((repo) => !repo.fork && !repo.private && !repo.archived && typeof repo.name === 'string' && REPO_NAME.test(repo.name as string))
    .map((repo) => ({
      name: repo.name as string,
      description: clean(repo.description, 140),
      stars: Number(repo.stargazers_count) || 0,
      created: day(repo.created_at),
      updated: day(repo.pushed_at),
      homepage: siteFromProfile(repo.homepage),
    }));
}

function reposFromSearchHtml(html: string, login: string): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    const n = decodeURIComponent(name).replace(/\.git$/, '');
    if (REPO_NAME.test(n) && !names.some((v) => v.toLowerCase() === n.toLowerCase())) names.push(n);
  };
  const owner = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of html.matchAll(new RegExp(`(?:github\\.com|href=")/${owner}/([A-Za-z0-9._-]+)`, 'gi'))) add(match[1]);
  return names.slice(0, 80);
}

/** Repos created this year: github.com search HTML (no API quota), then TinyFish if the page is empty. */
async function searchCreated(login: string, year: number, tinyfish: TinyfishAccess): Promise<string[]> {
  const q = `user:${login} created:>=${year}-01-01 fork:false`;
  const path = `/search?q=${encodeURIComponent(q)}&type=repositories&s=stars&o=desc`;
  try {
    const html = await githubPage(path);
    const fromHtml = html ? reposFromSearchHtml(html, login) : [];
    if (fromHtml.length) return fromHtml;
  } catch {
    // github.com search sometimes wants a session; TinyFish can still read it.
  }
  if (!tinyfish) return [];
  const page = await tinyfishPage(`${GH}${path}`, tinyfish);
  const fromText = [...page.text.matchAll(/github\.com\/[^/\s)]+\/[^/\s)?#]+/gi)].map((m) => `https://${m[0]}`);
  return reposLinked(login, [...page.links, ...fromText]).slice(0, 80);
}

type FeedEvent = { kind: 'created' | 'released'; repo: string; tag: string | null; date: string | null; link: string | null };

/** The public activity feed (last ~30 events): repos created or made public, and releases. */
async function feedOf(login: string): Promise<FeedEvent[]> {
  const xml = await githubPage(`/${login}.atom`);
  if (!xml) return [];
  const events: FeedEvent[] = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const title = decode(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
    const href = decode(entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '');
    const date = day(entry.match(/<published>([^<]+)</)?.[1]);
    const released = title.match(/ released (\S+) at ([^/\s]+)\/([^/\s]+)$/);
    const created = title.match(/ created a repository ([^/\s]+)\/([^/\s]+)$/);
    const owner = (released?.[2] ?? created?.[1] ?? reposOwner(href) ?? '').toLowerCase();
    if (owner !== login.toLowerCase()) continue;
    if (released) events.push({ kind: 'released', repo: released[3], tag: released[1], date, link: publicUrl(href) });
    else if (created || / made this repository public$/.test(title)) {
      const repo = created?.[2] ?? reposLinked(login, [href])[0];
      if (repo) events.push({ kind: 'created', repo, tag: null, date, link: `${GH}/${login}/${repo}` });
    }
  }
  return events;
}

const reposOwner = (href: string) => href.match(/^https:\/\/github\.com\/([^/]+)\//)?.[1] ?? null;

/** GitHub: repositories created this year, and releases this year of older ones. */
const github: SourceProvider = {
  id: 'github',
  enabled: ({ profile }) => Boolean(profile.github),
  async run({ profile, year, env, tinyfish }) {
    const login = profile.github!;
    const id = login.toLowerCase();
    const soft = <T,>(work: Promise<T>) => work.catch(() => null);
    const [list, feed, api] = await Promise.all([
      soft(cached(`gh:list:${id}`, 360 * MIN, () => repoList(login, tinyfish))),
      soft(cached(`gh:feed:${id}`, 30 * MIN, () => feedOf(login))),
      apiOpen(env) ? soft(cached(`gh:repos:${id}`, 360 * MIN, () => apiRepos(login, env))) : Promise.resolve(null),
    ]);
    const searched = await soft(cached(`gh:search:${id}:${year}`, 720 * MIN, () => searchCreated(login, year, tinyfish)));
    if (!list && !feed && !api && !searched) throw new SourceError('github-unreachable');

    const rows = new Map<string, RepoRow>();
    for (const row of [...(list ?? []), ...(api ?? [])]) rows.set(row.name.toLowerCase(), { ...rows.get(row.name.toLowerCase()), ...row });
    const createdOn = new Map<string, string | null>();
    for (const row of api ?? []) if (inYear(row.created, year)) createdOn.set(row.name.toLowerCase(), row.created);
    for (const name of searched ?? []) if (!createdOn.has(name.toLowerCase())) createdOn.set(name.toLowerCase(), null);
    for (const event of feed ?? []) {
      if (event.kind !== 'created' || !inYear(event.date, year)) continue;
      const known = createdOn.get(event.repo.toLowerCase());
      if (!known) createdOn.set(event.repo.toLowerCase(), event.date);
    }

    const found: Found[] = [];
    for (const [key, date] of createdOn) {
      const row = rows.get(key);
      const name = row?.name ?? [...(searched ?? []), ...(feed ?? []).map((e) => e.repo)].find((n) => n.toLowerCase() === key) ?? key;
      if (SKIP_REPOS.test(name)) continue;
      const repoUrl = `${GH}/${login}/${name}`;
      found.push(
        withMetrics(
          {
            name: clean(name, 60),
            description: row?.description ?? '',
            date,
            link: repoUrl,
            icon: row?.homepage ? faviconUrl(row.homepage) : null,
            source: 'github',
            status: row?.homepage ? 'LIVE' : 'SHIPPED',
            score: 6 + Math.log10(1 + (row?.stars ?? 0)) * 2 + (row?.homepage ? 1 : 0),
            dateConfidence: date ? 'exact' : 'year',
            thisYear: true,
          },
          [
            row?.stars
              ? sourcedStat('stars', `${row.stars >= 1000 ? `${(row.stars / 1000).toFixed(row.stars >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(row.stars)} GitHub stars`, row.stars, repoUrl, name)
              : null,
          ],
        ),
      );
    }

    // Older repos still pushed this year with public numbers — a site mention should inherit stars.
    for (const row of rows.values()) {
      if (createdOn.has(row.name.toLowerCase()) || (row.stars ?? 0) < 20 || !inYear(row.updated, year)) continue;
      const repoUrl = `${GH}/${login}/${row.name}`;
      found.push(
        withMetrics(
          {
            name: clean(row.name, 60),
            description: row.description,
            date: row.updated,
            link: repoUrl,
            icon: row.homepage ? faviconUrl(row.homepage) : null,
            source: 'github',
            status: row.homepage ? 'LIVE' : 'SHIPPED',
            score: 1.5 + Math.log10(1 + row.stars) * 2,
            dateConfidence: 'inferred',
            thisYear: true,
          },
          [sourcedStat('stars', `${row.stars >= 1000 ? `${(row.stars / 1000).toFixed(row.stars >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(row.stars)} GitHub stars`, row.stars, repoUrl, row.name)],
        ),
      );
    }

    // Older projects that cut a release this year: the feed's releases, newest per repo.
    const released = new Set<string>();
    for (const event of feed ?? []) {
      const key = event.repo.toLowerCase();
      if (event.kind !== 'released' || !inYear(event.date, year) || createdOn.has(key) || released.has(key)) continue;
      released.add(key);
      const row = rows.get(key);
      found.push({
        name: clean(`${row?.name ?? event.repo}${event.tag ? ` ${clean(event.tag, 20)}` : ''}`, 60),
        description: row?.description ?? '',
        date: event.date,
        link: event.link ?? `${GH}/${login}/${event.repo}`,
        icon: row?.homepage ? faviconUrl(row.homepage) : null,
        source: 'github',
        status: 'RELEASED',
        score: 2 + Math.log10(1 + (row?.stars ?? 0)) * 2,
        dateConfidence: event.date ? 'exact' : 'unknown',
      });
    }
    // With API room left, the most starred older repos still pushed this year may have releases the feed missed.
    if (api && apiOpen(env)) {
      const active = api
        .filter((row) => !createdOn.has(row.name.toLowerCase()) && !released.has(row.name.toLowerCase()) && inYear(row.updated, year))
        .sort((a, b) => b.stars - a.stars)
        .slice(0, 3);
      const releases = await Promise.allSettled(
        active.map((row) =>
          cached(`gh:releases:${id}/${row.name.toLowerCase()}`, 360 * MIN, () =>
            githubApi<Record<string, unknown>[]>(`/repos/${encodeURIComponent(login)}/${encodeURIComponent(row.name)}/releases?per_page=5`, env),
          ),
        ),
      );
      releases.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const row = active[i];
        const release = result.value.find((r) => !r.draft && !r.prerelease && inYear(day(r.published_at), year));
        if (!release) return;
        const tag = clean(release.tag_name, 20);
        found.push({
          name: clean(`${row.name}${tag ? ` ${tag}` : ''}`, 60),
          description: row.description,
          date: day(release.published_at),
          link: publicUrl(release.html_url) ?? `${GH}/${login}/${row.name}`,
          icon: row.homepage ? faviconUrl(row.homepage) : null,
          source: 'github',
          status: 'RELEASED',
          score: 2 + Math.log10(1 + row.stars) * 2,
          dateConfidence: 'exact',
        });
      });
    }
    return found;
  },
};

/** App Store apps by this developer, first released or updated this year (with their icons). */
const appStore: SourceProvider = {
  id: 'appstore',
  enabled: ({ subject, profile }) => Boolean(profile.name || (subject.kind !== 'github' && subject.display.replace(/^@/, '').length >= 3)),
  async run({ subject, profile, year }) {
    const term = subject.kind === 'domain' ? subject.id.split('.')[0] : profile.name || subject.display.replace(/^@/, '');
    if (loose(term).length < 3 || /^@/.test(term)) return [];
    const shortName = loose(term).length < 6;
    const data = await getJson<{ results?: Record<string, unknown>[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&attribute=softwareDeveloper&limit=50&country=us`,
    );
    const want = loose(term);
    const nameTokens = String(term)
      .split(/\s+/)
      .map((t) => loose(t))
      .filter((t) => t.length >= 4);
    const site = subject.kind === 'domain' ? subject.id : hostOf(profile.site);
    const sites = new Set([site, ...sitesOf(profile).map((url) => hostOf(url))].filter((h): h is string => Boolean(h)));
    return (data.results ?? [])
      .filter((app) => {
        const artist = loose(String(app.artistName ?? ''));
        const seller = loose(String(app.sellerName ?? ''));
        const dev = `${artist}|${seller}`;
        const sellerHost = hostOf(publicUrl(app.sellerUrl));
        if (sellerHost && sites.has(sellerHost)) return true;
        // A first name like "Hassan" matches half the store. Need the seller site or both name tokens.
        if (shortName || nameTokens.length < 2) return false;
        return nameTokens.every((t) => dev.includes(t));
      })
      .map((app) => {
        const released = day(app.releaseDate);
        const updated = day(app.currentVersionReleaseDate);
        const date = inYear(released, year) ? released : inYear(updated, year) ? updated : null;
        return { app, date };
      })
      .filter((row) => inYear(row.date, year))
      .slice(0, 8)
      .map(({ app, date }): Found => ({
        name: clean(app.trackName, 60),
        description: clean(String(app.description ?? '').split(/[.\n]/)[0], 140) || clean(app.primaryGenreName, 40),
        date,
        dateConfidence: 'exact',
        link: publicUrl(String(app.trackViewUrl ?? '').split('?')[0]),
        icon: publicUrl(app.artworkUrl512 ?? app.artworkUrl100),
        source: 'appstore',
        status: 'LAUNCHED',
        score: 5 + Math.log10(1 + (Number(app.userRatingCount) || 0)),
        metrics: [
          Number(app.averageUserRating)
            ? sourcedStat('rating', `${Number(app.averageUserRating).toFixed(1)} App Store rating`, Number(app.averageUserRating), String(app.trackViewUrl ?? '').split('?')[0], clean(app.trackName, 40))
            : null,
          Number(app.userRatingCount)
            ? sourcedStat('reviews', `${Number(app.userRatingCount)} App Store ratings`, Number(app.userRatingCount), String(app.trackViewUrl ?? '').split('?')[0], clean(app.trackName, 40))
            : null,
        ].filter((s): s is SourcedStat => Boolean(s)),
      }));
  },
};

/** Show HN / Launch HN posts by this handle, or stories about their sites / name, this year. */
const hackerNews: SourceProvider = {
  id: 'hn',
  enabled: ({ subject, profile }) => subject.kind === 'domain' || Boolean(profile.github || profile.x || profile.name || sitesOf(profile).length),
  async run({ subject, profile, year }) {
    const start = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const end = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
    const handles = [...new Set([profile.github, profile.x].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase()))];
    const domains = [
      subject.kind === 'domain' ? subject.id : null,
      ...sitesOf(profile).map((url) => hostOf(url)),
    ].filter((h): h is string => Boolean(h));
    const urls = [
      ...handles.map((h) => `https://hn.algolia.com/api/v1/search_by_date?tags=(show_hn,launch_hn),author_${encodeURIComponent(h)}&numericFilters=created_at_i>${start},created_at_i<${end}&hitsPerPage=15`),
      ...domains.slice(0, 3).map((d) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(d)}&restrictSearchableAttributes=url&tags=story&numericFilters=created_at_i>${start},created_at_i<${end},points>3&hitsPerPage=8`),
    ];
    if (profile.name && loose(profile.name).length >= 4) {
      urls.push(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(profile.name)}&tags=(show_hn,launch_hn)&numericFilters=created_at_i>${start},created_at_i<${end}&hitsPerPage=8`,
      );
    }
    const pages = await Promise.allSettled(urls.slice(0, 6).map((url) => getJson<{ hits?: Record<string, unknown>[] }>(url)));
    const found: Found[] = [];
        const want = [profile.name, profile.x, profile.github, ...domains].filter(Boolean).map((v) => loose(String(v)));
    const authors = new Set(handles);
    for (const page of pages) {
      if (page.status !== 'fulfilled') continue;
      for (const hit of page.value.hits ?? []) {
        const rawTitle = String(hit.title ?? '');
        const title = rawTitle.replace(/^(show|launch) hn:\s*/i, '');
        const author = String(hit.author ?? '').toLowerCase();
        const urlHost = hostOf(publicUrl(hit.url));
        const authored = authors.has(author);
        const ownUrl = Boolean(urlHost && domains.includes(urlHost));
        if (!authored && !ownUrl) continue;
        const hay = loose(`${title} ${hit.author ?? ''} ${hit.url ?? ''}`);
        if (want.length && !want.some((w) => w.length >= 3 && hay.includes(w))) continue;
        const [name, ...rest] = title.split(/\s+[–—-]\s+|:\s+/);
        const link = publicUrl(hit.url) ?? publicUrl(`https://news.ycombinator.com/item?id=${hit.objectID}`);
        found.push({
          name: clean(name, 60),
          description: clean(rest.join(' - '), 140) || 'Posted to Hacker News.',
          date: day(hit.created_at),
          dateConfidence: 'exact',
          link,
          icon: hit.url ? faviconUrl(String(hit.url)) : null,
          source: 'hn',
          status: 'LAUNCHED',
          score: 3 + Math.log10(1 + (Number(hit.points) || 0)) * 1.5,
          metrics: Number(hit.points)
            ? [
                sourcedStat(
                  'hn',
                  `${Number(hit.points)} HN points`,
                  Number(hit.points),
                  `https://news.ycombinator.com/item?id=${hit.objectID}`,
                  clean(name, 40),
                ),
              ].filter((s): s is SourcedStat => Boolean(s))
            : [],
        });
      }
    }
    return found;
  },
};

/** npm packages this handle maintains that were published this year. */
const npm: SourceProvider = {
  id: 'npm',
  enabled: ({ profile }) => Boolean(npmUsersOf(profile).length || profile.github || profile.x),
  async run({ profile, year }) {
    const listed = npmUsersOf(profile);
    const users = [...new Set((listed.length ? listed : [profile.github, profile.x]).filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase()))].slice(0, 3);
    const pages = await Promise.allSettled(
      users.map((user) =>
        getJson<{ objects?: { package: Record<string, unknown>; score?: { final?: number } }[] }>(
          `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(user)}&size=50`,
        ),
      ),
    );
    const objects = pages.flatMap((page) => (page.status === 'fulfilled' ? page.value.objects ?? [] : []));
    const recent = objects
      .filter((entry) => inYear(day(entry.package.date), year))
      .sort((a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0))
      .slice(0, 80);
    const downloads = await Promise.all(
      recent.map(({ package: pkg }) =>
        getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(String(pkg.name))}`).catch(() => null),
      ),
    );
    return recent.map(({ package: pkg, score }, i): Found => {
      const link = publicUrl((pkg.links as Record<string, unknown> | undefined)?.npm);
      const weekly = Number(downloads[i]?.downloads) || 0;
      return {
        name: clean(pkg.name, 60),
        description: clean(pkg.description, 140),
        date: day(pkg.date),
        dateConfidence: 'exact',
        link,
        icon: null,
        source: 'npm',
        status: 'RELEASED',
        score: 1 + (score?.final ?? 0) * 2 + Math.log10(1 + weekly),
        metrics:
          weekly && link
            ? [sourcedStat('downloads', `${weekly >= 1000 ? `${(weekly / 1000).toFixed(weekly >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(weekly)} npm weekly downloads`, weekly, link, clean(pkg.name, 40))].filter(
                (s): s is SourcedStat => Boolean(s),
              )
            : [],
      };
    });
  },
};

let productHuntToken: { value: string; until: number } | null = null;

/** A developer token if one is set, else a public-scope token from the OAuth app (client_credentials), cached. */
async function productHuntAuth(env: SourceEnv): Promise<string | null> {
  if (env.PRODUCTHUNT_TOKEN) return env.PRODUCTHUNT_TOKEN;
  if (!env.PRODUCTHUNT_KEY || !env.PRODUCTHUNT_SECRET) return null;
  if (productHuntToken && productHuntToken.until > Date.now()) return productHuntToken.value;
  const response = await fetch('https://api.producthunt.com/v2/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: env.PRODUCTHUNT_KEY, client_secret: env.PRODUCTHUNT_SECRET, grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) return null;
  // Client-credentials tokens don't expire unless revoked; re-fetch daily anyway.
  const life = Math.min(Number(body.expires_in) || 86_400, 86_400) * 1000;
  productHuntToken = { value: body.access_token, until: Date.now() + life - 60_000 };
  return body.access_token;
}

const GENERIC_PH_USER = new Set(['maker', 'user', 'official', 'team', 'dev', 'the', 'app', 'hq', 'inc', 'labs', 'admin', 'news']);

/** PH usernames to try: the X/GitHub handle, underscore variants, then a first-token guess (`tibo_maker` → `tibo`). */
export function phLookupHandles(profile: Profile): { username: string; guessed: boolean }[] {
  const raw = [...phUsersOf(profile), profile.x, profile.github].filter((h): h is string => Boolean(h));
  const out: { username: string; guessed: boolean }[] = [];
  const add = (value: string | null | undefined, guessed: boolean) => {
    const username = (value ?? '').replace(/^@/, '').trim();
    if (!username || username.length < 2 || GENERIC_PH_USER.has(username.toLowerCase())) return;
    if (out.some((row) => row.username.toLowerCase() === username.toLowerCase())) return;
    out.push({ username, guessed });
  };
  for (const handle of raw) {
    add(handle, false);
    for (const variant of handleVariants(handle)) add(variant, false);
    const first = handle.replace(/^@/, '').split(/[_-]/)[0];
    if (first && first.length >= 4 && first.toLowerCase() !== handle.replace(/^@/, '').toLowerCase()) add(first, true);
    for (const token of handleTokens(handle)) add(token, true);
  }
  return out.slice(0, 6);
}

/** PH `posts(twitterUrl:)` keys. The API's `postedAfter` defaults to one month ago unless we pass a year window. */
export function phTwitterUrls(handle: string | null | undefined): string[] {
  const id = (handle ?? '').replace(/^@/, '').trim();
  if (!id) return [];
  return [`https://twitter.com/${id}`, `https://x.com/${id}`];
}

const GENERIC_PH_SLUG = new Set(['www', 'app', 'www2', 'mail', 'blog', 'shop', 'store', 'docs', 'dev', 'api', 'status']);

/** Product-site hosts → PH slugs (`superx.so` → `superx`) plus the raw URLs for `posts(url:)`. */
export function phSiteLookups(urls: (string | null | undefined)[]): { urls: string[]; slugs: string[] } {
  const seenUrl = new Set<string>();
  const seenSlug = new Set<string>();
  const outUrls: string[] = [];
  const slugs: string[] = [];
  for (const raw of urls) {
    const url = publicUrl(raw);
    if (!url) continue;
    const host = hostOf(url);
    if (!host || /(^|\.)(github\.com|npmjs\.com|producthunt\.com|x\.com|twitter\.com)$/.test(host)) continue;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (!seenUrl.has(key)) {
      seenUrl.add(key);
      outUrls.push(url);
    }
    const label = host.split('.')[0] ?? '';
    if (label.length >= 3 && !GENERIC_PH_SLUG.has(label) && !seenSlug.has(label)) {
      seenSlug.add(label);
      slugs.push(label);
    }
  }
  return { urls: outUrls.slice(0, 6), slugs: slugs.slice(0, 4) };
}

const PH_POST_FIELDS = 'name tagline createdAt url website votesCount thumbnail{url} makers{username twitterUsername}';

type PhPost = Record<string, unknown> & { makers?: { username?: string; twitterUsername?: string }[] };

function phUserMatches(user: { username?: string | null; twitterUsername?: string | null } | null | undefined, profile: Profile, guessed: boolean): boolean {
  if (!user) return false;
  const twitter = (user.twitterUsername ?? '').replace(/^@/, '').toLowerCase();
  const want = (profile.x ?? '').replace(/^@/, '').toLowerCase();
  if (want && twitter && twitter === want) return true;
  if (want && twitter && handleVariants(want).some((v) => v.toLowerCase() === twitter)) return true;
  return !guessed;
}

function phMakerMatches(post: PhPost, profile: Profile, siteHosts: Set<string>): boolean {
  const makers = post.makers ?? [];
  const want = (profile.x ?? '').replace(/^@/, '').toLowerCase();
  const handles = new Set(
    [...phUsersOf(profile), profile.x, profile.github, ...phLookupHandles(profile).map((h) => h.username)]
      .filter((h): h is string => Boolean(h))
      .map((h) => h.replace(/^@/, '').toLowerCase()),
  );
  if (
    makers.some((maker) => {
      const username = (maker.username ?? '').toLowerCase();
      const twitter = (maker.twitterUsername ?? '').replace(/^@/, '').toLowerCase();
      return (username && handles.has(username)) || (twitter && (twitter === want || handles.has(twitter)));
    })
  ) {
    return true;
  }
  const website = hostOf(publicUrl(post.website as string) ?? '');
  return Boolean(website && siteHosts.has(website));
}

function foundFromPhPost(post: PhPost, year: number): Found | null {
  const date = day(post.createdAt);
  if (date && !inYear(date, year)) return null;
  const votes = Number(post.votesCount) || 0;
  const link = publicUrl(post.url) ?? publicUrl(post.website as string);
  return {
    name: clean(post.name, 60),
    description: clean(post.tagline, 140),
    date,
    dateConfidence: inYear(date, year) ? 'exact' : date ? 'exact' : 'unknown',
    link,
    icon: publicUrl((post.thumbnail as Record<string, unknown> | undefined)?.url),
    source: 'producthunt',
    status: 'LAUNCHED',
    score: 5 + Math.log10(1 + votes),
    metrics: votes
      ? [sourcedStat('upvotes', `${votes} Product Hunt upvotes`, votes, link ?? 'https://www.producthunt.com/', clean(post.name, 40))].filter((s): s is SourcedStat => Boolean(s))
      : [],
  };
}

async function phGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  return getJson<T>('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  }).catch(() => null);
}

/** Product Hunt launches the subject made (needs PRODUCTHUNT_KEY + PRODUCTHUNT_SECRET, or PRODUCTHUNT_TOKEN). */
const productHunt: SourceProvider = {
  id: 'producthunt',
  enabled: ({ env, profile, extraUrls }) =>
    Boolean(
      (env.PRODUCTHUNT_TOKEN || (env.PRODUCTHUNT_KEY && env.PRODUCTHUNT_SECRET)) &&
        (phUsersOf(profile).length || profile.x || profile.github || (extraUrls && extraUrls.length)),
    ),
  async run({ env, profile, year, extraUrls }) {
    const token = await productHuntAuth(env);
    if (!token) throw new SourceError('no-token');
    const after = `${year}-01-01T00:00:00Z`;
    const before = `${year + 1}-01-01T00:00:00Z`;
    const handles = phLookupHandles(profile);
    const twitterUrls = phTwitterUrls(profile.x);
    const sites = phSiteLookups([...sitesOf(profile), profile.site, ...(extraUrls ?? [])]);
    const siteHosts = new Set(sites.urls.map((url) => hostOf(url)).filter((h): h is string => Boolean(h)));

    type PhUserData = { data?: { user?: { username?: string; twitterUsername?: string; madePosts?: { edges?: { node: PhPost }[] } } } };
    type PhPostsData = { data?: { posts?: { edges?: { node: PhPost }[] } } };
    type PhSlugData = { data?: { post?: PhPost | null } };

    const userPages = await Promise.all(
      handles.map((row) =>
        phGraphql<PhUserData>(
          token,
          `query($u:String!){user(username:$u){username twitterUsername madePosts(first:20){edges{node{${PH_POST_FIELDS}}}}}}`,
          { u: row.username },
        ).then((page) => ({ row, page })),
      ),
    );
    const twitterPages = await Promise.all(
      twitterUrls.slice(0, 2).map((url) =>
        phGraphql<PhPostsData>(
          token,
          `query($u:String!,$a:DateTime!,$b:DateTime!){posts(twitterUrl:$u,postedAfter:$a,postedBefore:$b,first:20){edges{node{${PH_POST_FIELDS}}}}}`,
          { u: url, a: after, b: before },
        ),
      ),
    );
    const urlPages = await Promise.all(
      sites.urls.slice(0, 6).map((url) =>
        phGraphql<PhPostsData>(
          token,
          `query($u:String!,$a:DateTime!,$b:DateTime!){posts(url:$u,postedAfter:$a,postedBefore:$b,first:5){edges{node{${PH_POST_FIELDS}}}}}`,
          { u: url, a: after, b: before },
        ),
      ),
    );
    const slugPages = await Promise.all(
      sites.slugs.slice(0, 4).map((slug) =>
        phGraphql<PhSlugData>(token, `query($s:String!){post(slug:$s){${PH_POST_FIELDS}}}`, { s: slug }),
      ),
    );

    const posts: PhPost[] = [];
    for (const { row, page } of userPages) {
      const user = page?.data?.user;
      if (!phUserMatches(user, profile, row.guessed)) continue;
      for (const edge of user?.madePosts?.edges ?? []) posts.push(edge.node);
    }
    for (const page of twitterPages) {
      for (const edge of page?.data?.posts?.edges ?? []) posts.push(edge.node);
    }
    for (const page of urlPages) {
      for (const edge of page?.data?.posts?.edges ?? []) {
        if (phMakerMatches(edge.node, profile, siteHosts)) posts.push(edge.node);
      }
    }
    for (const page of slugPages) {
      const post = page?.data?.post;
      if (post && phMakerMatches(post, profile, siteHosts)) posts.push(post);
    }

    const seen = new Set<string>();
    const found: Found[] = [];
    for (const post of posts) {
      const item = foundFromPhPost(post, year);
      if (!item?.name) continue;
      const key = `${loose(item.name)}|${item.link ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(item);
    }
    return found;
  },
};

export const SOURCES: SourceProvider[] = [github, appStore, hackerNews, npm, productHunt];

// ---- The subject's own site --------------------------------------------------------------------

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find(Boolean) ?? null;
const decode = (text: string) =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

export function faviconUrl(siteUrl: string): string | null {
  const host = hostOf(siteUrl);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128` : null;
}

type BrandfetchFormat = { src?: string; format?: string; width?: number };
type BrandfetchBrand = { logos?: { type?: string; theme?: string; formats?: BrandfetchFormat[] }[] };

/** A brand's raster icon (PNG/JPEG) from Brandfetch, or null without BRANDFETCH_API or a match. */
export async function brandIcon(siteUrl: string, env: SourceEnv): Promise<string | null> {
  const host = hostOf(siteUrl);
  if (!env.BRANDFETCH_API || !host) return null;
  const response = await fetch(`https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(host)}`, {
    headers: { authorization: `Bearer ${env.BRANDFETCH_API}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => null);
  if (!response?.ok) return null;
  const brand = (await response.json().catch(() => null)) as BrandfetchBrand | null;
  const rank = (type?: string) => (type === 'icon' ? 0 : type === 'symbol' ? 1 : 2);
  const logos = [...(brand?.logos ?? [])].sort((a, b) => rank(a.type) - rank(b.type));
  for (const logo of logos) {
    const raster = (logo.formats ?? []).filter((f) => f.src && (f.format === 'png' || f.format === 'jpeg')).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    if (raster[0]?.src) return raster[0].src;
  }
  return null;
}

/** Homepage title, description, icon, a text sample and its links (for Claude to read, never to obey). */
export async function readSite(siteUrl: string): Promise<SiteInfo | null> {
  const url = publicUrl(siteUrl);
  if (!url) return null;
  const page = await safeFetch(url, { accept: 'text/html', maxBytes: 600_000, timeoutMs: TIMEOUT, types: ['text/html', 'application/xhtml'], userAgent: UA }).catch(() => null);
  if (!page) return null;
  const html = new TextDecoder().decode(page.bytes).slice(0, 400_000);
  const base = page.url || url;
  const abs = (href: string | null) => {
    try {
      return href ? publicUrl(new URL(decode(href), base).toString()) : null;
    } catch {
      return null;
    }
  };
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key: string) => {
    const tag = metas.find((m) => (attr(m, 'name') ?? attr(m, 'property') ?? '').toLowerCase() === key);
    return tag ? decode(attr(tag, 'content') ?? '') : '';
  };
  const icons = (html.match(/<link\b[^>]*>/gi) ?? []).filter((tag) => /icon/i.test(attr(tag, 'rel') ?? ''));
  const touch = icons.find((tag) => /apple-touch-icon/i.test(attr(tag, 'rel') ?? ''));
  const png = icons.find((tag) => /\.(png|svg)(\?|$)/i.test(attr(tag, 'href') ?? '') || /image\/(png|svg)/i.test(attr(tag, 'type') ?? ''));
  const links: SiteInfo['links'] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = abs(attr(match[1], 'href'));
    const text = clean(decode(match[2].replace(/<[^>]+>/g, ' ')), 60);
    if (href && text && !links.some((l) => l.url === href)) links.push({ text, url: href });
    if (links.length >= 40) break;
  }
  const rawText = decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const dated = (rawText.match(/(?:^|\n).{0,20}20\d\d[-/.]\d{1,2}.{0,80}/g) ?? []).join('\n');
  const text = clean(`${dated}\n${rawText}`, 12_000);
  return {
    url: base,
    title: clean(decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 100) || clean(meta('og:title'), 100),
    description: clean(meta('description') || meta('og:description'), 200),
    // og:image is usually a wide banner, which dithers to mush at logo size.
    icon: abs(attr(touch ?? png ?? '', 'href')) ?? faviconUrl(base),
    text,
    links,
  };
}

// ---- TinyFish: launch pages beyond the APIs -------------------------------------------------------

const result = (title: unknown, url: unknown, snippet: unknown, date: unknown): WebResult | null => {
  const link = publicUrl(url);
  return link ? { title: clean(title, 120), url: link, snippet: clean(snippet, 300), date: day(date) } : null;
};

/** Hosts whose pages say little about one launch (feeds, profiles) or that TinyFish can't read anyway. */
const SKIP_PAGES = /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|reddit\.com|threads\.net)$/;

const markdownText = (text: string, max: number) =>
  clean(text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>|]+/g, ' '), max);

function toPage(page: TinyfishPage): PageInfo | null {
  const url = publicUrl(page.url);
  if (!url) return null;
  return { url, title: clean(page.title, 120), description: clean(page.description, 240), published: day(page.published), text: markdownText(page.text, 1400) };
}

// ---- Who is this? --------------------------------------------------------------------------------

export type GithubUser = { login: string; name: string; bio: string; blog: string | null; x: string | null; repos: number };

const xFrom = (urls: string[]) =>
  urls
    .map((url) => url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?$/i)?.[1])
    .find((handle): handle is string => Boolean(handle) && isXHandle(handle!) && !/^(github|githubstatus|share|intent|home)$/i.test(handle!)) ?? null;

/** The profile page: "<login> (<Name>) · GitHub", the bio, website, social links and repo count. */
function parseProfile(html: string, login: string): GithubUser | null {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  if (!/· GitHub$/.test(title)) return null;
  const named = title.match(/^(\S+) \((.+)\) · GitHub$/);
  const username = html.match(/property="profile:username" content="([^"]+)"/)?.[1];
  const me = [...html.matchAll(/rel="nofollow me"[^>]*href="([^"]+)"/g)].map((m) => decode(m[1]));
  const website = html.match(/profile-website-url"[\s\S]*?<\/li>/)?.[0].match(/<a[^>]*href="([^"]+)"/)?.[1];
  return {
    login: username ?? named?.[1] ?? login,
    name: clean(decode(named?.[2] ?? html.match(/itemprop="name">([^<]*)</)?.[1] ?? title.replace(/ · GitHub$/, '').replace(new RegExp(`^${login}$`), '')), 60),
    bio: clean(decode(html.match(/data-bio-text="([^"]*)"/)?.[1] ?? ''), 160),
    blog: siteFromProfile(website ? decode(website) : null),
    x: xFrom(me),
    repos: count(html.match(/Repositories\s*<span title="([\d,]+)"/)?.[1]),
  };
}

function profileFromTinyfish(page: TinyfishPage, login: string): GithubUser | null {
  if (/page not found|not found · github/i.test(page.title)) return null;
  const named = page.title.match(/^(\S+) \((.+)\) · GitHub/);
  return {
    login: named?.[1] ?? login,
    name: clean(named?.[2] ?? page.title.replace(/ · GitHub.*$/, ''), 60),
    bio: clean(page.description.replace(new RegExp(`\\s+-\\s+${login}$`, 'i'), ''), 160),
    blog: null,
    x: xFrom(page.links),
    repos: 0,
  };
}

async function apiUser(login: string, env: SourceEnv): Promise<GithubUser | null> {
  const user = await githubApi<Record<string, unknown>>(`/users/${encodeURIComponent(login)}`, env).catch((error) => {
    if (error instanceof SourceError && error.code === 'not-found') return null;
    throw error;
  });
  if (!user) return null;
  return {
    login: String(user.login),
    name: clean(user.name, 60),
    bio: clean(user.bio, 160),
    blog: siteFromProfile(user.blog),
    x: typeof user.twitter_username === 'string' && isXHandle(user.twitter_username) ? user.twitter_username : null,
    repos: Number(user.public_repos) || 0,
  };
}

/** Who this GitHub login is: the profile page, else TinyFish reading it, else the API. Null = no such account. */
export async function githubUser(login: string, env: SourceEnv, tinyfish: TinyfishAccess = null): Promise<GithubUser | null> {
  if (!isGithubLogin(login) || NOT_USERS.has(login.toLowerCase())) return null;
  return cached(`gh:user:${login.toLowerCase()}`, 360 * MIN, async () => {
    try {
      const html = await githubPage(`/${login}`);
      if (!html) return null;
      const user = parseProfile(html, login);
      if (user) return user;
    } catch {
      // github.com turned us away; try the others.
    }
    if (tinyfish) {
      const page = await tinyfishPage(`${GH}/${login}`, tinyfish).catch(() => null);
      if (page) return profileFromTinyfish(page, login);
    }
    if (apiOpen(env)) return apiUser(login, env);
    throw new SourceError('rate-limited');
  });
}

/** GitHub accounts going by this name: the API's user search while it has room, else GitHub search via TinyFish. */
export async function searchGithubUsers(name: string, env: SourceEnv, tinyfish: TinyfishAccess = null): Promise<{ login: string }[]> {
  return cached(`gh:people:${loose(name)}`, 1440 * MIN, async () => {
    if (apiOpen(env)) {
      const query = /\s/.test(name.trim()) ? `fullname:${name.trim()}` : `${name} in:name`;
      const data = await githubApi<{ items?: { login?: unknown }[] }>(`/search/users?q=${encodeURIComponent(query)}&per_page=4`, env).catch(() => null);
      if (data) return (data.items ?? []).filter((u) => typeof u.login === 'string' && isGithubLogin(u.login)).map((u) => ({ login: u.login as string }));
    }
    if (!tinyfish) return [];
    const page = await tinyfishPage(`${GH}/search?q=${encodeURIComponent(name)}&type=users`, tinyfish);
    const logins: string[] = [];
    for (const url of page.links) {
      const login = url.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/?$/i)?.[1];
      if (login && isGithubLogin(login) && !NOT_USERS.has(login.toLowerCase()) && !logins.some((l) => l.toLowerCase() === login.toLowerCase())) logins.push(login);
    }
    return logins.slice(0, 4).map((login) => ({ login }));
  });
}

/** Count items we can treat as this year's work (dated, marked thisYear, or undated-but-attributed). */
export const inYearCount = (gathered: Gathered, year: number) =>
  gathered.found.filter((item) => item.thisYear || inYear(item.date, year) || (!item.date && item.dateConfidence !== 'exact')).length;

export type ResolvedIdentity = { profile: Profile; notes: string[]; cacheKey: string };

function finishProfile(profile: Profile): Profile {
  const sites = mergeSites(sitesOf(profile), [profile.site]);
  const handles = [profile.x, profile.github].filter((h): h is string => Boolean(h));
  return {
    ...profile,
    site: profile.site || sites[0] || null,
    sites,
    phUsers: [...new Set([...(profile.phUsers ?? []), ...handles])],
    npmUsers: [...new Set([...(profile.npmUsers ?? []), ...handles])],
  };
}

export function identityCacheKey(profile: Profile, subject: Subject): string {
  return [subject.kind, subject.id, profile.github, profile.x, hostOf(profile.site), loose(profile.name)]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

async function bestGithubFor(
  opts: { wantX?: string | null; wantName?: string | null; wantSite?: string | null; wantSites?: string[]; wantCompany?: string | null; logins: (string | null | undefined)[] },
  env: SourceEnv,
  tinyfish: TinyfishAccess,
): Promise<{ user: GithubUser; score: number } | null> {
  const seen = new Set<string>();
  let best: { user: GithubUser; score: number } | null = null;
  for (const login of opts.logins) {
    if (!login || !isGithubLogin(login) || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    const user = await githubUser(login, env, tinyfish).catch(() => null);
    if (!user) continue;
    const score = scoreGithubMatch({
      user,
      wantX: opts.wantX,
      wantName: opts.wantName,
      wantSite: opts.wantSite,
      wantSites: opts.wantSites,
      wantCompany: opts.wantCompany,
    });
    if (score < 8) continue;
    if (!best || score > best.score) best = { user, score };
  }
  return best;
}

/** Repo search for a product name: the owners are maker candidates. */
async function githubRepoOwners(product: string, env: SourceEnv): Promise<string[]> {
  if (!apiOpen(env) || product.length < 3) return [];
  const q = product.replace(/[^A-Za-z0-9._-]+/g, ' ').trim();
  const data = await githubApi<{ items?: { owner?: { login?: string }; name?: string; description?: string }[] }>(
    `/search/repositories?q=${encodeURIComponent(q)}&per_page=5`,
    env,
  ).catch(() => null);
  const want = loose(product);
  return (data?.items ?? [])
    .filter((row) => loose(`${row.name ?? ''} ${row.description ?? ''}`).includes(want) || want.includes(loose(row.name ?? '')))
    .map((row) => row.owner?.login)
    .filter((login): login is string => Boolean(login && isGithubLogin(login)))
    .slice(0, 4);
}

/** Expand a typed subject to GitHub, X, sites, PH/npm usernames. Cached 24h. */
export async function resolveIdentity(subject: Subject, env: SourceEnv, tinyfish: TinyfishAccess = null): Promise<ResolvedIdentity> {
  return cached(`id:v6:${subject.kind}:${subject.id.toLowerCase()}:${loose(subject.display)}`, 1440 * MIN, () => resolveIdentityFresh(subject, env, tinyfish));
}

async function resolveProductMaker(
  product: string,
  env: SourceEnv,
  tinyfish: TinyfishAccess,
  notes: string[],
): Promise<{ x: string[]; github: string[]; names: string[]; sites: string[] }> {
  const x: string[] = [];
  const github: string[] = [];
  const names: string[] = [];
  const sites: string[] = [];
  const take = (mentions: { x: string[]; github: string[]; names: string[] }, site?: string | null) => {
    for (const h of mentions.x) if (!x.some((v) => v.toLowerCase() === h.toLowerCase())) x.push(h);
    for (const g of mentions.github) if (!github.some((v) => v.toLowerCase() === g.toLowerCase())) github.push(g);
    for (const n of mentions.names) if (!names.includes(n)) names.push(n);
    if (site) sites.push(site);
  };

  for (const url of productHostGuesses(product)) {
    const page = await readSite(url).catch(() => null);
    if (!page) continue;
    notes.push(`product-host:${hostOf(url)}`);
    take(makerMentions(`${page.title}\n${page.description}\n${page.text}\n${page.links.map((l) => `${l.text} ${l.url}`).join('\n')}`), url);
    if (x.length || github.length) break;
  }

  const owners = await githubRepoOwners(product, env).catch(() => []);
  if (owners.length) {
    notes.push(`product-gh:${owners.join(',')}`);
    github.push(...owners.filter((g) => !github.some((v) => v.toLowerCase() === g.toLowerCase())));
  }

  const key = tinyfish?.key;
  if (key && tinyfish && !x.length && !github.length) {
    const year = new Date().getUTCFullYear();
    const hits = await tinyfishSearch(`"${product}" founder OR maker OR creator`, year, key, tinyfish.meter).catch(() => []);
    notes.push(`product-search:${hits.length}`);
    for (const hit of hits.slice(0, 5)) {
      const blob = `${hit.title}\n${hit.snippet}\n${hit.url}`;
      if (!loose(blob).includes(loose(product))) continue;
      take(makerMentions(blob), publicUrl(hit.url));
    }
  }
  return { x: x.slice(0, 4), github: github.slice(0, 4), names: names.slice(0, 3), sites: sites.slice(0, 4) };
}

async function followSitesForGithub(urls: string[], notes: string[]): Promise<string[]> {
  const logins: string[] = [];
  for (const url of urls.slice(0, 4)) {
    const page = await readSite(url).catch(() => null);
    if (!page) continue;
    const found = githubLoginsFromText(`${page.text}\n${page.links.map((l) => l.url).join('\n')}`);
    if (found.length) notes.push(`site-github:${hostOf(url)}=${found.join(',')}`);
    for (const login of found) if (!logins.some((v) => v.toLowerCase() === login.toLowerCase())) logins.push(login);
  }
  return logins.slice(0, 6);
}

async function resolveIdentityFresh(subject: Subject, env: SourceEnv, tinyfish: TinyfishAccess): Promise<ResolvedIdentity> {
  const notes: string[] = [];
  const profile = emptyProfile();
  if (subject.kind === 'github') profile.github = subject.id;
  if (subject.kind === 'x') profile.x = subject.id;
  if (subject.kind === 'domain' && isDomain(subject.id)) profile.site = `https://${subject.id}/`;
  const nameParts = parsePersonName(subject.display);
  if (subject.kind === 'name' && !nameParts.product) profile.name = subject.display;
  if (nameParts.product) notes.push(`product:${nameParts.product}`);

  const collided = collisionOverride(subject.id);
  if (collided) {
    notes.push(`collision:${subject.id}->${collided}`);
    if (isGithubLogin(collided)) profile.github ||= collided;
    if (isXHandle(collided)) profile.x ||= collided;
  }

  if (nameParts.product) {
    const maker = await resolveProductMaker(nameParts.product, env, tinyfish, notes);
    if (maker.x[0]) profile.x ||= maker.x[0];
    if (maker.github[0]) profile.github ||= maker.github[0];
    if (maker.names[0]) profile.name ||= maker.names[0];
    if (maker.sites[0]) profile.site ||= maker.sites[0];
    profile.sites = mergeSites(profile.sites, maker.sites);
  }

  const xHandle = profile.x || (subject.kind !== 'domain' && isXHandle(subject.id) ? subject.id : null);
  const fetchXPage = tinyfish
    ? async (url: string) => {
        const page = await tinyfishPage(url, tinyfish).catch(() => null);
        return page ? { title: page.title, description: page.description, text: page.text, links: page.links } : null;
      }
    : undefined;
  const xProfile: XProfile | null = xHandle
    ? await cached(`x:${xHandle.toLowerCase()}`, 30 * MIN, () => readXProfile(xHandle, fetchXPage)).catch(() => null)
    : null;
  if (xProfile) {
    notes.push(`x-profile:${xProfile.handle}`);
    profile.x = xProfile.handle;
    profile.name ||= xProfile.name;
    profile.bio ||= xProfile.bio;
    profile.site ||= xProfile.site;
    profile.sites = mergeSites(profile.sites, xProfile.urls, [xProfile.site]);
  } else if (xHandle) notes.push('x-profile:miss');

  const parts = subject.kind === 'name' ? nameParts : { name: profile.name, company: null, tokens: profile.name ? [profile.name] : [], product: null };
  if (parts.company) notes.push(`name-parse:${parts.name}|${parts.company}`);

  if (xProfile?.github?.length) {
    notes.push(`x-github:${xProfile.github.join(',')}`);
    profile.github ||= xProfile.github[0];
  }

  const followed = await followSitesForGithub(mergeSites(profile.sites, [profile.site]), notes);
  const knownLogins = [
    ...companyLogins(parts.name || subject.id, parts.company),
    ...nameLogins(profile.name || parts.name || ''),
    ...handleVariants(subject.id),
    ...handleVariants(profile.x ?? ''),
    ...handleTokens(subject.id),
    ...handleTokens(profile.x ?? ''),
    ...followed,
    ...(xProfile?.github ?? []),
    profile.github,
    collided,
  ].filter((l): l is string => Boolean(l));
  notes.push(`gh-try:${knownLogins.slice(0, 8).join(',') || 'none'}`);

  const wantSites = mergeSites(profile.sites, [profile.site]);
  const matchOpts = { wantX: profile.x, wantName: profile.name || parts.name, wantSite: profile.site, wantSites, wantCompany: parts.company };
  let matched = await bestGithubFor({ ...matchOpts, logins: knownLogins }, env, tinyfish);

  // Same-string logins (StevenTey vs steven-tey) score well on the name alone. Search when X/blog are missing.
  const weaklyLinked = Boolean(matched && !matched.user.x && !matched.user.blog);
  if (!matched || matched.score < 40 || weaklyLinked) {
    const searchTerms = [
      parts.name && parts.name.length >= 3 ? parts.name : null,
      parts.company ? `${parts.name} ${parts.company}` : null,
      profile.name && profile.name !== subject.id && profile.name.length >= 3 ? profile.name : null,
      ...handleTokens(subject.id),
      ...handleTokens(profile.x ?? ''),
    ].filter((t): t is string => Boolean(t && t.length >= 2 && !/^the guy/i.test(t)));
    const searched: string[] = [];
    for (const term of searchTerms.slice(0, 3)) {
      const people = await searchGithubUsers(term, env, tinyfish).catch(() => []);
      notes.push(`gh-search:${term}=${people.map((p) => p.login).join(',') || 'none'}`);
      searched.push(...people.map((p) => p.login));
    }
    const fromSearch = await bestGithubFor({ ...matchOpts, logins: searched }, env, tinyfish);
    if (fromSearch && (!matched || fromSearch.score > matched.score)) matched = fromSearch;
  }
  if (matched) {
    notes.push(`github:${matched.user.login} repos=${matched.user.repos} score=${matched.score}`);
    profile.github = matched.user.login;
    profile.name ||= matched.user.name;
    profile.bio ||= matched.user.bio;
    profile.site ||= matched.user.blog;
    profile.x ||= matched.user.x;
    if (matched.user.blog) {
      profile.site = matched.user.blog;
      profile.sites = mergeSites(profile.sites, [matched.user.blog]);
    }
  } else if (profile.github) {
    const user = await githubUser(profile.github, env, tinyfish).catch(() => null);
    if (user) {
      profile.name ||= user.name;
      profile.bio ||= user.bio;
      profile.site ||= user.blog;
      profile.x ||= user.x;
      if (user.blog) profile.sites = mergeSites(profile.sites, [user.blog]);
    } else notes.push('github-profile:miss');
  } else notes.push('github:unresolved');

  if (profile.bio) profile.sites = mergeSites(profile.sites, urlsFromText(profile.bio));
  const finished = finishProfile(profile);
  notes.push(`sites:${finished.sites.map((u) => hostOf(u)).join(',') || 'none'}`);
  return { profile: finished, notes, cacheKey: identityCacheKey(finished, subject) };
}

/** Lookup cards: one person when we could stitch surfaces; otherwise the old fallbacks. */
export function candidatesFromIdentity(subject: Subject, resolved: ResolvedIdentity): Candidate[] {
  const { profile } = resolved;
  const surfaces = [
    profile.github ? `GitHub @${profile.github}` : null,
    profile.x ? `@${profile.x} on X` : null,
    profile.site ? hostOf(profile.site) : null,
  ].filter(Boolean);
  const detail = surfaces.join(' · ') || (subject.kind === 'name' ? 'Name or brand' : subject.kind === 'domain' ? 'Website' : 'Public handle');
  if (profile.github) {
    return [{ kind: 'github', id: profile.github, display: profile.name || `@${profile.github}`, detail }];
  }
  if (profile.x) {
    return [{ kind: 'x', id: profile.x, display: profile.name || `@${profile.x}`, detail }];
  }
  if (subject.kind === 'domain') {
    return [{ kind: 'domain', id: subject.id, display: subject.display || subject.id, detail: 'Website' }];
  }
  return [{ kind: 'name', id: subject.id, display: subject.display || subject.id, detail }];
}

const NAV_LINK =
  /^(home|about|blog|contact|login|sign ?in|sign up|subscribe|newsletter|privacy|terms|careers|jobs|pricing|docs|support|twitter|github|x|linkedin|instagram|shop|store|cart|projects|changelog|source|start now|media kit|tech stack|api reference|investments?|sponsor( my work)?)$/i;
const JUNK_ITEM =
  /\b(subscribe|newsletter|sign[- ]?up|sign-up here|log ?in|listen on|apple podcasts|spotify|overcast|pocket casts|amazon music|telegram|investments?|media kit|tech stack|api reference|broadcast by|transistor|start now|follow me|buy me a coffee|powered by|wordpress|built with|24 startups|my book|my newsletter|sponsor my work|diamond sponsor|gold sponsor|silver sponsor|submit your game|founder not found)\b/i;
const GENERIC_NAME = /^(self|write|code|ideas|source|projects|changelog|home|shop|nvidia|replicate|fal|vercel|cursor|perplexity|openai|anthropic|sync|make|https|founder not found)$/i;

function yearMention(text: string, year: number): boolean {
  return new RegExp(`\\b${year}\\b`).test(text);
}

/** Lift the person's own sites, X bio products, and year-scoped search hits into Found items. */
export function itemsFromWebEvidence(opts: {
  profile: Profile;
  site: SiteInfo | null;
  pages: PageInfo[];
  web: WebResult[];
  year: number;
}): Found[] {
  const { profile, site, pages, web, year } = opts;
  const own = new Set([hostOf(profile.site), ...sitesOf(profile).map((u) => hostOf(u))].filter((h): h is string => Boolean(h)));
  const found: Found[] = [];
  const add = (item: Found) => {
    if (!item.name || hasBlockedWord(item.name)) return;
    if (item.date && !inYear(item.date, year)) return;
    found.push(item);
  };

  const considerLink = (text: string, url: string, source: Found['source'], score: number, date: string | null, confidence: DateConfidence) => {
    const host = hostOf(url);
    if (!host || SKIP_PAGES.test(host) || NAV_LINK.test(text) || JUNK_ITEM.test(text)) return;
    const cut = text.split(/\s*[.$•|·]\s*/)[0] ?? text;
    const name = clean(cut, 40) || productNameFromHost(host);
    if (!name || name.length < 2 || NAV_LINK.test(name) || JUNK_ITEM.test(name) || GENERIC_NAME.test(name)) return;
    if (profile.name && loose(name) === loose(profile.name)) return;
    add({
      name,
      description: own.has(host) ? clean(`Listed on ${hostOf(profile.site) ?? 'their site'}`, 140) : clean(`Public page on ${host}`, 140),
      date,
      dateConfidence: date ? 'exact' : confidence,
      link: url,
      icon: faviconUrl(url),
      source,
      status: 'LIVE',
      score,
      thisYear: !date && confidence !== 'exact',
    });
  };

  if (site) {
    const homeName = clean((site.title || '').replace(/\s*[|/·–—-].*$/, ''), 40);
    if (homeName && !NAV_LINK.test(homeName) && !JUNK_ITEM.test(homeName) && !/\b(blog|podcast|writer|newsletter)\b/i.test(homeName)) {
      considerLink(homeName, site.url, 'site', 4.2, null, 'unknown');
    }
    for (const link of site.links) {
      const url = publicUrl(link.url);
      if (!url) continue;
      const host = hostOf(url);
      const ownHost = hostOf(site.url);
      if (!host) continue;
      const external = host !== ownHost;
      const projectPath = /\/(projects?|now|changelog|shipped|launches?|apps?)\b/i.test(url);
      if (external || projectPath) considerLink(link.text, url, 'site', external ? 4 : 2, null, 'unknown');
    }
  }

  for (const url of sitesOf(profile)) {
    const host = hostOf(url);
    if (!host || host === hostOf(profile.site)) continue;
    considerLink(productNameFromHost(host), url, 'web', 4.5, null, 'unknown');
  }

  for (const hit of web) {
    if (hit.date && !inYear(hit.date, year)) continue;
    const dated = inYear(hit.date, year);
    considerLink(hit.title, hit.url, 'web', dated ? 5 : 3, dated ? hit.date : null, dated ? 'exact' : 'inferred');
  }

  for (const page of pages) {
    const dated = inYear(page.published, year) ? page.published : yearMention(page.text, year) || yearMention(page.title, year) ? `${year}-01` : null;
    const host = hostOf(page.url);
    if (!host || SKIP_PAGES.test(host)) continue;
    if (own.has(host) && /\/(now|projects?|changelog|shipped)\b/i.test(page.url)) continue;
    considerLink(page.title || productNameFromHost(host), page.url, own.has(host) ? 'site' : 'web', 3.5, dated, dated ? 'inferred' : 'unknown');
  }

  return found;
}

function dedupeFound(found: Found[]): Found[] {
  const seen = new Set<string>();
  return found
    .filter((item) => item.name && !hasBlockedWord(item.name))
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const base = loose(item.name.replace(/\s+v?\d+(\.\d+)*$/, ''));
      const key = item.date && (item.source === 'changelog' || item.source === 'company' || item.source === 'x')
        ? `${base}|${item.date}|${loose(item.name)}`
        : base;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200);
}

export type GatherMode = 'free' | 'full';

/** Everything the free sources and TinyFish know, de-duplicated, best first. Cached 24h per identity. */
export async function gather(
  subject: Subject,
  env: SourceEnv,
  year: number,
  meter: TinyfishMeter | null = null,
  opts?: { mode?: GatherMode },
): Promise<Gathered> {
  const tinyfish = tinyfishAccess(env, meter);
  const resolved = await resolveIdentity(subject, env, tinyfish);
  const mode: GatherMode = opts?.mode === 'full' ? 'full' : 'free';
  const key = mode === 'full' ? `gather:full:v2:${year}:${resolved.cacheKey}` : `gather:v11:${year}:${resolved.cacheKey}`;
  return cached(key, 1440 * MIN, () => gatherFresh(subject, resolved.profile, env, year, meter, tinyfish, resolved.notes, mode));
}

async function gatherFresh(
  subject: Subject,
  profile: Profile,
  env: SourceEnv,
  year: number,
  meter: TinyfishMeter | null,
  tinyfish: TinyfishAccess,
  notes: string[],
  mode: GatherMode = 'free',
): Promise<Gathered> {
  const ran: string[] = [...notes.filter((n) => n.startsWith('x-profile:') || n.startsWith('github:'))];
  const failed: string[] = notes.filter((n) => n.endsWith(':miss') || n.endsWith(':unresolved'));

  const ctx: SourceContext = { subject, profile, year, env, tinyfish };
  const key = tinyfish?.key ?? null;
  const who = profile.name || subject.display;
  const handle = profile.x ? ` OR "@${profile.x}"` : '';
  const siteHosts = sitesOf(profile)
    .map((url) => hostOf(url))
    .filter((h): h is string => Boolean(h))
    .slice(0, 4)
    .join(' OR ');
  const queries = key
    ? [
        `"${who}"${handle} launched OR shipped OR released ${year}`,
        `"${who}" ${year} app OR "Show HN" OR "Product Hunt" OR open source`,
        siteHosts ? `${siteHosts} launched OR changelog OR shipped ${year}` : '',
      ].filter(Boolean)
    : [];

  const homepage = profile.site;
  const extraHomes = [
    ...sitesOf(profile).filter((url) => hostOf(url) !== hostOf(homepage)),
    ...(homepage ? extraResearchPaths(homepage) : []),
    ...trustmrrUrls(profile),
  ]
    .filter((url, i, all) => all.findIndex((u) => u.replace(/\/+$/, '') === url.replace(/\/+$/, '')) === i)
    .slice(0, 10);
  const [results, site, extraSites, searched] = await Promise.all([
    Promise.allSettled(SOURCES.filter((source) => source.enabled(ctx)).map(async (source) => ({ id: source.id, found: await source.run(ctx) }))),
    homepage ? readSite(homepage).catch(() => null) : Promise.resolve(null),
    Promise.all(extraHomes.map((url) => readSite(url).catch(() => null))),
    Promise.all(
      queries.map((query) =>
        tinyfishSearch(query, year, key!, meter!).catch((error) => {
          failed.push(`tinyfish-search:${(error as Error).message}`);
          return [];
        }),
      ),
    ),
  ]);
  if (site) ran.push('site');
  if (extraSites.some(Boolean)) ran.push('sites');
  ran.push('research-pass:harvest');

  const web: WebResult[] = [];
  for (const row of searched.flat()) {
    const hit = result(row.title, row.url, row.snippet, row.date);
    if (hit && !web.some((w) => w.url === hit.url)) web.push(hit);
  }
  if (queries.length) ran.push('tinyfish-search');

  let pages: PageInfo[] = [];
  const crawlTargets = [
    homepage,
    ...sitesOf(profile),
    ...(homepage ? extraSitePaths(homepage).slice(1, 4) : []),
    ...web.map((w) => w.url),
  ]
    .map((url) => publicUrl(url))
    .filter((url): url is string => Boolean(url) && !SKIP_PAGES.test(hostOf(url) ?? ''))
    .filter((url, i, all) => all.findIndex((u) => hostOf(u) === hostOf(url) && u.replace(/\/+$/, '') === url.replace(/\/+$/, '')) === i);

  if (key) {
    try {
      pages = (await tinyfishFetch(crawlTargets.slice(0, 8), key, meter!)).map(toPage).filter((page): page is PageInfo => Boolean(page));
      if (crawlTargets.length) ran.push('tinyfish-fetch');
    } catch (error) {
      failed.push(`tinyfish-fetch:${(error as Error).message}`);
    }
  }

  const found: Found[] = [];
  for (const settled of results) {
    if (settled.status === 'fulfilled') {
      ran.push(settled.value.id);
      found.push(...settled.value.found);
    } else failed.push(settled.reason instanceof SourceError ? settled.reason.code : 'error');
  }

  const ownPages = extraSites.filter((page): page is SiteInfo => Boolean(page));
  for (const extra of ownPages) {
    found.push(
      ...itemsFromWebEvidence({
        profile,
        site: extra,
        pages: [],
        web: [],
        year,
      }),
    );
  }
  found.push(...itemsFromWebEvidence({ profile, site, pages, web, year }));

  const projectPages = [site, ...ownPages].filter((page): page is SiteInfo => Boolean(page));
  for (const page of projectPages) {
    found.push(...itemsFromProjectList({ text: `${page.title}\n${page.description}\n${page.text}`, url: page.url, year }));
  }
  for (const page of pages) {
    found.push(...itemsFromProjectList({ text: `${page.title}\n${page.text}`, url: page.url, year }));
  }

  const pageStats = mergeStats([
    profile.bio ? extractPublicStats(profile.bio, profile.x ? `https://x.com/${profile.x}` : profile.site || 'https://x.com/', profile.name) : [],
    ...projectPages.map((page) => extractPublicStats(`${page.title}\n${page.description}\n${page.text}`, page.url)),
    ...pages.map((page) => extractPublicStats(`${page.title}\n${page.text}`, page.url)),
    found.flatMap((item) => item.metrics ?? []),
  ]);

  if (profile.github) {
    try {
      const [html, user] = await Promise.all([githubPage(`/${profile.github}`), githubUser(profile.github, env, tinyfish).catch(() => null)]);
      const contrib = html ? githubContributions(html, year) : null;
      if (contrib) {
        pageStats.push(sourcedStat('contributions', `${contrib.toLocaleString('en-US')} GitHub contributions in ${year}`, contrib, `${GH}/${profile.github}`, profile.github)!);
      }
      if (user?.repos) {
        pageStats.push(sourcedStat('repos', `${user.repos} public GitHub repos`, user.repos, `${GH}/${profile.github}`, user.name || profile.github)!);
      }
      ran.push('github-overview');
    } catch {
      failed.push('github-overview');
    }
  }

  let deduped = dedupeFound(found).map((item) => ({ ...item, description: describeWithStat(item) }));
  let stats = mergeStats([pageStats, deduped.flatMap((item) => item.metrics ?? [])]);
  let draft: Gathered = { found: deduped, web: web.slice(0, 12), pages, site, profile, ran, failed, stats };
  const gaps = detectGaps(draft);
  ran.push(`research-pass:gaps:${gaps.join(',') || 'none'}`);

  // Pass 3 — gap-fill from already-fetched pages first (free). Paid TinyFish/Claude only if still thin.
  if (gaps.includes('thin-for-prolific') || gaps.includes('own-site')) ran.push('research-pass:gap-fill');
  if (gaps.includes('producthunt') && productHunt.enabled(ctx)) {
    try {
      const extra = deduped.map((item) => item.link).filter((url): url is string => Boolean(url));
      const more = await productHunt.run({ ...ctx, extraUrls: extra });
      if (more.length) {
        found.push(...more);
        ran.push('producthunt-sites');
      }
    } catch {
      failed.push('producthunt-sites');
    }
    deduped = dedupeFound(found).map((item) => ({ ...item, description: describeWithStat(item) }));
    stats = mergeStats([pageStats, deduped.flatMap((item) => item.metrics ?? [])]);
    draft = { ...draft, found: deduped, stats };
  }

  // Person → role → company. Resolve a missing handle/name BEFORE the company harvest so
  // "Tibo from OpenAI" becomes Thibault Sottiaux / Codex lead and the tape is scoped right.
  const { parseAffiliationQuery, affiliationFromBio, mergeAffiliation, viaLabel, defaultAttribution, companySlug, needsPersonResolve } =
    await import('./shipped-affiliation');
  const typed = parseAffiliationQuery(subject.display || subject.id);
  let affiliation = mergeAffiliation(typed, affiliationFromBio(profile.bio || '', typed));
  if (!affiliation.name) affiliation.name = who;
  if (!affiliation.companyX && affiliation.company) {
    const slug = companySlug(affiliation.company);
    if (slug && slug.length <= 15) affiliation.companyX = slug;
  }
  if (!affiliation.companyGithub && affiliation.company) affiliation.companyGithub = companySlug(affiliation.company);
  profile.affiliation = affiliation;

  let xaiMicros = 0;
  let xaiTicks = 0;
  let xaiPosts = 0;
  let xaiHit = false;
  let decisionsMicros = 0;
  const { xaiConfigured } = await import('./shipped-xai');
  if (xaiConfigured(env) && needsPersonResolve({ handle: profile.x, name: affiliation.name, company: affiliation.company, role: affiliation.role })) {
    try {
      const { resolvePersonWithXai } = await import('./shipped-xai');
      const ident = await resolvePersonWithXai({ env, who, company: affiliation.company, role: affiliation.role });
      xaiMicros += ident.spend.costMicros;
      xaiTicks += ident.spend.ticks;
      xaiPosts += ident.spend.posts;
      if (ident.spend.ticks || ident.spend.costMicros) {
        xaiHit = true;
        ran.push('xai-identity');
      }
      const { verifyResolvedPerson } = await import('./shipped-decisions');
      const verified = await verifyResolvedPerson({
        env,
        query: subject.display || subject.id,
        company: affiliation.company,
        candidate: ident,
      });
      decisionsMicros += verified.spend.costMicros;
      if (verified.keep) {
        if (ident.handle) profile.x = ident.handle;
        if (ident.name) {
          affiliation.name = ident.name;
          if (!profile.name) profile.name = ident.name;
        }
        if (ident.company && !affiliation.company) affiliation.company = ident.company;
        if (ident.role && affiliation.role === 'unknown') {
          const role = ident.role.toLowerCase();
          if (role.includes('ceo')) affiliation.role = 'ceo';
          else if (role.includes('founder')) affiliation.role = 'founder';
          else if (role.includes('lead') || role.includes('head') || role.includes('director')) affiliation.role = 'lead';
        }
        if (ident.product) affiliation.product = affiliation.product || ident.product;
        if (ident.handle) {
          try {
            const { readXProfile } = await import('./shipped-identity');
            const xProfile = await readXProfile(ident.handle);
            if (xProfile?.bio) {
              profile.bio = profile.bio || xProfile.bio;
              affiliation = mergeAffiliation(affiliation, affiliationFromBio(xProfile.bio, affiliation));
            }
            if (xProfile?.name && !profile.name) profile.name = xProfile.name;
            if (xProfile?.site && !profile.site) profile.site = xProfile.site;
          } catch {
            ran.push('x-profile:identity-miss');
          }
        }
        ran.push(`identity:${affiliation.name || who}${profile.x ? `@${profile.x}` : ''}${affiliation.product ? `:${affiliation.product}` : ''}`);
      } else {
        ran.push('identity:rejected');
      }
    } catch {
      failed.push('xai-identity');
    }
  }
  if (!affiliation.companyX && affiliation.company) {
    const slug = companySlug(affiliation.company);
    if (slug && slug.length <= 15) affiliation.companyX = slug;
  }
  if (!affiliation.companyGithub && affiliation.company) affiliation.companyGithub = companySlug(affiliation.company);
  profile.affiliation = affiliation;

  try {
    const { harvestCompany } = await import('./shipped-company');
    const company = await harvestCompany({
      affiliation,
      year,
      env,
      deep: mode === 'full',
      gapFillX: mode === 'full' || found.length < 6,
    });
    if (company.found.length) found.push(...company.found);
    ran.push(...company.ran);
    xaiMicros += company.spend.costMicros;
    xaiTicks += company.spend.ticks;
    xaiPosts += company.spend.posts;
    if (company.spend.ticks || company.spend.costMicros) xaiHit = true;
  } catch {
    failed.push('company-harvest');
  }

  deduped = dedupeFound(found).map((item) => ({ ...item, description: describeWithStat(item) }));
  const via = viaLabel(affiliation, defaultAttribution(affiliation.role));
  try {
    const { verifyCandidates, dedupeSameShips, sortBySignificance } = await import('./shipped-decisions');
    const verified = await verifyCandidates({ env, items: deduped, year, who, affiliation, via });
    decisionsMicros += verified.spend.costMicros;
    ran.push(verified.usedDecisions ? 'decisions' : 'decisions:heuristic');
    const same = await dedupeSameShips({ env, items: verified.items });
    decisionsMicros += same.spend.costMicros;
    deduped = sortBySignificance(same.items);
  } catch {
    failed.push('decisions');
    ran.push('decisions:heuristic');
  }

  const prolific = Boolean(profile.github || profile.site || affiliation.company || (profile.bio && profile.bio.length > 20));
  const deep = mode === 'full';
  try {
    const { searchXShips, searchPersonAndCompanyX, searchWebShips, xaiConfigured, xaiShouldGapFill, xaiMaxPosts, xaiDeepMaxPosts } =
      await import('./shipped-xai');
    const wantDeep = deep && xaiConfigured(env);
    const wantGap = !deep && xaiConfigured(env) && xaiShouldGapFill(deduped.length, prolific);
    if (wantDeep) {
      const sweep = await searchPersonAndCompanyX({
        env,
        year,
        personX: profile.x,
        personName: who,
        affiliation,
        deep: true,
      });
      xaiMicros += sweep.spend.costMicros;
      xaiTicks += sweep.spend.ticks;
      xaiPosts += sweep.spend.posts;
      if (sweep.spend.ticks || sweep.spend.costMicros || sweep.found.length) xaiHit = true;
      ran.push(...sweep.ran);
      if (sweep.found.length) found.push(...sweep.found);
      const web = await searchWebShips({ env, year, who, company: affiliation.company });
      xaiMicros += web.spend.costMicros;
      xaiTicks += web.spend.ticks;
      xaiPosts += web.spend.posts;
      if (web.spend.ticks || web.spend.costMicros || web.found.length) {
        xaiHit = true;
        ran.push('xai-web-deep');
      }
      if (web.found.length) found.push(...web.found);
      if (sweep.found.length || web.found.length) {
        const { verifyCandidates, dedupeSameShips, sortBySignificance } = await import('./shipped-decisions');
        const extra = await verifyCandidates({ env, items: [...sweep.found, ...web.found], year, who, affiliation, via });
        decisionsMicros += extra.spend.costMicros;
        const same = await dedupeSameShips({ env, items: [...deduped, ...extra.items] });
        decisionsMicros += same.spend.costMicros;
        deduped = sortBySignificance(same.items);
      }
      const cap = xaiDeepMaxPosts(env);
      if (xaiPosts >= cap && cap > 0) ran.push('xai-capped:deep');
    } else if (wantGap && profile.x) {
      const personX = await searchXShips({
        env,
        year,
        handles: [profile.x],
        who,
        company: affiliation.company,
        kind: 'person',
      });
      xaiMicros += personX.spend.costMicros;
      xaiTicks += personX.spend.ticks;
      xaiPosts += personX.spend.posts;
      if (personX.spend.ticks || personX.spend.costMicros || personX.found.length) {
        xaiHit = true;
        ran.push('xai-gapfill');
      }
      if (personX.found.length) {
        found.push(...personX.found);
        const { verifyCandidates, dedupeSameShips, sortBySignificance } = await import('./shipped-decisions');
        const extra = await verifyCandidates({ env, items: personX.found, year, who, affiliation, via });
        decisionsMicros += extra.spend.costMicros;
        const same = await dedupeSameShips({ env, items: [...deduped, ...extra.items] });
        decisionsMicros += same.spend.costMicros;
        deduped = sortBySignificance(same.items);
      }
      const cap = xaiMaxPosts(env);
      if (xaiPosts >= cap && cap > 0) ran.push('xai-capped:free');
    } else if (xaiConfigured(env) && wantGap && !profile.x) {
      ran.push('xai-skipped:no-handle');
    } else if (xaiConfigured(env) && !deep) {
      ran.push(deduped.length >= 6 ? 'xai-skipped:enough' : 'xai-skipped:not-prolific');
    }
  } catch {
    failed.push(deep ? 'xai-deep' : 'xai-gapfill');
  }

  stats = mergeStats([pageStats, deduped.flatMap((item) => item.metrics ?? [])]);
  const finalGaps = detectGaps({ ...draft, found: deduped, stats, profile });
  // Never invent a leftover count. A number only when we sliced a unique list past MAX_ITEMS.
  const leftover = 0;
  const meanConfidence =
    deduped.length > 0 ? deduped.reduce((sum, item) => sum + (item.confidence ?? 0), 0) / deduped.length : 0;
  const capped = ran.some((tag) => tag.startsWith('xai-capped')) || leftover > 0;
  const incomplete =
    !deep &&
    (finalGaps.includes('thin-for-prolific') ||
      ran.includes('xai-skipped:no-handle') ||
      (deduped.length > 0 && meanConfidence > 0 && meanConfidence < 0.85));
  return {
    ...draft,
    found: deduped,
    profile,
    stats,
    gaps: finalGaps,
    coverageCapped: capped,
    mode,
    leftover,
    leftoverKnown: leftover > 0,
    incomplete,
    costs: { xaiMicros, decisionsMicros, xaiTicks, xaiHit, xaiPosts },
    ran,
    failed,
  };
}
