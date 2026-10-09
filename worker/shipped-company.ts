// First-party company harvest, cached 7 days per company slug. Discovers changelog / blog / news
// / releases / updates, <link rel=alternate> feeds, sitemap.xml (2026 lastmod), GitHub org
// releases, and App Store version rows. No per-company URL tables.
import { extraResearchPaths, itemsFromProjectList } from './shipped-research';
import { companyOrgGuess, companyScope, companySlug, companyTokens, leadProductTokens, type Affiliation } from './shipped-affiliation';
import { type XaiEnv, type XaiSpend, emptyXaiSpend } from './shipped-xai';
import {
  cached,
  clean,
  hostOf,
  publicUrl,
  type Found,
  type SourceEnv,
} from './shipped-sources';
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

export type CompanyEnv = SourceEnv & XaiEnv;

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
  if (companyScope(affiliation) === 'product' && affiliation.product) {
    return `via ${affiliation.company} · ${affiliation.product}`;
  }
  if (companyScope(affiliation) === 'all') return `via ${affiliation.company}`;
  return null;
}

function withVia(items: Found[], via: string | null): Found[] {
  return items.map((item) => ({
    ...item,
    via: via ? item.via ?? via : item.via ?? null,
    source: item.source === 'site' || item.source === 'web' ? 'changelog' : item.source,
  }));
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

async function fetchText(url: string, maxBytes: number, types?: string[]): Promise<{ url: string; text: string } | null> {
  const safe = publicUrl(url);
  if (!safe) return null;
  const page = await safeFetch(safe, {
    accept: 'text/html, application/xhtml+xml, application/xml, application/rss+xml, application/atom+xml, text/xml, */*',
    maxBytes,
    timeoutMs: 8000,
    types,
    userAgent: UA,
  }).catch(() => null);
  if (!page) return null;
  return { url: page.url || safe, text: new TextDecoder().decode(page.bytes) };
}

export async function readCompanyPage(siteUrl: string): Promise<CompanyPage | null> {
  const fetched = await fetchText(siteUrl, 2_500_000, ['text/html', 'application/xhtml', 'text/xml', 'application/xml']);
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

async function pagesForCompany(site: string, year: number, product: string | null): Promise<{ found: Found[]; feeds: string[]; extraHosts: string[] }> {
  const base = publicUrl(site);
  if (!base) return { found: [], feeds: [], extraHosts: [] };
  const root = base.replace(/\/+$/, '');
  const roots = [
    `${root}/`,
    ...COMPANY_PATHS.map((path) => `${root}${path}`),
    ...productPaths(product).map((path) => `${root}${path}`),
    ...extraResearchPaths(base),
  ];
  const unique = [...new Set(roots)].slice(0, 28);
  const fetched = new Set(unique.map((url) => url.replace(/\/+$/, '')));
  const pages = await mapLimit(unique, 8, (url) => readCompanyPage(url));
  const found: Found[] = [];
  const feeds: string[] = [];
  const extraHosts: string[] = [];
  const follow: string[] = [];
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
  if (follow.length) {
    const more = await mapLimit(follow.slice(0, 10), 6, (url) => readCompanyPage(url));
    for (const page of more) absorb(page);
  }
  return { found, feeds, extraHosts };
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

async function harvestFeeds(urls: string[], year: number): Promise<Found[]> {
  const unique = [...new Set(urls)].slice(0, 10);
  const pages = await mapLimit(unique, 4, (url) => fetchText(url, 4_000_000));
  const found: Found[] = [];
  for (const page of pages) {
    if (!page) continue;
    found.push(...itemsFromFeedXml(page.text, year).map(asFound));
  }
  return found;
}

async function harvestSitemaps(origin: string, year: number): Promise<Found[]> {
  const root = origin.replace(/\/+$/, '');
  const seeds = [`${root}/sitemap.xml`, `${root}/sitemap_index.xml`, `${root}/sitemap-0.xml`];
  const first = await mapLimit(seeds, 3, (url) => fetchText(url, 2_000_000));
  const xmls = first.filter((page): page is { url: string; text: string } => Boolean(page));
  const children = xmls.flatMap((page) => sitemapChildLocs(page.text));
  const more = children.length ? await mapLimit(children, 3, (url) => fetchText(url, 2_000_000)) : [];
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
}): Promise<CompanyHarvest> {
  const { affiliation, year, env } = opts;
  const slug = companySlug(affiliation.company);
  if (!slug || companyScope(affiliation) === 'none') {
    return { found: [], spend: emptyXaiSpend(), ran: [], cacheHit: false };
  }
  const cacheKey = opts.deep ? `company:deep:v5:${year}:${slug}` : `company:v7:${year}:${slug}`;
  return cached(cacheKey, 7 * 1440 * MIN, async () => {
    const via = viaFor(affiliation);
    const ran: string[] = [];
    const found: Found[] = [];
    const spend = emptyXaiSpend();
    const seeds = [
      affiliation.companySite,
      ...hostGuesses(affiliation.company ?? ''),
      ...hostGuesses(affiliation.product ?? ''),
    ].filter((u): u is string => Boolean(u));
    const seenHost = new Set<string>();
    const liveOrigins: string[] = [];
    const feeds: string[] = [];

    for (const site of seeds.slice(0, 6)) {
      const host = hostOf(site);
      if (!host || seenHost.has(host)) continue;
      const pageItems = await pagesForCompany(site, year, affiliation.product);
      if (!pageItems.found.length && !pageItems.feeds.length && !pageItems.extraHosts.length) continue;
      seenHost.add(host);
      liveOrigins.push(site);
      found.push(...withVia(pageItems.found, via));
      for (const feed of pageItems.feeds) if (!feeds.includes(feed)) feeds.push(feed);
      ran.push(`company-site:${host}`);
      for (const extra of pageItems.extraHosts) {
        const extraHost = hostOf(extra);
        if (!extraHost || seenHost.has(extraHost)) continue;
        seenHost.add(extraHost);
        const more = await pagesForCompany(extra, year, affiliation.product);
        if (more.found.length) {
          found.push(...withVia(more.found, via));
          ran.push(`company-site:${extraHost}`);
        }
        for (const feed of more.feeds) if (!feeds.includes(feed)) feeds.push(feed);
      }
      for (const prefixed of prefixHosts(site)) {
        const extraHost = hostOf(prefixed);
        if (!extraHost || seenHost.has(extraHost)) continue;
        const more = await pagesForCompany(prefixed, year, affiliation.product);
        if (!more.found.length && !more.feeds.length) continue;
        seenHost.add(extraHost);
        found.push(...withVia(more.found, via));
        for (const feed of more.feeds) if (!feeds.includes(feed)) feeds.push(feed);
        ran.push(`company-site:${extraHost}`);
      }
    }

    for (const origin of liveOrigins.slice(0, 4)) {
      for (const path of FEED_PATHS) feeds.push(`${origin.replace(/\/+$/, '')}${path}`);
      const sitemapItems = await harvestSitemaps(origin, year).catch(() => []);
      if (sitemapItems.length) {
        found.push(...withVia(sitemapItems, via));
        ran.push(`company-sitemap:${hostOf(origin)}`);
      }
    }
    const feedItems = await harvestFeeds(feeds, year).catch(() => []);
    if (feedItems.length) {
      found.push(...withVia(feedItems, via));
      ran.push('company-feeds');
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

    return { found: scopeFilter(affiliation, found), spend, ran, cacheHit: false };
  });
}
