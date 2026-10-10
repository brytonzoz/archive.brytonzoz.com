// Hard pre-filters + title cleanup for the SHIPPED tape. Runs BEFORE Decisions
// so bylines, docs nav, roundups, and cut-off headings never get scored as ships.
import type { Affiliation } from './shipped-affiliation';
import { isJunkProductName, looksLikeCodeIdentifier, looksLikePersonName } from './shipped-repos';
import {
  cursorModelTitle,
  flagshipLaunchName,
  isCursorModelNote,
  isFlagshipYearKeep,
  isJoinOrAcquire,
  isPriorYearJoin,
  knownFlagshipDate,
  logFlagshipGate,
  stripDateSuffix,
} from './shipped-flagship';
import { ownedByBuilder, type OwnerContext } from './shipped-ownership';
import type { ItemStatus } from '../lib/shipped-year';
import { ITEM_STATUSES } from '../lib/shipped-year';

export const TITLE_MAX = 38;

const DOCS_NAV =
  /^(overview|prompting|pool|security|browser|search|terminal|settings|plugins?|hooks?|cli|api|faq|guides?|reference|getting started|quickstart|quick start|installation|install|usage|examples?|changelog|release notes|acting as users|builds|context|rules|modes?|models?|indexing|privacy|enterprise|teams|billing|account|authentication|auth|docs|home|index|support|repositories|ideas|pull requests)$/i;
const BYLINE = /^(authors?\s*[:\-–—]|written by\b|posted by\b|byline\s*:)/i;
const NAME_LIST =
  /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}(?:,| and )\s+[A-Z][A-Za-z.'-]+/;
const ROUNDUP =
  /^(week of|this week in|monthly roundup|what we shipped (this|the) week)\b|updates?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d\d/i;
const READ_THE = /^(read the|see the|check out the|learn more|if you\b|those\b|your agent can\b|prepare for\b|choose \w+ for complex)\b/i;
const INSTRUCTIONAL = /^(if you|those |your agent can|you can|you don|use a |use the |use \w[\w.-]* for complex)\b/i;
const RESEARCH_GERUND = /^(improving|bootstrapping|deprecating|continually|reward hacking|evaluating)\b/i;
const ACQUISITION = /\b(is now a part of|acquired by|has been acquired)\b/i;
const CUSTOMER_STORY = /\bships\s+[\d.,]+[×x]\s+faster\b|·\s*\d+[kmb]\s*$/i;
const TRAILING_PREP =
  /\b(of|in|to|for|and|or|the|a|an|with|on|as|by|from|into|longer|kind|new|our|your|through|their|its|vs|lower|higher|more|less|day|days|managed|security|controlled|trusted|general|advanced|remote|task|chat)$/i;
const TITLE_START_BAD =
  /^(in|on|at|for|with|from|to|of|by|as|a|an|the|and|or|use|using|start|starting|lines|line|built|build|building|run|running|join|joining|announce|announces|announcing|added|add|fixed|fix|connect|review|share|more|ways|preview|control|give|let|take|work|choose|scan|create|organize|talk|try|visit|explore|download|get|see|read|learn|follow|watch|make|making|how|when|while|after|before|without|inside|beyond|under|over|my|our|your|quitting)\b/i;
const TITLE_END_BAD = /\b(of|a|an|the|with|and|or|security|controlled|trusted|general|advanced|remote|task|chat)\s*$/i;
const TITLE_VERB =
  /^(announces|announce|announced|connects|connect|built|builds|building|works|working|uses|using|used|launched|ships|shipped|released|added|adds|created|makes|made|lets|can|will|is|are|was|were|gives|reaches|joins|keeps|combines|deprecated)$/i;
const SENTENCE_VERB =
  /\b(announces|announce|announced|connects|gives|reaches|joins|keeps|combines|deprecated|also added|is now|now keeps)\b/i;
const BARE_MODEL = /^gpt-\d+$/i;
const CODE_TITLE = /^[a-z][\w-]*\.[a-z][\w-]*\.[a-z]/i;
const MID_WORD =
  /^(ontrol|elease|pdate|ettings|vailable|olling|espectively|ead|nounced|ntroducing|aunched|hipped)\b/i;
const OLD_PRODUCT =
  /\b(gpt-?4o(?:-mini)?|gpt-?3(?:\.5)?(?:-turbo)?|text-embedding-?[123]|embedding v[123]|ada-?002|davinci|curie|babbage|turbo-0?125|whisper-1|o1|o3(?:-mini)?)\b/i;
const CTA_NAV =
  /^(visit our|try .{0,24} now|explore (enterprise|pricing|docs|plans)|watch (on )?youtube|subscribe|follow us|join (us|now)|get started|sign up|learn more|see more|read more|contact (us|sales)|book a (demo|call)|youtube channel)\b/i;
const CTA_TRAIL = /[↗→⬅︎↵]\s*$|youtube channel|try cursor now|explore enterprise/i;
const FRAGMENT_START = /^(ies|ing|ted|ated|nced|trol|elease|pdate|ontrol|espectively)\b/i;
const PLATFORM_LEAF =
  /(?:^|[-_/])(linux|darwin|win32|windows|freebsd|android|macos|ios)[-_]?(x64|arm64|armv7|ia32|x86_64|aarch64)?[-_]?(musl|gnu)?$/i;
const SCOPE_SUBPACKAGE =
  /^(types|loader|core|cli|native|bin|node|wasm|binding|runtime|parser|runner|extensions?)s?(?:[-_].+)?$/i;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const META_DESC = /sitemap lastmod|^(dated |linked from )/i;
const HOST_ONLY = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}$/i;
const PERSONAL_SOURCE = /^(github|npm|producthunt|appstore)$/;
const HOST_BRAND: Record<string, string> = {
  'cursor.com': 'Cursor',
  'openai.com': 'OpenAI',
  'chatgpt.com': 'OpenAI',
  'learn.chatgpt.com': 'OpenAI',
  'developers.openai.com': 'OpenAI',
  'platform.openai.com': 'OpenAI',
  'vercel.com': 'Vercel',
  'replit.com': 'Replit',
  'anthropic.com': 'Anthropic',
  'x.ai': 'xAI',
};
const KNOWN_BRAND: Record<string, string> = {
  cursor: 'Cursor',
  anysphere: 'Cursor',
  openai: 'OpenAI',
  vercel: 'Vercel',
  replit: 'Replit',
  anthropic: 'Anthropic',
  xai: 'xAI',
  higgsfield: 'Higgsfield',
};

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
  handle?: string | null;
  affiliation?: Affiliation | null;
  owner?: OwnerContext | null;
  onDrop?: (drop: PolishDrop) => void;
};

