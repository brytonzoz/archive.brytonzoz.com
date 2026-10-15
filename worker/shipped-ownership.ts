// Did this person ship it? Default is no. Tools they use, affiliate links, and
// friends' products stay off the tape even when the homepage links out.

export type OwnerContext = {
  name?: string | null;
  github?: string | null;
  x?: string | null;
  site?: string | null;
  sites?: string[];
  company?: string | null;
  companyGithub?: string | null;
  /** Public GitHub orgs the person belongs to (founder / top-3 harvest). */
  orgs?: string[];
};

export type OwnershipKind = 'developer' | 'portfolio' | 'named' | 'company' | 'none';

const MAKER_SOURCE = /^(npm|producthunt|appstore|x)$/;
const COMPANY_SOURCE = /^(changelog|company)$/;
const PORTFOLIO_HINT =
  /\b(pinned on|listed under|listed on|things i.?ve built|working on|my projects|portfolio)\b/i;
const MADE_IT = /\b(i made|i built|i launched|i shipped|i released|my (app|product|game|site|tool))\b/i;
const TOOLS_HINT =
  /\b(tools i use|affiliat|friends?|recommended|i use|made by|from the maker|founder community)\b/i;
const PUBLIC_PAGE = /^public page on /i;
const FOREIGN_PRODUCTS: { re: RegExp; owner: RegExp }[] = [
  { re: /\bship or die\b/i, owner: /marc\s*lou|marclou|marc_lou/i },
  { re: /\bmarketing or die\b/i, owner: /marc\s*lou|marclou|marc_lou/i },
];

function ownerHay(owner?: OwnerContext | null): string {
  return `${owner?.name || ''} ${owner?.github || ''} ${owner?.x || ''} ${owner?.site || ''}`;
}

function isForeignProduct(
  item: { name?: string; description?: string; link?: string | null },
  owner?: OwnerContext | null,
): boolean {
  const hay = `${item.name || ''} ${item.description || ''} ${item.link || ''}`;
  const who = ownerHay(owner);
  if (/\bmarc\s*lou\b/i.test(item.description || '') && !/marc\s*lou|marclou|marc_lou/i.test(who)) return true;
  return FOREIGN_PRODUCTS.some((row) => row.re.test(hay) && !row.owner.test(who));
}

function loose(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
}

export function ownerTokens(owner: OwnerContext | null | undefined): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const text = (raw || '').replace(/^@/, '').trim();
    if (!text) return;
    const compact = loose(text);
    if (compact.length >= 4) out.push(compact);
    for (const part of text.split(/[\s._-]+/)) {
      const token = loose(part);
      if (token.length >= 5) out.push(token);
    }
  };
  add(owner?.name);
  add(owner?.github);
  add(owner?.x);
  add(owner?.company);
  try {
    if (owner?.site) add(new URL(owner.site).hostname.replace(/^www\./, '').split('.')[0]);
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

export function ownHosts(owner: OwnerContext | null | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const url of [owner?.site, ...(owner?.sites ?? [])]) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  return hosts;
}

/** Own domain or a subdomain of it. blog.go-publicly.com is not Nico's just because he was listed there. */
export function hostOwnedByBuilder(host: string | null | undefined, owner: OwnerContext | null | undefined): boolean {
  if (!host) return false;
  const own = ownHosts(owner);
  if (own.has(host)) return true;
  for (const known of own) {
    if (host === known || host.endsWith(`.${known}`) || known.endsWith(`.${host}`)) return true;
  }
  return false;
}

export function listingHost(description: string | null | undefined): string | null {
  const match = String(description || '').match(/\blisted on\s+([a-z0-9.-]+\.[a-z]{2,})\b/i);
  return match?.[1] ? match[1].replace(/^www\./, '').toLowerCase() : null;
}

export function hostNamesOwner(host: string | null | undefined, owner: OwnerContext | null | undefined): boolean {
  if (!host) return false;
  if (ownHosts(owner).has(host)) return true;
  const hay = loose(host);
  return ownerTokens(owner).some((token) => token.length >= 5 && hay.includes(token));
}

function githubOwned(url: string | null | undefined, owner: OwnerContext | null | undefined): boolean {
  const login = owner?.github?.replace(/^@/, '');
  if (!login || !url) return false;
  return new RegExp(`github\\.com/${login}(/|$)`, 'i').test(url);
}

