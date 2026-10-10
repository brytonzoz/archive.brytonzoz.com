// Generic first-party ship extractors: changelog cards, RSS/Atom, sitemaps, JSON-LD.
// No per-company URL tables — callers discover pages, this file turns dated markup into Found rows.
import { dateFromShipSlug, flagshipLaunchName, isFlagshipYearKeep, isJoinOrAcquire, isPriorYearJoin, knownFlagshipDate, stripDateSuffix } from './shipped-flagship';

export type ChangelogFound = {
  name: string;
  description: string;
  date: string | null;
  dateConfidence: 'exact' | 'year' | 'inferred' | 'unknown';
  link: string | null;
  icon: string | null;
  source: 'changelog' | 'company' | 'site';
  status: 'LAUNCHED' | 'SHIPPED' | 'RELEASED' | 'LIVE';
  score: number;
  thisYear: boolean;
};

export const COMPANY_PATHS = [
  '/changelog',
  '/blog',
  '/news',
  '/releases',
  '/updates',
  '/whats-new',
  "/what's-new",
  '/blog/changelog',
  '/docs/changelog',
  '/docs/release-notes',
  '/help/release-notes',
  '/platform/changelog',
  '/developers/changelog',
  '/products/release-notes',
  '/release-notes',
  '/api/changelog',
  '/api/docs/changelog',
  '/docs/api/changelog',
  '/index',
  '/product',
];

export const FEED_PATHS = [
  '/feed',
  '/rss',
  '/atom',
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/changelog/rss',
  '/changelog/rss.xml',
  '/changelog/feed',
  '/changelog/atom',
  '/changelog.xml',
  '/rss.xml',
  '/blog/rss',
  '/blog/feed',
  '/news/rss',
  '/news/feed',
  '/releases/feed',
  '/index.xml',
];

