// Where "Shipped in <year>" finds things, all free: public APIs (GitHub, the App Store, Hacker News, npm,
// Product Hunt with a token), the subject's own site, and TinyFish's free Search + Fetch for launch pages
// (worker/shipped-tinyfish.ts). Claude only assembles the receipt from this; its paid web search is a
// last resort (worker/shipped-ai.ts). Every source returns plain Found items; nothing here is trusted text.
//
// Optional keys (each source is skipped without its key):
//   GITHUB_TOKEN          GitHub API (higher rate limit; anonymous works but shares Cloudflare's IPs)
//   PRODUCTHUNT_TOKEN     Product Hunt API v2 developer token: launches the subject made
//   TINYFISH_API_KEY      TinyFish Search + Fetch (free endpoints only)
import type { ItemSource, ItemStatus, Subject } from '../lib/shipped-year';
import { isDomain, isGithubLogin, isXHandle } from '../lib/shipped-year';
import { hasBlockedWord } from '../lib/shipped-sponsors';
import { tinyfishFetch, tinyfishSearch, type TinyfishMeter, type TinyfishPage } from './shipped-tinyfish';

export interface SourceEnv {
  GITHUB_TOKEN?: string;
  PRODUCTHUNT_TOKEN?: string;
  TINYFISH_API_KEY?: string;
}

export type Found = {
  name: string;
  description: string;
  date: string | null;
  link: string | null;
  /** Remote image to dither into the logo (app icon, favicon, og:image). */
  icon: string | null;
  source: ItemSource;
  status: ItemStatus;
  /** Higher sorts first when there are too many. */
  score: number;
};

export type WebResult = { title: string; url: string; snippet: string; date: string | null };

export type SiteInfo = { url: string; title: string; description: string; icon: string | null; text: string; links: { text: string; url: string }[] };

/** What the subject is, filled in as sources learn it (GitHub tells us their name, site and X handle). */
export type Profile = { name: string; bio: string; site: string | null; x: string | null; github: string | null };

/** A page TinyFish read for us (their site, a launch post), cut down for the prompt. */
export type PageInfo = { url: string; title: string; description: string; published: string | null; text: string };

export type Gathered = { found: Found[]; web: WebResult[]; pages: PageInfo[]; site: SiteInfo | null; profile: Profile; ran: string[]; failed: string[] };

export type SourceContext = { subject: Subject; profile: Profile; year: number; env: SourceEnv };

export interface SourceProvider {
  id: string;
  enabled(ctx: SourceContext): boolean;
  run(ctx: SourceContext): Promise<Found[]>;
}

const UA = 'brytonzoz.com-shipped (+https://brytonzoz.com/shipped/)';
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

const githubHeaders = (env: SourceEnv): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
});

/** GitHub: repositories created this year, and releases this year of the ones still being worked on. */
const github: SourceProvider = {
  id: 'github',
  enabled: ({ profile }) => Boolean(profile.github),
  async run({ profile, year, env }) {
    const login = profile.github!;
    const headers = githubHeaders(env);
    const repos = await getJson<Record<string, unknown>[]>(`https://api.github.com/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`, { headers });
    const own = repos.filter((repo) => !repo.fork && !repo.private && !repo.archived && typeof repo.name === 'string' && /^[A-Za-z0-9._-]+$/.test(repo.name as string));
    const found: Found[] = [];
    for (const repo of own) {
      const created = day(repo.created_at);
      if (!inYear(created, year)) continue;
      const stars = Number(repo.stargazers_count) || 0;
      const homepage = siteFromProfile(repo.homepage);
      found.push({
        name: clean(repo.name, 60),
        description: clean(repo.description, 140),
        date: created,
        link: publicUrl(repo.html_url),
        icon: homepage ? faviconUrl(homepage) : null,
        source: 'github',
        status: homepage ? 'LIVE' : 'SHIPPED',
        score: 2 + Math.log10(1 + stars) * 2 + (homepage ? 1 : 0),
      });
    }
    // Older projects that cut a release this year (at most 3 more requests).
    const active = own
      .filter((repo) => !inYear(day(repo.created_at), year) && inYear(day(repo.pushed_at), year))
      .sort((a, b) => (Number(b.stargazers_count) || 0) - (Number(a.stargazers_count) || 0))
      .slice(0, 3);
    const releases = await Promise.allSettled(
      active.map((repo) => getJson<Record<string, unknown>[]>(`https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo.name as string)}/releases?per_page=5`, { headers })),
    );
    releases.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const repo = active[i];
      const release = result.value.find((r) => !r.draft && !r.prerelease && inYear(day(r.published_at), year));
      if (!release) return;
      const homepage = siteFromProfile(repo.homepage);
      const tag = clean(release.tag_name, 20);
      found.push({
        name: clean(`${repo.name}${tag ? ` ${tag}` : ''}`, 60),
        description: clean(repo.description, 140),
        date: day(release.published_at),
        link: publicUrl(release.html_url) ?? publicUrl(repo.html_url),
        icon: homepage ? faviconUrl(homepage) : null,
        source: 'github',
        status: 'RELEASED',
        score: 2 + Math.log10(1 + (Number(repo.stargazers_count) || 0)) * 2,
      });
    });
    return found;
  },
};

