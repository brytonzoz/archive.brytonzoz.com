// Person → role → company. Founders/CEOs take the company's ships; a lead takes the product
// they run plus their own. No eval-name tables: typed "CEO of X" / "Ada at Vercel" plus a
// public bio are enough.
import { cleanText, isJunkProfileText, parsePersonName, xHandlesFromText } from './shipped-identity';

export type RoleKind = 'founder' | 'ceo' | 'lead' | 'employee' | 'unknown';
export type Attribution = 'personal' | 'company-led-by-person' | 'company-founded-by-person' | 'unrelated';

export type Affiliation = {
  name: string;
  company: string | null;
  role: RoleKind;
  product: string | null;
  companyX: string | null;
  companyGithub: string | null;
  companySite: string | null;
  /** Company came from the typed query ("Tibo from OpenAI"), not an inferred site. */
  typedCompany: boolean;
};

export const emptyAffiliation = (): Affiliation => ({
  name: '',
  company: null,
  role: 'unknown',
  product: null,
  companyX: null,
  companyGithub: null,
  companySite: null,
  typedCompany: false,
});

const ROLE_WORD: Record<string, RoleKind> = {
  ceo: 'ceo',
  'chief executive': 'ceo',
  founder: 'founder',
  cofounder: 'founder',
  'co-founder': 'founder',
  lead: 'lead',
  head: 'lead',
  director: 'lead',
};

export function companySlug(company: string | null | undefined): string | null {
  const slug = (company ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return slug.length >= 2 ? slug : null;
}

/** "Cursor (Anysphere)" → ["Cursor", "Anysphere"]. Used for host and org guesses. */
export function companyTokens(company: string | null | undefined): string[] {
  if (!company) return [];
  const parts = company
    .split(/[()[\],/|]/)
    .map((part) => part.replace(/\b(inc|llc|ltd|corp|the|labs?)\b/gi, ' ').trim())
    .filter((part) => part.length >= 2 && !/^(inc|llc|ltd|the)$/i.test(part));
  const out: string[] = [];
  for (const part of parts) {
    if (!out.some((v) => v.toLowerCase() === part.toLowerCase())) out.push(part);
  }
  return out.slice(0, 4);
}

export function companyOrgGuess(company: string | null | undefined): string | null {
  const primary = companyTokens(company)[0];
  return companySlug(primary ?? company);
}

/** vercel.com / openai.com on a CEO's profile → the company name. Skip personal hosts. */
export function companyFromSites(
  urls: (string | null | undefined)[],
  person: { name?: string; handle?: string | null },
): { company: string; site: string } | null {
  const skip = [person.handle, ...(person.name ?? '').split(/\s+/)]
    .filter((t): t is string => Boolean(t && t.length >= 3))
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const raw of urls) {
    if (!raw) continue;
    let host = '';
    try {
      host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      continue;
    }
    if (!host || /^(x\.com|twitter\.com|github\.com|linkedin\.com|instagram\.com)$/.test(host)) continue;
    const base = host.replace(/\.(com|ai|io|dev|so|app|me|co)$/i, '').replace(/\./g, '');
    if (base.length < 3) continue;
    if (skip.some((t) => base.includes(t) || t.includes(base))) continue;
    const label = companyTokens(base)[0] ?? base;
    return { company: label.charAt(0).toUpperCase() + label.slice(1), site: raw.startsWith('http') ? raw : `https://${host}/` };
  }
  return null;
}

