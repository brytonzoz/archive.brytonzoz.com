// Hard pre-filters + title cleanup for the SHIPPED tape. Runs BEFORE Decisions
// so bylines, docs nav, roundups, and cut-off headings never get scored as ships.
import type { Affiliation } from './shipped-affiliation';
import type { ItemStatus } from '../lib/shipped-year';
import { ITEM_STATUSES } from '../lib/shipped-year';

export const TITLE_MAX = 38;

const DOCS_NAV =
  /^(overview|prompting|pool|security|browser|search|terminal|settings|plugins?|hooks?|cli|api|faq|guides?|reference|getting started|quickstart|quick start|installation|install|usage|examples?|changelog|release notes|acting as users|builds|context|rules|modes?|models?|indexing|privacy|enterprise|teams|billing|account|authentication|auth|docs|home|index)$/i;
const BYLINE = /^(authors?\s*[:\-–—]|written by\b|posted by\b|byline\s*:)/i;
const ROUNDUP = /^(week of|this week in|monthly roundup|what we shipped (this|the) week)\b/i;
const READ_THE = /^(read the|see the|check out the|learn more)\b/i;
const TRAILING_PREP = /\b(of|in|to|for|and|or|the|a|an|with|on|as|by|from|into|longer|kind|new|our|your)$/i;
const MID_WORD =
  /^(ontrol|elease|pdate|ettings|vailable|olling|espectively|ead|nounced|ntroducing|aunched|hipped)\b/i;
const OLD_PRODUCT =
  /\b(gpt-?3(?:\.5)?(?:-turbo)?|text-embedding-?[123]|embedding v[123]|ada-?002|davinci|curie|babbage|turbo-0?125|whisper-1)\b/i;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const META_DESC = /^(sitemap lastmod|dated |linked from )/i;

export type Polishable = {
  name: string;
  description?: string;
  date: string | null;
  link?: string | null;
  source?: string;
  status?: string;
  via?: string | null;
  thisYear?: boolean;
  score?: number;
  significance?: number;
};

export type PolishOpts = {
  year: number;
  who?: string | null;
  affiliation?: Affiliation | null;
};

function tidy(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loose(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function wordClamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space >= Math.max(8, Math.floor(max * 0.4)) ? cut.slice(0, space) : cut).replace(/[,:;–—-]+$/, '').trim();
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
}

function hrefKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

export function isChangelogIndexHref(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    return /\/(changelog|docs\/changelog|whats-new|what-s-new|releases|updates|release-notes)$/i.test(path);
  } catch {
    return false;
  }
}

export function looksMidWord(text: string): boolean {
  const first = (text.trim().split(/\s+/)[0] || '');
  if (MID_WORD.test(first)) return true;
  if (/^(is|are|was|were|can|will|to)\s+/i.test(text.trim())) return true;
  return false;
}

export function looksCutOff(text: string): boolean {
  const trimmed = text.trim();
  if (/[,;]\s*$/.test(trimmed)) return true;
  if (TRAILING_PREP.test(trimmed) && trimmed.split(/\s+/).length >= 4) return true;
  if (/\b(turn on enable|enable full)\b/i.test(trimmed)) return true;
  return false;
}

export function isAboutPerson(title: string, who: string | null | undefined): boolean {
  const name = tidy(who);
  if (!name || name.length < 5) return false;
  const a = loose(title);
  const b = loose(name);
  if (!b || b.length < 8) return false;
  if (a === b || a === `${b}s`) return true;
  const words = name.split(/\s+/).filter((word) => word.length > 2);
  if (words.length < 2) return false;
  const hay = title.toLowerCase();
  if (!words.every((word) => hay.includes(word.toLowerCase()))) return false;
  return title.split(/\s+/).length <= words.length + 2;
}