/** App Store apps by this developer, released this year (with their icons). */
const appStore: SourceProvider = {
  id: 'appstore',
  enabled: ({ subject, profile }) => subject.kind !== 'github' || Boolean(profile.name),
  async run({ subject, profile, year }) {
    const term = subject.kind === 'domain' ? subject.id.split('.')[0] : profile.name || subject.display.replace(/^@/, '');
    if (loose(term).length < 3) return [];
    const data = await getJson<{ results?: Record<string, unknown>[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&attribute=softwareDeveloper&limit=50&country=us`,
    );
    const want = loose(term);
    const site = subject.kind === 'domain' ? subject.id : hostOf(profile.site);
    return (data.results ?? [])
      .filter((app) => {
        const dev = loose(String(app.artistName ?? '')) + '|' + loose(String(app.sellerName ?? ''));
        const sellerHost = hostOf(publicUrl(app.sellerUrl));
        return dev.includes(want) || (site && sellerHost === site);
      })
      .filter((app) => inYear(day(app.releaseDate), year))
      .slice(0, 8)
      .map((app): Found => ({
        name: clean(app.trackName, 60),
        description: clean(String(app.description ?? '').split(/[.\n]/)[0], 140) || clean(app.primaryGenreName, 40),
        date: day(app.releaseDate),
        link: publicUrl(String(app.trackViewUrl ?? '').split('?')[0]),
        icon: publicUrl(app.artworkUrl512 ?? app.artworkUrl100),
        source: 'appstore',
        status: 'LAUNCHED',
        score: 5 + Math.log10(1 + (Number(app.userRatingCount) || 0)),
      }));
  },
};

/** Show HN / Launch HN posts by this handle (or about this domain) this year. */
const hackerNews: SourceProvider = {
  id: 'hn',
  enabled: ({ subject, profile }) => subject.kind === 'domain' || Boolean(profile.github || profile.x),
  async run({ subject, profile, year }) {
    const start = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const end = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
    const handles = [...new Set([profile.github, profile.x].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase()))];
    const urls =
      subject.kind === 'domain'
        ? [`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(subject.id)}&restrictSearchableAttributes=url&tags=story&numericFilters=created_at_i>${start},created_at_i<${end},points>3&hitsPerPage=10`]
        : handles.map((h) => `https://hn.algolia.com/api/v1/search_by_date?tags=(show_hn,launch_hn),author_${encodeURIComponent(h)}&numericFilters=created_at_i>${start},created_at_i<${end}&hitsPerPage=15`);
    const pages = await Promise.allSettled(urls.map((url) => getJson<{ hits?: Record<string, unknown>[] }>(url)));
    const found: Found[] = [];
    for (const page of pages) {
      if (page.status !== 'fulfilled') continue;
      for (const hit of page.value.hits ?? []) {
        const title = String(hit.title ?? '').replace(/^(show|launch) hn:\s*/i, '');
        const [name, ...rest] = title.split(/\s+[–—-]\s+|:\s+/);
        const link = publicUrl(hit.url) ?? publicUrl(`https://news.ycombinator.com/item?id=${hit.objectID}`);
        found.push({
          name: clean(name, 60),
          description: clean(rest.join(' - '), 140) || 'Posted to Hacker News.',
          date: day(hit.created_at),
          link,
          icon: hit.url ? faviconUrl(String(hit.url)) : null,
          source: 'hn',
          status: 'LAUNCHED',
          score: 3 + Math.log10(1 + (Number(hit.points) || 0)) * 1.5,
        });
      }
    }
    return found;
  },
};

/** npm packages this handle maintains that were published this year. */
const npm: SourceProvider = {
  id: 'npm',
  enabled: ({ profile }) => Boolean(profile.github),
  async run({ profile, year }) {
    const data = await getJson<{ objects?: { package: Record<string, unknown>; score?: { final?: number } }[] }>(
      `https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(profile.github!.toLowerCase())}&size=50`,
    );
    return (data.objects ?? [])
      .filter((entry) => inYear(day(entry.package.date), year))
      .sort((a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0))
      .slice(0, 5)
      .map(({ package: pkg, score }): Found => ({
        name: clean(pkg.name, 60),
        description: clean(pkg.description, 140),
        date: day(pkg.date),
        link: publicUrl((pkg.links as Record<string, unknown> | undefined)?.npm),
        icon: null,
        source: 'npm',
        status: 'RELEASED',
        score: 1 + (score?.final ?? 0) * 2,
      }));
  },
};

/** Product Hunt launches the subject made (needs PRODUCTHUNT_TOKEN). */
const productHunt: SourceProvider = {
  id: 'producthunt',
  enabled: ({ env, profile }) => Boolean(env.PRODUCTHUNT_TOKEN && (profile.x || profile.github)),
  async run({ env, profile, year }) {
    const username = (profile.x || profile.github)!;
    const data = await getJson<{ data?: { user?: { madePosts?: { edges?: { node: Record<string, unknown> }[] } } } }>('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.PRODUCTHUNT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query($u:String!){user(username:$u){madePosts(first:20){edges{node{name tagline createdAt url website thumbnail{url}}}}}}',
        variables: { u: username },
      }),
    });
    return (data.data?.user?.madePosts?.edges ?? [])
      .map((edge) => edge.node)
      .filter((post) => inYear(day(post.createdAt), year))
      .map((post): Found => ({
        name: clean(post.name, 60),
        description: clean(post.tagline, 140),
        date: day(post.createdAt),
        link: publicUrl(post.url),
        icon: publicUrl((post.thumbnail as Record<string, unknown> | undefined)?.url),
        source: 'producthunt',
        status: 'LAUNCHED',
        score: 5,
      }));
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