/** Typed "CEO of Higgsfield", "Higgsfield CEO", "Tibo from OpenAI", "Codex lead at OpenAI". */
export function parseAffiliationQuery(text: string): Affiliation {
  const raw = cleanText(text, 80);
  const out = emptyAffiliation();
  const ceoOf = raw.match(/^(?:the\s+)?(ceo|founder|co-?founder|lead|head)\s+(?:of|at)\s+(.+)$/i);
  if (ceoOf) {
    out.role = ROLE_WORD[ceoOf[1].toLowerCase().replace(/\s+/g, '')] ?? (ceoOf[1].toLowerCase().includes('founder') ? 'founder' : 'lead');
    out.company = cleanText(ceoOf[2], 40);
    if (out.company) out.typedCompany = true;
    return out;
  }
  const titled = raw.match(/^(.+?)\s+(ceo|founder|co-?founder)$/i);
  if (titled && !/\s/.test(titled[1])) {
    out.role = titled[2].toLowerCase().includes('founder') ? 'founder' : 'ceo';
    out.company = cleanText(titled[1], 40);
    if (out.company) out.typedCompany = true;
    return out;
  }
  const leadOf = raw.match(/^(.+?)\s+lead\s+(?:of|at|@)\s+(.+)$/i);
  if (leadOf) {
    out.product = cleanText(leadOf[1], 40);
    out.company = cleanText(leadOf[2], 40);
    out.role = 'lead';
    if (out.company) out.typedCompany = true;
    return out;
  }
  const parts = parsePersonName(raw);
  out.name = parts.name && !/^(ceo|founder|the)$/i.test(parts.name) ? parts.name : '';
  out.company = parts.company;
  out.product = parts.product;
  if (parts.company && /^ceo$/i.test(parts.name)) out.role = 'ceo';
  if (out.company) out.typedCompany = true;
  return out;
}

const NOT_COMPANY = /^(the|a|an|this|that|our|all|humanity|people|life|course|things|stuff|code|service|privacy|policy|center|terms|javascript|browser|cookie|imprint|help|content|information|mission)$/i;

function usableCompany(raw: string | null | undefined): string | null {
  const name = cleanText(raw, 40);
  if (name.length < 3 || NOT_COMPANY.test(name)) return null;
  if (/\d/.test(name) && /[A-Z]/.test(name) && name.length > 8) return null;
  return name;
}

/** Bio lines like "Codex lead at OpenAI" / "CEO @higgsfield" / "founder of Vercel". */
export function affiliationFromBio(bio: string, hint: Affiliation = emptyAffiliation()): Affiliation {
  if (isJunkProfileText(bio)) return { ...hint };
  const text = cleanText(bio, 400);
  const out: Affiliation = { ...hint };
  const ceo = text.match(/\b(ceo|founder|co-?founder)\b(?:\s*(?:of|at|@|,|[/|-]|–)\s*@?([A-Za-z][A-Za-z0-9._-]{1,39}))?/i);
  if (ceo) {
    const role = ceo[1].toLowerCase().includes('founder') ? 'founder' : 'ceo';
    if (out.role === 'unknown' || role === 'ceo' || role === 'founder') out.role = role;
    if (ceo[2] && !out.company) out.company = usableCompany(ceo[2]);
  }
  const titled = text.match(/\b([A-Z][A-Za-z0-9._-]{1,39})\s+(ceo|founder|co-?founder)\b/i);
  if (titled) {
    if (out.role === 'unknown') out.role = titled[2].toLowerCase().includes('founder') ? 'founder' : 'ceo';
    if (!out.company) out.company = usableCompany(titled[1]);
  }
  const lead = text.match(/\b([A-Za-z][A-Za-z0-9 ._-]{1,32}?)\s+(?:lead|head|director)\s+(?:of|at|@)\s+([A-Za-z0-9._-]{2,40})/i);
  if (lead) {
    if (out.role === 'unknown') out.role = 'lead';
    out.product ||= cleanText(lead[1], 40);
    out.company ||= usableCompany(lead[2]);
  }
  const atCo = text.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9._-]{1,39})\b/);
  if (atCo && !out.company) out.company = usableCompany(atCo[1]);
  if (!out.company) {
    const missionOf = text.match(/\b(?:mission|ceo|founder|co-?founder|team|staff)\s+of\s+([A-Z][A-Za-z0-9]{2,39})\b/i);
    if (missionOf) {
      out.company = usableCompany(missionOf[1]);
      if (out.company && out.role === 'unknown' && /\b(mission|ceo)\s+of\b/i.test(text)) out.role = 'ceo';
    }
  }
  const handles = xHandlesFromText(text);
  if (!out.companyX && out.company) {
    const slug = companySlug(out.company);
    const hit = handles.find((h) => companySlug(h) === slug || h.toLowerCase() === (out.company ?? '').toLowerCase());
    if (hit) out.companyX = hit;
  }
  return out;
}