function githubOrgOwned(url: string | null | undefined, owner: OwnerContext | null | undefined): boolean {
  if (!url) return false;
  const orgs = [owner?.companyGithub, ...(owner?.orgs || [])]
    .map((value) => String(value || '').replace(/^@/, ''))
    .filter((org) => /^[A-Za-z0-9-]{1,39}$/.test(org));
  return orgs.some((org) => new RegExp(`github\\.com/${org}(/|$)`, 'i').test(url));
}

export function isOssHarvestItem(item: { kind?: string } | null | undefined): boolean {
  return /^(oss-release|oss-launch|oss-blog|oss-pin)$/.test(item?.kind || '');
}

/** Why this line may appear on the person's receipt. `none` means drop it. */
export function ownershipEvidence(
  item: { name?: string; description?: string; link?: string | null; source?: string; kind?: string },
  owner?: OwnerContext | null,
): OwnershipKind {
  const source = item.source ?? '';
  const desc = item.description ?? '';
  if (isForeignProduct(item, owner)) return 'none';
  if (TOOLS_HINT.test(desc) || PUBLIC_PAGE.test(desc)) return 'none';
  if (isOssHarvestItem(item)) return 'developer';
  if (String(item.kind || '') === 'journal-ship') return 'portfolio';
  if (COMPANY_SOURCE.test(source) && owner?.company) return 'company';
  if (githubOwned(item.link, owner) || githubOrgOwned(item.link, owner)) return 'developer';
  if (source === 'github') return 'none';
  if (MAKER_SOURCE.test(source)) return 'developer';
  const host = hostOf(item.link ?? null);
  if (hostOwnedByBuilder(host, owner)) {
    if (PORTFOLIO_HINT.test(desc) || source === 'site') return 'portfolio';
    return 'named';
  }
  if (hostNamesOwner(host, owner)) return 'named';
  const listed = listingHost(desc);
  if (listed && hostOwnedByBuilder(listed, owner) && MADE_IT.test(desc)) return 'portfolio';
  return 'none';
}

export function ownedByBuilder(
  item: { name?: string; description?: string; link?: string | null; source?: string; kind?: string },
  owner?: OwnerContext | null,
): boolean {
  return ownershipEvidence(item, owner) !== 'none';
}

/** Undated crumbs need real ownership. Named/portfolio site crumbs also need a description. */
export function undatedPassesGate(
  item: { name?: string; description?: string; link?: string | null; source?: string; date?: string | null; kind?: string },
  owner?: OwnerContext | null,
): boolean {
  if (item.date) return true;
  if (isOssHarvestItem(item)) return true;
  const kind = ownershipEvidence(item, owner);
  if (kind === 'none') return false;
  const desc = (item.description || '').replace(/\s+/g, ' ').trim();
  const hasDesc = desc.length >= 12;
  if (kind === 'company') return true;
  if (kind === 'developer') {
    if (githubOwned(item.link, owner)) return true;
    const host = hostOf(item.link);
    if (host === 'npmjs.com' || host === 'www.npmjs.com') {
      const n = loose(item.name || '');
      return ownerTokens(owner).some((token) => n.includes(token) || token.includes(n));
    }
    return hasDesc && hostNamesOwner(host, owner);
  }
  if (kind === 'named' || kind === 'portfolio') {
    if (!hasDesc) return false;
    const n = loose(item.name || '');
    if (ownerTokens(owner).some((token) => token.length >= 4 && (n.includes(token) || token.includes(n)))) return true;
    if (githubOwned(item.link, owner) || githubOrgOwned(item.link, owner)) return true;
    if (MADE_IT.test(desc)) return true;
    return false;
  }
  return false;
}

/** A display name or X handle alone cannot prove ownership. Need a site, GitHub, or company. */
export function ownerCanProve(owner?: OwnerContext | null): boolean {
  if (!owner) return false;
  return Boolean(
    owner.github || owner.site || owner.company || owner.companyGithub || (owner.sites && owner.sites.length) || (owner.orgs && owner.orgs.length),
  );
}

export function ownerFromProfile(
  profile?: {
    name?: string | null;
    github?: string | null;
    x?: string | null;
    site?: string | null;
    sites?: string[];
    company?: string | null;
    orgs?: string[];
  } | null,
  affiliation?: { name?: string | null; company?: string | null; companyGithub?: string | null } | null,
): OwnerContext {
  return {
    name: affiliation?.name || profile?.name,
    github: profile?.github,
    x: profile?.x,
    site: profile?.site,
    sites: profile?.sites,
    company: affiliation?.company,
    companyGithub: affiliation?.companyGithub || profile?.company,
    orgs: profile?.orgs,
  };
}
