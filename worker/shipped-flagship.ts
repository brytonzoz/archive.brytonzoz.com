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
  return /\/(changelog|blog|news|releases?|whats-new|release-notes)\//i.test(item.link ?? '');
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

  const report = name.match(/^a technical report on\s+(.+)$/i);
  if (report?.[1] && /\d/.test(report[1])) return titleCaseProduct(report[1]);

  const meet = name.match(/^meet the new\s+(.+)$/i);
  if (meet?.[1] && slug.match(/-(\d+)$/)) return `${titleCaseProduct(meet[1])} ${slug.match(/-(\d+)$/)?.[1]}`;

  const intro = name.match(/^(?:introducing|launching)\s+([A-Za-z][\w.+-]*(?:\s+\d+(?:\.\d+)?)?)/i);
  if (intro?.[1] && /\d/.test(intro[1]) && isCompanyShip(item)) return titleCaseProduct(intro[1]);

  const joining = name.match(/^([A-Za-z][\w.-]{1,32})\s+(?:is joining|joins)\s+([A-Za-z][\w.-]{1,32})/i);
  if (joining && isCompanyShip(item)) return `${titleCaseProduct(joining[1])} joining ${titleCaseProduct(joining[2])}`;

  return null;
}

/** Join/acquire announced in December of last year still belongs on this year's company tape. */
export function isFlagshipYearKeep(item: FlagshipItem, year: number): boolean {
  const flagship = flagshipLaunchName(item);
  if (!flagship || !isCompanyShip(item)) return false;
  const raw = item.date ? String(item.date) : '';
  if (!raw || raw.startsWith(String(year))) return true;
  if (/joining|joins|acquired/i.test(`${item.name ?? ''} ${flagship}`) && raw.startsWith(`${year - 1}-12`)) return true;
  return false;
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
