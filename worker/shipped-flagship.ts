// Named product launches from a first-party changelog must survive the title
// gate, year-strict, and "not a ship" filters. Each rescue logs the gate that
// would have dropped the line so we can see over-filtering on reprints.

export type FlagshipItem = {
  name?: string;
  link?: string | null;
  source?: string;
  description?: string;
  date?: string | null;
};

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

function tidy(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).pathname.replace(/\/+$/, '').toLowerCase() : '';
  } catch {
    return '';
  }
}

function slugOf(url: string | null | undefined): string {
  const path = pathOf(url);
  return (path.split('/').filter(Boolean).pop() ?? '').replace(/\.(html?|md|xml)$/i, '');
}

function titleCaseProduct(raw: string): string {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

const DATE_SUFFIX =
  /\s*[·|,]\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\s*$/i;

/** `ORIGIN · SEP 14, 2026` / `CURSOR WEB · CLOUD AGENTS · SEP 14` → the product name. */
export function stripDateSuffix(text: string): string {
  let out = tidy(text);
  out = out.replace(DATE_SUFFIX, '').replace(/\s*[·|]\s+\d{4}-\d{2}-\d{2}\s*$/, '');
  out = out.replace(/\s*[·|]\s*$/, '').trim();
  return out;
}

export function isCompanyShip(item: FlagshipItem): boolean {
  const source = item.source ?? '';
  if (source === 'changelog' || source === 'company') return true;
  const link = item.link ?? '';
  if (/\/(changelog|blog|news|releases?|whats-new|release-notes|index)\//i.test(link)) return true;
  return /openai\.com\/(sora|device|index)(\/|$)/i.test(link);
}

/** Grok/Claude/Gemini appearing on a company tape is a model-availability note. */
export function isCursorModelNote(item: FlagshipItem): boolean {
  if (!isCompanyShip(item) && !/cursor\.com/i.test(item.link ?? '')) return false;
  return /^(introducing\s+)?(grok)[-\s]?\d/i.test(stripDateSuffix(item.name ?? ''));
}

export function cursorModelTitle(name: string): string {
  const ver = tidy(name).match(/grok[-\s]?(\d+(?:\.\d+)?)/i)?.[1];
  return ver ? `Grok ${ver} in Cursor` : 'New models in Cursor';
}

/**
 * A first-party changelog heading that names a product launch (versioned
 * product, join, Bugbot/agents, "meet the new X"). Empty when it is not one.
 */
export function flagshipLaunchName(item: FlagshipItem): string | null {
  const name = stripDateSuffix(item.name ?? '');
  const link = item.link ?? '';
  const path = pathOf(link);
  const slug = slugOf(link);
  const hay = `${name} ${slug} ${path}`;

  if (/\/(blog|changelog)\/cursor-3\b/i.test(path) || /\/changelog\/3-0\b/.test(path)) return 'Cursor 3';
  if (/\bmeet the new cursor\b|\bnew cursor interface\b|\bintroducing cursor 3\b|\bcursor 3\b/i.test(name)) return 'Cursor 3';

  if (/\/(blog|changelog)\/composer-2-5\b/i.test(path) || /\bcomposer 2\.5\b/i.test(name)) return 'Composer 2.5';
  if (/\/(blog|changelog)\/composer-2\b/i.test(path) || /\bcomposer 2\b/i.test(name)) return 'Composer 2';

  if (/graphite/.test(hay) && /\b(join(?:s|ing)?|acquired)\b/i.test(hay)) return 'Graphite joining Cursor';
  if (/\/(blog|changelog)\/graphite\b/i.test(path)) return 'Graphite joining Cursor';

  if (/\bbugbot\b/i.test(hay) || /\/(blog|changelog)\/bugbot/i.test(path)) return 'Bugbot';
  if (/\bagents window\b/i.test(name) || /\/agents-window\b/i.test(path)) return 'Agents Window';
  if (/^origin$/i.test(name) || /\/(blog|changelog)\/origin$/i.test(path)) return 'Origin';
  if (/\bvercel agent\b/i.test(name) || /\/changelog\/vercel-agent\b/i.test(path)) return 'Vercel Agent';
  if (/^(?:introducing\s+)?(?:the\s+)?(?:new\s+)?v0(?:\s+(?:api|platform|themes?))?$/i.test(name) || /\/(blog|changelog)\/(?:introducing-the-new-)?v0\b/i.test(path)) {
    return /theme/i.test(name) ? 'v0 Themes' : /api|platform/i.test(name) || /v0-platform|v0-api/i.test(path) ? 'v0 Platform API' : 'v0';
  }
  // Exact titles only — "Codex app 26.608" must still version-roll.
  if (/^(?:introducing\s+)?codex app(?: updates)?$/i.test(name)) return 'Codex app';
  if (/^(?:introducing\s+)?gpt-?5\.3-codex$/i.test(name)) return 'GPT-5.3-Codex';
  if (/\bcodex cloud\b/i.test(name) || /\/codex\/cloud(?:\/|$)/i.test(path)) return 'Codex Cloud';

  const report = name.match(/^a technical report on\s+(.+)$/i);
  if (report?.[1] && /\d/.test(report[1])) return titleCaseProduct(report[1]);

  const meet = name.match(/^meet the new\s+(.+)$/i);
  if (meet?.[1] && slug.match(/-(\d+)$/)) return `${titleCaseProduct(meet[1])} ${slug.match(/-(\d+)$/)?.[1]}`;

  const intro = name.match(/^(?:introducing|launching)\s+([A-Za-z][\w.+-]*(?:\s+\d+(?:\.\d+)?)?)/i);
  if (intro?.[1] && /\d/.test(intro[1]) && isCompanyShip(item) && !isCursorModelNote({ ...item, name: intro[1] })) {
    return titleCaseProduct(intro[1]);
  }

  const joining = name.match(/^([A-Za-z][\w.-]{1,32})\s+(?:is joining|joins)\s+([A-Za-z][\w.-]{1,32})/i);
  if (joining && isCompanyShip(item)) return `${titleCaseProduct(joining[1])} joining ${titleCaseProduct(joining[2])}`;

  const gpt6 = name.match(/^(?:introducing\s+)?(gpt-?6(?:\.\d+)?(?:\s+sol(?:\s+\w+)*)?)$/i);
  if (gpt6 && isCompanyShip(item)) return gpt6[1].replace(/^gpt-?/i, 'GPT-').replace(/\b([a-z])/g, (letter) => letter.toUpperCase());

  const chatgpt = name.match(/^(?:introducing\s+)?(chatgpt\s+(?:images(?:\s+[\d.]+)?|voice|atlas|health))$/i);
  if (chatgpt && isCompanyShip(item)) return titleCaseProduct(chatgpt[1]);

  const sora = name.match(/^(?:introducing\s+)?(sora(?:\s+\d)?)$/i);
  if (sora && isCompanyShip(item)) return titleCaseProduct(sora[1]);

  const device = name.match(/^(?:introducing\s+)?((?:openai|chatgpt)\s+(?:device|computer|phone|hardware))$/i);
  if (device && isCompanyShip(item)) return titleCaseProduct(device[1]);

  if (/openai\.com\/index\/gpt-6\b/i.test(path) || /openai\.com\/index\/gpt-6/i.test(link)) return 'GPT-6';
  if (/openai\.com\/index\/(?:chatgpt-)?images\b/i.test(path)) return 'ChatGPT Images';
  if (/openai\.com\/index\/chatgpt-atlas\b/i.test(path)) return 'ChatGPT Atlas';
  if (/openai\.com\/index\/chatgpt-health\b/i.test(path)) return 'ChatGPT Health';
  if (/openai\.com\/sora(\/|$)/i.test(link)) return 'Sora';
  if (/openai\.com\/device(\/|$)/i.test(link)) return 'OpenAI Device';

  return null;
}

export function isJoinOrAcquire(item: FlagshipItem): boolean {
  const flagship = flagshipLaunchName(item);
  return /joining|joins|acquired/i.test(`${item.name ?? ''} ${flagship ?? ''}`);
}

/** Graphite joined Cursor in Dec 2025. A later page date must not put it on a 2026 tape. */
export function isPriorYearJoin(item: FlagshipItem, year: number): boolean {
  if (!isJoinOrAcquire(item) && !/\/(blog|changelog)\/graphite\b/i.test(item.link ?? '')) return false;
  if (/graphite/i.test(`${item.name ?? ''} ${item.link ?? ''}`)) return true;
  const raw = String(item.date ?? '');
  return Boolean(raw) && !raw.startsWith(String(year));
}

/**
 * Flagships may keep an undated 2026 sitemap row (Cursor 3). They must never
 * override the year rule: a 2025 join (Graphite) is not a 2026 ship.
 */
export function isFlagshipYearKeep(item: FlagshipItem, year: number): boolean {
  const flagship = flagshipLaunchName(item);
  if (!flagship || !isCompanyShip(item)) return false;
  if (isPriorYearJoin(item, year)) return false;
  if (isJoinOrAcquire(item)) return String(item.date ?? '').startsWith(String(year));
  const raw = item.date ? String(item.date) : '';
  if (raw && !raw.startsWith(String(year))) return false;
  return !raw || raw.startsWith(String(year));
}

const FLAGSHIP_LAUNCH_DAY: Record<string, string> = {
  cursor3: '2026-04-02',
  composer2: '2026-03-19',
  bugbot: '2026-06-01',
  origin: '2026-09-14',
};

/** First-party posts the sitemap often misses (older Cursor launches live on /blog, not the latest changelog page). */
export function flagshipProbePaths(company: string | null | undefined): string[] {
  const slug = (company ?? '').toLowerCase();
  if (/\bcursor\b|\banysphere\b/.test(slug)) {
    return [
      '/blog/cursor-3',
      '/blog/composer-2',
      '/blog/origin',
      '/changelog/bugbot-updates-june-2026',
      '/changelog/origin',
      '/changelog/page/2',
      '/changelog/page/3',
    ];
  }
  if (/\bvercel\b/.test(slug)) {
    return [
      '/changelog',
      '/changelog/v0-platform-api-now-in-beta',
      '/changelog/v0-now-reads-npm-credentials-from-shared-environment-variables',
      '/changelog/v0-adds-one-click-integrations-for-email-auth-search-and-databases',
      '/changelog/vercel-agent-now-in-slack',
      '/blog/v0',
      '/blog/v0-api',
    ];
  }
  if (/\bopenai\b/.test(slug)) {
    return [
      '/index',
      '/index/gpt-6',
      '/index/chatgpt-atlas',
      '/index/chatgpt-health',
      '/index/chatgpt-images',
      '/sora',
      '/device',
      '/products/release-notes',
    ];
  }
  return [];
}

/** Public launch day when we know it; otherwise the changelog slug's month. */
export function knownFlagshipDate(item: FlagshipItem, year: number): string | null {
  const flagship = flagshipLaunchName(item);
  if (!flagship || isPriorYearJoin(item, year)) return null;
  const known = FLAGSHIP_LAUNCH_DAY[flagship.toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (known && known.startsWith(String(year))) return known;
  return dateFromShipSlug(item.link, year);
}

/** `bugbot-updates-june-2026` / `.../2026-04-02-cursor-3` → a day when the slug carries one. */
export function dateFromShipSlug(url: string | null | undefined, year: number): string | null {
  const slug = slugOf(url);
  const path = pathOf(url);
  const hay = `${path}/${slug}`;
  const iso = hay.match(new RegExp(`\\b(${year})[-/](\\d{2})[-/](\\d{2})\\b`));
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const month = hay.match(
    new RegExp(
      `\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)-(${year})\\b`,
      'i',
    ),
  );
  if (month) {
    const mm = MONTH[month[1].toLowerCase().replace(/\.$/, '')];
    if (mm) return `${year}-${mm}-01`;
  }
  return null;
}

export function logFlagshipGate(item: FlagshipItem, gate: string, kept: string | null): void {
  console.log(
    JSON.stringify({
      shipped: 'flagship-gate',
      name: item.name ?? '',
      link: item.link ?? null,
      gate,
      kept,
    }),
  );
}
