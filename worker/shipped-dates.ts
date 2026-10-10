// First-launch dates for owned-but-undated pins, from free public records.
// Keep 2026 first launches. Drop products that are confidently older.

import { productHostGuesses } from './shipped-identity';
import { ownedByBuilder, ownHosts, type OwnerContext } from './shipped-ownership';
import { safeFetch } from './shipped-fetch';

export type LaunchEvidence = {
  source: 'archive.org' | 'rdap' | 'appstore' | 'producthunt' | 'github' | 'copyright';
  date: string;
};

export type PinDateVerdict = {
  date: string | null;
  confidence: 'exact' | 'year' | 'inferred' | 'unknown';
  source: string | null;
  drop: boolean;
  reason: string | null;
};

const GENERIC_HOST = /^(github\.com|gitlab\.com|npmjs\.com|producthunt\.com|apps\.apple\.com|x\.com|twitter\.com|linkedin\.com)$/i;

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

export function parseCdxTimestamp(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length < 2) {
    if (typeof rows === 'string') {
      const match = rows.match(/\b(20\d{2})(\d{2})(\d{2})/);
      return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    }
    return null;
  }
  const first = rows[1];
  const stamp = Array.isArray(first) ? first[0] : first;
  const match = String(stamp || '').match(/^(20\d{2})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseRdapRegistration(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const events = (body as { events?: { eventAction?: string; eventDate?: string }[] }).events;
  if (!Array.isArray(events)) return null;
  const reg = events.find((event) => /registration|registration date/i.test(event.eventAction ?? ''));
  const raw = reg?.eventDate ?? '';
  const match = raw.match(/^(20\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function parseCopyrightYear(text: string): number | null {
  const years = [...text.matchAll(/(?:©|&copy;|copyright|\(c\))\s*(?:20\d{2}\s*[-–—]\s*)?(20\d{2})\b/gi)].map((m) => Number(m[1]));
  if (!years.length) {
    const range = text.match(/\b(20\d{2})\s*[-–—]\s*(20\d{2})\b/);
    if (range) return Number(range[2]);
    return null;
  }
  return Math.min(...years);
}

/** Earliest strong evidence wins. Pre-`year` archive / store / github / copyright → drop. */
export function verdictFromEvidence(year: number, evidence: LaunchEvidence[]): PinDateVerdict {
  const ranked = evidence
    .map((row) => ({ ...row, day: row.date.slice(0, 10), y: Number(row.date.slice(0, 4)) }))
    .filter((row) => Number.isFinite(row.y) && row.y >= 1990 && row.y <= year + 1)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!ranked.length) return { date: null, confidence: 'unknown', source: null, drop: false, reason: null };
  const strong = ranked.filter((row) => row.source === 'archive.org' || row.source === 'appstore' || row.source === 'producthunt' || row.source === 'github');
  const first = (strong[0] ?? ranked[0])!;
  if (first.y < year) {
    return { date: first.day, confidence: first.day.length >= 10 ? 'exact' : 'year', source: first.source, drop: true, reason: 'pre-2026' };
  }
  if (first.y > year) {
    return { date: first.day, confidence: 'exact', source: first.source, drop: true, reason: 'year-future' };
  }
  return {
    date: first.day.length >= 10 ? first.day : `${year}-01-01`,
    confidence: first.day.length >= 10 ? 'exact' : 'year',
    source: first.source,
    drop: false,
    reason: null,
  };
}

export function productUrlsForPin(
  item: { name: string; link?: string | null },
  opts: { owner?: OwnerContext | null; links?: { text: string; url: string }[] },
): string[] {
  const out: string[] = [];
  const own = ownHosts(opts.owner);
  const add = (url: string | null | undefined) => {
    const host = hostOf(url);
    if (!url || !host || own.has(host) || GENERIC_HOST.test(host)) return;
    if (!out.includes(url)) out.push(url);
  };
  const itemHost = hostOf(item.link);
  if (item.link && itemHost && !own.has(itemHost)) add(item.link);
  const want = loose(item.name);
  for (const link of opts.links ?? []) {
    if (loose(link.text).includes(want) || loose(link.url).includes(want)) add(link.url);
  }
  for (const guess of productHostGuesses(item.name).slice(0, 3)) add(guess);
  return out.slice(0, 6);
}

async function readText(url: string, types?: string[]): Promise<string | null> {
  const res = await safeFetch(url, { timeoutMs: 6000, maxBytes: 80_000, types }).catch(() => null);
  if (!res || res.status >= 400) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(res.bytes);
}

async function evidenceForHost(host: string): Promise<LaunchEvidence[]> {
  const out: LaunchEvidence[] = [];
  const cdx = await readText(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&matchType=host&output=json&fl=timestamp&filter=statuscode:200&limit=1&from=2010`,
    ['application/json', 'text/plain', 'text/'],
  );
  if (cdx) {
    let parsed: unknown = cdx;
    try {
      parsed = JSON.parse(cdx);
    } catch {
      parsed = cdx;
    }
    const day = parseCdxTimestamp(parsed);
    if (day) out.push({ source: 'archive.org', date: day });
  }
  const rdap = await readText(`https://rdap.org/domain/${encodeURIComponent(host)}`, ['application/json', 'application/rdap+json', 'text/']);
  if (rdap) {
    try {
      const day = parseRdapRegistration(JSON.parse(rdap));
      if (day) out.push({ source: 'rdap', date: day });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function isOwnedPin(
  item: { name?: string; date?: string | null; link?: string | null; source?: string; description?: string },
  owner?: OwnerContext | null,
): boolean {
  if (item.date) return false;
  if (item.source !== 'site' && item.source !== 'web') return false;
  return ownedByBuilder(item, owner);
}

export async function dateOwnedPins<T extends { name: string; date: string | null; link?: string | null; source?: string; description?: string; thisYear?: boolean }>(
  items: T[],
  opts: {
    year: number;
    owner?: OwnerContext | null;
    links?: { text: string; url: string }[];
    pageText?: string;
  },
): Promise<{ items: T[]; drops: { name: string; reason: string; source: string | null }[] }> {
  const year = opts.year;
  const kept: T[] = [];
  const pending: T[] = [];
  const drops: { name: string; reason: string; source: string | null }[] = [];
  for (const item of items) {
    if (isOwnedPin(item, opts.owner)) pending.push(item);
    else kept.push(item);
  }
  const copyrightYear = opts.pageText ? parseCopyrightYear(opts.pageText) : null;
  const batch = pending.slice(0, 12);
  const leftover = pending.slice(12);
  const resolved = await Promise.all(
    batch.map(async (item) => {
      const evidence: LaunchEvidence[] = [];
      const urls = productUrlsForPin(item, { owner: opts.owner, links: opts.links });
      for (const url of urls.slice(0, 3)) {
        const host = hostOf(url);
        if (!host) continue;
        evidence.push(...(await evidenceForHost(host)));
        if (evidence.some((row) => row.source === 'archive.org')) break;
      }
      if (copyrightYear) evidence.push({ source: 'copyright', date: `${copyrightYear}-01-01` });
      const verdict = verdictFromEvidence(year, evidence);
      console.log(
        JSON.stringify({
          shipped: 'pin-date',
          name: item.name,
          urls,
          verdict,
        }),
      );
      return { item, verdict };
    }),
  );
  for (const { item, verdict } of resolved) {
    if (verdict.drop) {
      drops.push({ name: item.name, reason: verdict.reason ?? 'pre-year', source: verdict.source });
      continue;
    }
    if (verdict.date) {
      kept.push({ ...item, date: verdict.date, thisYear: true });
    } else {
      kept.push(item);
    }
  }
  kept.push(...leftover);
  return { items: kept, drops };
}
