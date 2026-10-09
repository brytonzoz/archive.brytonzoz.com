// Expand a typed handle or name into the person's public surfaces (X bio, GitHub login that may
// differ, personal/company sites). No secrets. Used by lookup and gather; results are cached 24h
// in shipped-sources `cached()`.
import { isDomain, isGithubLogin, isXHandle } from '../lib/shipped-year';

const UA = 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)';
const TIMEOUT = 6000;

/** Social / profile hosts that are not a shipped product. */
export const PROFILE_HOSTS =
  /(^|\.)(x\.com|twitter\.com|github\.com|gitlab\.com|linkedin\.com|instagram\.com|facebook\.com|tiktok\.com|youtube\.com|reddit\.com|threads\.net|bsky\.app|mastodon\.[a-z.]+|linktr\.ee|bio\.link|carrd\.co|beacons\.ai|stan\.store)$/i;

export type XProfile = {
  handle: string;
  name: string;
  bio: string;
  site: string | null;
  urls: string[];
};

export type NameParts = { name: string; company: string | null; tokens: string[]; product: string | null };

/** X/handle spellings that are not the GitHub login. Keep this list short — only proven mismatches. */
export const HANDLE_ALIASES: Record<string, string[]> = {
  tdinh_me: ['tony-dinh'],
  tibo_maker: ['tibo-maker'],
  dannypostmaa: ['dannypostma'],
  theo: ['t3dotgg'],
  t3dotgg: ['t3dotgg'],
  antfu7: ['antfu'],
  swyx: ['swyxio', 'sw-yx'],
  officiallogank: ['logankilpatrick'],
  alexalbert__: ['alexalbert'],
  jh3yy: ['jh3y'],
  rauno: ['raunofreiberg'],
  mkbhd: ['MKBHD'],
};

/** "the guy who made Photo AI" → the person who ships that product. */
export const PRODUCT_OWNERS: Record<string, string> = {
  photoai: 'levelsio',
  'photo ai': 'levelsio',
  'photo-ai': 'levelsio',
};

export function handleAliases(handle: string): string[] {
  const id = handle.replace(/^@/, '').toLowerCase();
  return HANDLE_ALIASES[id] ?? [];
}

/** Typed "the guy who made Photo AI" / "Photo AI guy" → the product name. */
export function parseProductQuery(text: string): string | null {
  const raw = cleanText(text, 80);
  const made =
    raw.match(/^(?:the\s+)?(?:guy|person|one|dev|developer|maker|creator|dude)\s+who\s+made\s+(.+)$/i) ||
    raw.match(/^who\s+made\s+(.+)$/i) ||
    raw.match(/^(.+?)\s+(?:guy|creator|maker)$/i);
  const product = made ? cleanText(made[1], 60) : null;
  return product && product.length >= 3 ? product : null;
}

export function ownerForProduct(product: string | null | undefined): string | null {
  if (!product) return null;
  return PRODUCT_OWNERS[loose(product)] || PRODUCT_OWNERS[product.toLowerCase()] || null;
}

/** `Tibo` + `OpenAI` → `tibo-openai` / `tiboopenai`. */
export function companyLogins(name: string, company: string | null | undefined): string[] {
  if (!company) return [];
  const n = (name.split(/\s+/)[0] ?? '').replace(/[^A-Za-z0-9-]/g, '').toLowerCase();
  const c = (company.split(/\s+/)[0] ?? '').replace(/[^A-Za-z0-9-]/g, '').toLowerCase();
  if (n.length < 2 || c.length < 2) return [];
  return [`${n}-${c}`, `${n}${c}`, `${n}_${c}`].filter((v) => isGithubLogin(v));
}

const decode = (text: string) =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

function httpsUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 400) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /^[\d.]+$/.test(host)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
};