/** Homepage title, description, icon, a text sample and its links (for Claude to read, never to obey). */
export async function readSite(siteUrl: string): Promise<SiteInfo | null> {
  const url = publicUrl(siteUrl);
  if (!url) return null;
  const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (!response?.ok || !(response.headers.get('content-type') ?? '').includes('html')) return null;
  const html = (await response.text()).slice(0, 400_000);
  const base = response.url || url;
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
  const text = clean(decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')), 2500);
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

type GithubUser = { login: string; name: string; bio: string; blog: string | null; x: string | null; repos: number; followers: number; type: string };

export async function githubUser(login: string, env: SourceEnv): Promise<GithubUser | null> {
  if (!isGithubLogin(login)) return null;
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { 'user-agent': UA, ...githubHeaders(env) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) throw new SourceError('rate-limited');
  if (!response.ok) throw new SourceError(`http-${response.status}`);
  const user = (await response.json()) as Record<string, unknown>;
  return {
    login: String(user.login),
    name: clean(user.name, 60),
    bio: clean(user.bio, 160),
    blog: siteFromProfile(user.blog),
    x: typeof user.twitter_username === 'string' && isXHandle(user.twitter_username) ? user.twitter_username : null,
    repos: Number(user.public_repos) || 0,
    followers: Number(user.followers) || 0,
    type: String(user.type),
  };
}

export async function searchGithubUsers(name: string, env: SourceEnv): Promise<{ login: string }[]> {
  const data = await getJson<{ items?: { login?: unknown; type?: unknown }[] }>(
    `https://api.github.com/search/users?q=${encodeURIComponent(`${name} in:name`)}&per_page=4`,
    { headers: githubHeaders(env) },
  );
  return (data.items ?? []).filter((u) => typeof u.login === 'string' && isGithubLogin(u.login)).map((u) => ({ login: u.login as string }));
}

/** Under 2 of these and Claude may spend its 2 paid searches. */
export const inYearCount = (gathered: Gathered, year: number) => gathered.found.filter((item) => inYear(item.date, year)).length;

/** Everything the free sources and TinyFish know, de-duplicated, best first. */
export async function gather(subject: Subject, env: SourceEnv, year: number, meter: TinyfishMeter | null = null): Promise<Gathered> {
  const profile: Profile = { name: '', bio: '', site: null, x: null, github: null };
  if (subject.kind === 'github') profile.github = subject.id;
  if (subject.kind === 'x') profile.x = subject.id;
  if (subject.kind === 'domain' && isDomain(subject.id)) profile.site = `https://${subject.id}/`;
  if (subject.kind === 'name') profile.name = subject.display;

  const ran: string[] = [];
  const failed: string[] = [];
  // An X handle borrows the same-named GitHub account only when that account lists this handle.
  if (subject.kind === 'x' && isGithubLogin(subject.id)) {
    const user = await githubUser(subject.id, env).catch(() => null);
    if (user?.x && user.x.toLowerCase() === subject.id.toLowerCase()) profile.github = subject.id;
  }
  if (profile.github) {
    try {
      const user = await githubUser(profile.github, env);
      if (user) {
        profile.name ||= user.name;
        profile.bio ||= user.bio;
        profile.site ||= user.blog;
        profile.x ||= user.x;
      }
    } catch {
      failed.push('github-profile');
    }
  }

  const ctx: SourceContext = { subject, profile, year, env };
  const key = env.TINYFISH_API_KEY && meter ? env.TINYFISH_API_KEY : null;
  const who = profile.name || subject.display;
  const handle = profile.x ? ` OR "@${profile.x}"` : '';
  const queries = key
    ? [`"${who}"${handle} launched OR shipped OR released ${year}`, `"${who}" ${year} app OR "Show HN" OR "Product Hunt" OR open source`]
    : [];
  const [results, site, searched] = await Promise.all([
    Promise.allSettled(SOURCES.filter((source) => source.enabled(ctx)).map(async (source) => ({ id: source.id, found: await source.run(ctx) }))),
    profile.site ? readSite(profile.site).catch(() => null) : Promise.resolve(null),
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

  const web: WebResult[] = [];
  for (const row of searched.flat()) {
    const hit = result(row.title, row.url, row.snippet, row.date);
    if (hit && !web.some((w) => w.url === hit.url)) web.push(hit);
  }
  if (queries.length) ran.push('tinyfish-search');

  // TinyFish Fetch reads their site (rendered, so JS-only sites work) and the best launch pages.
  let pages: PageInfo[] = [];
  if (key) {
    const targets = [profile.site, ...web.map((w) => w.url)]
      .map((url) => publicUrl(url))
      .filter((url): url is string => Boolean(url) && !SKIP_PAGES.test(hostOf(url) ?? ''))
      .filter((url, i, all) => all.indexOf(url) === i)
      .slice(0, 5);
    try {
      pages = (await tinyfishFetch(targets, key, meter!)).map(toPage).filter((page): page is PageInfo => Boolean(page));
      if (targets.length) ran.push('tinyfish-fetch');
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
  const seen = new Set<string>();
  const unique = found
    .filter((item) => item.name && !hasBlockedWord(item.name))
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = loose(item.name.replace(/\s+v?\d+(\.\d+)*$/, ''));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
  return { found: unique, web: web.slice(0, 12), pages, site, profile, ran, failed };
}
