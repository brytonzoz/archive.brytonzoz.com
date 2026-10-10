// Did this person ship it? Default is no. Tools they use, affiliate links, and
// friends' products stay off the tape even when the homepage links out.

export type OwnerContext = {
  name?: string | null;
  github?: string | null;
  x?: string | null;
  site?: string | null;
  sites?: string[];
  company?: string | null;
};

export type OwnershipKind = 'developer' | 'portfolio' | 'named' | 'company' | 'none';

const DEVELOPER_SOURCE = /^(github|npm|producthunt|appstore|x)$/;
const COMPANY_SOURCE = /^(changelog|company)$/;
const PORTFOLIO_HINT =
  /\b(pinned on|listed under|listed on|things i.?ve built|working on|my projects|portfolio)\b/i;
const TOOLS_HINT = /\b(tools i use|affiliat|friends?|recommended|i use|made by|from the maker)\b/i;
const PUBLIC_PAGE = /^public page on /i;

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

/** Why this line may appear on the person's receipt. `none` means drop it. */
export function ownershipEvidence(
  item: { name?: string; description?: string; link?: string | null; source?: string },
  owner?: OwnerContext | null,
): OwnershipKind {
  const source = item.source ?? '';
  if (COMPANY_SOURCE.test(source)) return 'company';
  if (DEVELOPER_SOURCE.test(source)) return 'developer';
  if (githubOwned(item.link, owner)) return 'developer';
  const host = hostOf(item.link ?? null);
  const desc = item.description ?? '';
  if (TOOLS_HINT.test(desc) || PUBLIC_PAGE.test(desc)) return 'none';
  if (host && ownHosts(owner).has(host)) {
    if (PORTFOLIO_HINT.test(desc) || source === 'site') return 'portfolio';
    return 'named';
  }
  if (hostNamesOwner(host, owner)) return 'named';
  if (PORTFOLIO_HINT.test(desc) && source === 'site') return 'portfolio';
  return 'none';
}

export function ownedByBuilder(
  item: { name?: string; description?: string; link?: string | null; source?: string },
  owner?: OwnerContext | null,
): boolean {
  return ownershipEvidence(item, owner) !== 'none';
}

/** Undated crumbs need real ownership. Named/portfolio site crumbs also need a description. */
export function undatedPassesGate(
  item: { name?: string; description?: string; link?: string | null; source?: string; date?: string | null },
  owner?: OwnerContext | null,
): boolean {
  if (item.date) return true;
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
    return hasDesc;
  }
  return false;
}

export function ownerFromProfile(
  profile?: {
    name?: string | null;
    github?: string | null;
    x?: string | null;
    site?: string | null;
    sites?: string[];
  } | null,
  affiliation?: { name?: string | null; company?: string | null } | null,
): OwnerContext {
  return {
    name: affiliation?.name || profile?.name,
    github: profile?.github,
    x: profile?.x,
    site: profile?.site,
    sites: profile?.sites,
    company: affiliation?.company,
  };
}
