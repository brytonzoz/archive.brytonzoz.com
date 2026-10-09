// Company-wide harvest, cached 24h per company slug so OpenAI / Vercel / Cursor is fetched once
// and shared by every receipt that resolves there. Changelog pages, GitHub org activity, and
// (when XAI_API_KEY is set) the company's X announcements. No per-visitor deep research.
import { extraResearchPaths } from './shipped-research';
import { companyScope, companySlug, type Affiliation } from './shipped-affiliation';
import { type XaiEnv, type XaiSpend, emptyXaiSpend } from './shipped-xai';
import {
  cached,
  clean,
  hostOf,
  publicUrl,
  readSite,
  type Found,
  type SiteInfo,
  type SourceEnv,
} from './shipped-sources';
import { itemsFromProjectList } from './shipped-research';

const MIN = 60;
const COMPANY_PATHS = [
  '/changelog',
  '/blog',
  '/news',
  '/index',
  '/whats-new',
  "/what's-new",
  '/releases',
  '/blog/changelog',
  '/docs/changelog',
  '/research',
  '/product',
];

export type CompanyEnv = SourceEnv & XaiEnv;

export type CompanyHarvest = { found: Found[]; spend: XaiSpend; ran: string[]; cacheHit: boolean };

const hostGuesses = (company: string): string[] => {
  const slug = companySlug(company);
  if (!slug) return [];
  const hyphen = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out: string[] = [];
  for (const tld of ['com', 'ai', 'dev', 'io', 'so']) {
    out.push(`https://${slug}.${tld}/`);
    if (hyphen && hyphen !== slug) out.push(`https://${hyphen}.${tld}/`);
  }
  return out.slice(0, 6);
};

function viaFor(affiliation: Affiliation): string {
  return affiliation.product ? `via ${affiliation.company} · ${affiliation.product}` : `via ${affiliation.company}`;
}

function withVia(items: Found[], via: string): Found[] {
  return items.map((item) => ({ ...item, via: item.via ?? via, source: item.source === 'site' || item.source === 'web' ? 'changelog' : item.source }));
}

function itemsFromNewsLinks(page: SiteInfo, year: number): Found[] {
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const link of page.links ?? []) {
    const hay = `${link.text} ${link.url}`;
    if (!hay.includes(String(year)) && !/\/(changelog|releases?|whats-new|news|blog|index)\//i.test(link.url)) continue;
    if (/\/(about|careers?|jobs|login|privacy|terms|legal|pricing)\b/i.test(link.url)) continue;
    const name = clean(link.text, 48);
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!name || key.length < 3 || seen.has(key)) continue;
    if (/^(home|about|blog|news|changelog|careers?|sign in|log in)$/i.test(name)) continue;
    seen.add(key);
    found.push({
      name,
      description: clean(`${name} on ${hostOf(page.url) ?? 'their site'}`, 140),
      date: null,
      dateConfidence: hay.includes(String(year)) ? 'year' : 'unknown',
      link: publicUrl(link.url),
      icon: null,
      source: 'changelog',
      status: 'LAUNCHED',
      score: hay.includes(String(year)) ? 6 : 4,
      thisYear: hay.includes(String(year)),
    });
  }
  return found;
}

async function pagesForCompany(site: string, year: number): Promise<Found[]> {
  const base = publicUrl(site);
  if (!base) return [];
  const roots = [base, ...COMPANY_PATHS.map((path) => `${base.replace(/\/+$/, '')}${path}`), ...extraResearchPaths(base)].slice(0, 10);
  const pages = await Promise.all(roots.map((url) => readSite(url).catch(() => null)));
  const found: Found[] = [];
  for (const page of pages) {
    if (!page) continue;
    found.push(...itemsFromProjectList({ text: `${page.title}\n${page.description}\n${page.text}`, url: page.url, year }));
    found.push(...itemsFromNewsLinks(page, year));
  }
  return found;
}

async function githubOrgShips(org: string, env: SourceEnv, year: number): Promise<Found[]> {
  if (!env.GITHUB_TOKEN && !org) return [];
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
  repos: { name?: string }[],
  env: SourceEnv,
  year: number,
): Promise<Found[]> {
  const targets = repos.map((repo) => repo.name).filter((name): name is string => Boolean(name)).slice(0, 8);
  const pages = await Promise.all(
    targets.map((name) =>
      fetch(`https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}/releases?per_page=6`, {
        headers: {
          'user-agent': 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)',
          accept: 'application/vnd.github+json',
          ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(7000),
      })
        .then(async (response) => (response.ok ? ((await response.json()) as { name?: string; tag_name?: string; html_url?: string; published_at?: string; body?: string }[]) : []))
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

export async function harvestCompany(opts: {
  affiliation: Affiliation;
  year: number;
  env: CompanyEnv;
  /** Paid full run: company X search is included and cached separately. */
  deep?: boolean;
}): Promise<CompanyHarvest> {
  const { affiliation, year, env } = opts;
  const slug = companySlug(affiliation.company);
  if (!slug || companyScope(affiliation.role) === 'none') {
    return { found: [], spend: emptyXaiSpend(), ran: [], cacheHit: false };
  }
  // Company lists are shared for 7 days. Deep harvests (with company X) use their own key.
  const cacheKey = opts.deep ? `company:deep:v1:${year}:${slug}` : `company:v3:${year}:${slug}`;
  return cached(cacheKey, 7 * 1440 * MIN, async () => {
    const via = viaFor(affiliation);
    const ran: string[] = [];
    const found: Found[] = [];
    const spend = emptyXaiSpend();
    const sites = [affiliation.companySite, ...hostGuesses(affiliation.company ?? '')].filter((u): u is string => Boolean(u));
    const seenHost = new Set<string>();
    for (const site of sites.slice(0, 5)) {
      const host = hostOf(site);
      if (!host || seenHost.has(host)) continue;
      seenHost.add(host);
      const pageItems = await pagesForCompany(site, year);
      if (pageItems.length) {
        found.push(...withVia(pageItems, via));
        ran.push(`company-site:${host}`);
        if (pageItems.length >= 3) break;
      }
    }
    const org = affiliation.companyGithub || slug;
    const orgItems = await githubOrgShips(org, env, year).catch(() => []);
    if (orgItems.length) {
      found.push(...withVia(orgItems, via));
      ran.push(`company-github:${org}`);
    }
    if (opts.deep && affiliation.companyX) {
      try {
        const { searchXShips } = await import('./shipped-xai');
        const companyX = await searchXShips({
          env,
          year,
          handles: [affiliation.companyX],
          who: affiliation.company || affiliation.companyX,
          company: affiliation.company,
          kind: 'company',
          deep: true,
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
    }
    const scoped =
      companyScope(affiliation.role) === 'product' && affiliation.product
        ? found.filter((item) => {
            const hay = `${item.name} ${item.description} ${item.via ?? ''}`.toLowerCase();
            return hay.includes(affiliation.product!.toLowerCase());
          })
        : found;
    return { found: scoped, spend, ran, cacheHit: false };
  });
}