const MONTH: Record<string, string> = {
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

const MONTH_ALT = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const SKIP_TITLE =
  /^(home|about|blog|news|changelog|releases?|updates?|guides?|editorials?|listicles?|product|safety|research|company|all|careers?|sign in|log in|learn more|read more|show more|whats? new|index|docs|pricing|login|related posts?|skip to main content)$/i;
const ARTICLE_TITLE =
  /\b(how to|tutorial|case stud(?:y|ies)|customer stor(?:y|ies)|deep dive|event recap|what we learned|behind the scenes|lessons? from|research paper|whitepaper|customer spotlight|success stor(?:y|ies))\b/i;
const CUSTOMER_STORY =
  /\b(engineers? (accelerate|adopt|use|used|build|built)|frontier firms|pulling ahead|what i ship(?:ped)? here|ships faster with|customer spotlight)\b/i;
const SHIP_PREFIX = /^(introducing|launching|announcing|presenting|meet|say hello to|now available[:\s]+|how to|how|the)\s+/i;
const BARE_VERSION = /^v?\d+(?:\.\d+){1,4}[a-z0-9.-]*$/i;
const BARE_YEAR = /^20\d\d(?:-\d{2}){0,2}$/;
const BARE_ID_SLUG = /^(?:[a-z]+-)?(?:20)?\d{2,4}(?:-\d{2}){1,3}(?:-[a-z0-9]+)*$/i;

function tidy(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[<>`{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordClamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space >= Math.max(8, Math.floor(max * 0.4)) ? cut.slice(0, space) : cut).replace(/[,:;–—-]+$/, '').trim();
}

function clean(value: unknown, max: number): string {
  return wordClamp(tidy(value), max);
}

function isNoiseTitle(text: string): boolean {
  if (!text || text.length < 3 || SKIP_TITLE.test(text)) return true;
  if (/^authors?\s*[:\-–—]/i.test(text) || /^week of\b/i.test(text) || /^respectively\.?$/i.test(text)) return true;
  if (/^(overview|prompting|pool|security|browser|search|terminal|settings|acting as users|builds)$/i.test(text)) return true;
  if (BARE_YEAR.test(text) || BARE_VERSION.test(text) || BARE_ID_SLUG.test(text)) return true;
  if ((text.replace(/[^a-zA-Z]/g, '').length < 3) && /\d/.test(text)) return true;
  if (/^by\s+\S/i.test(text)) return true;
  if (/\bmin(?:ute)?s?\s+read\b/i.test(text)) return true;
  if (ARTICLE_TITLE.test(text) || CUSTOMER_STORY.test(text)) return true;
  if (/^how\s+\w+\s+is\b/i.test(text)) return true;
  if (/\baccelerating\b/i.test(text) && !/\b(launch|released?|version|v\d)\b/i.test(text)) return true;
  if (/^[A-Za-z0-9][\w.-]{1,40}\s+(builds|engineers?)\b/i.test(text)) return true;
  if (/\busing\b.{0,48}\bto\s+(search|find|build|make|create|train)\b/i.test(text)) return true;
  if (/\b(uses|using)\b.{0,48}\b(to|for)\b/i.test(text)) return true;
  if (/\bsystem card\b/i.test(text)) return true;
  if (/^(to get started|each dot |sign in |contact |blog \/|company \/)/i.test(text)) return true;
  if (/^(blog|company|research|sign in|contact|resources|customers|support|next|submit now|see the changelog|timeline|of the year|do not sell|series [abc])\b/i.test(text)) return true;
  if (/^(inside|beyond|securing|decision time|cfos?|what i ship)\b/i.test(text)) return true;
  if (/\b(ships faster with|running .{0,40} safely|harness engineering|beyond rate limits|leveraging|economics of|guidance)\b/i.test(text)) return true;
  if (/^(output:|screenshot|to get started|each dot |design \()/i.test(text)) return true;
  if (/^(launched|released|shipped|live|available)(\s+as(\s+a)?\s+\w+)?$/i.test(text)) return true;
  if (new RegExp(`^(?:${MONTH_ALT}),?\\s+20\\d\\d$`, 'i').test(text)) return true;
  if (/\b(practical guide|approach to|progress in|text provenance|advertising for)\b/i.test(text)) return true;
  if (/^(building|sharing|our approach)\b/i.test(text) && !/\b(launch|released?|version|cli|api|app|model)\b/i.test(text)) return true;
  if (text.length <= 3 && !/\d/.test(text)) return true;
  if (/^(fixes|updates|changes|improvements|bugfixes|misc)$/i.test(text)) return true;
  if (/,\s+(and|or|the|to|for)$/i.test(text)) return true;
  if (/\b(and|or|the|to|for)$/i.test(text) && text.split(/\s+/).length <= 8) return true;
  return false;
}

/** Headline verbs → a short product name. Never cut mid-word. */
export function shipName(value: unknown, max = 60): string {
  let text = stripDateSuffix(tidy(value))
    .replace(/^(guides?|editorials?|listicles?|news|product|safety|research|company|inside\s+\w+)\s+/i, '')
    .replace(/\s+\d+\s*min(?:ute)?s?\s*$/i, '')
    .replace(/^\d+\s*min(?:ute)?s?\s*·\s*/i, '')
    .replace(/^·\s*/, '');
  if (isNoiseTitle(text)) return '';
  text = text.replace(SHIP_PREFIX, '').trim();
  if (/\b(released|lets?|can also|can now|use a |with site)\b/i.test(text)) {
    const first = (text.split(/[.!?]/)[0] ?? text).trim();
    const named = first.match(
      /^(?:released|added|announced|launched)\s+([A-Z0-9@][\w. +-]{1,36}?)(?:\s+in\s+the\b.*)?$/i,
    );
    const lets = first.match(/^([A-Za-z][\w. -]{1,32}?)\s+(lets?|can also|can now)\b/i);
    const product = named?.[1] || lets?.[1] || '';
    text = tidy(product) || '';
    if (!text) return '';
  }
  text = text
    .replace(/\s+launches?\s+on\s+/i, ' for ')
    .replace(/\s+introduces?\s+/i, ' ')
    .replace(/\s+(launches?|released?|ships|is (?:now )?(?:live|available))$/i, '')
    .replace(/^new\s+/i, '')
    .replace(/\s+flow$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || isNoiseTitle(text)) return '';
  return wordClamp(text, max);
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

function loose(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function monthNum(word: string): string | null {
  return MONTH[word.toLowerCase().replace(/\.$/, '')] ?? null;
}

/** ISO, "Sep 23, 2026", "9 October 2026", RFC 2822, or month-day assumed as `year`. */
export function parseFlexibleDate(raw: string, year: number, assumeYear = false): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const iso = text.match(new RegExp(`\\b(${year})[-/.](\\d{1,2})(?:[-/.](\\d{1,2}))?`));
  if (iso) {
    const month = iso[2].padStart(2, '0');
    const day = iso[3] ? iso[3].padStart(2, '0') : '01';
    if (Number(month) < 1 || Number(month) > 12) return null;
    return `${year}-${month}-${day}`;
  }
  const md = text.match(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(${year}))?\\b`, 'i'));
  if (md && (md[3] || assumeYear)) {
    const month = monthNum(md[1]);
    if (month) return `${year}-${month}-${md[2].padStart(2, '0')}`;
  }
  const dm = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})(?:,)?(?:\\s+(${year}))?\\b`, 'i'));
  if (dm && (dm[3] || assumeYear)) {
    const month = monthNum(dm[2]);
    if (month) return `${year}-${month}-${dm[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    if (date.getUTCFullYear() === year) return date.toISOString().slice(0, 10);
  }
  return null;
}

