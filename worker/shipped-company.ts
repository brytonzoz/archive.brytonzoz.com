// First-party company harvest, cached 7 days per company slug. Discovers changelog / blog / news
// / releases / updates, <link rel=alternate> feeds, sitemap.xml (2026 lastmod), GitHub org
// releases, and App Store version rows. No per-company URL tables.
import { extraResearchPaths, itemsFromProjectList } from './shipped-research';
import { looksLikeNotAShip } from './shipped-decisions';
import { prettyBrand } from './shipped-polish';
import { companyOrgGuess, companyScope, companySlug, companyTokens, leadProductTokens, type Affiliation } from './shipped-affiliation';
import { type XaiEnv, type XaiSpend, emptyXaiSpend } from './shipped-xai';
import { stripVia, type CompanyStore } from './shipped-company-store';
import {
  cached,
  clean,
  hostOf,
  publicUrl,
  type Found,
  type SourceEnv,
  type TinyfishAccess,
} from './shipped-sources';
import { tinyfishFetch, tinyfishSearch, type TinyfishPage } from './shipped-tinyfish';
import { safeFetch } from './shipped-fetch';
import {
  COMPANY_PATHS,
  FEED_PATHS,
  extractAlternateFeeds,
  isShipPath,
  itemsFromCompanyPage,
  itemsFromFeedXml,
  itemsFromSitemap,
  mergeChangelog,
  productPaths,
  sitemapChildLocs,
  type ChangelogFound,
} from './shipped-changelog';

const MIN = 60;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PREFIX_HOSTS = ['developers', 'platform', 'docs', 'help', 'blog', 'news', 'changelog'];
/** TinyFish Fetch is metered (600/day). Cap first-party fallback URLs per company harvest. */
const TINYFISH_COMPANY_CAP = 24;

export type CompanyEnv = SourceEnv & XaiEnv;

type FetchCtx = {
  tinyfish: TinyfishAccess;
  left: { n: number };
  used: number;
  blocked: string[];
};

export function looksBlockedPage(text: string, title = ''): boolean {
  const hay = `${title}\n${text}`.slice(0, 6000).toLowerCase();
  if (
    /just a moment|attention required|enable javascript to continue|cf-browser-verification|challenge-platform|checking your browser|verify you are (a )?human|unusual traffic from your computer|access denied|request unsuccessful|sorry, you have been blocked|blocked because of|bot detection/.test(
      hay,
    )
  ) {
    return true;
  }
  return text.length < 1200 && /cloudflare|please enable javascript|captcha/.test(hay);
}

export function isPriorityCompanyUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/index') return true;
    return /\/(changelog|blog|news|releases|updates|whats-new|feed|rss|atom|sitemap)(\/|$|\.)/i.test(path);
  } catch {
    return false;
  }
}

/** Changelog/release paths first so TinyFish's small batch is not spent on /blog and /news. */
export function priorityCompanyScore(url: string): number {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (/\/changelog\b/i.test(path)) return 0;
    if (/\/(releases?|updates?|whats-new)\b/i.test(path)) return 1;
    if (path === '/' || path === '/index') return 2;
    if (/\/(feed|rss|atom|sitemap)/i.test(path)) return 3;
    if (/\/(blog|news)\b/i.test(path)) return 4;
    return 5;
  } catch {
    return 9;
  }
}

export type CompanyHarvest = { found: Found[]; spend: XaiSpend; ran: string[]; cacheHit: boolean };

type CompanyPage = {
  url: string;
  title: string;
  text: string;
  html: string;
  links: { text: string; url: string }[];
  feeds: string[];
};

export function hostGuesses(company: string): string[] {
  const tokens = companyTokens(company);
  const names = tokens.length ? tokens : [company];
  const out: string[] = [];
  for (const name of names) {
    const slug = companySlug(name);
    if (!slug) continue;
    const hyphen = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const tld of ['com', 'ai', 'dev', 'io', 'so']) {
      const apex = `https://${slug}.${tld}/`;
      if (!out.includes(apex)) out.push(apex);
      if (hyphen && hyphen !== slug) {
        const dashed = `https://${hyphen}.${tld}/`;
        if (!out.includes(dashed)) out.push(dashed);
      }
    }
  }
  return out.slice(0, 12);
}

function prefixHosts(apex: string): string[] {
  const host = hostOf(apex);
  if (!host) return [];
  return PREFIX_HOSTS.map((prefix) => `https://${prefix}.${host}/`);
}