export function isJunkTitle(title: string, opts: { who?: string | null; company?: string | null } = {}): boolean {
  const text = tidy(title);
  if (!text || text.length < 3) return true;
  if (BYLINE.test(text) || ROUNDUP.test(text) || READ_THE.test(text)) return true;
  if (/^respectively\.?$/i.test(text)) return true;
  if (DOCS_NAV.test(text)) return true;
  if (isAboutPerson(text, opts.who)) return true;
  if (looksMidWord(text) || looksCutOff(text)) return true;
  if ((text.replace(/[^a-zA-Z]/g, '').length < 3) && /\d/.test(text)) return true;
  return false;
}

function normalizeVersionTokens(text: string): string {
  return text
    .replace(/\b(GPT|Grok|Claude|Gemini)[-\s]+(\d+)\s+(\d+)\b/gi, (_, brand: string, major: string, minor: string) => {
      const name = brand.toLowerCase() === 'gpt' ? 'GPT' : brand[0].toUpperCase() + brand.slice(1).toLowerCase();
      return `${name}-${major}.${minor}`;
    })
    .replace(/\b(GPT|Grok|Claude|Gemini)[-\s]+(\d+)\.(\d+)\b/gi, (_, brand: string, major: string, minor: string) => {
      const name = brand.toLowerCase() === 'gpt' ? 'GPT' : brand[0].toUpperCase() + brand.slice(1).toLowerCase();
      return `${name}-${major}.${minor}`;
    })
    .replace(/\b([A-Za-z][A-Za-z0-9.+-]{1,20})\s+(\d)\s+(\d)\b/g, '$1 $2.$3');
}

export function versionParts(name: string): { product: string; version: string } | null {
  const text = tidy(name);
  const match = text.match(/^(.+?)\s+v?(\d{1,3}(?:\.\d+){1,3})$/i);
  if (!match) return null;
  const product = match[1].replace(/\s+/g, ' ').trim();
  if (product.length < 2 || !/[a-z]/i.test(product)) return null;
  if (product.split(/\s+/).length > 3) return null;
  return { product, version: match[2] };
}