export function mergeAffiliation(base: Affiliation, extra: Affiliation): Affiliation {
  const roleRank: Record<RoleKind, number> = { unknown: 0, employee: 1, lead: 2, founder: 3, ceo: 4 };
  return {
    name: base.name || extra.name,
    company: base.company || extra.company,
    role: roleRank[extra.role] > roleRank[base.role] ? extra.role : base.role,
    product: base.product || extra.product,
    companyX: base.companyX || extra.companyX,
    companyGithub: base.companyGithub || extra.companyGithub,
    companySite: base.companySite || extra.companySite,
    typedCompany: base.typedCompany || extra.typedCompany,
  };
}

type ScopeHint = RoleKind | Pick<Affiliation, 'role' | 'product' | 'typedCompany'>;

/** Founders/CEOs get the whole company tape; a lead gets the product they run plus their own.
 *  Unknown indie builders do not inherit a company harvest. A typed "from Company" still does. */
export function companyScope(roleOrAff: ScopeHint): 'all' | 'product' | 'none' {
  const role = typeof roleOrAff === 'string' ? roleOrAff : roleOrAff.role;
  const typed = typeof roleOrAff === 'string' ? false : Boolean(roleOrAff.typedCompany);
  const product = typeof roleOrAff === 'string' ? null : roleOrAff.product;
  if (role === 'founder' || role === 'ceo') return 'all';
  if (role === 'lead') return 'product';
  if (typed && product) return 'product';
  if (typed) return 'all';
  return 'none';
}

/** Infer a company from a personal site or GitHub org only for CEOs or typed-company queries.
 *  Indie founders (levelsio, Marc Lou) run many products; one site must not become THE company. */
export function shouldInferCompany(affiliation: Pick<Affiliation, 'role' | 'typedCompany'>): boolean {
  return affiliation.role === 'ceo' || Boolean(affiliation.typedCompany);
}

/** Cheap xAI / web identity when the typed query has no handle yet. */
export function needsPersonResolve(opts: { handle?: string | null; name?: string; company?: string | null; role?: RoleKind }): boolean {
  if (opts.handle) return false;
  if (opts.role === 'ceo' || opts.role === 'founder') return true;
  if (opts.name && opts.company) return true;
  if (opts.name && /\s/.test(opts.name)) return true;
  return Boolean(opts.company || opts.name);
}

/** Handle is known but the company they run is not — @sama, @rauchg.
 *  Only fires for CEO/founder (typed or bio). Unknown+handle stays free. */
export function needsCompanyResolve(opts: {
  handle?: string | null;
  company?: string | null;
  role?: RoleKind;
  product?: string | null;
  bio?: string;
}): boolean {
  if (opts.company) return false;
  if (!opts.handle) return false;
  if (opts.role === 'ceo' || opts.role === 'founder' || opts.role === 'lead') return true;
  if (opts.product) return true;
  return Boolean(opts.bio && !isJunkProfileText(opts.bio) && /\b(ceo|founder|co-?founder|lead|head|director)\b/i.test(opts.bio));
}

/** Handle is known but we still have no company or product — one identity lookup for leads. */
export function needsHandleEnrichment(opts: { handle?: string | null; company?: string | null; product?: string | null }): boolean {
  return Boolean(opts.handle && !opts.company && !opts.product);
}