function viaFor(affiliation: Affiliation): string | null {
  if (!affiliation.company) return null;
  const brand = prettyBrand(affiliation.company) || affiliation.company;
  if (companyScope(affiliation) === 'product' && affiliation.product) {
    return `via ${brand} · ${affiliation.product}`;
  }
  if (companyScope(affiliation) === 'all') return `via ${brand}`;
  return null;
}

function withVia(items: Found[], via: string | null): Found[] {
  return items.map((item) => ({
    ...item,
    via: via ? item.via ?? via : item.via ?? null,
    source: item.source === 'site' || item.source === 'web' ? 'changelog' : item.source,
  }));
}

const COMPANY_CACHE_CAP = 200;

/** Keep dated changelog cards; drop sitemap-sized dumps before D1/R2 ingest. */
export function compactCompanyFound(found: Found[], cap = COMPANY_CACHE_CAP): Found[] {
  const ranked = found.filter((item) => item && item.name && item.thisYear !== false);
  const weight = (item: Found) => {
    let n = (item.score || 0) * 8;
    const url = (item.link || '').toLowerCase();
    const name = item.name || '';
    if (item.source === 'changelog') n += 80;
    if (/\/(changelog|release-notes|whats-new|docs\/changelog)/i.test(url)) n += 50;
    if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) n += 30;
    if (/\/(blog|news|research|index)\//i.test(url) && !/changelog/i.test(url)) n -= 20;
    if (looksLikeNotAShip(item)) n -= 80;
    if (/\b(bug fixes?|get started|configuration details|see setup)\b/i.test(name)) n -= 60;
    if (/\b(codex|chatgpt|claude|cursor|gpt-?\d)/i.test(name) && name.length <= 72) n += 25;
    return n;
  };
  ranked.sort((a, b) => weight(b) - weight(a));
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const item of ranked) {
    const key = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const letters = item.name.replace(/[^a-zA-Z]/g, '').length;
    if (key.length < 4 || letters < 3 || seen.has(key)) continue;
    if (looksLikeNotAShip(item)) continue;
    if (/\b(get started with|configuration details|see setup)\b/i.test(item.name)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

function asFound(row: ChangelogFound): Found {
  return {
    name: row.name,
    description: row.description,
    date: row.date,
    dateConfidence: row.dateConfidence,
    link: row.link,
    icon: row.icon,
    source: row.source,
    status: row.status,
    score: row.score,
    thisYear: row.thisYear,
  };
}

async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

async function fetchText(url: string, maxBytes: number, types?: string[], blocked?: string[]): Promise<{ url: string; text: string } | null> {
  const safe = publicUrl(url);
  if (!safe) return null;
  const page = await safeFetch(safe, {
    accept: 'text/html, application/xhtml+xml, application/xml, application/rss+xml, application/atom+xml, text/xml, */*',
    maxBytes,
    timeoutMs: 8000,
    types,
    userAgent: UA,
  }).catch(() => null);
  if (!page) {
    if (blocked && isPriorityCompanyUrl(safe)) blocked.push(safe);
    return null;
  }
  const text = new TextDecoder().decode(page.bytes);
  if (looksBlockedPage(text)) {
    if (blocked && isPriorityCompanyUrl(safe)) blocked.push(safe);
    return null;
  }
  return { url: page.url || safe, text };
}

function linksFromMarkdown(text: string, base: string): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  for (const match of text.matchAll(/\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const href = publicUrl(match[2]);
    const label = clean(match[1], 80);
    if (href && label && !out.some((row) => row.url === href)) out.push({ text: label, url: href });
    if (out.length >= 400) break;
  }
  if (out.length) return out;
  for (const match of text.matchAll(/https?:\/\/[^\s)"']+/g)) {
    try {
      const href = publicUrl(new URL(match[0], base).toString());
      const label = clean(match[0].split('/').filter(Boolean).pop() ?? '', 80);
      if (href && label && !out.some((row) => row.url === href)) out.push({ text: label, url: href });
    } catch {
      /* skip */
    }
    if (out.length >= 200) break;
  }
  return out;
}

export function companyPageFromTinyfish(page: TinyfishPage): CompanyPage | null {
  const url = publicUrl(page.url);
  if (!url || !page.text || looksBlockedPage(page.text, page.title)) return null;
  const fromApi = page.links
    .map((href) => {
      try {
        const abs = publicUrl(new URL(href, url).toString());
        const label = clean(href.split('/').filter(Boolean).pop() ?? href, 80);
        return abs && label ? { text: label, url: abs } : null;
      } catch {
        return null;
      }
    })
    .filter((row): row is { text: string; url: string } => Boolean(row));
  const links = fromApi.length ? fromApi : linksFromMarkdown(page.text, url);
  const text = page.text.slice(0, 140_000);
  return {
    url,
    title: clean(page.title, 100),
    text,
    html: text,
    links,
    feeds: extractAlternateFeeds(page.text, url),
  };
}

async function fetchViaTinyfish(urls: string[], ctx: FetchCtx | undefined): Promise<CompanyPage[]> {
  if (!ctx?.tinyfish || ctx.left.n <= 0) return [];
  const want = [...new Set(urls.map((url) => publicUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, Math.min(10, ctx.left.n));
  if (!want.length) return [];
  ctx.left.n -= want.length;
  ctx.used += want.length;
  const pages = await tinyfishFetch(want, ctx.tinyfish.key, ctx.tinyfish.meter).catch(() => []);
  return pages.map(companyPageFromTinyfish).filter((page): page is CompanyPage => Boolean(page));
}

export async function readCompanyPage(siteUrl: string, blocked?: string[]): Promise<CompanyPage | null> {
  const fetched = await fetchText(siteUrl, 2_500_000, ['text/html', 'application/xhtml', 'text/xml', 'application/xml'], blocked);
  if (!fetched) return null;
  const html = fetched.text.slice(0, 1_800_000);
  const base = fetched.url;
  const abs = (href: string | null) => {
    try {
      return href ? publicUrl(new URL(href, base).toString()) : null;
    } catch {
      return null;
    }
  };
  const links: CompanyPage['links'] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = abs(/href=["']([^"']+)["']/i.exec(match[1])?.[1] ?? null);
    const text = clean(match[2].replace(/<[^>]+>/g, ' '), 80);
    if (href && text && !links.some((l) => l.url === href)) links.push({ text, url: href });
    if (links.length >= 400) break;
  }
  const headings = (html.match(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi) ?? [])
    .map((tag) => `# ${clean(tag.replace(/<[^>]+>/g, ' '), 80)}`)
    .filter(Boolean)
    .join('\n');
  const rawText = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const dated = (rawText.match(/(?:^|\n).{0,40}20\d\d[-/.]\d{1,2}.{0,100}/g) ?? []).join('\n');
  const text = `${headings}\n${dated}\n${rawText}`.slice(0, 140_000);
  return {
    url: base,
    title: clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 100),
    text,
    html,
    links,
    feeds: extractAlternateFeeds(html, base),
  };
}

function sameRegistrable(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = a.split('.').slice(-2).join('.');
  const right = b.split('.').slice(-2).join('.');
  return left.length >= 3 && left === right;
}

async function pagesForCompany(
  site: string,
  year: number,
  product: string | null,
  ctx?: FetchCtx,
): Promise<{ found: Found[]; feeds: string[]; extraHosts: string[]; tinyfish: boolean }> {
  const base = publicUrl(site);
  if (!base) return { found: [], feeds: [], extraHosts: [], tinyfish: false };
  const root = base.replace(/\/+$/, '');
  const changelogFirst = (path: string) => /changelog|releases?|updates?|whats-new/i.test(path);
  const roots = [
    `${root}/`,
    ...productPaths(product).map((path) => `${root}${path}`),
    ...COMPANY_PATHS.filter(changelogFirst).map((path) => `${root}${path}`),
    ...COMPANY_PATHS.filter((path) => !changelogFirst(path)).map((path) => `${root}${path}`),
    ...extraResearchPaths(base),
  ];
  const unique = [...new Set(roots)].slice(0, 36);
  const fetched = new Set(unique.map((url) => url.replace(/\/+$/, '')));
  const pages = await mapLimit(unique, 8, (url) => readCompanyPage(url, ctx?.blocked));
  const found: Found[] = [];
  const feeds: string[] = [];
  const extraHosts: string[] = [];
  const follow: string[] = [];
  let usedTinyfish = false;
  const apex = hostOf(base);
  const absorb = (page: CompanyPage | null) => {
    if (!page) return;
    const extracted = itemsFromCompanyPage({ text: page.text, html: page.html, url: page.url, year, links: page.links });
    found.push(...extracted.map(asFound));
    found.push(
      ...itemsFromProjectList({ text: `${page.title}\n${page.text}`, url: page.url, year }).map((item) => ({
        ...item,
        source: item.source === 'site' ? 'changelog' : item.source,
      })),
    );
    for (const feed of page.feeds) if (!feeds.includes(feed)) feeds.push(feed);
    for (const link of page.links) {
      const host = hostOf(link.url);
      if (host && sameRegistrable(host, apex) && PREFIX_HOSTS.some((p) => host.startsWith(`${p}.`))) {
        const origin = `https://${host}/`;
        if (!extraHosts.includes(origin)) extraHosts.push(origin);
      }
      if (host && sameRegistrable(host, apex) && isIndexShipPath(link.url)) {
        const next = link.url.replace(/\/+$/, '');
        if (!fetched.has(next) && !follow.includes(next)) follow.push(next);
      }
    }
  };
  for (const page of pages) absorb(page);
  if (!found.length && !feeds.length && ctx?.tinyfish) {
    const priority = unique
      .filter(isPriorityCompanyUrl)
      .sort((a, b) => priorityCompanyScore(a) - priorityCompanyScore(b) || a.length - b.length)
      .slice(0, 10);
    const fallback = await fetchViaTinyfish(priority.length ? priority : unique.slice(0, 6), ctx);
    if (fallback.length) usedTinyfish = true;
    for (const page of fallback) absorb(page);
  }
  if (follow.length) {
    const more = await mapLimit(follow.slice(0, 10), 6, (url) => readCompanyPage(url, ctx?.blocked));
    for (const page of more) absorb(page);
    if (!found.length && ctx?.tinyfish) {
      const extra = await fetchViaTinyfish(follow.filter(isPriorityCompanyUrl).slice(0, 4), ctx);
      if (extra.length) usedTinyfish = true;
      for (const page of extra) absorb(page);
    }
  }
  return { found, feeds, extraHosts, tinyfish: usedTinyfish };
}

function isIndexShipPath(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    return parts.length <= 3 && isShipPath(url) && !/\d{4}\/\d{2}/.test(path);
  } catch {
    return false;
  }
}

async function harvestFeeds(urls: string[], year: number, ctx?: FetchCtx): Promise<Found[]> {
  const unique = [...new Set(urls)].slice(0, 10);
  const pages = await mapLimit(unique, 4, (url) => fetchText(url, 4_000_000, undefined, ctx?.blocked));
  const found: Found[] = [];
  const absorb = (text: string) => found.push(...itemsFromFeedXml(text, year).map(asFound));
  for (const page of pages) {
    if (page) absorb(page.text);
  }
  if (!found.length && ctx?.tinyfish) {
    const fallback = await fetchViaTinyfish(unique.filter(isPriorityCompanyUrl).slice(0, 4), ctx);
    for (const page of fallback) absorb(page.text);
  }
  return found;
}

async function harvestSitemaps(origin: string, year: number, ctx?: FetchCtx): Promise<Found[]> {
  const root = origin.replace(/\/+$/, '');
  const seeds = [`${root}/sitemap.xml`, `${root}/sitemap_index.xml`, `${root}/sitemap-0.xml`];
  const first = await mapLimit(seeds, 3, (url) => fetchText(url, 2_000_000, undefined, ctx?.blocked));
  let xmls = first.filter((page): page is { url: string; text: string } => Boolean(page));
  if (!xmls.length && ctx?.tinyfish) {
    const fallback = await fetchViaTinyfish(seeds, ctx);
    xmls = fallback.map((page) => ({ url: page.url, text: page.text }));
  }
  const children = xmls.flatMap((page) => sitemapChildLocs(page.text));
  const more = children.length ? await mapLimit(children, 3, (url) => fetchText(url, 2_000_000, undefined, ctx?.blocked)) : [];
  return mergeChangelog([...xmls, ...more.filter(Boolean)].map((page) => itemsFromSitemap(page!.text, year))).map(asFound);
}

async function githubOrgShips(org: string, env: SourceEnv, year: number): Promise<Found[]> {
  const login = org.replace(/^@/, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return [];
  const response = await fetch(`https://api.github.com/orgs/${encodeURIComponent(login)}/repos?sort=pushed&per_page=100`, {
    headers: {
      'user-agent': 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)',
      accept: 'application/vnd.github+json',
      ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(7000),
  }).catch(() => null);
  if (!response?.ok) return [];
  const repos = (await response.json().catch(() => [])) as {
    name?: string;
    html_url?: string;
    description?: string;
    pushed_at?: string;
    created_at?: string;
    stargazers_count?: number;
    fork?: boolean;
  }[];
  if (!Array.isArray(repos)) return [];
  const own = repos.filter((repo) => !repo.fork);
  const createdThisYear = own.filter((repo) => typeof repo.created_at === 'string' && repo.created_at.startsWith(String(year)));
  const releaseItems = await githubOrgReleases(login, own, env, year).catch(() => []);
  const repoItems = createdThisYear
    .slice(0, 40)
    .map((repo): Found => {
      const created = typeof repo.created_at === 'string' && repo.created_at.startsWith(String(year));
      return {
        name: clean(repo.name, 60),
        description: clean(repo.description, 140),
        date: created && repo.created_at ? repo.created_at.slice(0, 10) : repo.pushed_at ? repo.pushed_at.slice(0, 10) : null,
        dateConfidence: created ? 'exact' : 'inferred',
        link: publicUrl(repo.html_url),
        icon: null,
        source: 'company',
        status: 'SHIPPED',
        score: 4 + Math.log10(1 + (repo.stargazers_count ?? 0)),
        thisYear: true,
      };
    })
    .filter((item) => item.name && item.link);
  return [...releaseItems, ...repoItems];
}

async function githubOrgReleases(
  org: string,
  repos: { name?: string; stargazers_count?: number }[],
  env: SourceEnv,
  year: number,
): Promise<Found[]> {
  const targets = [...repos]
    .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
    .map((repo) => repo.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 20);
  const pages = await Promise.all(
    targets.map((name) =>
      fetch(`https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}/releases?per_page=15`, {
        headers: {
          'user-agent': 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)',
          accept: 'application/vnd.github+json',
          ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(7000),
      })
        .then(async (response) =>
          response.ok ? ((await response.json()) as { name?: string; tag_name?: string; html_url?: string; published_at?: string; body?: string }[]) : [],
        )
        .catch(() => [] as { name?: string; tag_name?: string; html_url?: string; published_at?: string; body?: string }[]),
    ),
  );
  const found: Found[] = [];
  for (const releases of pages) {
    if (!Array.isArray(releases)) continue;
    for (const release of releases) {
      const published = typeof release.published_at === 'string' ? release.published_at : '';
      if (!published.startsWith(String(year))) continue;
      const name = clean(release.name || release.tag_name, 60);
      const link = publicUrl(release.html_url);
      if (!name || !link) continue;
      found.push({
        name,
        description: clean(release.body, 140),
        date: published.slice(0, 10),
        dateConfidence: 'exact',
        link,
        icon: null,
        source: 'company',
        status: 'RELEASED',
        score: 7,
        thisYear: true,
      });
    }
  }
  return found;
}

async function appStoreCompanyShips(company: string, year: number): Promise<Found[]> {
  const term = company.replace(/[^A-Za-z0-9 .+-]/g, ' ').trim();
  if (term.length < 2) return [];
  const urls = [
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&attribute=softwareDeveloper&limit=25&country=us`,
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=12&country=us`,
  ];
  const pages = await Promise.all(
    urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'user-agent': UA } })
        .then((response) => (response.ok ? (response.json() as Promise<{ results?: Record<string, unknown>[] }>) : { results: [] }))
        .catch(() => ({ results: [] })),
    ),
  );
  const want = term.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const apps = pages.flatMap((page) => page.results ?? []).filter((app) => {
    const artist = String(app.artistName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const seller = String(app.sellerName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return artist.includes(want) || seller.includes(want) || want.includes(artist) && artist.length >= 4;
  });
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const app of apps) {
    const released = typeof app.releaseDate === 'string' && app.releaseDate.startsWith(String(year)) ? app.releaseDate.slice(0, 10) : null;
    const updated =
      typeof app.currentVersionReleaseDate === 'string' && app.currentVersionReleaseDate.startsWith(String(year))
        ? app.currentVersionReleaseDate.slice(0, 10)
        : null;
    const date = updated || released;
    if (!date) continue;
    const name = clean(String(app.trackName ?? ''), 60);
    const version = clean(String(app.version ?? ''), 16);
    const label = version ? `${name} ${version}` : name;
    const link = publicUrl(String(app.trackViewUrl ?? '').split('?')[0]);
    const key = label.toLowerCase();
    if (!label || !link || seen.has(key)) continue;
    seen.add(key);
    found.push({
      name: label,
      description: clean(String(app.description ?? '').split(/[.\n]/)[0], 140) || `${name} on the App Store`,
      date,
      dateConfidence: 'exact',
      link,
      icon: publicUrl(String(app.artworkUrl100 ?? '')),
      source: 'company',
      status: 'RELEASED',
      score: 6,
      thisYear: true,
    });
  }
  const history = await Promise.all(
    apps.slice(0, 4).map((app) => appStoreVersionHistory(Number(app.trackId), String(app.trackName ?? ''), year)),
  );
  for (const rows of history) found.push(...rows);
  return found;
}