const loose = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[<>`{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Product-looking https URLs in a bio or page, plus a bare example.com. */
export function urlsFromText(text: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const url = httpsUrl(raw.replace(/[),.;:]+$/, ''));
    if (!url) return;
    const host = hostOf(url);
    if (!host || PROFILE_HOSTS.test(host)) return;
    if (!found.some((u) => hostOf(u) === host)) found.push(url);
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'()]+/gi)) add(match[0]);
  for (const match of text.matchAll(/\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi)) {
    add(match[0]);
  }
  return found.slice(0, 12);
}

export function productNameFromHost(host: string): string {
  const base = host.replace(/^www\./, '').split('.')[0] ?? host;
  return cleanText(base.replace(/[-_]+/g, ' '), 40);
}

/** Typed "Tibo from OpenAI" / "Ada at Vercel" → name + company. Product nicknames stay out of the name. */
export function parsePersonName(text: string): NameParts {
  const product = parseProductQuery(text);
  if (product) return { name: '', company: null, tokens: [], product };
  const raw = cleanText(text, 80);
  const from = raw.match(/^(.+?)\s+(?:from|at|of|@)\s+(.+)$/i);
  const name = cleanText(from?.[1] ?? raw, 60);
  const company = from ? cleanText(from[2], 40) : null;
  const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
  return { name, company, tokens, product: null };
}

/**
 * Other spellings of a handle that might be the GitHub login (underscores, a doubled last letter).
 * `dannypostmaa` → `dannypostma`; `tdinh_me` → `tdinhme`, `tdinh-me`, `tdinh`.
 */
export function handleVariants(handle: string): string[] {
  const id = handle.replace(/^@/, '');
  const out: string[] = [];
  const add = (value: string) => {
    if (value && !out.some((v) => v.toLowerCase() === value.toLowerCase())) out.push(value);
  };
  add(id);
  add(id.replace(/_/g, ''));
  add(id.replace(/_/g, '-'));
  if (/(.)\1$/i.test(id) && id.length > 4) add(id.slice(0, -1));
  const parts = id.split(/[_-]/).filter(Boolean);
  // A short first token ("tibo", "tdinh") is too generic to try as a GitHub login.
  if (parts.length > 1 && parts[0].length >= 6) add(parts[0]);
  return out.filter((v) => isGithubLogin(v) || isXHandle(v)).slice(0, 8);
}

function namesClose(a: string, b: string): boolean {
  const x = loose(a);
  const y = loose(b);
  if (!x || !y || x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function scoreGithubMatch(opts: {
  user: { login: string; name: string; bio: string; blog: string | null; x: string | null; repos: number };
  wantX?: string | null;
  wantName?: string | null;
  wantSite?: string | null;
  wantCompany?: string | null;
}): number {
  const { user, wantX, wantName, wantSite, wantCompany } = opts;
  let score = 0;
  const xLinked = Boolean(wantX && user.x && user.x.toLowerCase() === wantX.toLowerCase());
  const variantHit = Boolean(
    wantX && handleVariants(wantX).some((v) => v.toLowerCase() === user.login.toLowerCase() || (user.x && v.toLowerCase() === user.x.toLowerCase())),
  );
  const siteHit = Boolean(wantSite && user.blog && hostOf(user.blog) === hostOf(wantSite));
  if (wantX && user.x && user.x.toLowerCase() === wantX.toLowerCase()) score += 50;
  if (wantX && user.login.toLowerCase() === wantX.toLowerCase()) score += 8;
  if (variantHit) score += 18;
  if (siteHit) score += 25;
  const nameHit = Boolean(wantName && namesClose(user.name || user.login, wantName));
  const shortName = Boolean(wantName && !/\s/.test(wantName) && wantName.length < 8);
  // A first name like "Tibo" or a shared "Tony Dinh" must not steal an X identity.
  const companyHit = Boolean(wantCompany && `${user.bio} ${user.name} ${user.login}`.toLowerCase().includes(wantCompany.toLowerCase()));
  if (nameHit && (!wantX || xLinked || variantHit || siteHit) && (!shortName || xLinked || siteHit || companyHit)) score += shortName ? 8 : 20;
  if (companyHit) score += 16;
  if (user.repos > 0 && score > 0) score += Math.min(8, Math.round(Math.log10(1 + user.repos) * 3));
  if (user.repos === 0 && !user.blog && !user.x) score -= 20;
  if (wantX && !xLinked && !variantHit && !siteHit && user.login.toLowerCase() !== wantX.toLowerCase()) return Math.min(score, 6);
  return score;
}

/** Unauthenticated X profile: FxTwitter first, then a TinyFish read of x.com/<handle>. */
export async function readXProfile(
  handle: string,
  fetchPage?: (url: string) => Promise<{ title: string; description: string; text: string; links: string[] } | null>,
): Promise<XProfile | null> {
  if (!isXHandle(handle)) return null;
  const fromFx = (await readFxTwitter(handle)) ?? (await readFxTwitter(handle, 'https://api.vxtwitter.com'));
  if (fromFx) return fromFx;
  if (!fetchPage) return null;
  const page = await fetchPage(`https://x.com/${handle}`).catch(() => null);
  if (!page) return null;
  const title = cleanText(page.title.replace(/\s*[|/·].*$/, ''), 60);
  const bio = cleanText(page.description || page.text.slice(0, 400), 280);
  const urls = [...urlsFromText(`${page.description}\n${page.text}`), ...page.links.map((u) => httpsUrl(u)).filter((u): u is string => Boolean(u))];
  const site = urls.find((u) => !PROFILE_HOSTS.test(hostOf(u) ?? '')) ?? null;
  const name = title && !/^(@|x\.com)/i.test(title) ? title : handle;
  return { handle, name: cleanText(name, 60), bio, site, urls: uniqueUrls(urls) };
}

async function readFxTwitter(handle: string, origin = 'https://api.fxtwitter.com'): Promise<XProfile | null> {
  const response = await fetch(`${origin}/${encodeURIComponent(handle)}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    user?: { screen_name?: string; name?: string; description?: string; website?: { url?: string; display_url?: string } | string };
  } | null;
  const user = body?.user;
  if (!user) return null;
  const bio = cleanText(user.description, 280);
  const website = typeof user.website === 'string' ? user.website : user.website?.url || user.website?.display_url;
  const site = httpsUrl(website ?? null);
  const urls = uniqueUrls([site, ...urlsFromText(bio)].filter((u): u is string => Boolean(u)));
  return {
    handle: typeof user.screen_name === 'string' && isXHandle(user.screen_name) ? user.screen_name : handle,
    name: cleanText(user.name, 60) || handle,
    bio,
    site: site && !PROFILE_HOSTS.test(hostOf(site) ?? '') ? site : urls[0] ?? null,
    urls,
  };
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = httpsUrl(raw);
    const host = hostOf(url);
    if (!url || !host || PROFILE_HOSTS.test(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(url);
  }
  return out.slice(0, 12);
}

export function mergeSites(...lists: (string | null | undefined)[][]): string[] {
  return uniqueUrls(lists.flat().filter((u): u is string => Boolean(u)));
}

export function extraSitePaths(siteUrl: string): string[] {
  const url = httpsUrl(siteUrl);
  if (!url) return [];
  const base = url.replace(/\/+$/, '');
  const host = hostOf(url);
  if (!host || isDomain(host) === false) return [];
  return [`${base}/`, `${base}/now`, `${base}/projects`, `${base}/changelog`, `${base}/shipped`, `${base}/2026`, `${base}/work`];
}

export { httpsUrl, namesClose, uniqueUrls };
