// Multi-pass research for a SHIPPED receipt: identity is resolved first, then every public
// surface is harvested with real numbers, then a gap-fill pass (own /projects + TrustMRR +
// TinyFish / Claude, only while the receipt budget still has room). Stats always carry a
// source URL. This file is parsers + scoring; gather() in shipped-sources.ts runs the passes.

import type { ItemSource, ItemStatus } from '../lib/shipped-year';
import { itemsFromFeedXml } from './shipped-changelog';

type Found = {
  name: string;
  description: string;
  date: string | null;
  dateConfidence?: 'exact' | 'year' | 'inferred' | 'unknown';
  link: string | null;
  icon: string | null;
  source: ItemSource;
  status: ItemStatus;
  score: number;
  thisYear?: boolean;
  metrics?: SourcedStat[];
};

type Profile = { name: string; bio: string; site: string | null; x: string | null; github: string | null; sites?: string[] };
type Gathered = { found: Found[]; profile: Profile; site: { text?: string; url?: string } | null; stats?: SourcedStat[] };

function clean(value: unknown, max: number): string {
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

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
}

export type StatKind =
  | 'stars'
  | 'repos'
  | 'contributions'
  | 'downloads'
  | 'upvotes'
  | 'rank'
  | 'rating'
  | 'reviews'
  | 'mrr'
  | 'users'
  | 'hn'
  | 'other';

export type SourcedStat = {
  kind: StatKind;
  /** Printed on the tape, e.g. "553 GitHub stars". */
  label: string;
  value: number | null;
  /** Required: the public page that published this number. */
  url: string;
  about?: string;
};

export const RECEIPT_BUDGET_MICROS = 50_000;

export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

export function sourcedStat(kind: StatKind, label: string, value: number | null, url: string, about?: string): SourcedStat | null {
  const safe = publicUrl(url);
  if (!safe || !label) return null;
  return { kind, label: clean(label, 60), value: Number.isFinite(value ?? NaN) ? (value as number) : null, url: safe, about };
}