async function appStoreVersionHistory(trackId: number, appName: string, year: number): Promise<Found[]> {
  if (!Number.isFinite(trackId) || trackId <= 0) return [];
  const page = await fetchText(`https://apps.apple.com/us/app/id${trackId}`, 600_000, ['text/html', 'application/xhtml']);
  if (!page) return [];
  const found: Found[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`(?:Version|Ver)\\s+([0-9][0-9A-Za-z.-]{0,16}).{0,80}(${year}[-/]\\d{1,2}[-/]\\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+${year})`, 'gi');
  const { parseFlexibleDate } = await import('./shipped-changelog');
  for (const match of page.text.matchAll(re)) {
    const date = parseFlexibleDate(match[2], year);
    const name = clean(`${appName} ${match[1]}`, 60);
    if (!date || !name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    found.push({
      name,
      description: `${appName} App Store version history`,
      date,
      dateConfidence: 'exact',
      link: publicUrl(page.url),
      icon: null,
      source: 'company',
      status: 'RELEASED',
      score: 6,
      thisYear: true,
    });
  }
  return found.slice(0, 12);
}

function scopeFilter(affiliation: Affiliation, found: Found[]): Found[] {
  if (companyScope(affiliation) !== 'product' || !affiliation.product) return found;
  const tokens = leadProductTokens(affiliation.product, affiliation.company).map((t) => t.toLowerCase());
  if (!tokens.length) return found;
  return found.filter((item) => {
    const hay = `${item.name} ${item.description} ${item.link ?? ''}`.toLowerCase();
    return tokens.some((token) => hay.includes(token));
  });
}

export async function harvestCompany(opts: {
  affiliation: Affiliation;
  year: number;
  env: CompanyEnv;
  /** Paid full run: company X search is included and cached separately. */
  deep?: boolean;
  /** Free gap-fill: company X only after first-party sources, and only if those were thin. */
  gapFillX?: boolean;
  /** When first-party hosts block Worker IPs, TinyFish Fetch reads changelog/blog/news pages. */
  tinyfish?: TinyfishAccess;
  /** Off-worker lists written by the company-cache GitHub Action (D1/R2). */
  store?: CompanyStore;
  /** Ignore isolate + off-worker caches (Actions rebuild). */
  rebuild?: boolean;
  /** Extra first-party hosts from the seed list (docs/learn/developers). */
  extraSites?: string[];
  /** First-paint path: D1/R2 only, never a live crawl. */
  storeOnly?: boolean;
}): Promise<CompanyHarvest> {
  const { affiliation, year, env } = opts;
  const slug = companySlug(affiliation.company);
  if (!slug || companyScope(affiliation) === 'none') {
    return { found: [], spend: emptyXaiSpend(), ran: [], cacheHit: false };
  }
  const via = viaFor(affiliation);
  // Always prefer the off-worker list. `rebuild` only skips the isolate cache so
  // Actions can harvest live; Worker reprints still need the D1/R2 tape.
  if (opts.store) {
    const off = await opts.store.get(year, slug);
    if (off) {
      const scoped = scopeFilter(affiliation, stripVia(off.found));
      if (scoped.length || companyScope(affiliation) === 'all') {
        return {
          found: withVia(scoped, via),
          spend: emptyXaiSpend(),
          ran: ['company-offworker', ...off.ran.slice(0, 8)],
          cacheHit: true,
        };
      }
    }
  }
  if (opts.storeOnly) {
    return { found: [], spend: emptyXaiSpend(), ran: ['company-store-miss'], cacheHit: false };
  }
  const cacheKey = opts.deep ? `company:deep:v13:${year}:${slug}` : `company:v15:${year}:${slug}`;
  const load = async (): Promise<CompanyHarvest> => {
    const via = viaFor(affiliation);
    const ran: string[] = [];
    const found: Found[] = [];
    const spend = emptyXaiSpend();
    const ctx: FetchCtx = {
      tinyfish: opts.tinyfish ?? null,
      left: { n: TINYFISH_COMPANY_CAP },
      used: 0,
      blocked: [],
    };
    const seeds = [
      affiliation.companySite,
      ...(opts.extraSites ?? []),
      ...hostGuesses(affiliation.company ?? ''),
      ...hostGuesses(affiliation.product ?? ''),
    ].filter((u): u is string => Boolean(u));
    const seenHost = new Set<string>();
    const liveOrigins: string[] = [];
    const feeds: string[] = [];

    const discoveredHosts: string[] = [];
    const takePages = async (site: string, tag: string) => {
      const host = hostOf(site);
      if (!host || seenHost.has(host)) return false;
      const pageItems = await pagesForCompany(site, year, affiliation.product, ctx);
      if (!pageItems.found.length && !pageItems.feeds.length && !pageItems.extraHosts.length) return false;
      seenHost.add(host);
      liveOrigins.push(site);
      found.push(...withVia(pageItems.found, via));
      for (const feed of pageItems.feeds) if (!feeds.includes(feed)) feeds.push(feed);
      for (const extra of pageItems.extraHosts) {
        if (!discoveredHosts.includes(extra)) discoveredHosts.push(extra);
      }
      ran.push(`${tag}:${host}`);
      if (pageItems.tinyfish) ran.push(`company-tinyfish:${host}`);
      return true;
    };

    const firstSeeds = seeds.slice(0, 6);
    const prefixed = firstSeeds[0] ? prefixHosts(firstSeeds[0]) : [];
    await Promise.all([...prefixed, ...firstSeeds].map((site) => takePages(site, 'company-site')));
    await Promise.all(discoveredHosts.map((extra) => takePages(extra, 'company-site')));

    await Promise.all(
      liveOrigins.slice(0, 4).map(async (origin) => {
        for (const path of FEED_PATHS) feeds.push(`${origin.replace(/\/+$/, '')}${path}`);
        const sitemapItems = await harvestSitemaps(origin, year, ctx).catch(() => []);
        if (sitemapItems.length) {
          found.push(...withVia(sitemapItems, via));
          ran.push(`company-sitemap:${hostOf(origin)}`);
        }
      }),
    );
    const feedItems = await harvestFeeds(feeds, year, ctx).catch(() => []);
    if (feedItems.length) {
      found.push(...withVia(feedItems, via));
      ran.push('company-feeds');
    }

    if (ctx?.tinyfish && found.length < 12) {
      const apex = hostOf(liveOrigins[0] || firstSeeds[0] || '');
      const queries = [
        apex ? `site:${apex} (changelog OR "release notes") ${year}` : '',
        affiliation.product
          ? `"${affiliation.product}" changelog OR "what's new" ${year}`
          : affiliation.company
            ? `"${affiliation.company}" changelog OR "release notes" ${year}`
            : '',
      ].filter(Boolean);
      for (const query of queries.slice(0, 2)) {
        const hits = await tinyfishSearch(query, year, ctx.tinyfish.key, ctx.tinyfish.meter).catch(() => []);
        const urls = [
          ...new Set(
            hits
              .map((hit) => publicUrl(hit.url))
              .filter((url): url is string => Boolean(url) && (isPriorityCompanyUrl(url) || /changelog|releases?|whats-new|docs\//i.test(url)))
              .flatMap((url) => {
                const out = [url];
                try {
                  const parsed = new URL(url);
                  if (/^(developers|docs|learn|platform)\./i.test(parsed.hostname) && !/changelog/i.test(parsed.pathname)) {
                    out.push(`${parsed.origin}/docs/changelog`, `${parsed.origin}/changelog`);
                  }
                } catch {
                  /* skip */
                }
                return out;
              }),
          ),
        ].slice(0, 10);
        if (!urls.length) continue;
        ran.push(`company-tinyfish-search:${urls.length}`);
        const absorbPage = (page: CompanyPage) => {
          const extracted = itemsFromCompanyPage({
            text: page.text,
            html: page.html,
            url: page.url,
            year,
            links: page.links,
          });
          found.push(...withVia(extracted.map(asFound), via));
          found.push(
            ...itemsFromProjectList({ text: `${page.title}\n${page.text}`, url: page.url, year }).map((item) => ({
              ...item,
              source: item.source === 'site' ? 'changelog' : item.source,
              via: via ?? item.via ?? null,
            })),
          );
        };
        // Prefer a direct HTML read: TinyFish markdown is short, and docs hosts like learn.* often allow Worker fetches.
        const missing: string[] = [];
        for (const url of urls) {
          const htmlPage = await readCompanyPage(url, ctx?.blocked);
          if (htmlPage) absorbPage(htmlPage);
          else missing.push(url);
        }
        if (missing.length) {
          for (const page of await fetchViaTinyfish(missing, ctx)) absorbPage(page);
        }
      }
    }

    const org = affiliation.companyGithub || companyOrgGuess(affiliation.company) || slug;
    const orgItems = await githubOrgShips(org, env, year).catch(() => []);
    if (orgItems.length) {
      found.push(...withVia(orgItems, via));
      ran.push(`company-github:${org}`);
    }

    const storeItems = await appStoreCompanyShips(affiliation.company ?? slug, year).catch(() => []);
    if (storeItems.length) {
      found.push(...withVia(storeItems, via));
      ran.push('company-appstore');
    }

    const firstParty = found.length;
    ran.push(`company-first-party:${firstParty}`);

    const wantCompanyX = Boolean(affiliation.companyX) && (opts.deep || (opts.gapFillX && firstParty < 8));
    if (wantCompanyX && affiliation.companyX) {
      try {
        const { searchXShips } = await import('./shipped-xai');
        const companyX = await searchXShips({
          env,
          year,
          handles: [affiliation.companyX],
          who: affiliation.company || affiliation.companyX,
          company: affiliation.company,
          kind: 'company',
          deep: Boolean(opts.deep),
        });
        if (companyX.found.length) {
          found.push(...withVia(companyX.found, via));
          ran.push(`company-x:${affiliation.companyX}`);
        }
        Object.assign(spend, {
          inputTokens: spend.inputTokens + companyX.spend.inputTokens,
          outputTokens: spend.outputTokens + companyX.spend.outputTokens,
          posts: spend.posts + companyX.spend.posts,
          profiles: spend.profiles + companyX.spend.profiles,
          web: spend.web + companyX.spend.web,
          ticks: spend.ticks + companyX.spend.ticks,
          costMicros: spend.costMicros + companyX.spend.costMicros,
        });
      } catch {
        ran.push('company-x:miss');
      }
    } else if (affiliation.companyX && firstParty >= 8) {
      ran.push('company-x:skipped-first-party');
    }

    if (ctx.used) ran.push(`company-tinyfish-urls:${ctx.used}`);

    if (found.length < 12 && ctx.blocked.length) {
      try {
        const { browseShipPage, xaiConfigured } = await import('./shipped-xai');
        if (xaiConfigured(env)) {
          const blockedChangelogs = [...new Set(ctx.blocked.filter((url) => /changelog|releases?|whats-new|docs\//i.test(url)))].slice(0, 3);
          for (const url of blockedChangelogs) {
            const browsed = await browseShipPage({ env, url, year, who: affiliation.company || slug });
            if (browsed.found.length) {
              found.push(...withVia(browsed.found, via));
              ran.push(`company-xai-browse:${hostOf(url)}`);
            }
            Object.assign(spend, {
              inputTokens: spend.inputTokens + browsed.spend.inputTokens,
              outputTokens: spend.outputTokens + browsed.spend.outputTokens,
              posts: spend.posts + browsed.spend.posts,
              profiles: spend.profiles + browsed.spend.profiles,
              web: spend.web + browsed.spend.web,
              ticks: spend.ticks + browsed.spend.ticks,
              costMicros: spend.costMicros + browsed.spend.costMicros,
            });
          }
        }
      } catch {
        ran.push('company-xai-browse:miss');
      }
    }

    return { found: compactCompanyFound(found), spend, ran, cacheHit: false };
  };
  const harvested = opts.rebuild
    ? await load()
    : await cached(cacheKey, 7 * 1440 * MIN, load, (harvest) => harvest.found.length > 0);

  if (!opts.rebuild && opts.store && harvested.found.length < 8) {
    const fresh = await opts.store
      .queue({
        slug,
        company: affiliation.company || slug,
        product: affiliation.product,
        site: affiliation.companySite || opts.extraSites?.[0] || null,
      })
      .catch(() => false);
    if (fresh) await opts.store.dispatch?.(slug).catch(() => undefined);
    ranNote(harvested, 'company-queued');
  }

  return { ...harvested, found: scopeFilter(affiliation, harvested.found) };
}

function ranNote(harvest: CompanyHarvest, note: string) {
  if (!harvest.ran.includes(note)) harvest.ran.push(note);
}
