// Resolve a builder's OWN products from public surfaces (X bio/URL, personal site,
// GitHub profile/orgs/pins). No per-person alias tables. First-party changelogs,
// release notes, launch posts and GitHub releases for those products count as ships.
import type { Affiliation } from './shipped-affiliation';
import { FEED_PATHS, itemsFromCompanyPage, itemsFromFeedXml, type ChangelogFound } from './shipped-changelog';
import { safeFetch } from './shipped-fetch';
import {
  PROFILE_HOSTS,
  cleanText,
  githubReposFromText,
  hostOf,
  productHostGuesses,
  productNameFromHost,
  urlsFromText,
} from './shipped-identity';

export type OwnProduct = {
  name: string;
  site?: string | null;
  github?: { owner: string; name: string } | null;
};

const SKIP_NAME =
  /^(the|and|for|with|from|into|about|over|after|before|that|this|your|our|my|new|all|life|work|code|app|apps|site|blog|home|here|now|ai|ml|api|sdk|cli|ios|web|dev|inc|llc|labs?|hq|studio|official|personal|portfolio|twitter|github|linkedin|youtube|instagram|newsletter|podcast|community|discord|slack|open|source|software|engineer|designer|founder|ceo|lead|head|director|advocate|vercel|openai|cursor|anthropic|anysphere)$/i;

const EMPLOYER_PLATFORM = /^(vercel|openai|cursor|anthropic|anysphere)$/i;

const MADE_OF =
  /\b(?:maker|creator|founder|co-?founder|author|building|built|maker of|behind)\s+(?:of|at|for|@)?\s*([A-Z][A-Za-z0-9.+ -]{1,40})/gi;

const TITLE_CASE_CHUNK = /\b([A-Z][A-Za-z0-9.+-]{1,24}(?:\s+(?:AI|OS|OK|HQ|Pro|App|Kit|Lab|CLI|API|SDK))?(?:\s+[A-Z][A-Za-z0-9.+-]{1,20}){0,2})\b/g;

function loose(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function prettyProduct(raw: string): string {
  const text = cleanText(raw, 40).replace(/[.,;:]+$/g, '').trim();
  if (text.length < 2 || SKIP_NAME.test(text)) return '';
  if (EMPLOYER_PLATFORM.test(loose(text))) return '';
  return text;
}

export function isEmployerPlatform(name: string | null | undefined): boolean {
  const slug = String(name || '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return EMPLOYER_PLATFORM.test(slug);
}

/** Employer npm / company-rollup lines. CEO/founder/lead of THAT brand keep them. */
export function isEmployerSpill(
  item: { name?: string; link?: string | null; source?: string },
  affiliation?: Pick<Affiliation, 'role' | 'company' | 'product'> | null,
): boolean {
  const name = String(item.name || '');
  const link = String(item.link || '');
  const hay = `${name} ${link}`.toLowerCase();
  let brand: string | null = null;
  if (/^vercel\b/i.test(name) || /(?:^|\/)(@vercel\/|package\/next(?:js)?(?:\/|$)|package\/turbo)/i.test(link)) brand = 'vercel';
  else if (/^next\.?js\b/i.test(name) && /npmjs\.com|vercel\.com/i.test(link)) brand = 'vercel';
  else if (/^openai\b/i.test(name) && /openai\.com|npmjs\.com\/package\/openai/i.test(link)) brand = 'openai';
  else if (/^(cursor|anysphere)\b/i.test(name) && /cursor\.com|anysphere/i.test(link)) brand = 'cursor';
  if (!brand) return false;
  const rollup = /·\s*\d+\s+(updates?|releases?)/i.test(name);
  const numbered = new RegExp(`^${brand}\\s+\\d+\\.\\d+`, 'i').test(name);
  const npmDump = item.source === 'npm' && new RegExp(`(@${brand}\\/|^${brand}$|^next$|^turbo$)`, 'i').test(name);
  if (!rollup && !numbered && !npmDump) return false;
  const company = loose(affiliation?.company || '');
  const role = affiliation?.role;
  const owns = (role === 'ceo' || role === 'founder' || role === 'lead') && company.includes(brand);
  return !owns;
}

function addProduct(out: OwnProduct[], next: OwnProduct): void {
  const key = loose(next.name);
  if (key.length < 2) return;
  const existing = out.find((row) => loose(row.name) === key || (next.site && row.site && hostOf(row.site) === hostOf(next.site)));
  if (existing) {
    existing.site ||= next.site;
    existing.github ||= next.github;
    return;
  }
  out.push(next);
}

export function productsFromBio(bio: string): OwnProduct[] {
  const text = cleanText(bio, 400);
  if (!text) return [];
  const out: OwnProduct[] = [];
  for (const match of text.matchAll(MADE_OF)) {
    const name = prettyProduct(match[1] || '');
    if (name) addProduct(out, { name });
  }
  for (const url of urlsFromText(text)) {
    const host = hostOf(url);
    if (!host || PROFILE_HOSTS.test(host)) continue;
    const name = prettyProduct(productNameFromHost(host));
    if (name) addProduct(out, { name, site: url });
  }
  for (const repo of githubReposFromText(text)) {
    const name = prettyProduct(repo.name.replace(/[-_]+/g, ' '));
    if (name) addProduct(out, { name, github: repo });
  }
  for (const match of text.matchAll(TITLE_CASE_CHUNK)) {
    const name = prettyProduct(match[1] || '');
    if (!name || name.split(/\s+/).length > 3) continue;
    if (SKIP_NAME.test(name.split(/\s+/)[0] || '')) continue;
    addProduct(out, { name });
  }
  return out.slice(0, 8);
}

export function productsFromUrls(urls: (string | null | undefined)[]): OwnProduct[] {
  const out: OwnProduct[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    const host = hostOf(raw);
    if (!host || PROFILE_HOSTS.test(host)) continue;
    const name = prettyProduct(productNameFromHost(host));
    if (name) addProduct(out, { name, site: raw });
  }
  return out.slice(0, 8);
}

/** Pinned repos on a GitHub profile HTML page. */
export function pinnedReposFromHtml(html: string): { owner: string; name: string }[] {
  const out: { owner: string; name: string }[] = [];
  const seen = new Set<string>();
  const add = (owner: string, name: string) => {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) return;
    if (/^(sponsors|issues|pulls|settings|marketplace|topics|orgs|apps)$/i.test(name)) return;
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ owner, name });
  };
  const block =
    html.match(/pinned-items-list[\s\S]{0,12000}?(?:<\/ol>|<\/ul>|js-pinned-items-reorder-container)/i)?.[0] ||
    html.match(/js-pinned-items-reorder-container[\s\S]{0,12000}?(?:<\/ol>|<\/div>\s*<\/div>)/i)?.[0] ||
    '';
  const hay = block || html;
  for (const match of hay.matchAll(/pinned-item-list-item[\s\S]{0,500}?href="\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)"/gi)) {
    add(match[1], match[2].replace(/\.git$/i, ''));
  }
  for (const match of hay.matchAll(/href="\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)"[^>]*class="[^"]*(?:Link|text-bold|mr-1)[^"]*"/gi)) {
    add(match[1], match[2].replace(/\.git$/i, ''));
  }
  if (!out.length) {
    for (const match of html.matchAll(/itemprop="owns"[\s\S]{0,400}?href="\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)"/gi)) {
      add(match[1], match[2].replace(/\.git$/i, ''));
    }
  }
  return out.slice(0, 8);
}