/** Extract a clean product / feature name. Empty string means drop the item. */
export function cleanShipTitle(raw: unknown, max = TITLE_MAX): string {
  let text = normalizeVersionTokens(tidy(raw));
  if (!text) return '';
  text = text
    .replace(/^(introducing|launching|announcing|presenting|meet|say hello to|now available[:\s]+|how to|read the)\s+/i, '')
    .replace(/\s+release notes\.?$/i, '')
    .replace(/\s+,/g, ',')
    .replace(/[,\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (isJunkTitle(text)) return '';
  const keepVersion = Boolean(versionParts(text));
  const clamped = wordClamp(text, keepVersion ? Math.max(max, 56) : max);
  if (!clamped || isJunkTitle(clamped) || looksMidWord(clamped) || looksCutOff(clamped)) return '';
  return clamped;
}

export function otherYearProduct(name: string, year: number): boolean {
  if (OLD_PRODUCT.test(name)) return true;
  const prior = year - 1;
  for (let y = 2010; y <= prior; y++) {
    if (new RegExp(`\\b${y}\\b`).test(name)) return true;
  }
  return false;
}

export function inYearDate(value: unknown, year: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;
  if (Number(match[1]) !== year) return null;
  return match[3] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[1]}-${match[2]}`;
}

export function inYearStrict(item: Polishable, year: number): boolean {
  if (otherYearProduct(item.name, year)) return false;
  const raw = item.date ? String(item.date) : '';
  if (/^\d{4}/.test(raw) && !raw.startsWith(String(year))) return false;
  const company = item.source === 'changelog' || item.source === 'company';
  if (company && !inYearDate(item.date, year)) return false;
  return true;
}

export function cleanStatus(value: unknown): ItemStatus {
  const text = String(value || '')
    .replace(/~+$/g, '')
    .trim()
    .toUpperCase();
  return (ITEM_STATUSES as string[]).includes(text) ? (text as ItemStatus) : 'LAUNCHED';
}

export function cleanDescription(value: unknown): string {
  const text = tidy(value);
  if (!text || META_DESC.test(text)) return '';
  return text;
}

export function viaBrand(company: string | null | undefined, host: string | null | undefined): string {
  const paren = tidy(company).match(/\(([^)]+)\)/)?.[1];
  if (paren) return tidy(paren);
  if (company) return tidy(company).replace(/\s*\([^)]+\)\s*/g, '').trim();
  if (host) {
    const leaf = host.split('.')[0] || '';
    return leaf ? leaf[0].toUpperCase() + leaf.slice(1) : '';
  }
  return '';
}

export function sourceVia(item: Polishable, affiliation?: Affiliation | null): string | null {
  const host = hostOf(item.link ?? null);
  const existing = tidy(item.via);
  if (existing && /^via\s+/i.test(existing) && /·/.test(existing) && !META_DESC.test(existing.replace(/^via\s+/i, ''))) {
    return existing;
  }
  const brand = viaBrand(affiliation?.company, host);
  if (brand && host) return `via ${brand} · ${host}`;
  if (brand) return `via ${brand}`;
  if (host) return `via ${host}`;
  return existing || null;
}

function titleScore(item: Polishable): number {
  let score = item.name.length;
  if (!looksMidWord(item.name) && !looksCutOff(item.name)) score += 12;
  if (/\d/.test(item.name)) score += 4;
  if (item.date) score += 3;
  score += item.significance ?? 0;
  score += item.score ?? 0;
  return score;
}

/** Same article URL → one item. Changelog index URLs keep their dated cards. */
export function collapseSameHref<T extends Polishable>(items: T[]): T[] {
  const best = new Map<string, T>();
  const indexCards: T[] = [];
  const none: T[] = [];
  for (const item of items) {
    if (!item.link) {
      none.push(item);
      continue;
    }
    if (isChangelogIndexHref(item.link)) {
      indexCards.push(item);
      continue;
    }
    const key = hrefKey(item.link);
    const prev = best.get(key);
    if (!prev || titleScore(item) > titleScore(prev)) best.set(key, item);
  }
  return [...none, ...indexCards, ...best.values()];
}

export function rollupVersions<T extends Polishable>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  const kept: T[] = [];
  for (const item of items) {
    const parts = versionParts(item.name);
    const month = item.date?.match(/^(\d{4})-(\d{2})/)?.[0];
    if (!parts || !month) {
      kept.push(item);
      continue;
    }
    const key = `${loose(parts.product)}|${month}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    if (list.length < 3) {
      kept.push(...list);
      continue;
    }
    const product = versionParts(list[0].name)?.product || list[0].name;
    const month = key.split('|')[1] ?? '';
    const mon = MONTHS_SHORT[Number(month.slice(5, 7)) - 1] || month;
    const latest = list.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
    kept.push({
      ...latest,
      name: `${product} · ${list.length} updates in ${mon}`,
      description: '',
    });
  }
  return kept;
}

export function noteCountMismatch(note: string, count: number): boolean {
  const mention = /\b(\d{1,4})\s+(public\s+)?(ships?|lines?|launches?|things?)\b/i.exec(note);
  if (!mention) return false;
  return Number(mention[1]) !== count;
}

export function polishCandidates<T extends Polishable>(items: T[], opts: PolishOpts): T[] {
  const year = opts.year;
  const who = opts.who || opts.affiliation?.name || '';
  const out: T[] = [];
  for (const item of items) {
    if (!inYearStrict(item, year)) continue;
    const name = cleanShipTitle(item.name);
    if (!name) continue;
    if (isJunkTitle(name, { who, company: opts.affiliation?.company })) continue;
    const date = inYearDate(item.date, year) ?? (item.source === 'changelog' || item.source === 'company' ? null : item.date);
    if ((item.source === 'changelog' || item.source === 'company') && !date) continue;
    out.push({
      ...item,
      name,
      description: cleanDescription(item.description),
      date,
      via: sourceVia({ ...item, name }, opts.affiliation),
      status: cleanStatus(item.status),
      thisYear: Boolean(date && String(date).startsWith(String(year))),
    });
  }
  const collapsed = collapseSameHref(out);
  const rolled = rollupVersions(collapsed);
  return rolled
    .map((item) => ({ ...item, name: versionParts(item.name) ? item.name : wordClamp(item.name, TITLE_MAX) }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
