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

const PROFILE_HOST = /^(gitlab\.com|npmjs\.com|x\.com|twitter\.com|linkedin\.com)$/i;
const STORE_HOST = /^(github\.com|apps\.apple\.com|producthunt\.com)$/i;

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

export function parseAppStoreDate(text: string): string | null {
  const json = text.match(/"(?:datePublished|releaseDate)"\s*:\s*"(20\d{2}-\d{2}-\d{2})/i);
  if (json) return json[1];
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})T/);
  const released = text.match(/Released\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})/i);
  if (released) {
    const day = new Date(`${released[1]} UTC`);
    if (!Number.isNaN(day.getTime())) return day.toISOString().slice(0, 10);
  }
  return iso ? iso[1] : null;
}

export function parseProductHuntDate(text: string): string | null {
  const json = text.match(/"(?:launchedAt|featuredAt|created_at|featured_at)"\s*:\s*"(20\d{2}-\d{2}-\d{2})/i);
  if (json) return json[1];
  const launched = text.match(/Launched\s+on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})/i);
  if (launched) {
    const day = new Date(`${launched[1]} UTC`);
    if (!Number.isNaN(day.getTime())) return day.toISOString().slice(0, 10);
  }
  return null;
}

export function parseGithubCreated(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    const raw = String(body ?? '');
    const match = raw.match(/"(?:created_at|createdAt)"\s*:\s*"(20\d{2}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  const created = (body as { created_at?: string; createdAt?: string }).created_at ?? (body as { createdAt?: string }).createdAt;
  const match = String(created || '').match(/^(20\d{2}-\d{2}-\d{2})/);
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

/** http(s) URLs in HTML, RSC payloads, or visible copy — Next sites often hide pins in script tags. */
export function urlsFromPageText(text: string): string[] {
  const out: string[] = [];
  for (const match of String(text || '').matchAll(/https?:\/\/[a-z0-9][-a-z0-9.]*\.[a-z]{2,}[^\\s"'<>]*/gi)) {
    const raw = match[0].replace(/[),.;]+$/g, '').replace(/\\+$/g, '');
    try {
      const url = new URL(raw);
      if (!/^https?:$/i.test(url.protocol)) continue;
      const href = url.toString();
      if (!out.includes(href)) out.push(href);
    } catch {
      /* skip */
    }
    if (out.length >= 80) break;
  }
  return out;
}

export function productUrlsForPin(
  item: { name: string; link?: string | null },
  opts: { owner?: OwnerContext | null; links?: { text: string; url: string }[]; pageText?: string; metrics?: string[] },
): string[] {
  const out: string[] = [];
  const own = ownHosts(opts.owner);
  const want = loose(item.name);
  const add = (url: string | null | undefined) => {
    const host = hostOf(url);
    if (!url || !host || PROFILE_HOST.test(host)) return;
    // Portfolio hosts are not first-launch evidence, unless the host *is* the product (post-bridge.com).
    if (own.has(host) && !(want.length >= 4 && loose(host).includes(want))) return;
    if (!out.includes(url)) out.push(url);
  };
  const itemHost = hostOf(item.link);
  if (item.link && itemHost && !own.has(itemHost)) add(item.link);
  for (const link of opts.links ?? []) {
    if (!want) break;
    if (loose(link.text).includes(want) || loose(link.url).includes(want)) add(link.url);
  }
  for (const url of urlsFromPageText(opts.pageText ?? '')) {
    if (want && want.length >= 4 && loose(url).includes(want)) add(url);
  }
  for (const metric of opts.metrics ?? []) add(metric);
  // Short names ("doof", "wacko") collide with other people's domains — only guess long slugs.
  // Multi-word names must use the hyphenated host (ship-or-die.com), never the smashed one (shipordie.com).
  if (want.length >= 8) {
    for (const guess of datingHostGuesses(item.name)) add(guess);
  }
  return out.slice(0, 8);
}

/** Hyphenated hosts first. Multi-word products never guess the concatenated .com. */
export function datingHostGuesses(name: string): string[] {
  const guesses = productHostGuesses(name);
  const words = name.trim().split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  const hyphen = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hyphenated = guesses.filter((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '').startsWith(`${hyphen}.`);
    } catch {
      return false;
    }
  });
  if (words.length >= 2 && hyphenated.length) return hyphenated.slice(0, 4);
  return [...hyphenated, ...guesses.filter((url) => !hyphenated.includes(url))].slice(0, 4);
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

async function evidenceForUrl(url: string): Promise<LaunchEvidence[]> {
  const host = hostOf(url);
  if (!host) return [];
  if (/^github\.com$/i.test(host)) {
    const repo = url.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1];
    if (!repo || /\/(issues|pull|commit|actions|wiki)\b/i.test(url)) return [];
    const body = await readText(`https://api.github.com/repos/${repo}`, ['application/json', 'text/']);
    if (!body) return [];
    try {
      const day = parseGithubCreated(JSON.parse(body));
      return day ? [{ source: 'github', date: day }] : [];
    } catch {
      const day = parseGithubCreated(body);
      return day ? [{ source: 'github', date: day }] : [];
    }
  }
  if (/^apps\.apple\.com$/i.test(host)) {
    const page = await readText(url, ['text/html', 'text/', 'application/json']);
    const day = page ? parseAppStoreDate(page) : null;
    return day ? [{ source: 'appstore', date: day }] : [];
  }
  if (/^producthunt\.com$/i.test(host)) {
    const page = await readText(url, ['text/html', 'text/', 'application/json']);
    const day = page ? parseProductHuntDate(page) : null;
    return day ? [{ source: 'producthunt', date: day }] : [];
  }
  return evidenceForHost(host);
}

function isOwnedPin(
  item: { name?: string; date?: string | null; link?: string | null; source?: string; description?: string },
  owner?: OwnerContext | null,
): boolean {
  if (item.source !== 'site' && item.source !== 'web') return false;
  return ownedByBuilder(item, owner);
}

/** After a pin is proven pre-`year`, drop leftover npm/web lines with the same loose name (POST BRIDGE, not POSTBRIDGE-CLI). */
export function dropSameNameLeftovers<T extends { name: string; source?: string }>(
  items: T[],
  preYearNames: string[],
): { items: T[]; drops: { name: string; reason: string; source: string | null }[] } {
  const banned = new Set(preYearNames.map(loose).filter(Boolean));
  if (!banned.size) return { items, drops: [] };
  const drops: { name: string; reason: string; source: string | null }[] = [];
  const kept = items.filter((item) => {
    if (item.source === 'changelog' || item.source === 'company') return true;
    if (!banned.has(loose(item.name))) return true;
    drops.push({ name: item.name, reason: 'same-name-pre-2026', source: item.source ?? null });
    return false;
  });
  return { items: kept, drops };
}

export async function dateOwnedPins<T extends { name: string; date: string | null; link?: string | null; source?: string; description?: string; thisYear?: boolean; metrics?: { url?: string | null }[] }>(
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
  const batch = pending.slice(0, 24);
  const leftover = pending.slice(24);
  const resolved = await Promise.all(
    batch.map(async (item) => {
      const evidence: LaunchEvidence[] = [];
      const urls = productUrlsForPin(item, {
        owner: opts.owner,
        links: opts.links,
        pageText: opts.pageText,
        metrics: (item.metrics ?? []).map((row) => row.url).filter((url): url is string => Boolean(url)),
      });
      for (const url of urls.slice(0, 3)) {
        evidence.push(...(await evidenceForUrl(url)));
        // Keep going until a pre-year first-launch record shows up; a 2026 article must not hide a 2024 domain.
        if (evidence.some((row) => Number(row.date.slice(0, 4)) < year && (row.source === 'archive.org' || row.source === 'appstore' || row.source === 'producthunt' || row.source === 'github'))) break;
      }
      // Copyright only from the product page, never the maker's portfolio footer.
      const productPage = urls.find((url) => !STORE_HOST.test(hostOf(url) ?? ''));
      if (productPage && !evidence.some((row) => row.source === 'archive.org')) {
        const page = await readText(productPage, ['text/html', 'text/']);
        const yearOnPage = page ? parseCopyrightYear(page) : null;
        if (yearOnPage) evidence.push({ source: 'copyright', date: `${yearOnPage}-01-01` });
      }
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
      const host = hostOf(item.link);
      const own = host ? ownHosts(opts.owner).has(host) : false;
      kept.push(own && item.date ? { ...item, date: null, thisYear: true } : item);
    }
  }
  kept.push(...leftover);
  const leftoverDrop = dropSameNameLeftovers(
    kept,
    drops.filter((row) => row.reason === 'pre-2026').map((row) => row.name),
  );
  return { items: leftoverDrop.items, drops: [...drops, ...leftoverDrop.drops] };
}