export type PolishDrop = { name: string; reason: string };

function shouldLogIndieDrops(who?: string | null, handle?: string | null): boolean {
  return /levelsio|pieter levels|marc ?lou|marclou|marc_lou/i.test(`${who || ''} ${handle || ''}`);
}

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

/** Personal project lists and homepage journals share one URL for many ships. */
export function isShipListHref(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return true;
    return /\/(projects?|now|shipped|launches?|apps?|work|products?|blog|2026)$/i.test(path);
  } catch {
    return false;
  }
}

export function looksMidWord(text: string): boolean {
  const first = (text.trim().split(/\s+/)[0] || '');
  if (MID_WORD.test(first) || FRAGMENT_START.test(first)) return true;
  if (/^(is|are|was|were|can|will|to)\s+/i.test(text.trim())) return true;
  return false;
}

export function looksFragment(text: string): boolean {
  const trimmed = tidy(text);
  if (!trimmed) return true;
  if (!/^[A-Za-z0-9@#]/.test(trimmed) && !/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return true;
  if (FRAGMENT_START.test(trimmed.split(/\s+/)[0] || '')) return true;
  return looksMidWord(trimmed);
}

export function looksCutOff(text: string): boolean {
  const trimmed = text.trim();
  if (/[,;·|]\s*$/.test(trimmed)) return true;
  if (/\([^)]*$/.test(trimmed)) return true;
  if (TRAILING_PREP.test(trimmed) && trimmed.split(/\s+/).length >= 3) return true;
  if (/\b(turn on enable|enable full|at lower|on ai)$/i.test(trimmed)) return true;
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

function isAcquisitionNews(title: string): boolean {
  if (!ACQUISITION.test(title)) return false;
  if (/\b(app|desktop|cli|api|sdk)\b/i.test(title)) return false;
  return true;
}

export function isJunkTitle(title: string, opts: { who?: string | null; company?: string | null } = {}): boolean {
  const text = tidy(title);
  if (!text || text.length < 3) return true;
  if (BYLINE.test(text) || NAME_LIST.test(text) || ROUNDUP.test(text) || READ_THE.test(text) || INSTRUCTIONAL.test(text)) return true;
  if (RESEARCH_GERUND.test(text) || CUSTOMER_STORY.test(text) || isAcquisitionNews(text)) return true;
  if (CTA_NAV.test(text) || CTA_TRAIL.test(text)) return true;
  if (/^(download on the|get it on|get the app|affiliates|analytics|available on|filed under|quitting)\b/i.test(text)) return true;
  if (CODE_TITLE.test(text) || /^(object|query|router)$/i.test(text)) return true;
  if (/\bgithub stars\b|\bweekly downloads\b/i.test(text) && !/\b(zod|nub|tsc|cli|app)\b/i.test(text)) return true;
  if (/^respectively\.?$/i.test(text)) return true;
  if (DOCS_NAV.test(text) || /^(recent highlights|cursor support|under:|blog\s*\/\s*research|blog|research)$/i.test(text)) return true;
  if (isAboutPerson(text, opts.who)) return true;
  if (looksLikePersonName(text, opts.who) || looksLikeCodeIdentifier(text)) return true;
  if (isPricingOrMetricNote(text)) return true;
  if (/^(the )?(guy|person|one) who made\b/i.test(text)) return true;
  const whoLast = (opts.who || '').split(/\s+/).filter((word) => word.length > 2);
  if (/^[A-Z]\s+[A-Z]{2,}$/.test(text) && whoLast.some((word) => loose(text).includes(loose(word)))) return true;
  if (looksFragment(text) || looksMidWord(text) || looksCutOff(text)) return true;
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

export function isPricingOrMetricNote(name: string): boolean {
  const text = tidy(name);
  if (/\b(pric(e|ing|es)|plans?|billing|skus?)\b/i.test(text) && !/\b(app|cli|sdk|api|model)\b/i.test(text)) return true;
  if (/^(improved|better|faster|cheaper|reduced|lower|higher)\s+[A-Za-z]+(?:\s+[A-Za-z]+)?$/i.test(text)) return true;
  return false;
}

const VERSION = String.raw`v?(?:\d{4}\.\d{1,2}\.\d{1,2}|\d{1,3}(?:\.\d+){1,3})`;

export function versionParts(name: string): { product: string; version: string; extra?: number } | null {
  const text = tidy(name)
    .replace(/\s+(reconnects?|released?|shipped|available)$/i, '')
    .trim();
  const comma = text.match(new RegExp(`^(.+?)\\s+(${VERSION})(?:\\s*,\\s*${VERSION})+$`, 'i'));
  if (comma) {
    const product = comma[1].replace(/\s+/g, ' ').trim();
    const versions = text.match(new RegExp(VERSION, 'gi')) ?? [];
    if (product.length >= 2 && /[a-z]/i.test(product) && product.split(/\s+/).length <= 4) {
      return { product, version: comma[2], extra: versions.length };
    }
  }
  const match = text.match(new RegExp(`^(.+?)\\s+(${VERSION})$`, 'i'));
  if (!match) return null;
  const product = match[1].replace(/\s+/g, ' ').trim();
  if (product.length < 2 || !/[a-z]/i.test(product)) return null;
  if (product.split(/\s+/).length > 4) return null;
  return { product, version: match[2] };
}

/** Pull a product/feature noun phrase out of a changelog sentence, or empty to drop. */
export function nounPhraseFromSentence(raw: string): string {
  let text = tidy(raw);
  if (!text) return '';
  text = text.split(/[.!?]/)[0]?.trim() ?? text;
  text = text.split(/:\s+/)[0]?.trim() ?? text;
  text = text
    .replace(/^(released|added|announced|launched|shipped|introduced|built)\s+/i, '')
    .replace(/^(in the|on the)\s+/i, '')
    .trim();
  if (/^(use|give|let|take|work with|choose|scan|create|organize|talk through)\b/i.test(text)) {
    const product = text.match(
      /\b((?:gpt|codex|chatgpt|claude|cursor|grok)[\w. -]{0,28}|(?:[A-Z][A-Za-z0-9.+-]{2,20})(?:\s+(?:cli|api|app|sdk|ios|desktop))?)/i,
    );
    return product ? tidy(product[1]) : '';
  }
  const lets = text.match(/^([A-Za-z][\w. -]{1,32}?)\s+(lets?|can also|can now|will)\b/i);
  if (lets) return tidy(lets[1]);
  const isNow = text.match(/^([A-Za-z][\w.-]{1,32})\s+is now\b/i);
  if (isNow) return tidy(isNow[1]);
  const joining = text.match(/^([A-Za-z][\w.-]{1,32})\s+(?:is joining|joins)\s+([A-Za-z][\w.-]{1,32})/i);
  if (joining) return `${tidy(joining[1])} joining ${tidy(joining[2])}`;
  const report = text.match(/^a technical report on\s+(.+)$/i);
  if (report?.[1]) return tidy(report[1]);
  text = text
    .replace(/\s+in the (api|app|chatgpt|desktop app).*$/i, '')
    .replace(/\s+(can also|lets?|will retire).*$/i, '')
    .trim();
  return text;
}

/** Extract a clean product / feature name. Empty string means drop the item. */
export function cleanShipTitle(raw: unknown, max = TITLE_MAX): string {
  let text = normalizeVersionTokens(stripDateSuffix(tidy(raw)));
  if (!text) return '';
  const join = text.match(/^([A-Za-z][\w.-]{1,32})\s+(?:is joining|joins)\s+([A-Za-z][\w.-]{1,32})/i);
  if (join) text = `${join[1]} joining ${join[2]}`;
  const report = text.match(/^a technical report on\s+(.+)$/i);
  if (report?.[1]) text = report[1];
  const meet = text.match(/^meet the new\s+(.+)$/i);
  if (meet?.[1]) text = meet[1];
  if (/^codex,\s*our code generation cli tool$/i.test(text)) text = 'Codex CLI';
  text = text
    .replace(/^(introducing|launching|announcing|presenting|meet|say hello to|now available[:\s]+|how to|read the|launched)\s+/i, '')
    .replace(/\s+launched as\b.*$/i, '')
    .replace(/\s+(is )?(now |generally )?available( today| in\b.*)?$/i, '')
    .replace(/\s+(release|launch) notes\.?$/i, '')
    .replace(/\s+reconnects?$/i, '')
    .replace(/\s+,/g, ',')
    .replace(/[,\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const sentence = /\b(released|lets?|can also|can now|in the api|use a |with site)\b/i.test(text);
  if (sentence) {
    const phrase = nounPhraseFromSentence(text);
    if (!phrase || phrase.split(/\s+/).length > 6) return '';
    text = phrase;
  }
  if (!text) return '';
  if (isJunkTitle(text)) return '';
  const keepVersion = Boolean(versionParts(text));
  const clamped = wordClamp(text, keepVersion ? Math.max(max, 56) : max);
  if (!clamped || isJunkTitle(clamped) || looksMidWord(clamped) || looksCutOff(clamped) || looksFragment(clamped)) return '';
  return gateShipTitle(String(raw ?? ''), clamped);
}

/** Product / feature / model noun phrase. Sentence fragments and dangling preps fail. */
export function isProductNounPhrase(title: string): boolean {
  const text = tidy(title);
  if (!text) return false;
  if (TITLE_START_BAD.test(text) || TITLE_END_BAD.test(text)) return false;
  if (BARE_MODEL.test(text.replace(/\s+/g, ''))) return false;
  const words = text.split(/\s+/);
  if (words.length >= 2 && TITLE_VERB.test(words[1] || '')) return false;
  return true;
}

/** Final title gate: rewrite a heading into a noun phrase, or drop the line. */
export function gateShipTitle(raw: string, cleaned = ''): string {
  let text = tidy(cleaned || raw);
  if (!text) return '';
  const dotted = text.match(/^[^.]{2,40}\.\s+(?:in the\s+)?(.+)$/i);
  if (dotted && isProductNounPhrase(dotted[1])) text = dotted[1].trim();
  text = text.replace(/^(in the|on the|in|on|at the|at)\s+/i, '').trim();
  const works = text.match(/^(.{4,36}?)\s+works$/i);
  if (works && works[1].trim().split(/\s+/).length >= 2) text = works[1].trim();
  text = text.replace(/\s+\b(of|a|an|the|with|and|or|security|controlled|trusted|general|advanced|remote|task|chat)\s*$/i, '').trim();
  if (!text) return '';
  if (BARE_MODEL.test(text.replace(/\s+/g, ''))) return '';
  if (/^use\b/i.test(tidy(raw)) || /^use\b/i.test(text)) return '';
  if (SENTENCE_VERB.test(text) || CODE_TITLE.test(text)) {
    const phrase = nounPhraseFromSentence(raw);
    return phrase && isProductNounPhrase(phrase) && !SENTENCE_VERB.test(phrase) ? phrase : '';
  }
  if (isProductNounPhrase(text)) return text;
  const phrase = nounPhraseFromSentence(raw);
  if (phrase && isProductNounPhrase(phrase) && !/^use\b/i.test(tidy(raw))) return phrase;
  return '';
}

export function otherYearProduct(name: string, year: number): boolean {
  if (OLD_PRODUCT.test(name)) return true;
  const prior = year - 1;
  for (let y = 2010; y <= prior; y++) {
    if (new RegExp(`\\b${y}\\b`).test(name)) return true;
  }
  return false;
}

export function isScrapeDate(value: unknown, now = new Date()): boolean {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${match[1]}-${match[2]}-${match[3]}` === today;
}

export function isFutureDate(value: unknown, now = new Date()): boolean {
  const match = String(value || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return false;
  const day = match[3] ? Number(match[3]) : 1;
  const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return then > today;
}

export function inYearDate(value: unknown, year: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;
  if (Number(match[1]) !== year) return null;
  return match[3] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[1]}-${match[2]}`;
}

export function inYearStrict(item: Polishable, year: number): boolean {
  if (otherYearProduct(item.name, year) && !flagshipLaunchName(item)) return false;
  if (isPriorYearJoin(item, year)) return false;
  if (isJoinOrAcquire(item) && !String(item.date ?? '').startsWith(String(year))) return false;
  const raw = item.date ? String(item.date) : '';
  if (/^\d{4}/.test(raw) && !raw.startsWith(String(year))) {
    if (isFlagshipYearKeep(item, year)) return true;
    return false;
  }
  if (isFutureDate(item.date)) return false;
  const company = item.source === 'changelog' || item.source === 'company';
  if (company && isScrapeDate(item.date) && !flagshipLaunchName(item)) return false;
  if (company && item.date && !inYearDate(item.date, year) && !isFlagshipYearKeep(item, year)) return false;
  return true;
}

export function cleanStatus(value: unknown): ItemStatus {
  const text = String(value || '')
    .replace(/~+$/g, '')
    .trim()
    .toUpperCase();
  return (ITEM_STATUSES as string[]).includes(text) ? (text as ItemStatus) : 'LAUNCHED';
}

const DESC_MAX = 90;

export function cleanDescription(value: unknown): string {
  let text = tidy(value);
  if (!text || META_DESC.test(text) || HOST_ONLY.test(text)) return '';
  text = text
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\b(p|h[1-6]|div|span|img|a|ul|ol|li|br)\s+(align|class|src|href|style)=["'][^"']*["']/gi, ' ')
    .replace(/\b(p|h[1-6])\s+align=["']?center["']?/gi, ' ')
    .replace(/align=["']?center["']?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !text ||
    /<\/?[a-z]|align=["']|^(p|h[1-6]|div|span|img|ul|ol|li|picture|source)\b|\b(srcset|prefers-color-scheme|media=["'])/i.test(text)
  )
    return '';
  if (text.length <= DESC_MAX) return text;
  const cut = wordClamp(text, DESC_MAX);
  if (!cut) return '';
  return /[.!?…]$/.test(cut) ? cut : `${cut}…`;
}

export function prettyBrand(company: string | null | undefined, host?: string | null): string {
  if (host && HOST_BRAND[host]) return HOST_BRAND[host];
  const paren = tidy(company).match(/\(([^)]+)\)/)?.[1];
  const raw = tidy(paren || company || '').replace(/\s*\([^)]+\)\s*/g, '').trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (KNOWN_BRAND[key]) return KNOWN_BRAND[key];
  if (raw) return raw.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
  if (host) {
    const leaf = host.split('.')[0] || '';
    return leaf ? leaf[0].toUpperCase() + leaf.slice(1) : '';
  }
  return '';
}

export function viaBrand(company: string | null | undefined, host: string | null | undefined): string {
  return prettyBrand(company, host);
}

function isPersonalItem(item: Polishable): boolean {
  if (PERSONAL_SOURCE.test(item.source ?? '')) return true;
  if ((item.source === 'site' || item.source === 'web') && item.link) {
    try {
      const path = new URL(item.link).pathname.replace(/\/+$/, '');
      if (!path) return true;
    } catch {
      /* ignore */
    }
    return item.source === 'site';
  }
  return false;
}

export function sourceVia(item: Polishable, affiliation?: Affiliation | null): string | null {
  const host = hostOf(item.link ?? null);
  if (isPersonalItem(item)) return host ? `via ${host}` : null;
  const brand = prettyBrand(affiliation?.company, host);
  const product = affiliation?.product && affiliation.role === 'lead' ? tidy(affiliation.product) : '';
  if (brand && product) return `via ${brand} · ${product}`;
  if (brand && host) return `via ${brand} · ${host}`;
  if (brand) return `via ${brand}`;
  if (host) return `via ${host}`;
  return null;
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
    if (isChangelogIndexHref(item.link) || isShipListHref(item.link) || item.source === 'site') {
      indexCards.push(item);
      continue;
    }
    const key = hrefKey(item.link);
    const prev = best.get(key);
    if (!prev || titleScore(item) > titleScore(prev)) best.set(key, item);
  }
  return [...none, ...indexCards, ...best.values()];
}

function versionCount(item: Polishable): number {
  return versionParts(item.name)?.extra ?? 1;
}

export function npmFamilyKey(name: string): string | null {
  const raw = tidy(name).replace(/^@/, '');
  if (!raw) return null;
  const slash = raw.indexOf('/');
  const scope = slash >= 0 ? raw.slice(0, slash) : null;
  const pkg = slash >= 0 ? raw.slice(slash + 1) : raw;
  const brand = (scope || '').replace(/js$/i, '');
  if (scope && /^shooj?s?$/i.test(scope)) return 'shoo';
  if (scope && loose(pkg) === loose(brand)) return brand;
  if (scope && (PLATFORM_LEAF.test(pkg) || SCOPE_SUBPACKAGE.test(pkg))) return brand;
  if (PLATFORM_LEAF.test(pkg)) {
    const parent = pkg.replace(PLATFORM_LEAF, '').replace(/[-_]+$/g, '');
    return parent.length >= 2 ? parent : brand || null;
  }
  return null;
}

export function rollupPlatformPackages<T extends Polishable>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  const kept: T[] = [];
  for (const item of items) {
    const key = npmFamilyKey(item.name);
    if (!key) {
      kept.push(item);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    if (loose(key) === 'shoo') {
      const pick = list.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;
      kept.push({ ...pick, name: 'SHOO' });
      continue;
    }
    if (list.length === 1 && !PLATFORM_LEAF.test(list[0].name.replace(/^@[^/]+\//, ''))) {
      kept.push(list[0]);
      continue;
    }
    const parent = list.find((item) => loose(item.name.replace(/^@/, '').split('/').pop() ?? '') === loose(key));
    const pick = parent ?? list.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;
    kept.push({ ...pick, name: key });
  }
  return kept;
}

const MONTH_LINE = /^(.+?)\s*·\s*(\d+)\s+updates?\s+in\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*$/i;

function versionFamily(item: Polishable): { product: string; count: number } | null {
  if (isCursorModelNote(item) || /^(grok|claude|gemini)[-.\s]?\d/i.test(item.name)) return null;
  const rolled = tidy(item.name).match(MONTH_LINE);
  if (rolled) return { product: rolled[1].trim(), count: Number(rolled[2]) || 1 };
  const parts = versionParts(item.name);
  if (!parts) return null;
  if (flagshipLaunchName({ ...item, name: parts.product }) || flagshipLaunchName(item)) return null;
  if (/^(grok|claude|gemini)$/i.test(parts.product)) return null;
  return { product: parts.product, count: versionCount(item) };
}

export function rollupVersions<T extends Polishable>(items: T[]): T[] {
  const groups = new Map<string, { item: T; product: string; count: number }[]>();
  const kept: T[] = [];
  for (const item of items) {
    const family = versionFamily(item);
    const month = item.date?.match(/^(\d{4})-(\d{2})/)?.[0];
    if (!family || !month) {
      kept.push(item);
      continue;
    }
    const key = `${loose(family.product)}|${month}`;
    const list = groups.get(key) ?? [];
    list.push({ item, product: family.product, count: family.count });
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    const count = list.reduce((sum, row) => sum + row.count, 0);
    const product = list[0]?.product || list[0]!.item.name;
    const month = key.split('|')[1] ?? '';
    const mon = MONTHS_SHORT[Number(month.slice(5, 7)) - 1] || month;
    const latest = list.slice().sort((a, b) => (b.item.date ?? '').localeCompare(a.item.date ?? ''))[0]!.item;
    kept.push({
      ...latest,
      name: `${product} · ${count} update${count === 1 ? '' : 's'} in ${mon}`,
      description: '',
    });
  }
  return kept;
}

/** Same normalized name → one line (NUB + NUB, not NUB + NUBJS). */
export function dedupeNormalized<T extends Polishable>(items: T[]): T[] {
  const best = new Map<string, T>();
  const none: T[] = [];
  for (const item of items) {
    const key = loose(item.name);
    if (!key) {
      none.push(item);
      continue;
    }
    const prev = best.get(key);
    if (!prev || titleScore(item) > titleScore(prev)) best.set(key, item);
  }
  return [...best.values(), ...none];
}

export function rollupCursorModels<T extends Polishable>(items: T[]): T[] {
  const models: T[] = [];
  const kept: T[] = [];
  for (const item of items) {
    if (isCursorModelNote(item)) models.push(item);
    else kept.push(item);
  }
  if (!models.length) return items;
  if (models.length === 1) {
    kept.push({ ...models[0]!, name: cursorModelTitle(models[0]!.name) });
    return kept;
  }
  const latest = models.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
  kept.push({ ...latest, name: 'New models in Cursor' });
  return kept;
}

export function noteCountMismatch(note: string, count: number): boolean {
  const mention =
    /\b(\d{1,4})\s+(public\s+)?(ships?|lines?|launches?|things?|updates?|items?|projects?|repos?|repositories)\b/i.exec(
      note,
    );
  if (!mention) return false;
  return Number(mention[1]) !== count;
}

const DATE_DONOR = /^(github|npm|x|producthunt|appstore)$/;

function canInheritDate(undated: Polishable, dated: Polishable): boolean {
  if (!DATE_DONOR.test(dated.source ?? '')) return false;
  const a = loose(undated.name);
  const b = loose(dated.name);
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (value: string) => value.replace(/(cli|app|sdk)$/g, '');
  if (strip(a) && strip(a) === strip(b)) return true;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

/** Copy a first-party date onto the same undated product so pins can sort with the ship. */
export function inheritDates<T extends Polishable>(items: T[]): T[] {
  const dated = items.filter((item) => item.date);
  return items.map((item) => {
    if (item.date) return item;
    const donor = dated.find((other) => canInheritDate(item, other));
    return donor ? { ...item, date: donor.date, thisYear: true } : item;
  });
}

/** Undated lines sort last and may not lead. When anything is dated, crumb undated stay ≤ 25% of the tape (U ≤ D/3). Company/changelog cards without a day stay — they are ships, not leftover links. */
export function capUndated<T extends Polishable>(items: T[], onDrop?: (drop: PolishDrop) => void): T[] {
  const dated = items.filter((item) => item.date);
  const companyUndated = items.filter(
    (item) => !item.date && (item.source === 'changelog' || item.source === 'company'),
  );
  const undated = items.filter((item) => !item.date && item.source !== 'changelog' && item.source !== 'company');
  if (!dated.length) return items;
  const maxUndated = Math.floor(dated.length / 3);
  if (undated.length > maxUndated) {
    for (const item of undated.slice(maxUndated)) onDrop?.({ name: item.name, reason: 'undated-cap' });
  }
  return [...dated, ...companyUndated, ...undated.slice(0, maxUndated)];
}

export function polishCandidates<T extends Polishable>(items: T[], opts: PolishOpts): T[] {
  const year = opts.year;
  const who = opts.who || opts.affiliation?.name || '';
  const out: T[] = [];
  const drops: PolishDrop[] = [];
  const drop = (item: Polishable, reason: string) => {
    const row = { name: item.name, reason };
    drops.push(row);
    opts.onDrop?.(row);
  };
  for (const item of items) {
    const flagship = flagshipLaunchName(item);
    if (!inYearStrict(item, year)) {
      const reason = otherYearProduct(item.name, year)
        ? 'year-other'
        : isFutureDate(item.date)
          ? 'year-future'
          : isScrapeDate(item.date)
            ? 'scrape-date'
            : 'year-strict';
      if (flagship && isFlagshipYearKeep(item, year)) {
        logFlagshipGate(item, reason, flagship);
      } else {
        if (flagship) logFlagshipGate(item, reason, null);
        drop(item, reason);
        continue;
      }
    }
    let name = cleanShipTitle(item.name);
    if (flagship && !isCursorModelNote(item) && (!name || name.split(/\s+/).length <= 1 || /^the new\b/i.test(name))) {
      if (!name) logFlagshipGate(item, isJunkTitle(item.name, { who }) ? 'junk-title' : 'title-empty', flagship);
      name = flagship;
    }
    if (!name) {
      drop(item, isJunkTitle(item.name, { who, company: opts.affiliation?.company }) ? 'junk-title' : 'title-empty');
      continue;
    }
    if (isJunkTitle(name, { who, company: opts.affiliation?.company })) {
      if (flagship) {
        logFlagshipGate(item, 'junk-title', flagship);
        name = flagship;
      } else {
        drop(item, 'junk-title');
        continue;
      }
    }
    if (isJunkProductName(name, opts.handle || opts.owner?.github, who)) {
      drop(item, 'github-junk');
      continue;
    }
    if (opts.owner && !ownedByBuilder({ ...item, name }, opts.owner)) {
      if (flagship) logFlagshipGate(item, 'not-owned', flagship);
      else {
        drop(item, 'not-owned');
        continue;
      }
    }
    const date =
      knownFlagshipDate({ ...item, name }, year) ??
      (isFlagshipYearKeep(item, year) && item.date ? String(item.date).slice(0, 10) : inYearDate(item.date, year));
    out.push({
      ...item,
      name,
      description: cleanDescription(item.description),
      date,
      via: sourceVia({ ...item, name }, opts.affiliation),
      status: cleanStatus(item.status),
      thisYear: Boolean(item.thisYear) || Boolean(date && (String(date).startsWith(String(year)) || isFlagshipYearKeep(item, year))),
    });
  }
  const beforeHref = out.length;
  const collapsed = collapseSameHref(out);
  if (collapsed.length < beforeHref) {
    const kept = new Set(collapsed.map((item) => item.name));
    for (const item of out) {
      if (!kept.has(item.name)) drop(item, 'href-collapse');
    }
  }
  const beforeRoll = collapsed.length;
  const versioned = rollupVersions(collapsed);
  if (versioned.length < beforeRoll) drop({ name: `${beforeRoll - versioned.length} version rows` }, 'version-rollup');
  const beforePkg = versioned.length;
  const packaged = rollupPlatformPackages(versioned);
  if (packaged.length < beforePkg) drop({ name: `${beforePkg - packaged.length} platform packages` }, 'platform-rollup');
  const models = rollupCursorModels(packaged);
  if (models.length < packaged.length) drop({ name: `${packaged.length - models.length} model notes` }, 'model-rollup');
  const inherited = inheritDates(models);
  const unique = dedupeNormalized(inherited);
  if (unique.length < inherited.length) drop({ name: `${inherited.length - unique.length} duplicate names` }, 'name-dedupe');
  const capped = capUndated(unique, drop);
  if (drops.length) {
    console.log(JSON.stringify({ shipped: 'polish-drops', who, handle: opts.handle || null, kept: capped.length, drops: drops.slice(0, 80) }));
  }
  return capped
    .map((item) => ({ ...item, name: versionParts(item.name) ? item.name : wordClamp(item.name, TITLE_MAX) }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