/** Handle exists but X returned a cookie wall / empty bio and no site — one identity lookup. */
export function needsIdentityRetry(opts: {
  handle?: string | null;
  company?: string | null;
  bio?: string;
  site?: string | null;
}): boolean {
  if (!opts.handle || opts.company) return false;
  if (opts.site) return false;
  if (opts.bio && !isJunkProfileText(opts.bio) && opts.bio.length > 20) return false;
  return true;
}

/** GitHub `company` is often `@openai`. */
export function cleanGithubCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^@/, '').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 2 ? cleaned : null;
}

export function productTokens(product: string | null | undefined): string[] {
  if (!product) return [];
  return product
    .split(/\s*(?:,|;|&|\/|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !/^(the|and|platform|generation)$/i.test(part))
    .slice(0, 4);
}

/** One primary product a lead owns. "ChatGPT & Codex" at OpenAI → Codex, not ChatGPT. */
export function leadProductTokens(product: string | null | undefined, company: string | null | undefined = null): string[] {
  const tokens = productTokens(product);
  const skip = new Set(companyTokens(company).map((t) => t.toLowerCase()));
  const filtered = tokens.filter((t) => !skip.has(t.toLowerCase()));
  const use = filtered.length ? filtered : tokens;
  return use.slice(-1);
}

/** Codex changelog after the 308 to learn.chatgpt.com — cards keep `#codex-` even when the title does not say Codex. */
export function isCodexChangelogHref(link?: string | null): boolean {
  const url = String(link || '');
  if (!url) return false;
  if (/\/codex(\/|$|#)/i.test(url) || /#codex-/i.test(url)) return true;
  return /learn\.chatgpt\.com\/docs\/changelog/i.test(url) || /developers\.openai\.com\/codex/i.test(url);
}

function isChatGptOnlyOnCodexTape(name: string): boolean {
  if (/\bcodex\b/i.test(name)) return false;
  if (/chatgpt for (ios|android|ipad)/i.test(name)) return true;
  return /^chatgpt\b/i.test(name);
}

/** Lead scope: product token in the row, or a feature card on that product's changelog. */
export function matchesLeadProduct(
  item: { name?: string; description?: string; link?: string | null },
  product: string | null | undefined,
  company?: string | null,
): boolean {
  const tokens = leadProductTokens(product, company).map((t) => t.toLowerCase());
  if (!tokens.length) return true;
  const hay = `${item.name || ''} ${item.description || ''} ${item.link || ''}`.toLowerCase();
  if (tokens.some((token) => hay.includes(token))) {
    if (tokens.includes('codex') && isChatGptOnlyOnCodexTape(item.name || '')) return false;
    return true;
  }
  if (tokens.includes('codex') && isCodexChangelogHref(item.link)) {
    return !isChatGptOnlyOnCodexTape(item.name || '');
  }
  return false;
}

export function primaryProduct(product: string | null | undefined, company: string | null | undefined = null): string | null {
  return leadProductTokens(product, company)[0] ?? null;
}

export function identitySearchQuery(who: string, company: string | null, role: RoleKind | string | null): string {
  const titled = !who || /^(the\s+)?(ceo|founder|co-?founder)$/i.test(who);
  if ((role === 'ceo' || role === 'founder') && company && titled) return `${role} of ${company}`;
  if (who && company) return `${who} ${company}`;
  return who || company || '';
}

export function viaLabel(affiliation: Affiliation, attribution: Attribution): string | null {
  if (!affiliation.company || attribution === 'unrelated' || attribution === 'personal') return null;
  const product = affiliation.product && attribution === 'company-led-by-person' ? ` · ${affiliation.product}` : '';
  return `via ${affiliation.company}${product}`;
}

export function defaultAttribution(role: RoleKind, typedCompany = false): Attribution {
  if (role === 'founder' || role === 'ceo') return 'company-founded-by-person';
  if (role === 'lead') return 'company-led-by-person';
  // "Tibo from OpenAI" is a company tape until a bio upgrades them to a product lead.
  if (typedCompany) return 'company-founded-by-person';
  return 'personal';
}
