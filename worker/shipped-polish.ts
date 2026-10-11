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
import { isLegacyNpmFamily } from './shipped-dates';
import { isOssHarvestItem, ownedByBuilder, ownerCanProve, undatedPassesGate, type OwnerContext } from './shipped-ownership';
import { isEmployerSpill } from './shipped-products';
import { journalShipName, looksLikePersonalShip } from './shipped-research';
import type { ItemStatus } from '../lib/shipped-year';
import { ITEM_STATUSES } from '../lib/shipped-year';

export const TITLE_MAX = 48;
/** Already-clean noun phrases may keep one extra token; sentences stay at TITLE_MAX. */
export const TITLE_HARD_MAX = 56;
/** Cheap harvest cap before the one LLM curation call. */
export const CHEAP_CANDIDATE_CAP = 150;
/** Printed tape cap after curation roll-ups. */
export const RECEIPT_LINE_CAP = 60;

const DOCS_NAV =
  /^(overview|prompting|pool|security|browser|search|terminal|settings|plugins?|hooks?|cli|api|faq|guides?|reference|getting started|quickstart|quick start|installation|install|usage|examples?|changelog|release notes|acting as users|builds|context|rules|modes?|models?|indexing|privacy|enterprise|teams|billing|account|authentication|auth|docs|home|index|support|repositories|ideas|pull requests|last updated|what'?s new|agents|legal|update)$/i;
const BYLINE = /^(authors?\s*[:\-–—]|written by\b|posted by\b|byline\s*:)/i;
const NAME_LIST =
  /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}(?:,| and )\s+[A-Z][A-Za-z.'-]+/;
const ROUNDUP =
  /^(week of|this week in|monthly roundup|what we shipped (this|the) week)\b|updates?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d\d/i;
const READ_THE = /^(read the|see the|check out the|learn more|if you\b|those\b|your agent can\b|prepare for\b|choose \w+ for complex)\b/i;
const INSTRUCTIONAL = /^(if you|those |your agent can|you can|you don|use a |use the |use \w[\w.-]* for complex)\b/i;
const RESEARCH_GERUND =
  /^(improving|bootstrapping|deprecating|continually|reward hacking|evaluating|keeping|reproducing|disclosing|migrating|deploying)\b/i;
const ACQUISITION = /\b(is now a part of|acquired by|has been acquired)\b/i;
const CUSTOMER_STORY =
  /\bships\s+[\d.,]+[×x]\s+faster\b|·\s*\d+[kmb]\s*$|\busers?\s+(make|made|send|sent)\s+[\d.,]+[kmb]?\b|\b\d+[kmb]\s+(media|pitches|users|customers|engineers)\b|\bfeatured'?s?\s+users\b|\bcustomer stor(?:y|ies)\b/i;
const PLATFORM_POLICY =
  /\b(deployment retention|default to \d+[-\s]?day|retain(?:s|ed|ing)? (fewer )?deployments|skip sending|request bodies|routing middleware|billing begins|spend management|per-user budgets|hobby projects now retain|edge requests are now called|no longer caches|timestamp attributes are now supported)\b/i;
const CHOPPED_GATEWAY = /^microsoft decision[- ]?1$/i;
const TRAILING_PREP =
  /(?:^|[\s/])(of|in|to|for|and|or|the|a|an|with|on|as|by|from|into|longer|kind|new|our|your|through|their|its|vs|lower|higher|more|less|day|days|every|managed|security|controlled|trusted|general|advanced|remote|task|chat|now|key|third|are|image|usage|delay|preview|zero|has|accepts|service|except)$/i;
export const CUT_OFF_ENDINGS =
  /^(now|and|with|for|of|the|on|key|third|are|image|usage|delay|preview|zero|has|accepts|service|except)$/i;
const TITLE_START_BAD =
  /^(in|on|at|for|with|from|to|of|by|as|a|an|the|and|or|so|both|use|using|start|starting|lines|line|built|build|building|run|running|join|joining|announce|announces|announcing|added|add|fixed|fix|connect|review|share|more|ways|preview|control|give|let|take|work|choose|scan|create|organize|talk|try|visit|explore|download|get|see|read|learn|follow|watch|make|making|how|when|while|after|before|without|inside|beyond|under|over|my|our|your|quitting)\b/i;
const TITLE_END_BAD = /\b(of|a|an|the|with|and|or|security|controlled|trusted|general|advanced|remote|task|chat)\s*$/i;
const TITLE_VERB =
  /^(announces|announce|announced|connects|connect|built|builds|building|works|working|uses|using|used|launched|ships|shipped|released|added|adds|created|makes|made|lets|can|will|is|are|was|were|gives|reaches|joins|keeps|combines|deprecated)$/i;
const SENTENCE_VERB =
  /\b(announces|announce|announced|connects|gives|reaches|joins|keeps|combines|deprecated|also added|is now|are now|now live|now keeps|now display|now supported|now shows?|now includes?|now calculates?|now provides?|now returns?)\b/i;
const BARE_MODEL = /^gpt-[3-5]$/i;
const CODE_TITLE = /^[a-z][\w-]*\.[a-z][\w-]*\.[a-z]/i;
const MID_WORD =
  /^(ontrol|elease|pdate|ettings|vailable|olling|espectively|ead|nounced|ntroducing|aunched|hipped|rigin|roved|cial)\b/i;
const OLD_PRODUCT =
  /\b(gpt-?4o(?:-mini)?|gpt-?3(?:\.5)?(?:-turbo)?|text-embedding-?[123]|embedding v[123]|ada-?002|davinci|curie|babbage|turbo-0?125|whisper-1|o1|o3(?:-mini)?)\b/i;
const CTA_NAV =
  /^(visit our|try .{0,24} now|explore (enterprise|pricing|docs|plans)|watch (on )?youtube|subscribe|follow us|join (us|now)|get started|sign up|sign in\b|learn more|see more|read more|contact (us|sales|contact)|book a (demo|call)|youtube channel)\b/i;
const CTA_TRAIL = /[↗→⬅︎↵]\s*$|youtube channel|try cursor now|explore enterprise/i;
const FRAGMENT_START = /^(ies|ing|ted|ated|nced|trol|elease|pdate|ontrol|espectively|cial|mercial)\b/i;
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
  kind?: string;
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
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loose(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

export function wordClamp(text: string, max: number): string {
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
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    const hash = parsed.hash.replace(/^#/, '').toLowerCase();
    const list = !path || isShipListHref(`${parsed.protocol}//${parsed.host}${parsed.pathname}`);
    if (hash && list) return `${host}${path}#${hash}`;
    return `${host}${path}`.toLowerCase();
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
  if (/^(is|are|was|were|can|will|to|so|both)\s+/i.test(text.trim())) return true;
  return false;
}

export function looksFragment(text: string): boolean {
  const trimmed = tidy(text);
  if (!trimmed) return true;
  if (!/^[A-Za-z0-9@#]/.test(trimmed) && !/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return true;
  const first = trimmed.split(/\s+/)[0] || '';
  if (FRAGMENT_START.test(first)) return true;
  if (/^[A-Za-z]$/.test(first)) return true;
  if (/^(availability depends|keep tab widths|thread, spawned|improved mobile connection)\b/i.test(trimmed)) return true;
  return looksMidWord(trimmed);
}

/** Last word is a chopped headline ending. Short product nouns like "FLUX 3 Image" stay. */
const KEEP_TAIL_ACRONYM =
  /^(cli|sdk|api|app|gpt|cdn|dns|sso|cpu|gpu|sql|css|html|aws|v0|ui|ai|mcp|npm|mrr|ios|mac|dev|sol|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|plan|beta|live|pro|max|mini|web|bot|kit|hub|lab|one|all)$/i;

export function endsWithCutOffWord(text: string): boolean {
  const words = tidy(text).split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || '';
  if (/^[A-Za-z]{1,2}$/.test(last) && words.length >= 2 && !KEEP_TAIL_ACRONYM.test(last)) return true;
  if (/^(now|and|with|for|of|the|on|key|third|are|zero|has|accepts|except)$/i.test(last) && words.length >= 2) return true;
  if (/^(image|usage|delay|preview)$/i.test(last) && words.length >= 4) return true;
  if (words.length >= 5 && /^[A-Za-z]{3,4}$/.test(last) && !KEEP_TAIL_ACRONYM.test(last) && !/\d/.test(last)) {
    return true;
  }
  if (
    words.length >= 3 &&
    last.length >= 8 &&
    !/\d/.test(last) &&
    !/(tion|sion|ments?|ness|ship|ware|work|ings|able|ible|ical|ular|ers?|ors?|ies|ous|ive|est|ing|ted|als?|ects|ity|ance|ence|ator|ency|graphy|shots)$/i.test(
      last,
    )
  ) {
    return true;
  }
  return false;
}

export function looksCutOff(text: string): boolean {
  const trimmed = text.trim();
  if (/[,;·|&:]\s*$/.test(trimmed)) return true;
  if (/\bnow\s+(has|accepts)(\s+\w+){0,2}$/i.test(trimmed) && trimmed.split(/\s+/).length >= 3) return true;
  if (/\bacross your\s+\w+$/i.test(trimmed) && trimmed.split(/\s+/).length >= 6) return true;
  if (/[A-Za-z0-9]-$/.test(trimmed)) return true;
  if (/\([^)]*$/.test(trimmed)) return true;
  if (TRAILING_PREP.test(trimmed) && trimmed.split(/\s+/).length >= 3) return true;
  if (/\b(turn on enable|enable full|at lower|on ai)$/i.test(trimmed)) return true;
  return endsWithCutOffWord(trimmed);
}

export function isAboutPerson(title: string, who: string | null | undefined): boolean {
  const name = tidy(who).replace(/^@/, '');
  if (!name || name.length < 4) return false;
  const a = loose(title);
  const b = loose(name);
  if (!b || b.length < 5) return false;
  if (a === b || a === `${b}s`) return true;
  if (b.length >= 5 && a.includes(b) && /@[\w.-]+/.test(title)) return true;
  const words = name.split(/\s+/).filter((word) => word.length > 2);
  if (words.length < 2) return false;
  const hay = title.toLowerCase();
  if (!words.every((word) => hay.includes(word.toLowerCase()))) return false;
  return title.split(/\s+/).length <= words.length + 3;
}

const JOB_TITLE =
  /\b(software engineer|staff engineer|engineering manager|developer advocate|director of engineering|engineer at|python engineers?|head of engineering|vp of engineering)\b/i;

function isSelfNameTitle(
  title: string,
  opts: { who?: string | null; handle?: string | null; github?: string | null } = {},
): boolean {
  const text = tidy(title);
  if (isAboutPerson(text, opts.who) || isAboutPerson(text, opts.handle) || isAboutPerson(text, opts.github)) return true;
  const stripped = text.replace(/@[\w.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (looksLikePersonName(stripped, opts.who) || looksLikePersonName(text, opts.who)) return true;
  const handle = (opts.handle || '').replace(/^@/, '');
  if (handle.length >= 4 && new RegExp(`@${handle}\\b`, 'i').test(text)) return true;
  const github = (opts.github || '').replace(/^@/, '');
  if (github.length >= 4 && (loose(text) === loose(github) || new RegExp(`@${github}\\b`, 'i').test(text))) return true;
  if (JOB_TITLE.test(text) && looksLikePersonName(stripped.replace(JOB_TITLE, '').trim(), opts.who)) return true;
  if (JOB_TITLE.test(text) && stripped.split(/\s+/).length <= 6) return true;
  return false;
}

/** Docs nav, SDK references, and "Deploying to X" pages are not ships. */
export function isDocsOrReferenceTitle(title: string): boolean {
  const text = tidy(title);
  if (!text) return true;
  if (/^(last updated|what'?s new|deploying to|docs agent|installation and connection|model selection)\b/i.test(text)) {
    return true;
  }
  if (/\b(js\s+)?sdk\s+reference\b/i.test(text)) return true;
  if (/\breference$/i.test(text) && /\b(sdk|api|cli|js|flags|queues)\b/i.test(text)) return true;
  if (/\b(expanded .+ documentation|auto-review documentation)\b/i.test(text)) return true;
  if (/\b(workspace )?model availability\b/i.test(text)) return true;
  if (/\bcsv export\b/i.test(text) || /^public plugin catalog\b/i.test(text)) return true;
  if (/^usage resets\b/i.test(text)) return true;
  if (/^more .+ features in the\b/i.test(text)) return true;
  if (/^(documentation|chores)$/i.test(text)) return true;
  if (/^(improvements?|performance improvements?) and bug fixes$/i.test(text)) return true;
  if (/^full release on github$/i.test(text)) return true;
  return false;
}

/** The bio company/product itself is not a 2026 ship unless it has a day in this year. */
export function isStaleBioProduct(
  item: { name?: string; date?: string | null },
  affiliation?: Affiliation | null,
  year?: number,
): boolean {
  if (!affiliation || !year) return false;
  const name = loose(item.name || '');
  if (!name) return false;
  const company = loose(affiliation.company || '');
  const product = loose(affiliation.product || '');
  if ((company && name === company) || (product && name === product)) {
    const date = item.date ? String(item.date) : '';
    if (date && date.startsWith(String(year))) return false;
    return true;
  }
  return false;
}

/** A customer used the product — not the company's own ship. */
const COMPANY_METRIC =
  /^[A-Z][A-Za-z0-9.&'’-]+(?:\s+[A-Z][A-Za-z0-9.&'’-]+){0,2}\s+(analyzes?|processes?|handles?|serves?|ships?|scales?|cuts?|boosts?|saves?|runs?)\b.+\b(\d[\d,.]*\s*[MKB%+]|million|billion|\d{2,}m\+)/i;

export function isCustomerStoryTitle(title: string): boolean {
  const text = tidy(title);
  if (!text) return false;
  if (/^(how|helping)\b/i.test(text)) return true;
  if (/\b(cuts?|boosts?|saves?|turns?|halves?)\b.+\bwith\b/i.test(text)) return true;
  if (/\b(lowers the cost of|bio bug bounty|creating with sora|trusted access)\b/i.test(text)) return true;
  if (/^[A-Za-z][\w'’]*(?:\s+AI)?(?:'s)?\s+(brings|trusts|reviewed|ships|widens|completes|improves)\b/i.test(text)) {
    return true;
  }
  if (/\bbig bet\b/i.test(text)) return true;
  if (COMPANY_METRIC.test(text)) return true;
  if (/^[A-Z][A-Za-z0-9.&'’-]+(?:\s+[A-Z][A-Za-z0-9.&'’-]+){0,2}\s+(puts?|placed?)\b.+\bin the hands\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Blog essays, reports, and cut-off thought-pieces. */
export function isBlogEssayTitle(title: string): boolean {
  const text = tidy(title);
  if (!text) return true;
  if (isCustomerStoryTitle(text)) return true;
  if (/\bkeeping\b.+\bwhile\b/i.test(text)) return true;
  if (/^(we\s+)?migrated\b/i.test(text)) return true;
  if (/^reproducing\b/i.test(text)) return true;
  if (/\beverything\b.+\bwill (get|be) hacked\b/i.test(text)) return true;
  if (/\btake\s+\d+\s*%/i.test(text)) return true;
  if (/^state of\b/i.test(text)) return true;
  if (/^open-weight\b/i.test(text)) return true;
  if (/\bfor (python |javascript |js |typescript )?engineers\b/i.test(text)) return true;
  if (/\bproduction index\b/i.test(text)) return true;
  if (/\brecap\b/i.test(text)) return true;
  if (/^what[’']s new in\b/i.test(text)) return true;
  if (/\b(security boundaries|credential sprawl|security release|we disabled)\b/i.test(text)) return true;
  if (/\b(customer journeys?|global affairs|intelligence age|safety cases|youth safety|frontline defenders|false front|road ahead|view inside|epidemiology)\b/i.test(text)) return true;
  if (/\bships\s+\d+\s+times?\s+a\s+day\b/i.test(text) || /\bfastest-adopted\b/i.test(text)) return true;
  if (/\bships agent-written code\b|\bbug bounty program\b/i.test(text)) return true;
  if (/\b(helping (older adults|small businesses)|supporting the blind|big air tour|expand(?:s|ing) (access|their partnership)|academy with)\b/i.test(text)) return true;
  if (/^(towards|disrupting|advancing|acceleration|daybreak|eternal|path to|publication|overview)\b/i.test(text)) return true;
  if (/^[A-Za-z][\w.-]*\s+is an?\s+(applied research|engineering|product|research) team\b/i.test(text)) return true;
  if (/^both are available\b|^available today on\b/i.test(text)) return true;
  if (/^(latest|top|best)\s+(articles?|posts?|stories|news)\b/i.test(text)) return true;
  if (/\bbest\b/i.test(text) && /\b(20\d{2}|generators?|tools?|apps?)\b/i.test(text) && text.split(/\s+/).length >= 4) {
    return true;
  }
  if (/\barticles? about\b/i.test(text)) return true;
  if (/^openai delivers\b/i.test(text) || /\b(at scale|in production)\s+engineering\b/i.test(text)) return true;
  if (/\bhelps run\b.+\bexperiments\b/i.test(text) || /\bquantum computing experiments\b/i.test(text)) return true;
  if (/^(how|helping)\b/i.test(text) && !/\b(chatgpt|codex|gpt-?\d)\b/i.test(text.split(/\s+/).slice(0, 3).join(' '))) {
    return true;
  }
  if (/\b(cuts?|boosts?|saves?|turns?|halves?)\b.+\bwith\b/i.test(text)) return true;
  if (/\b(safety overview|system card|blueprint|partner network|for (singapore|india|countries))\b/i.test(text)) {
    return true;
  }
  if (/\b(company|safety|research|engineering)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text) && !/\b(gpt-?\d|sora|chatgpt images|codex app|v0)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** A dated /changelog/slug or /products/release-notes#id card — not the index and not /docs. */
export function isChangelogEntryHref(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    if (/\/(changelog|docs\/changelog|whats-new|what-s-new|releases|updates|release-notes)$/i.test(path)) {
      return Boolean(parsed.hash && parsed.hash.length > 2);
    }
    return /\/(changelog|docs\/changelog|whats-new|what-s-new|release-notes)\/[^/]+/i.test(path);
  } catch {
    return false;
  }
}

/** Docs nav and blog category indexes are not ships. Changelog cards keep their own URLs. */
export function isDocsOrCategoryHref(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
    if (/\/(changelog|release-notes)\b/i.test(path)) return false;
    if (/\/blog\/category(?:\/|$)/.test(path)) return true;
    if (/^\/docs(?:\/|$)/.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

const TITLE_MONTH: Record<string, string> = {
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

/** "… SEPTEMBER" dated January 1 is a scrape/index date, not a launch day. */
export function isMismatchedMonthDate(title: string, date?: string | null): boolean {
  if (!date) return false;
  const match = String(date).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return false;
  const titled = tidy(title).match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (!titled) return false;
  const want = TITLE_MONTH[titled[1].toLowerCase().replace(/\.$/, '')];
  if (!want) return false;
  if (match[2] === want) return false;
  if (match[2] === '01' && (match[3] === '01' || !match[3])) return true;
  return match[2] !== want;
}

function isAcquisitionNews(title: string): boolean {
  if (!ACQUISITION.test(title)) return false;
  if (/\b(app|desktop|cli|api|sdk)\b/i.test(title)) return false;
  return true;
}

export function isJunkTitle(
  title: string,
  opts: { who?: string | null; handle?: string | null; company?: string | null; date?: string | null } = {},
): boolean {
  const text = tidy(title);
  if (!text) return true;
  if (text.length < 3 && !/^v\d$/i.test(text)) return true;
  if (BYLINE.test(text) || ((text.match(/,/g) || []).length < 2 && NAME_LIST.test(text)) || /\band \d+ others?\b/i.test(text) || ROUNDUP.test(text) || READ_THE.test(text) || INSTRUCTIONAL.test(text)) return true;
  if (hasMashedDuplicateTokens(text)) return true;
  if (RESEARCH_GERUND.test(text) || CUSTOMER_STORY.test(text) || CHOPPED_GATEWAY.test(text) || isAcquisitionNews(text)) return true;
  if (CTA_NAV.test(text) || CTA_TRAIL.test(text)) return true;
  if (/^(download on the|get it on|get the app|affiliates|analytics|available on|filed under|quitting)\b/i.test(text)) return true;
  if (CODE_TITLE.test(text) || isCodeOrBugfixTitle(text) || isChangelogIdOrHostCrumb(text) || /^(object|query|router|number|string|boolean|date|type|value|array|null|undefined|any)$/i.test(text)) return true;
  if (isVagueOrCutTitle(text)) return true;
  if (/\bgithub stars\b|\bweekly downloads\b/i.test(text) && !/\b(zod|nub|tsc|cli|app)\b/i.test(text)) return true;
  if (/^respectively\.?$/i.test(text)) return true;
  if (DOCS_NAV.test(text) || /^(recent highlights|cursor support|under:|blog\s*\/\s*research|blog|research)$/i.test(text)) return true;
  if (isDocsOrReferenceTitle(text) || isBlogEssayTitle(text)) return true;
  if (isMismatchedMonthDate(text, opts.date)) return true;
  if (isSelfNameTitle(text, opts)) return true;
  if (looksLikePersonName(text, opts.who) || looksLikeCodeIdentifier(text)) return true;
  if (isPricingOrMetricNote(text)) return true;
  if (isNotAShipTitle(text)) return true;
  if (isPrereleaseShip(text) || isNeverShipKind(text)) return true;
  if (/^(the )?(guy|person|one) who made\b/i.test(text)) return true;
  const whoLast = (opts.who || '').split(/\s+/).filter((word) => word.length > 2);
  if (/^[A-Z]\s+[A-Z]{2,}$/.test(text) && whoLast.some((word) => loose(text).includes(loose(word)))) return true;
  if (looksFragment(text) || looksMidWord(text) || looksCutOff(text)) return true;
  if ((text.replace(/[^a-zA-Z]/g, '').length < 3) && /\d/.test(text) && !/^v\d\b/i.test(text)) return true;
  return false;
}

/** Consecutive repeated tokens (`typesafe-compat typesafe-compat`) are scrape mash, not a ship. */
export function hasMashedDuplicateTokens(title: string): boolean {
  const tokens = tidy(title)
    .toLowerCase()
    .split(/[\s,/|]+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''));
  return tokens.some((token, i) => i > 0 && token.length >= 4 && token === tokens[i - 1]);
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
  if (/\breduc(?:e|ing) (future )?deployment size\b/i.test(text)) return true;
  if (/\b(pric(e|ing|es)|billing|skus?)\b/i.test(text) && !/\b(app|cli|sdk|api|model)\b/i.test(text)) return true;
  if (/\b(pricing plans?|plan pricing|teams plans?)\b/i.test(text)) return true;
  if (/^(improved|better|faster|cheaper|reduced|lower|higher)\s+[A-Za-z]+(?:\s+[A-Za-z]+)?$/i.test(text)) return true;
  if (/\bnow costs?\b|\bper million\b/i.test(text)) return true;
  if (/\$\d+/.test(text) && /\b(token|input|output|million)\b/i.test(text)) return true;
  return false;
}

/** Canary / alpha / beta / rc version tags. Named launches that happen to say "now in beta" stay. */
export function isPrereleaseShip(name: string): boolean {
  const text = tidy(name);
  if (!text) return false;
  if (/\bv?\d+\.\d+[\w.-]*-(canary|alpha|beta|rc|nightly)(?:\.|$)/i.test(text)) return true;
  if (/\b(canary|alpha|rc|nightly)\.\d+\b/i.test(text)) return true;
  if (/\b(canary|alpha|beta|rc|nightly)\s+\d/i.test(text) && /\bv?\d+\.\d+/i.test(text)) return true;
  if (/\bnightly\b/i.test(text) && !/\bnow in\b/i.test(text)) return true;
  return false;
}

/** Starters, courses, GitHub Actions, repo rules, and examples are never ships. */
export function isNeverShipKind(name: string): boolean {
  const text = tidy(name);
  if (!text) return false;
  if (flagshipLaunchName({ name: text })) return false;
  if (/\b(starter|foundations|academy|course|examples?|templates?|repo[- ]?rules?|global-repo-rules)\b/i.test(text)) return true;
  if (/-(starter|course|action|example|template|rules?)$/i.test(text.replace(/\s+/g, '-'))) return true;
  if (/\bwait-for-deployment-action\b|\bdeployment-action\b/i.test(text)) return true;
  return false;
}

/** A model listing on AI Gateway — roll up, don't print each vendor. */
export function isGatewayModelListing(name: string, link?: string | null, description?: string): boolean {
  const text = tidy(name);
  const hay = `${text} ${link || ''} ${description || ''}`;
  if (!text && !link) return false;
  if (/\b(v0|vercel agent|botid)\b/i.test(text)) return false;
  if (/\b(adds|supports|http api|asynchronous|browserbase|confidence-based)\b/i.test(text)) return false;
  if (/\btypesafe\b/i.test(text) && /\b(http|api|sdk)\b/i.test(text) && !/\btypesafe ai\b/i.test(text)) return false;
  if (/^liquid ai\b/i.test(text)) return true;
  if (/[-/](?:on-)?ai-gateway|available-on-ai-gateway|\/ai-gateway/i.test(link || '')) {
    if (/\b(adds|tools|fallback|browserbase|confidence)\b/i.test(text)) return false;
    return true;
  }
  return /\b(?:now )?available on (?:the )?(?:vercel )?ai gateway\b|\bon ai gateway\b/i.test(hay);
}

/** Company-org GitHub repo roots that never earned a homepage / launch post. */
export function isUnnotableCompanyRepo(item: {
  name?: string;
  link?: string | null;
  source?: string | null;
  description?: string;
  kind?: string;
}): boolean {
  if (/^(oss-release|oss-launch|oss-blog)$/.test(item.kind || '')) return false;
  const source = item.source || '';
  if (source !== 'company') return false;
  const link = item.link || '';
  if (/\/releases\/tag\//i.test(link)) return false;
  if (!/^https?:\/\/github\.com\/[^/]+\/[^/#?]+\/?$/i.test(link)) return false;
  if (/\/(changelog|blog)\//i.test(link)) return false;
  return true;
}

const FOREIGN_VENDOR_BARE =
  /^(stripe|bun|cursor|claude|anthropic|openai|chatgpt|github|gitlab|slack|aws|amazon)$/i;
const FOREIGN_VENDOR_PRODUCT =
  /^(cursor cloud agents|gpt-[\d.]+(?:\s+sol)?)$/i;

/** Another company's product on this company's tape, with no first-party feature phrasing. */
const PREVIEW_CHANGELOG_HOST = /\.(vercel\.app|netlify\.app|pages\.dev)$/i;

/** Another company's Vercel/Netlify preview changelog is not this builder's tape. */
export function isOffCompanyChangelog(
  item: { name?: string; link?: string | null; source?: string | null },
  company?: string | null,
): boolean {
  if ((item.source || '') !== 'changelog') return false;
  const host = hostOf(item.link);
  if (!host) return false;
  if (PREVIEW_CHANGELOG_HOST.test(host)) {
    if (/vercel/i.test(company || '') && /vercel\.app$/i.test(host)) return false;
    return true;
  }
  return false;
}

export function isForeignProductOnCompanyTape(
  name: string,
  company?: string | null,
): boolean {
  const text = tidy(name);
  const who = tidy(company);
  if (!text || !who) return false;
  if (new RegExp(`\\b${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return false;
  if (/vercel/i.test(who)) {
    if (/\b(vercel|v0|ai gateway|ai sdk|sandbox|marketplace)\b/i.test(text)) return false;
    if (/^deploy from /i.test(text) || /\bdeploys$/i.test(text)) return false;
    if (FOREIGN_VENDOR_BARE.test(text) || FOREIGN_VENDOR_PRODUCT.test(text)) return true;
  }
  return false;
}

/** Settings, retention, and middleware knobs — roll up, don't print as ships. */
export function isMinorPlatformChange(name: string): boolean {
  const text = tidy(name);
  if (!text || flagshipLaunchName({ name: text })) return false;
  if (CHOPPED_GATEWAY.test(text) || CUSTOMER_STORY.test(text)) return false;
  if (/\b(v0|vercel agent|botid)\b/i.test(text)) return false;
  return PLATFORM_POLICY.test(text) || /\bpro teams now default\b/i.test(text);
}

/** Removals, docs updates, @handles, and vague "X updates" titles are not ships. */
export function isNotAShipTitle(name: string): boolean {
  const text = tidy(name);
  if (!text) return true;
  if (/^@[\w.-]+$/.test(text)) return true;
  if (CHOPPED_GATEWAY.test(text) || CUSTOMER_STORY.test(text)) return true;
  if (/\b(removed|retired|retires|retire|deprecated|sunsetting|sunset|deleted|discontinued|shut down|shutting down)\b/i.test(text)) return true;
  if (/^key changes\b|\bwhen migrating\b/i.test(text)) return true;
  if (/\b(docs?|documentation|readme|governance docs)\b/i.test(text) && /\b(update|updated|updates)\b/i.test(text)) return true;
  if (/\bmodels? for model availability\b/i.test(text) || /\bmodel availability update\b/i.test(text) || /\bmodel availability\b/i.test(text)) return true;
  if (/\binto the\b/i.test(text)) return true;
  if (/\bupdates\s*:/i.test(text)) return true;
  if (/\bslugs?\b/i.test(text) && /\b(point|alias|latest|chat-latest)\b/i.test(text)) return true;
  if (/\balias(es)?\b/i.test(text) && /\b(point|slug|latest)\b/i.test(text)) return true;
  if (/·\s*\d+\s+(updates?|releases?)\s+in\s+/i.test(text)) return false;
  if (/^(?:[A-Za-z][\w.+-]*\s+and\s+)?.+\s+updates$/i.test(text)) return true;
  return false;
}

/** Cut headings, mashed alternatives, and vague two-word "work/controls" titles. */
export function isVagueOrCutTitle(name: string): boolean {
  const text = tidy(name);
  if (!text) return true;
  if (/\b or \b/i.test(text) && !/\b(ship or die|marketing or die)\b/i.test(text)) return true;
  if (/^cloud work$/i.test(text) || /^new controls\b/i.test(text) || /^all\s+[a-z]+$/i.test(text)) return true;
  if (/\brolling out to all users\b/i.test(text) || /^beta and rolling\b/i.test(text) || /\bis rolling out\b/i.test(text) || /\brolling out$/i.test(text)) return true;
  if (/\bin the chatgpt desktop$/i.test(text)) return true;
  if (/^(codex joining|chatgpt|features|commands|customize|side|release|admin|members|documentation|chores)$/i.test(text)) return true;
  if (/^(also released|connections to api):?$/i.test(text)) return true;
  if (/joining$/i.test(text) && text.split(/\s+/).length <= 3) return true;
  if (/including:?$/i.test(text) || /alerts\s*&?$/i.test(text)) return true;
  if (/\b(is on by default|on by default|for everyone(?:\s+except)?)\b/i.test(text) && text.split(/\s+/).length >= 4) {
    return true;
  }
  if (/^(updated|released|previewing)\b/i.test(text) && /\b(including|navigation for|budget alerts|model snapshot)\b/i.test(text)) {
    return true;
  }
  if (/^stronger for software development$/i.test(text)) return true;
  if (/\bmodel snapshot\b/i.test(text)) return true;
  if (/^(work with|use)\b.+\bfrom anywhere\b/i.test(text)) return true;
  if (/\bcan now help\b/i.test(text)) return true;
  if (/^released several\b|\bseveral new models and tools\b/i.test(text)) return true;
  if (/^support for\b/i.test(text)) return true;
  if (/^released uploads\b|\bupload large files in multiple parts\b/i.test(text)) return true;
  if (/\bconnections to api\.openai\.com\b|\bcan now use ipv6\b|\bipv6\b/i.test(text)) return true;
  if (/^server-side compaction\b|\bcompaction in the responses api\b/i.test(text)) return true;
  if (/^(pets|cloud|new)\s+[a-z]+$/i.test(text) && !/\b(cli|app|sdk|api|gpt|codex|cursor|chatgpt)\b/i.test(text)) return true;
  if (/\bdroplet\b/i.test(text) && /\b(configure|ssh|connect)\b/i.test(text)) return true;
  return false;
}

/** Assignment snippets, quoted code, and bugfix / known-issue sentences never print. */
export function isCodeOrBugfixTitle(name: string): boolean {
  const text = tidy(name);
  if (!text) return false;
  if (/=/.test(text) || /["“”]/.test(text)) return true;
  return /\b(flaky|bug ?fix(?:es)?|minor fix(?:es)?|hotfix(?:es)?|known issues?|will continue to scale)\b/i.test(text);
}

/** Changelog row ids, R2 host crumbs, and "latest articles about…" are not ships. */
export function isChangelogIdOrHostCrumb(name: string, link?: string | null): boolean {
  const text = tidy(name);
  if (!text) return true;
  if (/\b(latest articles? about|changelog goal)\b/i.test(text)) return true;
  if (/^(latest|top|best)\s+(articles?|posts?|stories|news)\b/i.test(text)) return true;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (
    tokens.some((token) => {
      if (/[-.]/.test(token) && /[a-z]/i.test(token)) return false;
      const compact = token.replace(/[^A-Za-z0-9]/g, '');
      return compact.length >= 18 && /^[A-Z0-9]+$/i.test(compact);
    })
  ) {
    return true;
  }
  if (/^(public|www|cdn|static|assets|blob|media)$/i.test(text)) return true;
  const href = String(link || '');
  if (/\.(r2\.dev|vercel-storage\.com)(\/|$)/i.test(href) || /\/blob\//i.test(href)) return true;
  return false;
}

/** `2026 08 13 …` or `2026-08-13` in a title — used when the card date is a Jan 1 scrape. */
export function dateFromNumericTitle(title: string, year: number): string | null {
  const iso = tidy(title).match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  const spaced = tidy(title).match(/\b(20\d{2})\s+(\d{1,2})\s+(\d{1,2})\b/);
  const match = iso || spaced;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y !== year || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Undated adjective phrases ("Richer JavaScript representation") are changelog copy, not products. */
export function isChangelogPhrase(name: string, date?: string | null): boolean {
  if (date) return false;
  const text = tidy(name);
  if (!text || /\d/.test(text)) return false;
  if (/\b(cli|app|sdk|api|bot|kit|auth|cursor|codex|chatgpt|composer|zod|shoo)\b/i.test(text)) return false;
  return /^(richer|typed|better|improved|faster|fuller|native|optional|simple|lightweight|advanced|new)\b/i.test(text);
}

const SHIP_WORD: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gpt: 'GPT',
  openai: 'OpenAI',
  macos: 'macOS',
  ios: 'iOS',
  cli: 'CLI',
  sdk: 'SDK',
  api: 'API',
  mcp: 'MCP',
  ai: 'AI',
  rl: 'RL',
  ui: 'UI',
  hn: 'HN',
  npm: 'npm',
  js: 'JS',
  ts: 'TS',
  aws: 'AWS',
  cdn: 'CDN',
  dns: 'DNS',
  ip: 'IP',
  gpu: 'GPU',
  cpu: 'CPU',
  http: 'HTTP',
  sql: 'SQL',
  rss: 'RSS',
};

const PROPER_SHIP: Record<string, string> = {
  ...SHIP_WORD,
  botid: 'BotID',
  tscrs: 'tsc-rs',
  trpc: 'tRPC',
  zod: 'Zod',
  shoo: 'Shoo',
  nub: 'Nub',
  cn: 'cn',
  sora: 'Sora',
  bugbot: 'Bugbot',
  photoai: 'PhotoAI',
  interiorai: 'InteriorAI',
  superlevels: 'SuperLevels',
  postbridgecli: 'postbridge-cli',
  postbridge: 'Post Bridge',
};

const SMALL_SHIP_WORD = new Set(['for', 'the', 'in', 'of', 'and', 'or', 'a', 'an', 'to', 'on', 'at', 'with', 'app']);

function formatSpokenToken(word: string, index: number, sentenceCase = false): string {
  const key = loose(word);
  if (PROPER_SHIP[key]) return PROPER_SHIP[key];
  if (/^[a-z0-9]+(?:-[a-z0-9.]+)+$/.test(word)) return word;
  if (/[a-z]/.test(word) && /[A-Z]/.test(word) && word !== word.toUpperCase()) return word;
  if (/^[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/.test(word) && !/\d/.test(word)) return word.toLowerCase();
  if (word.includes('-')) {
    return word
      .split('-')
      .map((part, partIndex) => formatSpokenToken(part, index + partIndex, sentenceCase))
      .join('-');
  }
  const lower = word.toLowerCase();
  if (sentenceCase && index > 0 && !PROPER_SHIP[key]) return lower;
  if (SMALL_SHIP_WORD.has(lower) && index > 0) return lower;
  if (/^\d/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Spoken product name: keep the source's casing (tsc-rs, BotID) and never
 * Title-Case a kebab or camel token. Tape ALL-CAPS falls back to PROPER_SHIP.
 */
export function spokenShipName(name: string, source?: string | null): string {
  const original = tidy(source || '');
  const fallback = tidy(name);
  if (!original && !fallback) return '';
  const mapped = PROPER_SHIP[loose(original || fallback)];
  if (mapped && (original || fallback).split(/\s+/).length <= 3) return mapped;
  const keepSource =
    Boolean(original) &&
    ((/[a-z]/.test(original) && /[A-Z]/.test(original)) || /^[a-z0-9]+(?:-[a-z0-9.]+)+$/.test(original));
  const input = keepSource ? original : fallback;
  const sentenceCase = !keepSource && input.split(/\s+/).filter(Boolean).length >= 4 && input === input.toUpperCase();
  let index = 0;
  return input.replace(/[A-Za-z0-9.+]+(?:-[A-Za-z0-9.+]+)*/g, (word) => {
    const out = formatSpokenToken(word, index, sentenceCase);
    index += 1;
    return out;
  });
}

/** Tape names stay uppercase; notes speak them in natural / source case. */
export function displayShipName(name: string, source?: string | null): string {
  return spokenShipName(name, source);
}

const VERSION = String.raw`v?(?:\d{4}\.\d{1,2}\.\d{1,2}|\d{1,3}(?:\.\d+){1,3})`;

export function versionParts(name: string): { product: string; version: string; extra?: number } | null {
  const labeled = tidy(name).match(
    /^(\d+\.\d+)\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );
  if (labeled) return { product: 'Cursor', version: labeled[1] };
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
  const isNow = text.match(/^([A-Za-z][\w.-]{1,32}(?:\s+[A-Za-z][\w.-]{1,24}){0,3})\s+(?:is|are) now\b/i);
  if (isNow) return tidy(isNow[1]);
  const nowDoes = text.match(/^([A-Za-z][\w.-]{1,32}(?:\s+[A-Za-z][\w.-]{1,24}){0,3})\s+now (?:display|shows?|includes?|accepts?|link|links)\b/i);
  if (nowDoes) return tidy(nowDoes[1]);
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
const LABELED_VERSION =
  /^(\d+\.\d+)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

/** `3.10 JUN 30, 2026` → the day on the card, so version rows can roll up. */
export function dateFromLabeledTitle(raw: unknown, year: number): string | null {
  const text = tidy(raw);
  const match = text.match(
    /(\d+\.\d+)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?/i,
  );
  if (!match) return null;
  const y = match[4] ? Number(match[4]) : year;
  if (y !== year) return null;
  const mm = MONTHS_SHORT.findIndex((mon) => mon.toLowerCase() === match[2].slice(0, 3).toLowerCase());
  if (mm < 0) return null;
  return `${y}-${String(mm + 1).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

export function cleanShipTitle(raw: unknown, max = TITLE_MAX): string {
  if (/[A-Za-z0-9]-$/.test(tidy(raw))) return '';
  if (/including:?\s*$/i.test(tidy(raw))) return '';
  let text = normalizeVersionTokens(stripDateSuffix(tidy(raw)));
  if (!text) return '';
  const nowLive = text.match(/^(.{2,48}?)\s+(?:is|are) now\b/i);
  if (nowLive?.[1] && nowLive[1].trim().split(/\s+/).length <= 6) text = nowLive[1].trim();
  if (isNotAShipTitle(text) || isDocsOrReferenceTitle(text) || isVagueOrCutTitle(text) || isCodeOrBugfixTitle(text)) return '';
  const labeled = text.match(LABELED_VERSION);
  if (labeled) text = `Cursor ${labeled[1]}`;
  const join = text.match(/^([A-Za-z][\w.-]{1,32})\s+(?:is joining|joins)\s+([A-Za-z][\w.-]{1,32})/i);
  if (join) text = `${join[1]} joining ${join[2]}`;
  const report = text.match(/^a technical report on\s+(.+)$/i);
  if (report?.[1]) text = report[1];
  const meet = text.match(/^meet the new\s+(.+)$/i);
  if (meet?.[1]) text = meet[1];
  if (/^codex,\s*our code generation cli(?: tool)?$/i.test(text)) text = 'Codex CLI';
  if (/^install the chatgpt desktop app on linux$/i.test(text) || /^chatgpt desktop app on linux$/i.test(text)) {
    text = 'ChatGPT Desktop for Linux';
  }
  const deployFrom = text.match(/^deploy from (.+) to vercel$/i);
  if (deployFrom) text = `${deployFrom[1].trim()} deploys`;
  const tagline = text.match(/^([A-Za-z0-9][\w.+ -]{1,40}):\s+(.+)$/);
  if (tagline && /\b(new generation|next[- ]generation|the next|a new|smoother|smarter|clearer|frontier intelligence|more useful)\b/i.test(tagline[2])) {
    text = tagline[1].trim();
  }
  text = text.replace(/^the new\s+/i, '').replace(/^new\s+(v\d\b)/i, '$1');
  if (/^(released|updated|added)\s+/i.test(text)) {
    text = text.replace(/^(released|updated|added)\s+/i, '').replace(/^the\s+/i, '').trim();
  }
  text = text.replace(/\b([\w][\w.-]{3,})\s+\1\b/gi, '$1');
  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');
  text = text.replace(/\s+and \d+ others?\b.*$/i, '');
  text = text.replace(/,\s+a new\b.*$/i, '').trim();
  text = text.replace(/\s+in (public )?beta with\b.*$/i, '').trim();
  text = text.replace(/-+$/, '').trim();
  const speedTag = text.match(/^(.*?):\s*(.+?)\s+at up to\s+\d+x\b.*$/i);
  if (speedTag) {
    const left = speedTag[1].replace(/^(introducing|launching|announcing|presenting|previewing)\s+/i, '').trim();
    const mid = speedTag[2].trim();
    text = left && !isJunkTitle(left) && !isVagueOrCutTitle(left) ? left : mid || left;
  }
  text = text
    .replace(/^(introducing|launching|announcing|presenting|meet|say hello to|now available[:\s]+|how to|read the|launched|previewing|released|updated|added)\s+/i, '')
    .replace(/:?\s*at up to\s+\d+x\b.*$/i, '')
    .replace(/\s+launched as\b.*$/i, '')
    .replace(/\s+(is )?(now |generally )?available(\s+(today|on\b.*|in\b.*))?$/i, '')
    .replace(/\s+now in (public )?beta\b.*$/i, '')
    .replace(/\s+is now\b.*$/i, '')
    .replace(/\s+support for\b.*$/i, '')
    .replace(/\s+now supports?\b.*$/i, '')
    .replace(/\s+now supported\b.*$/i, '')
    .replace(/\s+now (shows?|includes?|calculates?|provides?|returns?|uses?|links?)\b.*$/i, '')
    .replace(/\s+and other\b.*$/i, '')
    .replace(/\s+(release|launch) notes\.?$/i, '')
    .replace(/\s+reconnects?$/i, '')
    .replace(/\s+,/g, ',')
    .replace(/[,\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (isVagueOrCutTitle(text) || isCodeOrBugfixTitle(text)) return '';
  while (text && endsWithCutOffWord(text)) {
    text = text.split(/\s+/).slice(0, -1).join(' ').trim();
  }
  if (!text) return '';
  const changelogSentence = /\b(are now|is now|now live|now display)\b/i.test(text);
  if (changelogSentence) {
    const phrase = nounPhraseFromSentence(text);
    const words = phrase ? phrase.split(/\s+/).filter(Boolean) : [];
    if (phrase && words.length >= 2 && words.length <= 6 && !isJunkTitle(phrase) && !SENTENCE_VERB.test(phrase)) text = phrase;
    else if (text.split(/\s+/).filter(Boolean).length >= 8) return '';
  } else if (/\b(can also|can now)\b/i.test(text)) {
    const phrase = nounPhraseFromSentence(text);
    const words = phrase ? phrase.split(/\s+/).filter(Boolean) : [];
    if (phrase && words.length >= 2 && words.length <= 6 && !isJunkTitle(phrase)) text = phrase;
  }
  if (!text) return '';
  if (isJunkTitle(text)) return '';
  const keepVersion = Boolean(versionParts(text));
  const clampTo = changelogSentence ? TITLE_MAX : keepVersion ? Math.max(max, TITLE_HARD_MAX) : TITLE_HARD_MAX;
  const clamped = wordClamp(text, clampTo);
  if (!clamped || isJunkTitle(clamped) || looksMidWord(clamped) || looksCutOff(clamped) || looksFragment(clamped)) return '';
  return gateShipTitle(String(raw ?? ''), shortenWordyTitle(clamped));
}

/** Changelog leftovers with 8+ words become a short product name. */
export function shortenWordyTitle(title: string): string {
  let text = stripMarkup(title)
    .replace(/\s+and other\b.*$/i, '')
    .replace(/\s+now (links?)\b.*$/i, '')
    .trim();
  if (!text) return '';
  const launched = text.match(/^(?:we|i|i['’]ve|i['’]m)\s+(?:launched|shipped|released|built|made|added)\s+(.+)$/i);
  if (launched?.[1]) text = launched[1].trim();
  text = text
    .replace(/\s+(?:is|are)\s+now\s+available\s+on\s+(?:the\s+)?(?:vercel\s+)?ai gateway\b.*$/i, '')
    .replace(/\s+now\s+available\s+on\s+(?:the\s+)?(?:vercel\s+)?ai gateway\b.*$/i, '')
    .replace(/\s+available\s+on\s+(?:the\s+)?(?:vercel\s+)?ai gateway(?:,\s*free)?\b.*$/i, '')
    .replace(/\s+for free(?:\s+on every plan)?$/i, '')
    .replace(/\s+on every plan$/i, '')
    .replace(/\s+starts?\s+\d+%\s+faster$/i, '')
    .replace(/\s+\d+%\s+faster$/i, '')
    .replace(/\s+with the\s+.+$/i, '')
    .trim();
  if (!text) return '';
  if (/\d+\.\d+/.test(text) || /·\s*\d+\s+(updates?|releases?)/i.test(text)) return text;
  const originalWords = text.split(/\s+/).filter(Boolean);
  if (originalWords.length < 8) return text;
  if (isMinorPlatformChange(text) || isMinorPlatformChange(title)) return text;
  const phrase = nounPhraseFromSentence(text);
  const phraseWords = phrase ? phrase.split(/\s+/).filter(Boolean) : [];
  if (phrase && phraseWords.length >= 2 && phraseWords.length < 8 && isProductNounPhrase(phrase) && !looksCutOff(phrase) && !isJunkTitle(phrase)) {
    return phrase;
  }
  let clipped = originalWords.slice(0, 5).join(' ');
  while (clipped && TITLE_TRAILING_GLUE.test(clipped)) {
    clipped = clipped.split(/\s+/).slice(0, -1).join(' ').trim();
  }
  const clippedWords = clipped.split(/\s+/).filter(Boolean);
  const canNow = /\bcan now\b/i.test(clipped);
  if (
    clippedWords.length >= 2 &&
    !looksCutOff(clipped) &&
    !isJunkTitle(clipped) &&
    !SENTENCE_VERB.test(clipped) &&
    (canNow || (isProductNounPhrase(clipped) && !/\bnow\b/i.test(clipped)))
  ) {
    return clipped;
  }
  if (
    clippedWords.length >= 3 &&
    clippedWords.length < 8 &&
    !looksCutOff(clipped) &&
    !looksMidWord(clipped) &&
    !isJunkTitle(clipped) &&
    !TITLE_TRAILING_GLUE.test(clipped)
  ) {
    return clipped;
  }
  return '';
}

/** levels.io / indie journal ships: first-person launches, not blog essays.
 *  "Announced 2026" / "I made this." on the description is not enough — tweet
 *  dumps get those prefixes from the journal scraper. After rewrite the name
 *  is the product (hotelist.com); keep those via kind, host, or ship-list href. */
export function isJournalShip(item: {
  name?: string;
  description?: string | null;
  source?: string;
  kind?: string;
  link?: string | null;
}): boolean {
  if (String(item.kind || '') === 'journal-ship') return true;
  const name = String(item.name || '').trim();
  if (looksLikePersonalShip(name)) return true;
  if (!name || looksLikeEssayTitle(name) || isBlogEssayTitle(name) || looksLikeMonthlyRoundup(name)) return false;
  if (item.source && item.source !== 'site') return false;
  const words = name.split(/\s+/).filter(Boolean);
  const hostish = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(com|io|ai|app|dev|co)$/i.test(name);
  const shortProduct = words.length <= 4 && /\b(feature|features|free|milestone)$/i.test(name);
  if (!hostish && !shortProduct) return false;
  const link = String(item.link || '');
  return Boolean(link && (isShipListHref(link) || /#/.test(link)));
}

/** Product / feature / model noun phrase. Sentence fragments and dangling preps fail. */
const NAMED_PRODUCT = /\b(codex|chatgpt|cursor|v0|gpt-?\d|sora|atlas|appshots|sites)\b/i;
const SOFT_NAMED_START = /^(use|build|building|work|more)\b/i;
const SOFT_CONCRETE_START = /^(share|pin|open)\b/i;

/** `use-sound`, `@scope/pkg` — a package id, not a "use X" sentence. */
function isHyphenatedPackage(title: string): boolean {
  const text = tidy(title);
  return /^@[\w.-]+\/[\w.-]+$/.test(text) || /^[A-Za-z][\w]*[-_][\w.-]+$/.test(text);
}

export function isProductNounPhrase(title: string): boolean {
  const text = tidy(title);
  if (!text) return false;
  if (isHyphenatedPackage(text)) return true;
  if (TITLE_START_BAD.test(text)) {
    const namedOk = SOFT_NAMED_START.test(text) && NAMED_PRODUCT.test(text);
    const concreteOk = SOFT_CONCRETE_START.test(text) && text.split(/\s+/).length >= 3;
    if (!namedOk && !concreteOk) return false;
  }
  if (TITLE_END_BAD.test(text) && !NAMED_PRODUCT.test(text)) return false;
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
  if (!isHyphenatedPackage(text) && !isHyphenatedPackage(tidy(raw)) && (/^use\b/i.test(tidy(raw)) || /^use\b/i.test(text))) {
    if (!/^use\s+(codex|chatgpt|cursor|v0|gpt-?\d)\b/i.test(text) && !/^use\s+(codex|chatgpt|cursor|v0|gpt-?\d)\b/i.test(tidy(raw))) {
      return '';
    }
  }
  if (SENTENCE_VERB.test(text) || CODE_TITLE.test(text)) {
    const phrase = nounPhraseFromSentence(raw);
    return phrase && isProductNounPhrase(phrase) && !SENTENCE_VERB.test(phrase) ? phrase : '';
  }
  if (isProductNounPhrase(text) && (text.split(/\s+/).length >= 2 || !DOCS_NAV.test(text))) return text;
  const phrase = nounPhraseFromSentence(raw);
  if (
    phrase &&
    isProductNounPhrase(phrase) &&
    phrase.split(/\s+/).length >= 2 &&
    !DOCS_NAV.test(phrase) &&
    !/^use\b/i.test(tidy(raw))
  ) {
    return phrase;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 4 && !looksCutOff(text) && !looksMidWord(text) && !looksFragment(text) && !TITLE_START_BAD.test(words[0] || '')) {
    return wordClamp(text, TITLE_MAX);
  }
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
  if (company && !item.date && !knownFlagshipDate(item, year) && !isOssHarvestItem(item)) return false;
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

/** Strip markdown and HTML so harvest text never prints as `###` / `<h3>`. */
export function stripMarkup(value: unknown): string {
  return tidy(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`+/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\b(p|h[1-6]|div|span|img|a|ul|ol|li|br)\s+(align|class|src|href|style)=["'][^"']*["']/gi, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_TRAILING_GLUE =
  /(?:^|[\s/])(&|of|in|to|for|and|or|the|a|an|with|on|as|by|from|into|vs|via|can|you|we|they|now|just|still)\s*$/i;
const ESSAY_OPENER =
  /^(i|i'm|i've|i'd|we've|it's|this is how|everyone can|congratulations|yesterday|looking through)\b/i;
const PRINTED_FIRST_PERSON = /^(i|i'm|i've|i'd|we|we've|it's)\b/i;
const ESSAY_MIDDLE = /\b(because|while america|after trying|so now|is the best|in the entire|i think)\b/i;

/** Tweet / blog-essay titles are not product names. Short "We launched X" changelog lines stay for Claude to rename. */
export function looksLikeEssayTitle(title: string): boolean {
  const text = stripMarkup(title);
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (ESSAY_OPENER.test(text)) return true;
  if (/\bbest\b/i.test(text) && /\b(20\d{2}|generators?|tools?|apps?)\b/i.test(text) && words.length >= 4) return true;
  if (words.length >= 12) return true;
  if (words.length >= 8 && ESSAY_MIDDLE.test(text)) return true;
  if (words.length >= 6 && !/\d+\.\d+/.test(text) && /\b(is|are|was|were|makes|broke|will|can't|could|should|has|have|had|lies|killed)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Printed tape titles cannot stay in first person — Claude must rewrite "We launched X" to the product name. */
export function looksLikePrintedFirstPerson(title: string): boolean {
  return PRINTED_FIRST_PERSON.test(stripMarkup(title));
}

export function looksLikeSocialPost(item: { source?: string; kind?: string; link?: string | null }): boolean {
  if (String(item.source || '') === 'x' || String(item.kind || '') === 'post') return true;
  try {
    const host = new URL(String(item.link || '')).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com') || host === 'mobile.x.com';
  } catch {
    return false;
  }
}

export function looksLikeScopedPackage(title: string): boolean {
  return /^@[\w.-]+\//.test(stripMarkup(title));
}

/** Monthly recap blogs and "building X, part N" essays are not ships. */
export function looksLikeMonthlyRoundup(title: string): boolean {
  const text = stripMarkup(title);
  if (!text) return false;
  if (/^what[’'`´]?s new in\b/i.test(text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))) return true;
  if (/^building\b.+,?\s+part\s+\d/i.test(text)) return true;
  if (/\b(year in review|annual recap|wrapped|recap)\b/i.test(text) && !/\d+\.\d+/.test(text)) return true;
  if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\b/.test(text) && text.split(/\s+/).length <= 8) return true;
  if (/^[A-Z]{3}\s+\d{1,2},\s+\d{4}$/.test(text)) return true;
  return false;
}

/** Tiny deterministic check after the LLM rewrites a title. */
export function titleSanityOk(title: string): boolean {
  const text = stripMarkup(title);
  if (!text || text.length < 2) return false;
  if (/[<>{}`#]/.test(text)) return false;
  if (/^#{1,6}\s/.test(title) || /<\/?[a-z]/.test(title)) return false;
  if (TITLE_TRAILING_GLUE.test(text)) return false;
  if (looksCutOff(text) || endsWithCutOffWord(text)) return false;
  if (looksLikePrintedFirstPerson(text) || looksLikeEssayTitle(text) || looksLikeScopedPackage(text) || looksLikeMonthlyRoundup(text)) {
    return false;
  }
  if (/\band \d+ others?\b/i.test(text) || hasMashedDuplicateTokens(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 8 && !/\d+\.\d+/.test(text) && !/·\s*\d+\s+(updates?|releases?)/i.test(text)) return false;
  if (SENTENCE_VERB.test(text) && !/\d+\.\d+/.test(text)) return false;
  if (text.length > TITLE_HARD_MAX && !/·\s*\d+\s+(updates?|releases?)/i.test(text)) return false;
  return true;
}

/** Claude title if it already prints; otherwise a deterministic product-name shortener. Never drop a rewriteable line. */
export function rewriteShipTitle(title: string, link?: string | null): string {
  const raw = stripMarkup(title).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const flag = flagshipLaunchName({ name: raw, link: link || undefined });
  if (flag && titleSanityOk(flag)) return flag;
  if (titleSanityOk(raw) && raw.length <= TITLE_HARD_MAX) return raw;
  const short = shortenWordyTitle(raw);
  const printable = (text: string) =>
    Boolean(
      text &&
        titleSanityOk(text) &&
        !isVagueOrCutTitle(text) &&
        !isNotAShipTitle(text) &&
        !isDocsOrReferenceTitle(text) &&
        !/^(released|updated|previewing|announcing)\b/i.test(text),
    );
  if (printable(short)) return short;
  const words = (short || raw).split(/\s+/).filter(Boolean);
  if (words.length >= 8) {
    const clip = words.slice(0, 5).join(' ');
    if (printable(clip)) return clip;
  }
  return '';
}

export function cleanDescription(value: unknown): string {
  let text = stripMarkup(value);
  if (!text || META_DESC.test(text) || HOST_ONLY.test(text)) return '';
  if (/\bopens in a new window\b|\bcopy link to\b/i.test(text) && text.split(/\s+/).length <= 14) return '';
  text = text
    .replace(/\s*\(opens in a new window\)\.?/gi, '')
    .replace(/\bopens in a new window\b/gi, '')
    .replace(/\bcopy link to\b[\s\S]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !text ||
    /<\/?[a-z]|align=["']|^(p|h[1-6]|div|span|img|ul|ol|li|picture|source)\b|\b(srcset|prefers-color-scheme|media=["'])/i.test(text)
  )
    return '';
  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');
  if (text.length <= DESC_MAX) return text;
  const cut = wordClamp(text, DESC_MAX);
  if (!cut || looksCutOff(cut) || looksMidWord(cut)) return '';
  return cut;
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

const MONTH_LINE = /^(.+?)\s*·\s*(\d+)\s+(?:updates?|releases?)\s+in\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*$/i;

function isNotableOssVersion(version: string): boolean {
  const ver = version.replace(/^v/i, '');
  if (/^\d{4}\.\d/.test(ver)) return false;
  if (/^\d+$/.test(ver)) return true;
  const pair = ver.match(/^(\d+)\.(\d+)$/);
  if (!pair) return false;
  const major = Number(pair[1]);
  const minor = Number(pair[2]);
  return major <= 25 && minor <= 40;
}

const NAMED_OSS_MAJOR =
  /^(bun|vite|vue|react|svelte|sveltekit|rolldown|rails|preact|oxc|nitro|tanstack query|code hike|partykit)$/i;
const PACKAGE_ROLLUP = /·\s*\d+\s+(updates?|releases?)(?:\s+in\s+\w+)?$/i;
const VERSION_RANGE = /\s+v?\d+(?:\.\d+){1,3}\s*[–-]\s*v?\d+(?:\.\d+){1,3}$/i;

function parseSemver(version: string): [number, number, number] {
  const parts = version.replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function cmpSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** npm registry rows and npmjs.com package pages — never print their readme blurb. */
export function isNpmPackageItem(item: { source?: string | null; link?: string | null }): boolean {
  if ((item.source || '') === 'npm') return true;
  return /(?:^|\/\/)(?:www\.)?npmjs\.com\b/i.test(item.link || '');
}

const CEO_NPM_KEEP = /^(next(?:\.?js)?|vercel|swr|ai|ai-sdk|ncc|@ai-sdk\/|@vercel\/)/i;

/** One-word npm utilities (serve, canvas, botid) do not lead a CEO tape. */
export function isCeoNpmUtility(
  item: { name?: string; source?: string | null; link?: string | null },
  affiliation?: Affiliation | null,
): boolean {
  const role = affiliation?.role;
  if (role !== 'ceo' && role !== 'founder') return false;
  if (!isNpmPackageItem(item)) return false;
  if (flagshipLaunchName(item)) return false;
  const raw = tidy(item.name || '');
  if (!raw || PACKAGE_ROLLUP.test(raw) || VERSION_RANGE.test(raw)) return false;
  const pkg = raw.replace(/^@/, '').split(/[\s/]+/)[0] || raw;
  if (CEO_NPM_KEEP.test(raw) || CEO_NPM_KEEP.test(pkg)) return false;
  const company = loose(affiliation?.company || '');
  const product = loose(affiliation?.product || '');
  if (company && (loose(pkg) === company || loose(raw) === company)) return false;
  if (product && (loose(pkg) === product || loose(raw).includes(product))) return false;
  return true;
}

export function printedDescription(item: { description?: string; source?: string | null; link?: string | null }): string {
  if (isNpmPackageItem(item)) return '';
  return cleanDescription(item.description);
}

/** Significance-3 / named flagships print first (top ~5), then the rest by date. */
export function isHeadlinerItem(item: Polishable): boolean {
  if (flagshipLaunchName(item)) return true;
  return (item.significance ?? 0) >= 3;
}

export function orderReceiptItems<T extends Polishable>(items: T[]): T[] {
  const ranked = items.slice().sort((a, b) => {
    const headA = isHeadlinerItem(a);
    const headB = isHeadlinerItem(b);
    if (headA !== headB) return headA ? -1 : 1;
    if (headA && headB) {
      const sig = (b.significance ?? 0) - (a.significance ?? 0);
      if (sig) return sig;
    }
    return (a.date ?? '9999').localeCompare(b.date ?? '9999');
  });
  const head = ranked.filter(isHeadlinerItem).slice(0, 5);
  const seen = new Set(head);
  const rest = ranked.filter((item) => !seen.has(item)).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  return [...head, ...rest];
}

/**
 * Year-wide rollup: ≥3 patch/minor lines of one package become one tape line.
 * Named majors (Vite 7 / Vite 8) and flagships stay separate.
 */
export function rollupSamePackageVersions<T extends Polishable>(items: T[]): T[] {
  const groups = new Map<string, { item: T; product: string; version: string | null; count: number }[]>();
  const kept: T[] = [];
  for (const item of items) {
    if (VERSION_RANGE.test(item.name) || flagshipLaunchName(item)) {
      kept.push(item);
      continue;
    }
    const rolled = tidy(item.name).match(PACKAGE_ROLLUP);
    if (rolled) {
      const product = tidy(item.name).replace(PACKAGE_ROLLUP, '').trim() || item.name;
      if (NAMED_OSS_MAJOR.test(product) || flagshipLaunchName({ ...item, name: product })) {
        kept.push(item);
        continue;
      }
      const count = Number(item.name.match(/·\s*(\d+)\s+(?:updates?|releases?)/i)?.[1]) || 1;
      const key = loose(product);
      const list = groups.get(key) ?? [];
      list.push({ item, product, version: null, count });
      groups.set(key, list);
      continue;
    }
    const parts = versionParts(item.name);
    if (!parts || NAMED_OSS_MAJOR.test(parts.product)) {
      kept.push(item);
      continue;
    }
    const key = loose(parts.product);
    const list = groups.get(key) ?? [];
    list.push({ item, product: parts.product, version: parts.version, count: versionCount(item) });
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    const count = list.reduce((sum, row) => sum + row.count, 0);
    if (count < 3) {
      kept.push(...list.map((row) => row.item));
      continue;
    }
    const latest = list.slice().sort((a, b) => (b.item.date ?? '').localeCompare(a.item.date ?? ''))[0]!.item;
    const versions = list
      .map((row) => row.version?.replace(/^v/i, '') || '')
      .filter(Boolean)
      .sort(cmpSemver);
    const product = list[0]!.product;
    const majors = new Set(versions.map((version) => version.split('.')[0]));
    const first = versions[0] || '';
    const last = versions[versions.length - 1] || first;
    const name =
      majors.size === 1 && first && last && first !== last && list.every((row) => row.version)
        ? `${product} ${first}–${last}`
        : `${product} · ${count} releases`;
    kept.push({ ...latest, name, description: '' });
  }
  return kept;
}

function versionFamily(item: Polishable): { product: string; count: number } | null {
  if (isOssHarvestItem(item) || item.kind === 'oss-release' || item.kind === 'oss-launch' || item.kind === 'oss-blog') return null;
  if (/·\s*\d+\s+releases?\s+in\s+/i.test(item.name)) return null;
  if (isCursorModelNote(item) || /^(grok|claude|gemini)[-.\s]?\d/i.test(item.name)) return null;
  const rolled = tidy(item.name).match(MONTH_LINE);
  if (rolled) return { product: rolled[1].trim(), count: Number(rolled[2]) || 1 };
  const parts = versionParts(item.name);
  if (!parts) return null;
  if (flagshipLaunchName(item)) return null;
  if (/^(grok|claude|gemini)$/i.test(parts.product)) return null;
  if (isNotableOssVersion(parts.version) && !parts.extra) return null;
  if (NAMED_OSS_MAJOR.test(parts.product) && !parts.extra) {
    return null;
  }
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
      name: count <= 1 ? product : `${product} · ${count} updates in ${mon}`,
      description: '',
    });
  }
  return kept;
}

const SEMANTIC_STOP = new Set(['in', 'the', 'a', 'an', 'and', 'of', 'for', 'on', 'with', 'to', 'from', 'at']);
const GPT_FLUFF = /^(intelligent|ui|everyone|preferred|model|microsoft|365|copilot|previewing|ultrafast|mode)$/i;

/** Word-order-insensitive ship key: "Health in ChatGPT" == "ChatGPT Health". */
export function semanticShipKey(name: string): string {
  const tokens = tidy(name)
    .toLowerCase()
    .replace(/\bgpt[-\s]?(\d+(?:\.\d+)?)/gi, (_, ver: string) => `gpt${ver.replace(/\./g, '')}`)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !SEMANTIC_STOP.has(token));
  const gpt = tokens.find((token) => /^gpt\d/.test(token));
  if (gpt && tokens.filter((token) => token !== gpt).every((token) => GPT_FLUFF.test(token))) return gpt;
  return tokens.slice().sort().join('');
}

/** If the title names GPT-N but the URL slug is GPT-M, prefer the slug. */
export function reconcileTitleWithHref(name: string, link?: string | null): string {
  if (!name || !link) return name;
  const titleGpt = name.match(/\bgpt[-\s]?(\d+(?:\.\d+)?)/i);
  const slugGpt = String(link).match(/\/gpt-(\d+(?:-\d+)*)(?:\/|$|[?#])/i);
  if (!titleGpt || !slugGpt) return name;
  const titleVer = titleGpt[1];
  const slugVer = slugGpt[1].replace(/-/g, '.');
  if (titleVer === slugVer) return name;
  return name.replace(titleGpt[0], `GPT-${slugVer}`);
}

function preferShorterShip<T extends Polishable>(a: T, b: T): T {
  const wordsA = a.name.split(/\s+/).filter(Boolean).length;
  const wordsB = b.name.split(/\s+/).filter(Boolean).length;
  if (wordsA !== wordsB) return wordsA < wordsB ? a : b;
  return titleScore(a) >= titleScore(b) ? a : b;
}

/** Same normalized name → one line (NUB + NUB, not NUB + NUBJS). */
export function dedupeNormalized<T extends Polishable>(items: T[]): T[] {
  const best = new Map<string, T>();
  const none: T[] = [];
  for (const item of items) {
    const key = semanticShipKey(item.name) || loose(item.name);
    if (!key) {
      none.push(item);
      continue;
    }
    const prev = best.get(key);
    if (!prev) best.set(key, item);
    else best.set(key, preferShorterShip(prev, item));
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

/** AI Gateway model listings collapse to one line. */
export function rollupGatewayModels<T extends Polishable>(items: T[]): T[] {
  const models: T[] = [];
  const kept: T[] = [];
  for (const item of items) {
    if (isGatewayModelListing(item.name, item.link, item.description)) models.push(item);
    else kept.push(item);
  }
  if (!models.length) return items;
  const latest = models.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
  kept.push({ ...latest, name: 'New models on AI Gateway', description: '' });
  return kept;
}

/** Minor Vercel settings/policy cards collapse to one monthly platform line. A lone knob drops. */
export function rollupPlatformSettings<T extends Polishable>(items: T[]): T[] {
  const minor: T[] = [];
  const kept: T[] = [];
  for (const item of items) {
    if (isMinorPlatformChange(item.name)) minor.push(item);
    else kept.push(item);
  }
  if (!minor.length) return items;
  const groups = new Map<string, T[]>();
  for (const item of minor) {
    const month = (item.date || '').match(/^(\d{4}-\d{2})/)?.[1] || 'undated';
    const list = groups.get(month) ?? [];
    list.push(item);
    groups.set(month, list);
  }
  for (const [month, list] of groups) {
    if (list.length < 2 || month === 'undated') continue;
    const latest = list.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]!;
    const mon = MONTHS_SHORT[Number(month.slice(5, 7)) - 1] || month;
    kept.push({
      ...latest,
      name: `Vercel Platform · ${list.length} updates in ${mon}`,
      description: '',
    });
  }
  return kept;
}

const COUNT_ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const COUNT_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

function spokenCount(word: string): number | null {
  const text = word.toLowerCase().replace(/[\s_]+/g, '-');
  if (COUNT_ONES[text] != null) return COUNT_ONES[text];
  if (COUNT_TENS[text] != null) return COUNT_TENS[text];
  const parts = text.split('-');
  if (parts.length === 2 && COUNT_TENS[parts[0]] != null && COUNT_ONES[parts[1]] != null) {
    return COUNT_TENS[parts[0]]! + COUNT_ONES[parts[1]]!;
  }
  return null;
}

export function noteCountMismatch(note: string, count: number): boolean {
  const mention =
    /\b(\d{1,4}|twenty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|zero|one|two|three|four|five|six|seven|eight|nine)\s+(printed\s+)?(public\s+)?(ships?|lines?|launches?|things?|updates?|items?|projects?|repos?|repositories|entries)\b/i.exec(
      note,
    );
  if (!mention) return false;
  const raw = mention[1].replace(/\s+/g, '-');
  const n = /^\d+$/.test(raw) ? Number(raw) : spokenCount(raw);
  if (n == null || Number.isNaN(n)) return false;
  return n !== count;
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

/** Undated lines sort last and may not lead. When anything is dated, crumb undated stay ≤ 25% of the tape (U ≤ D/3). Company/changelog cards without a day were already dropped. */
export function capUndated<T extends Polishable>(items: T[], onDrop?: (drop: PolishDrop) => void): T[] {
  const dated = items.filter((item) => item.date);
  const companyUndated = items.filter(
    (item) => !item.date && (item.source === 'changelog' || item.source === 'company') && flagshipLaunchName(item),
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
    if (isEmployerSpill(item, opts.affiliation)) {
      drop(item, 'employer-spill');
      continue;
    }
    if (
      (opts.affiliation?.role === 'ceo' || opts.affiliation?.role === 'founder') &&
      isCeoApiMinutiae(item.name, item.link)
    ) {
      drop(item, 'ceo-api-minutiae');
      continue;
    }
    if (isCeoNpmUtility(item, opts.affiliation)) {
      drop(item, 'ceo-npm-utility');
      continue;
    }
    if (
      !flagship &&
      !isJournalShip(item) &&
      (isBlogEssayTitle(item.name) || looksLikeEssayTitle(item.name) || looksLikeMonthlyRoundup(item.name))
    ) {
      drop(item, 'essay-title');
      continue;
    }
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
    const junkOpts = {
      who,
      handle: opts.handle,
      github: opts.owner?.github,
      company: opts.affiliation?.company,
      date: item.date,
    };
    let name = isJournalShip(item) && looksLikePersonalShip(item.name) ? cleanShipTitle(journalShipName(item.name) || item.name) : cleanShipTitle(item.name);
    if (!name && isJournalShip(item)) name = journalShipName(item.name) || String(item.name || '').trim();
    if (name) name = shortenWordyTitle(name);
    if (name) name = reconcileTitleWithHref(name, item.link);
    if (!name && (item.source === 'changelog' || isChangelogEntryHref(item.link))) {
      const fallback = rewriteShipTitle(item.name, item.link) || wordClamp(stripDateSuffix(tidy(item.name).replace(/\bcopy link to\b[\s\S]*/i, '')), TITLE_MAX);
      const keepCard =
        fallback &&
        fallback.split(/\s+/).length >= 2 &&
        !looksCutOff(fallback) &&
        !looksMidWord(fallback) &&
        !looksFragment(fallback) &&
        !isVagueOrCutTitle(fallback) &&
        !/including:?$/i.test(String(item.name || '')) &&
        !isPrereleaseShip(fallback) &&
        !isNeverShipKind(fallback) &&
        !isDocsOrReferenceTitle(fallback) &&
        !isBlogEssayTitle(fallback) &&
        !isNotAShipTitle(fallback) &&
        titleSanityOk(fallback);
      if (keepCard) name = fallback;
    }
    if (name) name = reconcileTitleWithHref(name, item.link);
    if (flagship && !isCursorModelNote(item) && (!name || name.split(/\s+/).length <= 1 || /^the new\b/i.test(name))) {
      if (!name) logFlagshipGate(item, isJunkTitle(item.name, junkOpts) ? 'junk-title' : 'title-empty', flagship);
      name = flagship;
    }
    if (!name) {
      drop(item, isJunkTitle(item.name, junkOpts) ? 'junk-title' : 'title-empty');
      continue;
    }
    if (isChangelogIdOrHostCrumb(name, item.link) || isChangelogIdOrHostCrumb(item.name, item.link)) {
      drop(item, 'changelog-id');
      continue;
    }
    if (looksLikePrintedFirstPerson(name)) {
      const launched = name.match(
        /^(?:we|i|i['’]ve|i['’]m)\s+(?:launched|shipped|released|built|made|added)\s+(.+)$/i,
      );
      const extracted = launched?.[1]?.trim() || '';
      if (extracted && isProductNounPhrase(extracted) && !looksLikePrintedFirstPerson(extracted)) {
        name = extracted;
      } else {
        drop(item, 'first-person');
        continue;
      }
    }
    if (isJunkTitle(name, junkOpts)) {
      if (flagship) {
        logFlagshipGate(item, 'junk-title', flagship);
        name = flagship;
      } else {
        drop(item, 'junk-title');
        continue;
      }
    }
    if (isOffCompanyChangelog({ ...item, name }, opts.affiliation?.company || junkOpts.company)) {
      drop(item, 'off-company-changelog');
      continue;
    }
    if (isForeignProductOnCompanyTape(name, opts.affiliation?.company || junkOpts.company)) {
      drop(item, 'foreign-vendor');
      continue;
    }
    if (isStaleBioProduct({ name, date: item.date }, opts.affiliation, year)) {
      drop(item, 'stale-bio-product');
      continue;
    }
    if (isJunkProductName(name, opts.handle || opts.owner?.github, who)) {
      if (flagship) {
        logFlagshipGate(item, 'github-junk', flagship);
        name = flagship;
      } else {
        drop(item, 'github-junk');
        continue;
      }
    }
    if (isLegacyNpmFamily(name)) {
      drop(item, 'legacy-family');
      continue;
    }
    if (isDocsOrCategoryHref(item.link) && !flagship && !isChangelogEntryHref(item.link)) {
      drop(item, 'docs-href');
      continue;
    }
    if (
      !flagship &&
      !isOssHarvestItem(item) &&
      /\/blog\//i.test(item.link || '') &&
      !/changelog/i.test(item.link || '') &&
      (isBlogEssayTitle(name) || /\bships\b/i.test(name) || /\b(engineers?|customers?|teams?)\b/i.test(name))
    ) {
      drop(item, 'blog-essay');
      continue;
    }
    if (isUnnotableCompanyRepo({ ...item, name }) && !flagship) {
      drop(item, 'company-github');
      continue;
    }
    if (
      !isJournalShip({ ...item, name }) &&
      opts.owner &&
      ownerCanProve(opts.owner) &&
      !ownedByBuilder({ ...item, name }, opts.owner)
    ) {
      if (flagship) logFlagshipGate(item, 'not-owned', flagship);
      else {
        drop(item, 'not-owned');
        continue;
      }
    }
    const titledDate = dateFromNumericTitle(item.name, year) || dateFromNumericTitle(name, year);
    const rawDate = String(item.date || '');
    const scrapeJan1 = /^20\d{2}-01-01$/.test(rawDate);
    const date =
      titledDate && scrapeJan1
        ? titledDate
        : knownFlagshipDate({ ...item, name }, year) ??
          (isFlagshipYearKeep(item, year) && item.date ? String(item.date).slice(0, 10) : inYearDate(item.date, year)) ??
          dateFromLabeledTitle(item.name, year) ??
          titledDate;
    if (isChangelogPhrase(name, date)) {
      drop(item, 'changelog-phrase');
      continue;
    }
    if (isMismatchedMonthDate(name, date)) {
      drop(item, 'date-mismatch');
      continue;
    }
    if ((item.significance ?? 1) <= 0 && !flagship) {
      drop(item, 'minor-fix');
      continue;
    }
    if (opts.owner && ownerCanProve(opts.owner) && !undatedPassesGate({ ...item, name, date }, opts.owner)) {
      drop(item, 'undated-unowned');
      continue;
    }
    const role = opts.affiliation?.role;
    const ceo = role === 'ceo' || role === 'founder';
    const npmRow = isNpmPackageItem({ ...item, name });
    let significance = item.significance;
    if (ceo && flagship && !/\bcodex\b/i.test(name)) {
      significance = Math.max(significance ?? 0, 80);
    } else if (ceo && npmRow && !flagship) {
      significance = Math.min(significance ?? 1, 1);
    }
    out.push({
      ...item,
      name,
      description: printedDescription({ ...item, name }),
      date,
      via: sourceVia({ ...item, name }, opts.affiliation),
      status: cleanStatus(item.status),
      significance,
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
  const versioned = rollupSamePackageVersions(rollupVersions(collapsed));
  if (versioned.length < beforeRoll) drop({ name: `${beforeRoll - versioned.length} version rows` }, 'version-rollup');
  const beforePkg = versioned.length;
  const packaged = rollupPlatformPackages(versioned);
  if (packaged.length < beforePkg) drop({ name: `${beforePkg - packaged.length} platform packages` }, 'platform-rollup');
  const models = rollupCursorModels(packaged);
  if (models.length < packaged.length) drop({ name: `${packaged.length - models.length} model notes` }, 'model-rollup');
  const platform = rollupPlatformSettings(models);
  if (platform.length < models.length) drop({ name: `${models.length - platform.length} platform settings` }, 'platform-rollup');
  const gateway = rollupGatewayModels(platform);
  if (gateway.length < platform.length) drop({ name: `${platform.length - gateway.length} gateway models` }, 'gateway-rollup');
  const inherited = inheritDates(gateway);
  const unique = dedupeNormalized(inherited);
  if (unique.length < inherited.length) drop({ name: `${inherited.length - unique.length} duplicate names` }, 'name-dedupe');
  const capped = capUndated(unique, drop);
  if (drops.length) {
    console.log(JSON.stringify({ shipped: 'polish-drops', who, handle: opts.handle || null, kept: capped.length, drops: drops.slice(0, 80) }));
  }
  const rolled = rollupCeoLeadCrumbs(capped, opts.affiliation);
  if (rolled.length < capped.length) drop({ name: `${capped.length - rolled.length} ceo-lead crumbs` }, 'ceo-rollup');
  const sane = rolled.flatMap((item) => {
    if (/·\s*\d+\s+(updates?|releases?)/i.test(item.name) || VERSION_RANGE.test(item.name)) return [item];
    if (isJournalShip(item) && item.name) return [item];
    if (titleSanityOk(item.name)) return [item];
    const short = rewriteShipTitle(item.name, item.link);
    if (short && titleSanityOk(short)) return [{ ...item, name: short }];
    drop(item, 'title-sanity');
    return [];
  });
  return sane.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

export function isOpenAiCompanyWide(name: string, link?: string | null): boolean {
  if (/\bin codex\b|gpt-[\d.]+-codex|\bcodex and\b/i.test(name)) return false;
  if (/chatgpt for ios\s*·/i.test(name)) return false;
  if (/openai\.com\/(index|sora|device)\b/i.test(link || '')) return true;
  return /\b(gpt-?\d|chatgpt|sora|(openai|chatgpt)\s+(device|computer|phone|hardware)|atlas)\b/i.test(name);
}

export function isApiChangelogHref(link?: string | null): boolean {
  return /developers\.openai\.com\/(api\/)?docs\/changelog|platform\.openai\.com\/[^\s]*changelog/i.test(link || '');
}

/** A named model or product, not "support for X in the Y API". */
export function isNamedModelOrProduct(name: string): boolean {
  return /\b(gpt-?\d|gpt-realtime|gpt-audio|gpt-live|chatgpt|sora|codex|atlas|openai realtime|decisions api|agents api)\b/i.test(
    name,
  );
}

/** CEO tapes: API changelog crumbs stay only when they name a model or product. */
export function isCeoApiMinutiae(name: string, link?: string | null): boolean {
  if (!isApiChangelogHref(link) && !/developers\.openai\.com\/api\b/i.test(link || '')) return false;
  return !isNamedModelOrProduct(name);
}

function isOpenAiLeadCrumb(name: string, link?: string | null): boolean {
  if (isOpenAiCompanyWide(name, link)) return false;
  if (/\bcodex\b/i.test(name) || /\/codex\b/i.test(link || '')) return true;
  if (/developers\.openai\.com\/codex|learn\.chatgpt\.com\/docs/i.test(link || '')) return true;
  if (/^(feature|announcement|including:?|update|v1\/responses)$/i.test(name)) return true;
  return false;
}

/** CEO tapes keep company-wide flagships; a product-lead changelog (Codex) collapses to one line. */
export function rollupCeoLeadCrumbs<T extends Polishable>(items: T[], affiliation?: Affiliation | null): T[] {
  const role = affiliation?.role;
  if (role !== 'ceo' && role !== 'founder') return items;
  const company = loose(affiliation?.company || '');
  if (company !== 'openai' && !company.includes('openai')) return items;
  const wide: T[] = [];
  const lead: T[] = [];
  const other: T[] = [];
  for (const item of items) {
    if (isOpenAiCompanyWide(item.name, item.link) || (flagshipLaunchName(item) && !/\bcodex\b/i.test(item.name))) wide.push(item);
    else if (isOpenAiLeadCrumb(item.name, item.link)) lead.push(item);
    else other.push(item);
  }
  const monthly = other.filter((item) => /·\s*\d+\s+updates?\s+in\s+/i.test(item.name));
  const rest = other.filter((item) => !/·\s*\d+\s+updates?\s+in\s+/i.test(item.name));
  const monthKeep = new Map<string, T>();
  for (const item of monthly) {
    const product = tidy(item.name).replace(/\s*·\s*\d+\s+updates?\s+in\s+\w+\s*$/i, '').trim() || item.name;
    const key = loose(product);
    const prev = monthKeep.get(key);
    if (!prev || (item.date ?? '') > (prev.date ?? '')) monthKeep.set(key, { ...item, name: product });
  }
  if (wide.length < 1 || lead.length <= 1) return [...wide, ...rest, ...monthKeep.values(), ...lead];
  const app =
    lead.find((item) => /^codex app\b/i.test(item.name)) ??
    lead.slice().sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0) || (a.date ?? '').localeCompare(b.date ?? ''))[0];
  return [...wide, ...rest, ...monthKeep.values(), ...(app ? [app] : [])];
}

/**
 * The one print-time gate. Every receipt line — company cache, npm, GitHub, site,
 * xAI, changelog — passes through here right before the tape is written.
 * Company caches store raw rows; this is what applies today's filters to old caches.
 */
export function gateReceiptItems<T extends Polishable>(items: T[], opts: PolishOpts): T[] {
  return polishCandidates(items, opts);
}

function cheapYearOk(item: Polishable, year: number): boolean {
  const raw = item.date ? String(item.date) : '';
  if (!raw) return item.thisYear !== false;
  const match = raw.match(/^(\d{4})/);
  if (!match) return item.thisYear !== false;
  if (Number(match[1]) === year) return !isFutureDate(item.date);
  return Boolean(flagshipLaunchName(item) && isFlagshipYearKeep(item, year));
}

/**
 * Hard pre-filters only: year, URL, canary/prerelease, markup strip, URL dedupe.
 * Title/junk/ownership heuristics stay out — the LLM curation call owns those.
 */
export function cheapHardFilter<T extends Polishable>(items: T[], year: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    let name = stripMarkup(item.name);
    if (!name || name === 'YOUR POTENTIAL') continue;
    const journal = isJournalShip({ ...item, name });
    if (journal && looksLikePersonalShip(name)) {
      const rewritten = journalShipName(name);
      if (rewritten) name = rewritten;
    }
    if (!cheapYearOk(item, year)) continue;
    if (isPrereleaseShip(name) || isPrereleaseShip(item.name)) continue;
    if (!journal && (looksLikeEssayTitle(name) || isBlogEssayTitle(name) || looksLikeMonthlyRoundup(name))) {
      continue;
    }
    if (looksLikeScopedPackage(name)) {
      const family = npmFamilyKey(name);
      if (!family) continue;
      name = family;
    }
    const listedOnly = /^Listed on /i.test(String(item.description || ''));
    if (listedOnly && name.split(/\s+/).filter(Boolean).length >= 5 && !/\d+\.\d+/.test(name)) continue;
    if (looksLikeSocialPost(item)) continue;
    const link = String(item.link || '').trim();
    if (!link) continue;
    try {
      const url = new URL(link);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const key = hrefKey(link);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const description = cleanDescription(item.description);
    out.push({ ...item, name, description });
  }
  return out
    .slice()
    .sort((a, b) => {
      const date = (b.date ?? '').localeCompare(a.date ?? '');
      if (date) return date;
      return (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, CHEAP_CANDIDATE_CAP)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
