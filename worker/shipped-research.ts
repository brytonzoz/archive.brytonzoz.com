// Multi-pass research for a SHIPPED receipt: identity is resolved first, then every public
// surface is harvested with real numbers, then a gap-fill pass (own /projects + TrustMRR +
// TinyFish / Claude, only while the receipt budget still has room). Stats always carry a
// source URL. This file is parsers + scoring; gather() in shipped-sources.ts runs the passes.

import type { ItemSource, ItemStatus } from '../lib/shipped-year';

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
    found.push({
      name: trimmed,
      description: clean(hint || `Listed under ${year} on ${hostOf(url) ?? 'their site'}`, 140),
      date,
      dateConfidence: date ? 'exact' : 'year',
      link: publicUrl(url),
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
  if (found.length < 6 && (Boolean(github) || hasSite)) gaps.push('thin-for-prolific');
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
  return [`${base}/projects`, `${base}/now`, `${base}/changelog`, `${base}/2026`, `${base}/work`, `${base}/shipped`];
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