export function titleFromSlug(url: string): string {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return clean(decodeURIComponent(path).replace(/\.(html?|md|xml)$/i, '').replace(/[-_]+/g, ' '), 60);
  } catch {
    return '';
  }
}

export function isShipPath(url: string): boolean {
  return /\/(changelog|blog|news|releases?|updates?|whats-new|what-s-new|index|research|product|codex|docs)(\/|$)/i.test(url);
}

/** Sitemap lastmod is not a ship. Only changelog/blog/news/release URLs, never docs nav. */
export function isSitemapShipPath(url: string): boolean {
  if (/\/docs\/(?!changelog|release)/i.test(url)) return false;
  return /\/(changelog|blog|news|releases?|updates?|whats-new|what-s-new|release-notes)(\/|$)/i.test(url);
}

export function productPaths(product: string | null | undefined): string[] {
  const slug = (product ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 2) return [];
  return [`/${slug}`, `/${slug}/changelog`, `/${slug}/whats-new`, `/${slug}/blog`, `/${slug}/news`, `/${slug}/releases`, `/docs/${slug}`, `/docs/${slug}/changelog`, `/developers/${slug}`, `/developers/${slug}/changelog`];
}

export function extractAlternateFeeds(html: string, base: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const type = /type=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const alt = /\balternate\b/i.test(rel) || /rss|atom|xml/i.test(type);
    if (!alt) continue;
    if (!/rss|atom|xml|feed/i.test(`${rel} ${type} ${href}`)) continue;
    try {
      const url = publicUrl(new URL(href, base).toString());
      if (url && !out.includes(url)) out.push(url);
    } catch {
      /* skip */
    }
  }
  return out.slice(0, 8);
}

function cleanTitle(name: string): string {
  const trimmed = shipName(name, 60);
  if (!trimmed || trimmed.length < 3) return '';
  if (BARE_YEAR.test(trimmed) || BARE_VERSION.test(trimmed)) return '';
  if (/^\d+\s*min/i.test(trimmed)) return '';
  if (/^(changelog|contact|sign in|download|contact sales|search blog)$/i.test(trimmed)) return '';
  if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}/i.test(trimmed)) return '';
  if (/^\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i.test(trimmed)) return '';
  return trimmed;
}

function row(name: string, date: string | null, url: string, year: number, _hint?: string): ChangelogFound | null {
  const flagship = flagshipLaunchName({ name, link: url, source: 'changelog', date });
  const title = flagship || cleanTitle(name);
  if (!title) return null;
  const slugDate = dateFromShipSlug(url, year);
  const draft = { name: title, link: url, source: 'changelog', date };
  if (isPriorYearJoin({ ...draft, date: date || slugDate }, year)) return null;
  if (isJoinOrAcquire(draft) && !String(date || slugDate || '').startsWith(String(year))) return null;
  const keepYear = isFlagshipYearKeep(draft, year);
  const known = knownFlagshipDate({ ...draft, date: date || slugDate }, year);
  const resolved = known || (date && date.startsWith(String(year)) ? date : slugDate);
  const dated = Boolean(resolved && resolved.startsWith(String(year)));
  const otherYear = Boolean(resolved && /^\d{4}/.test(resolved) && !resolved.startsWith(String(year)));
  return {
    name: title,
    description: hostOf(url) ?? '',
    date: dated ? resolved : null,
    dateConfidence: dated ? 'exact' : 'unknown',
    link: publicUrl(url),
    icon: null,
    source: 'changelog',
    status: 'LAUNCHED',
    score: dated || Boolean(flagship && keepYear) ? 7 : 5,
    thisYear: dated || Boolean(flagship && keepYear) || !otherYear,
  };
}