export function productsFromSurfaces(opts: {
  bio?: string | null;
  urls?: (string | null | undefined)[];
  orgs?: string[] | null;
  pins?: { owner: string; name: string }[] | null;
  github?: string | null;
}): OwnProduct[] {
  const out: OwnProduct[] = [];
  for (const row of productsFromBio(opts.bio || '')) addProduct(out, row);
  for (const row of productsFromUrls(opts.urls || [])) addProduct(out, row);
  for (const pin of opts.pins || []) {
    const name = prettyProduct(pin.name.replace(/[-_]+/g, ' ')) || pin.name;
    addProduct(out, { name, github: pin, site: productHostGuesses(name)[0] ?? null });
  }
  const login = (opts.github || '').replace(/^@/, '');
  for (const org of opts.orgs || []) {
    const slug = org.replace(/^@/, '');
    if (!slug || isEmployerPlatform(slug)) continue;
    const name = prettyProduct(slug.replace(/[-_]+/g, ' ')) || slug;
    addProduct(out, { name, github: login ? { owner: slug, name: slug } : { owner: slug, name: slug } });
  }
  return out.slice(0, 8);
}

const PRODUCT_PATHS = ['/changelog', '/releases', '/whats-new', '/release-notes', '/updates', ...FEED_PATHS.slice(0, 8)];

async function readText(url: string): Promise<string | null> {
  try {
    const response = await safeFetch(url, {
      accept: 'text/html, application/rss+xml, application/atom+xml, text/xml, */*',
      timeoutMs: 4500,
      maxBytes: 400_000,
    });
    return new TextDecoder('utf-8').decode(response.bytes);
  } catch {
    return null;
  }
}

function asFound(row: ChangelogFound): ChangelogFound {
  return { ...row, source: row.source === 'site' ? 'changelog' : row.source };
}

/** First-party changelog / RSS / release notes for the builder's own products. */
export async function harvestOwnProductSites(products: OwnProduct[], year: number): Promise<ChangelogFound[]> {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const targets = products
    .map((product) => {
      const site = product.site || productHostGuesses(product.name)[0] || null;
      return site ? { product, site } : null;
    })
    .filter((row): row is { product: OwnProduct; site: string } => Boolean(row))
    .slice(0, 4);

  await Promise.all(
    targets.map(async ({ product, site }) => {
      let origin = '';
      try {
        origin = new URL(site).origin;
      } catch {
        return;
      }
      const urls = [...new Set(PRODUCT_PATHS.map((path) => `${origin}${path}`))].slice(0, 4);
      const pages = await Promise.all(urls.map((url) => readText(url)));
      for (let i = 0; i < pages.length; i++) {
        const html = pages[i];
        const url = urls[i]!;
        if (!html) continue;
        const rows = /<item\b|<entry\b/i.test(html)
          ? itemsFromFeedXml(html, year)
          : itemsFromCompanyPage({ text: html, html, url, year });
        for (const row of rows) {
          const key = `${loose(row.name)}|${row.link || ''}`;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          found.push({
            ...asFound(row),
            description: row.description || `${product.name} release`,
          });
        }
      }
    }),
  );
  return found.slice(0, 80);
}