const loose = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Dated rows on a /projects or /2026 page: "●2026-07 pieter.com" or "2026-04 XDR Boost". */
export function itemsFromProjectList(opts: { text: string; url: string; year: number }): Found[] {
  const { text, url, year } = opts;
  const found: Found[] = [];
  const seen = new Set<string>();
  const add = (name: string, date: string | null, hint?: string) => {
    const trimmed = clean(name.replace(/\b(active|shipped|live|sunset|killed|paused)\b/gi, ''), 40);
    if (!trimmed || trimmed.length < 2) return;
    const key = loose(trimmed);
    if (key.length < 2 || seen.has(key)) return;
    if (/^(home|about|blog|contact|projects?|changelog)$/i.test(trimmed)) return;
    seen.add(key);
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const href = publicUrl(url);
    found.push({
      name: trimmed,
      description: clean(hint || `Listed under ${year} on ${hostOf(url) ?? 'their site'}`, 140),
      date,
      dateConfidence: date ? 'exact' : 'year',
      link: href && slug ? `${href.replace(/#.*$/, '')}#${slug}` : href,
      icon: null,
      source: 'site',
      status: 'LIVE',
      score: 6,
      thisYear: true,
    });
  };

  const dateFirst = new RegExp(
    `(?:^|[\\n•●\\-])\\s*(${year}[-/.](\\d{1,2})(?:[-/.](\\d{1,2}))?)\\s+([A-Za-z0-9][A-Za-z0-9 ._'\\/-]{1,60})`,
    'gi',
  );
  for (const match of text.matchAll(dateFirst)) {
    const month = match[2].padStart(2, '0');
    const day = match[3] ? match[3].padStart(2, '0') : '';
    add(match[4], day ? `${year}-${month}-${day}` : `${year}-${month}`);
  }

  const heading = text.split(new RegExp(`(?:^|\\n)\\s*#{0,3}\\s*${year}\\b[:\\s]*`, 'i'))[1] ?? '';
  if (heading) {
    const chunk = heading.split(new RegExp(`(?:^|\\n)\\s*#{0,3}\\s*${year + 1}\\b|\\n\\s*#{0,3}\\s*20\\d\\d\\b`, 'i'))[0] ?? heading;
    for (const line of chunk.split(/\n/).slice(0, 40)) {
      const bullet = line.match(/^\s*(?:[-*•●]|\d+[.)])\s+(.{2,80})$/);
      if (bullet) add(bullet[1], null, `Under the ${year} heading`);
    }
  }

  // "Introducing Codex — January 15, 2026" / "Sora 2 (Mar 2026)" / "GPT-5 · 2026-08-07"
  const namedDate = new RegExp(
    `([A-Za-z][A-Za-z0-9][A-Za-z0-9 ._'\\/-]{1,48}?)\\s*(?:[—–\\-·|,]|\\s)\\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},?\\s+${year}|${year}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?)`,
    'gi',
  );
  for (const match of text.matchAll(namedDate)) add(match[1], null, `Dated ${year} on ${hostOf(url) ?? 'their site'}`);

  const pins = portfolioText(text).matchAll(/([A-Za-z][A-Za-z0-9 .'-]{1,32})\s*\(([^)]{3,80})\)/g);
  for (const match of pins) {
    const name = match[1].trim();
    if (name.split(/\s+/).length > 4) continue;
    if (/^(you |from the |get |download |how i |available )/i.test(name)) continue;
    if (/\b(tools i use|affiliat|friends?|recommended|i use|made by|from the maker)\b/i.test(match[2])) continue;
    add(name, null, clean(match[2], 80) || `Listed on ${hostOf(url) ?? 'their site'}`);
  }

  for (const match of text.matchAll(/📌\s*([A-Za-z][A-Za-z0-9 .'-]{1,32})(?:\s*\(([^)]{3,80})\))?/g)) {
    add(match[1], null, clean(match[2] || '', 80) || `Pinned on ${hostOf(url) ?? 'their site'}`);
  }

  return found.slice(0, 80);
}

const PORTFOLIO_HEADING =
  /(?:^|\n)\s*#{0,3}\s*(📌\s*)?(things i(?:['’]m| am) working on|things i(?:['’]ve| have) built|working on|my projects|portfolio)\b/i;
const TOOLS_HEADING =
  /(?:^|\n)\s*#{0,3}\s*(tools i use|affiliates?|friends?(?:\s+and\s+makers)?|recommended(?: tools)?|i use these)\b/i;

/** `Name (blurb)` pins only from the builder's own project list, never a tools/friends block. */
export function portfolioText(text: string): string {
  const toolsAt = text.search(TOOLS_HEADING);
  const body = toolsAt >= 0 ? text.slice(0, toolsAt) : text;
  const portAt = body.search(PORTFOLIO_HEADING);
  return portAt >= 0 ? body.slice(portAt) : body;
}

const MONTH_NAME =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_NUM: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

const PERSON_SHIP =
  /\b(i (?:made|built|launched|shipped|released|added|published|open[- ]sourced|vibe ?coded|registered|ported|remade)|i have made|just (?:launched|shipped|released|built)|now (?:live|free|out)\b|hit (?:a new )?(?:record )?\$|passed \$\s?\d|registered [a-z0-9-]+\.(?:com|ai|io|app|dev|co))\b/i;

/** Indie blog / X-style posts that are actually ships, not commentary. */
export function looksLikePersonalShip(title: string): boolean {
  const text = title.trim();
  if (!text || text.length < 6) return false;
  if (PERSON_SHIP.test(text)) return true;
  return /\b(hit|passed|reached|crossed)\b/i.test(text) && /\$\s?\d/.test(text);
}

/** Pull a short product / milestone name out of "I made hotelist.com to fix…". */
export function journalShipName(raw: string): string {
  const text = clean(raw.replace(/𝕏/g, ''), 160);
  if (!text) return '';
  const host = text.match(/\b((?:[a-z0-9-]+\.)+(?:com|ai|io|app|dev|co))\b/i);
  if (host && /\b(made|built|registered|launched|shipped|released)\b/i.test(text)) {
    if (/\bfree\b/i.test(text)) return clean(`${host[1]} free`, 40);
    return host[1];
  }
  const money = text.match(/\$\s?[\d,.]+(?:\s*[kKmMbB])?(?:\s*\/\s*(?:mo|y|yr|year)|\/y|\/mo|\s*MRR)?/i);
  if (money && /\b(hit|passed|reached|crossed|record)\b/i.test(text)) {
    return clean(`${money[0].replace(/\s+/g, '')} milestone`, 40);
  }
  const into = text.match(/\b(?:added|built|shipped|vibe ?coded).{0,80}?\b(?:into|to|for|on)\s+([A-Z][A-Za-z0-9 .+-]{2,32})/i);
  if (into) return clean(`${into[1].replace(/[.,].*$/, '').trim()} feature`, 40);
  const named = text.match(
    /\b(?:i (?:made|built|launched|shipped|released|added|vibe ?coded|registered|ported|remade)|just (?:launched|shipped|built))\s+(?:a |an |the |my |our )?([^,.]{2,48})/i,
  );
  if (named) return clean(named[1].replace(/\b(yesterday|today|tonight|this (?:week|month)|completely|with)\b.*$/i, '').trim(), 40);
  return clean(text, 40);
}

/**
 * levels.io / indie-blog archives: "October 2026" then "- 5 Oct I made hotelist.com…".
 * Commentary stays out; only first-person ships, launches, and revenue milestones.
 */
export function itemsFromDatedJournal(opts: { text: string; url: string; year: number }): Found[] {
  const { text, url, year } = opts;
  const found: Found[] = [];
  const seen = new Set<string>();
  const monthRe = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?(${MONTH_NAME})\\s+${year}\\b`, 'gi');
  const marks = [...text.matchAll(monthRe)];
  const add = (name: string, date: string, hint: string) => {
    const trimmed = journalShipName(name);
    if (!trimmed || trimmed.length < 2) return;
    const key = loose(trimmed);
    if (key.length < 2 || seen.has(key)) return;
    seen.add(key);
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const href = publicUrl(url);
    found.push({
      name: trimmed,
      description: clean(hint || `Announced ${date} on ${hostOf(url) ?? 'their site'}`, 140),
      date,
      dateConfidence: 'exact',
      link: href && slug ? `${href.replace(/#.*$/, '')}#${slug}` : href,
      icon: null,
      source: 'site',
      status: 'LAUNCHED',
      score: 7,
      thisYear: true,
    });
  };

  for (let i = 0; i < marks.length; i++) {
    const monthToken = (marks[i][1] || '').toLowerCase().replace(/[^a-z]/g, '');
    const month = MONTH_NUM[monthToken] || MONTH_NUM[monthToken.slice(0, 3)];
    if (!month) continue;
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : Math.min(text.length, start + 8000);
    const chunk = text.slice(start, end);
    const bulletRe = new RegExp(
      `(?:^|[\\n•●\\-]|\\s)\\s*(\\d{1,2})\\s+(${MONTH_NAME})(?:\\s+'?\\d{2,4})?\\s+(.+?)(?=(?:\\s+[\\-*•●]?\\s*\\d{1,2}\\s+(?:${MONTH_NAME}))|\\s+(?:${MONTH_NAME})\\s+${year}\\b|\\n|$)`,
      'gi',
    );
    for (const match of chunk.matchAll(bulletRe)) {
      const day = match[1].padStart(2, '0');
      const raw = match[3].replace(/𝕏/g, '').replace(/\s+/g, ' ').trim();
      if (!looksLikePersonalShip(raw)) continue;
      add(raw, `${year}-${month}-${day}`, `Announced ${year}-${month}-${day} on ${hostOf(url) ?? 'their site'}`);
    }
  }

  return found.slice(0, 80);
}

/** RSS/Atom on a personal site: keep dated 2026 ships, drop commentary. */
export function itemsFromPersonalFeed(opts: { text: string; url: string; year: number }): Found[] {
  if (!/<item\b|<entry\b/i.test(opts.text)) return [];
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const item of itemsFromFeedXml(opts.text, opts.year)) {
    const raw = `${item.name} ${item.description || ''}`;
    if (!looksLikePersonalShip(raw) && !looksLikePersonalShip(item.name)) continue;
    const name = journalShipName(item.name);
    const key = loose(name);
    if (!name || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    found.push({
      name,
      description: clean(item.description || `Announced ${item.date} on ${hostOf(opts.url) ?? 'their site'}`, 140),
      date: item.date,
      dateConfidence: item.dateConfidence,
      link: item.link,
      icon: null,
      source: 'site',
      status: 'LAUNCHED',
      score: 7.5,
      thisYear: true,
    });
  }
  return found.slice(0, 80);
}

// Only monthly/MRR figures — a bare "$70" next to an "M" is not $70 million.
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?\s*(\/\s*mo(?:nth)?|\/m\b|MRR|per month)/gi;
const USERS = /\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*[kKmM])\s+(users?|customers?|founders?|subscribers?|visitors?)\b/gi;
const STARS = /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:GitHub\s+)?stars?\b/gi;
const VOTES = /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(upvotes?|votes?)\b/gi;

function parseAmount(raw: string, suffix?: string): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  const s = (suffix ?? '').trim().toLowerCase();
  if (s === 'k') return n * 1000;
  if (s === 'm') return n * 1_000_000;
  return n;
}

/** Public MRR, user counts, stars and upvotes printed on a page we already fetched. */
export function extractPublicStats(text: string, url: string, about?: string): SourcedStat[] {
  const stats: SourcedStat[] = [];
  const add = (stat: SourcedStat | null) => {
    if (!stat) return;
    if (stats.some((s) => s.kind === stat.kind && s.label === stat.label)) return;
    stats.push(stat);
  };
  for (const match of text.matchAll(MONEY)) {
    const value = parseAmount(match[1], match[2]);
    if (!Number.isFinite(value) || value < 100) continue;
    const before = text.slice(Math.max(0, match.index ?? 0 - 48), match.index ?? 0);
    const nearby = before.match(/([A-Za-z0-9][A-Za-z0-9._-]{2,32})(?:\.[a-z]{2,8})?\s*$/i)?.[1];
    const label = `${compactNumber(value)}/mo public revenue`;
    add(sourcedStat('mrr', label, value, url, nearby || about));
  }
  for (const match of text.matchAll(USERS)) {
    const value = parseAmount(match[1].replace(/\s*[kKmM]$/, ''), match[1].match(/[kKmM]$/)?.[0]);
    if (!Number.isFinite(value) || value < 50) continue;
    add(sourcedStat('users', `${compactNumber(value)} ${match[2].toLowerCase()}`, value, url, about));
  }
  for (const match of text.matchAll(STARS)) {
    const value = parseAmount(match[1]);
    if (!Number.isFinite(value) || value < 20) continue;
    add(sourcedStat('stars', `${compactNumber(value)} GitHub stars`, value, url, about));
  }
  for (const match of text.matchAll(VOTES)) {
    const value = parseAmount(match[1]);
    if (!Number.isFinite(value) || value < 20) continue;
    add(sourcedStat('upvotes', `${compactNumber(value)} ${match[2].toLowerCase()}`, value, url, about));
  }
  return stats.slice(0, 8);
}

export function githubContributions(html: string, year: number): number | null {
  const match = html.match(new RegExp(`([\\d,]+)\\s+contributions\\s+in\\s+${year}`, 'i'));
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export type ResearchGap =
  | 'own-site'
  | 'project-list'
  | 'github-profile'
  | 'thin-for-prolific'
  | 'revenue'
  | 'producthunt'
  | 'appstore';

export function detectGaps(gathered: Gathered): ResearchGap[] {
  const gaps: ResearchGap[] = [];
  const found = gathered.found;
  const siteItems = found.filter((item) => item.source === 'site' || item.source === 'web').length;
  const hasSite = Boolean(gathered.profile.site || gathered.site);
  const github = gathered.profile.github;
  const stats = gathered.stats ?? [];
  if (hasSite && siteItems < 2) gaps.push('own-site');
  if (hasSite && !found.some((item) => item.source === 'site' && item.thisYear)) gaps.push('project-list');
  if (github && !stats.some((s) => s.kind === 'repos' || s.kind === 'contributions')) gaps.push('github-profile');
  if (found.length < 10 && (Boolean(github) || hasSite)) gaps.push('thin-for-prolific');
  if (!stats.some((s) => s.kind === 'mrr') && /trustmrr|\$\d/i.test(`${gathered.site?.text ?? ''} ${gathered.profile.bio}`)) gaps.push('revenue');
  if (gathered.profile.x && !found.some((item) => item.source === 'producthunt')) gaps.push('producthunt');
  return [...new Set(gaps)];
}

export function mergeStats(lists: (SourcedStat | null | undefined)[][]): SourcedStat[] {
  const out: SourcedStat[] = [];
  for (const stat of lists.flat()) {
    if (!stat) continue;
    const key = `${stat.kind}|${stat.label}|${stat.url}`;
    if (out.some((s) => `${s.kind}|${s.label}|${s.url}` === key)) continue;
    out.push(stat);
  }
  const rank: Record<StatKind, number> = {
    mrr: 0,
    users: 1,
    stars: 2,
    downloads: 3,
    upvotes: 4,
    rank: 5,
    rating: 6,
    reviews: 7,
    hn: 8,
    contributions: 9,
    repos: 10,
    other: 11,
  };
  const cap: Partial<Record<StatKind, number>> = { mrr: 2, users: 2, other: 2 };
  const kept: SourcedStat[] = [];
  const used = new Map<StatKind, number>();
  for (const stat of out.sort((a, b) => (rank[a.kind] ?? 20) - (rank[b.kind] ?? 20) || (b.value ?? 0) - (a.value ?? 0))) {
    const n = (used.get(stat.kind) ?? 0) + 1;
    if (n > (cap[stat.kind] ?? 4)) continue;
    used.set(stat.kind, n);
    kept.push(stat);
    if (kept.length >= 12) break;
  }
  return kept;
}

/** Cashier lines: the number plus a host/path so the source is on the tape. */
export function formatReceiptStats(stats: SourcedStat[]): string[] {
  return stats.slice(0, 4).map((stat) => {
    const path = stat.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    const about = stat.about ? ` ${stat.about}` : '';
    return `${stat.label}${about} · ${path}`.slice(0, 90);
  });
}

export function extraResearchPaths(siteUrl: string): string[] {
  const url = publicUrl(siteUrl);
  if (!url) return [];
  const base = url.replace(/\/+$/, '');
  return [
    `${base}/projects`,
    `${base}/now`,
    `${base}/changelog`,
    `${base}/2026`,
    `${base}/work`,
    `${base}/shipped`,
    `${base}/products`,
    `${base}/apps`,
    `${base}/blog`,
    `${base}/rss`,
    `${base}/feed`,
    `${base}/rss.xml`,
  ];
}

const PORTFOLIO_DATE = /^(createdAt|created_at|launchedAt|launched_at|shippedAt|shipped_at|publishedAt|published_at|date)$/i;
const PORTFOLIO_NAME = /^(name|title|label)$/i;
const PORTFOLIO_URL = /^(url|href|link|website|site)$/i;
const PORTFOLIO_LIST = /^(startups|products|projects|ships|apps)$/i;

function pickField(row: Record<string, unknown>, match: RegExp): unknown {
  for (const [key, value] of Object.entries(row)) {
    if (match.test(key)) return value;
  }
  return undefined;
}

function portfolioDate(value: unknown, year: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match || Number(match[1]) !== year) return null;
  return match[3] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[1]}-${match[2]}`;
}

function isPortfolioRow(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const name = pickField(row, PORTFOLIO_NAME);
  const href = pickField(row, PORTFOLIO_URL);
  const date = pickField(row, PORTFOLIO_DATE);
  return typeof name === 'string' && name.trim().length >= 2 && Boolean(href) && date != null;
}

function collectPortfolioRows(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 8 || out.length >= 80) return;
  if (Array.isArray(node)) {
    const rows = node.filter(isPortfolioRow);
    if (rows.length >= 2) {
      for (const row of rows) {
        if (out.length >= 80) break;
        out.push(row);
      }
      return;
    }
    for (const item of node) collectPortfolioRows(item, out, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (PORTFOLIO_LIST.test(key) && Array.isArray(value)) collectPortfolioRows(value, out, depth + 1);
    else if (value && typeof value === 'object') collectPortfolioRows(value, out, depth + 1);
  }
}

export function embeddedPageBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];
  const add = (raw: string) => {
    const text = raw.trim();
    if (text.length < 20 || text.length > 800_000) return;
    try {
      blobs.push(JSON.parse(text));
    } catch {
      /* ignore */
    }
  };
  if (html.trim().startsWith('{') || html.trim().startsWith('[')) add(html);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1);
    const body = match[1] || '';
    if (/id=["']__NEXT_DATA__["']/i.test(tag) || /type=["']application\/json["']/i.test(tag)) add(body);
  }
  return blobs;
}

/**
 * Indie Page / similar personal portfolios keep the product list in __NEXT_DATA__.
 * HTML text extraction strips <script>, so dated 2026 startups never reached the tape.
 */
export function itemsFromEmbeddedPortfolio(opts: { html: string; url: string; year: number }): Found[] {
  const found: Found[] = [];
  const seen = new Set<string>();
  const add = (name: string, date: string, href: string | null, hint: string) => {
    const trimmed = clean(name, 40);
    if (!trimmed || trimmed.length < 2) return;
    const key = loose(trimmed);
    if (key.length < 2 || seen.has(key)) return;
    if (/^(home|about|blog|contact|projects?|changelog|indie page)$/i.test(trimmed)) return;
    seen.add(key);
    found.push({
      name: trimmed,
      description: clean(hint, 140),
      date,
      dateConfidence: 'exact',
      link: href || publicUrl(opts.url),
      icon: null,
      source: 'site',
      status: 'LAUNCHED',
      score: 8,
      thisYear: true,
    });
  };

  const rows: Record<string, unknown>[] = [];
  for (const blob of embeddedPageBlobs(opts.html)) collectPortfolioRows(blob, rows);
  for (const row of rows) {
    if (row.isShown === false) continue;
    const date = portfolioDate(pickField(row, PORTFOLIO_DATE), opts.year);
    if (!date) continue;
    const name = String(pickField(row, PORTFOLIO_NAME) || '');
    const href = publicUrl(String(pickField(row, PORTFOLIO_URL) || ''));
    const bio = typeof row.bio === 'string' ? clean(row.bio, 120) : '';
    add(name, date, href, bio || `Listed ${date} on ${hostOf(opts.url) ?? 'their site'}`);
  }
  return found.slice(0, 40);
}

export function trustmrrUrls(profile: Profile): string[] {
  return [...new Set([profile.x, profile.github].filter((h): h is string => Boolean(h)))].map(
    (handle) => `https://trustmrr.com/founder/${encodeURIComponent(handle.toLowerCase())}`,
  );
}

export function withMetrics(item: Found, metrics: (SourcedStat | null | undefined)[]): Found {
  const next = metrics.filter((m): m is SourcedStat => Boolean(m));
  if (!next.length) return item;
  return { ...item, metrics: [...(item.metrics ?? []), ...next] };
}

export function describeWithStat(item: Found): string {
  const stat = item.metrics?.[0];
  if (!stat) return item.description;
  if (item.description.toLowerCase().includes(stat.label.toLowerCase().slice(0, 8))) return item.description;
  const joined = item.description ? `${item.description} · ${stat.label}` : stat.label;
  return clean(joined, 140);
}

export type CoverageReport = {
  gaps: ResearchGap[];
  searchCap: number;
  budgetMicros: number;
  coverageCapped: boolean;
  /** What one more search wave would cost if we refused to stop. */
  nextWaveUsd: number;
};

/** How many paid searches the remaining budget can still buy. Never silent-cut without saying so. */
export function searchBudget(opts: { remainingMicros: number; want: number; searchMicros: number }): CoverageReport['searchCap'] {
  const affordable = Math.max(0, Math.floor(opts.remainingMicros / Math.max(1, opts.searchMicros)));
  return Math.min(opts.want, affordable);
}