function titleish(line: string): string {
  const trimmed = line.replace(/^#{1,3}\s+/, '').trim();
  if (!trimmed || trimmed.length > 80) return '';
  if (/[.!?]$/.test(trimmed)) return '';
  return cleanTitle(trimmed);
}

function nearestTitle(before: string, after: string): string {
  const headingBefore = [...before.matchAll(/(?:^|\n)\s*#{1,3}\s+([A-Za-z0-9][^\n]{2,80})/g)].pop()?.[1];
  const headingAfter = after.match(/^\s*#{1,3}\s+([A-Za-z0-9][^\n]{2,80})/)?.[1];
  const bulletAfter = after.match(/^\s*(?:[-*•●]|\d+[.)])\s+([A-Za-z0-9][^\n]{2,80})/)?.[1];
  const linesBefore = before.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const lineBefore = [...linesBefore].reverse().map(titleish).find(Boolean);
  const lineAfter = after.split(/\n/).map((l) => l.trim()).map(titleish).find(Boolean);
  return cleanTitle(headingBefore || headingAfter || bulletAfter || lineBefore || lineAfter || '');
}

/** Cursor / OpenAI / Higgsfield: a 2026 date next to a heading or card title. */
export function itemsFromDatedCards(text: string, url: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const dateRe = new RegExp(
    `\\b(?:${year}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?|(?:${MONTH_ALT})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+${year}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_ALT}),?\\s+${year})\\b`,
    'gi',
  );
  for (const match of text.matchAll(dateRe)) {
    const date = parseFlexibleDate(match[0], year);
    if (!date) continue;
    const idx = match.index ?? 0;
    const name = nearestTitle(text.slice(Math.max(0, idx - 160), idx), text.slice(idx + match[0].length, idx + match[0].length + 160));
    const key = loose(name);
    if (!name || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    const item = row(name, date, url, year, `Dated ${date} on ${hostOf(url) ?? 'their site'}`);
    if (item) found.push(item);
  }
  return found;
}

/** `2026-07-23` then `### Codex CLI 0.145.0` (Codex / many docs changelogs). */
export function itemsFromIsoDateHeadings(text: string, url: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`(?:^|\\n)\\s*(${year}-\\d{2}-\\d{2})\\s*(?:\\n+\\s*#{0,3}\\s*|\\s+#{0,3}\\s*)([A-Za-z0-9][^\\n]{2,80})`, 'g');
  for (const match of text.matchAll(re)) {
    const name = cleanTitle(match[2]);
    const key = loose(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const item = row(name, match[1], url, year);
    if (item) found.push(item);
  }
  return found;
}

/** `## October 1, 2026 release` then `## 3.23` (Cursor docs release notes). */
export function itemsFromVersionReleases(text: string, url: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const dated = new RegExp(`(?:^|\\n)\\s*#{1,3}\\s*((?:${MONTH_ALT})\\s+\\d{1,2},?\\s+${year})\\s+release\\b`, 'gi');
  const marks = [...text.matchAll(dated)];
  for (let i = 0; i < marks.length; i++) {
    const date = parseFlexibleDate(marks[i][1], year);
    if (!date) continue;
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : Math.min(text.length, start + 400);
    const version = text.slice(start, end).match(/#{1,3}\s*(v?\d+\.\d+(?:\.\d+)?)/)?.[1];
    const name = version ? `${hostOf(url)?.split('.')[0] ?? 'Release'} ${version}` : `${marks[i][1]} release`;
    const key = loose(name + date);
    if (seen.has(key)) continue;
    seen.add(key);
    const item = row(name, date, url, year);
    if (item) found.push(item);
  }
  return found;
}

/** Vercel-style `9 October` / `October 9` day headings, then dash bullets (year assumed on changelog pages). */
export function itemsFromMonthHeadings(text: string, url: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const heading = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?(\\d{1,2}\\s+(?:${MONTH_ALT})|(?:${MONTH_ALT})\\s+\\d{1,2})(?:\\s+${year})?\\b`, 'gi');
  const marks = [...text.matchAll(heading)];
  for (let i = 0; i < marks.length; i++) {
    const date = parseFlexibleDate(marks[i][1], year, true);
    if (!date) continue;
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : Math.min(text.length, start + 900);
    const chunk = text.slice(start, end);
    for (const line of chunk.split(/\n/).slice(0, 12)) {
      const bullet = line.match(/^\s*(?:[-*•●]|\d+[.)])\s+([A-Za-z0-9][^\n]{2,90})$/);
      const plain = !bullet && /^\s*[A-Z][A-Za-z0-9].{8,90}$/.test(line) ? line.trim() : '';
      const name = cleanTitle(bullet?.[1] || plain);
      const key = loose(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const item = row(name, date, url, year);
      if (item) found.push(item);
    }
  }
  return found;
}

export function itemsFromFeedXml(xml: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];
  for (const block of blocks) {
    const chunk = block[0];
    const title = clean(decodeXml(chunk.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 120);
    const link =
      publicUrl(decodeXml(chunk.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? '')) ??
      publicUrl(decodeXml(chunk.match(/<link\b[^>]*>([^<]+)<\/link>/i)?.[1] ?? '')) ??
      publicUrl(decodeXml(chunk.match(/<id>([^<]+)<\/id>/i)?.[1] ?? ''));
    const datedRaw =
      chunk.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)</i)?.[1] ??
      chunk.match(/<(?:pubDate|published|updated)[^>]*>([^<]+)</i)?.[1] ??
      '';
    const date = parseFlexibleDate(datedRaw, year);
    if (!date || !title || !link) continue;
    if (!date.startsWith(String(year))) continue;
    if (/\/blog\//i.test(link) && !/changelog/i.test(link)) {
      if (ARTICLE_TITLE.test(title) || CUSTOMER_STORY.test(title) || /^how\s+/i.test(title) || /^state of\b/i.test(title) || /\brecap\b/i.test(title)) {
        continue;
      }
    }
    const key = loose(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const item = row(title, date, link, year, clean(decodeXml(chunk.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))/i)?.[1] ?? ''), 140));
    if (item) found.push(item);
  }
  return found;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ');
}

export function itemsFromSitemap(xml: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  for (const block of xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)) {
    const loc = publicUrl(decodeXml(block[0].match(/<loc>\s*([^<]+)\s*<\/loc>/i)?.[1] ?? ''));
    if (!loc || !isSitemapShipPath(loc)) continue;
    const name = titleFromSlug(loc);
    const key = loose(name) || loc;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    // lastmod is crawl metadata, not a publish date — never stamp it as the ship day.
    const item = row(name, null, loc, year);
    if (item) found.push(item);
    if (found.length >= 160) break;
  }
  return found;
}

export function sitemapChildLocs(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)) {
    const loc = publicUrl(decodeXml(match[0].match(/<loc>\s*([^<]+)\s*<\/loc>/i)?.[1] ?? ''));
    if (loc && /sitemap|blog|news|changelog|release|index/i.test(loc) && !out.includes(loc)) out.push(loc);
  }
  return out.slice(0, 4);
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [k: string]: JsonValue };

function walkJson(value: JsonValue, visit: (node: Record<string, JsonValue>) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  visit(value);
  for (const child of Object.values(value)) walkJson(child, visit);
}

export function itemsFromJsonLd(html: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  for (const script of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let raw: JsonValue = null;
    try {
      raw = JSON.parse(script[1]) as JsonValue;
    } catch {
      continue;
    }
    walkJson(raw, (node) => {
      const types = [node['@type']].flat().map((t) => String(t || '').toLowerCase());
      const dated = parseFlexibleDate(String(node.datePublished || node.dateCreated || node.dateModified || ''), year);
      const name = clean(String(node.headline || node.name || ''), 80);
      const link = publicUrl(String((typeof node.url === 'string' ? node.url : '') || (typeof node['@id'] === 'string' ? node['@id'] : '')));
      const article = types.some((t) => /blogposting|newsarticle|article|techarticle|report/.test(t));
      if (article && dated && name && link) {
        const key = loose(name);
        if (seen.has(key)) return;
        seen.add(key);
        const item = row(name, dated, link, year);
        if (item) found.push(item);
      }
    });
  }
  return found;
}

export function itemsFromNewsLinks(
  links: { text: string; url: string }[],
  year: number,
  pageUrl: string,
): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const hay = `${link.text} ${link.url}`;
    const dated = hay.includes(String(year)) || Boolean(parseFlexibleDate(link.text, year));
    if (!dated && !isShipPath(link.url)) continue;
    if (/\/(about|careers?|jobs|login|privacy|terms|legal|pricing|signup)\b/i.test(link.url)) continue;
    try {
      const path = new URL(link.url).pathname.replace(/\/+$/, '').toLowerCase();
      if (/\/blog\/category(?:\/|$)/.test(path)) continue;
      if (/^\/docs(?:\/|$)/.test(path) && !/changelog|release-notes/i.test(path)) continue;
      if (/\/(changelog|releases?|whats-new|updates?)\b/i.test(pageUrl) && !/\/(changelog|releases?|whats-new|updates?|release-notes)\//i.test(path)) {
        continue;
      }
    } catch {
      /* keep */
    }
    const name = cleanTitle(link.text) || titleFromSlug(link.url);
    const key = loose(name);
    if (!name || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    const date = parseFlexibleDate(link.text, year) ?? (dated ? `${year}-01-01` : null);
    const item = row(name, date, publicUrl(link.url) ?? pageUrl, year, `Linked from ${hostOf(pageUrl) ?? 'their site'}`);
    if (item) {
      if (!dated) item.thisYear = false;
      found.push(item);
    }
  }
  return found;
}

export function mergeChangelog(lists: ChangelogFound[][]): ChangelogFound[] {
  const seen = new Set<string>();
  const out: ChangelogFound[] = [];
  for (const item of lists.flat()) {
    const key = `${loose(item.name)}|${item.date ?? ''}|${item.link ?? ''}`;
    if (!item.name || seen.has(key) || seen.has(loose(item.name))) continue;
    seen.add(key);
    seen.add(loose(item.name));
    out.push(item);
    if (out.length >= 180) break;
  }
  return out;
}

/** Every generic extractor on one page: HTML text + optional raw HTML + feeds already inlined. */
/** `<time>2026-10-08</time>` next to an `<h3>` — docs changelogs (Codex, API, many Mintlify/Starlight sites). */
export function itemsFromTimedHeadings(html: string, url: string, year: number): ChangelogFound[] {
  const found: ChangelogFound[] = [];
  const seen = new Set<string>();
  const add = (dateRaw: string, titleHtml: string) => {
    const date = parseFlexibleDate(tidy(dateRaw.replace(/<[^>]+>/g, ' ')), year);
    const span = titleHtml.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const name = cleanTitle(
      tidy((span || titleHtml).replace(/<[^>]+>/g, ' ').replace(/\bcopy link to\b[\s\S]*/i, '')),
    );
    const key = loose(name);
    if (!date || !name || key.length < 3 || seen.has(key)) return;
    seen.add(key);
    const item = row(name, date, url, year);
    if (item) found.push(item);
  };
  const timeThenHeading = new RegExp(
    `<time\\b([^>]*)>([\\s\\S]*?)</time>[\\s\\S]{0,500}?<h[1-4]\\b[^>]*>([\\s\\S]*?)</h[1-4]>`,
    'gi',
  );
  const headingThenTime = new RegExp(
    `<h[1-4]\\b[^>]*>([\\s\\S]*?)</h[1-4]>[\\s\\S]{0,500}?<time\\b([^>]*)>([\\s\\S]*?)</time>`,
    'gi',
  );
  for (const match of html.matchAll(timeThenHeading)) {
    add(match[1].match(/datetime=["']([^"']+)["']/i)?.[1] || match[2], match[3]);
  }
  for (const match of html.matchAll(headingThenTime)) {
    add(match[2].match(/datetime=["']([^"']+)["']/i)?.[1] || match[3], match[1]);
  }
  const datedLi = new RegExp(`<li\\b[^>]*id=["']([^"']*${year}-\\d{2}-\\d{2}[^"']*)["'][^>]*>([\\s\\S]*?)</li>`, 'gi');
  for (const match of html.matchAll(datedLi)) {
    const date = parseFlexibleDate(match[1], year);
    const heading = match[2].match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ?? '';
    if (date && heading) add(date, heading);
  }
  return found;
}

export function itemsFromCompanyPage(opts: {
  text: string;
  html?: string;
  url: string;
  year: number;
  links?: { text: string; url: string }[];
}): ChangelogFound[] {
  const assume = /\/(changelog|releases?|whats-new|updates?)\b/i.test(opts.url);
  const monthItems = assume ? itemsFromMonthHeadings(opts.text, opts.url, opts.year) : [];
  return mergeChangelog([
    itemsFromIsoDateHeadings(opts.text, opts.url, opts.year),
    itemsFromDatedCards(opts.text, opts.url, opts.year),
    itemsFromVersionReleases(opts.text, opts.url, opts.year),
    monthItems,
    opts.html ? itemsFromTimedHeadings(opts.html, opts.url, opts.year) : [],
    opts.html ? itemsFromJsonLd(opts.html, opts.year) : [],
    itemsFromNewsLinks(opts.links ?? [], opts.year, opts.url),
  ]);
}
