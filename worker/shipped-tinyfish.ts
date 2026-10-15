// TinyFish, the crawl layer for /shipped: Search finds launch pages, Fetch reads them (JS rendered, as markdown).
//
// Only these two endpoints may ever be called. Per TinyFish's docs and pricing page (checked Oct 2026), Search
// (12,000 requests/day) and Fetch (1,000 URLs/day) are free and never draw from the Wallet. Agent, Browser,
// Research and Monitor are paid, and the account has billing open, so `call()` refuses every other host and
// path. Calls past the free allowance can also bill a funded Wallet, so our own daily meter stops well
// short of it (TINYFISH_DAILY), and a 402 shuts TinyFish off for the rest of the UTC day.
//
// Key: env.tinyfish / env.TINYFISH / env.TINYFISH_API_KEY (whichever is set).

export const TINYFISH_FREE = {
  search: 'https://api.search.tinyfish.ai/',
  fetch: 'https://api.fetch.tinyfish.ai/',
} as const;

/** Our ceiling per UTC day: a fraction of the free allowance (12,000 searches, 1,000 fetched URLs). */
export const TINYFISH_DAILY = { search: 4000, fetch: 600 } as const;

export type TinyfishKind = keyof typeof TINYFISH_FREE;

/** Reserves `n` units for today; false when the day's budget is spent or TinyFish answered 402. */
export type TinyfishMeter = { take(kind: TinyfishKind, n: number): Promise<boolean>; exhausted(kind: TinyfishKind): Promise<void> };

export type TinyfishResult = { title: string; url: string; snippet: string; date: string | null };
export type TinyfishPage = { url: string; title: string; description: string; published: string | null; text: string; links: string[] };

export class TinyfishError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call(kind: TinyfishKind, key: string, meter: TinyfishMeter, units: number, init: { query?: URLSearchParams; body?: unknown }) {
  const endpoint = TINYFISH_FREE[kind];
  const url = new URL(endpoint);
  if (init.query) url.search = init.query.toString();
  // Belt and braces: the URL must still be exactly one of the two free endpoints.
  if (`${url.origin}${url.pathname}` !== endpoint) throw new TinyfishError('not-free');
  if (!(await meter.take(kind, units))) throw new TinyfishError('budget');
  const response = await fetch(url.toString(), {
    method: init.body ? 'POST' : 'GET',
    headers: { 'X-API-Key': key, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(kind === 'fetch' ? 20000 : 8000),
  });
  if (response.status === 402) {
    await meter.exhausted(kind);
    throw new TinyfishError('allowance');
  }
  if (response.status === 429) throw new TinyfishError('rate-limited');
  if (!response.ok) throw new TinyfishError(`http-${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export async function tinyfishSearch(query: string, year: number, key: string, meter: TinyfishMeter): Promise<TinyfishResult[]> {
  const params = new URLSearchParams({ query, after_date: `${year}-01-01`, purpose: `Find products, apps and open-source projects a person or brand launched in ${year}` });
  const data = await call('search', key, meter, 1, { query: params });
  const rows = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
  return rows.map((row) => ({ title: str(row.title), url: str(row.url), snippet: str(row.snippet), date: str(row.date) || null })).filter((row) => row.url);
}

/** Up to 10 URLs in one request; failed URLs are just missing from the result. */
export async function tinyfishFetch(urls: string[], key: string, meter: TinyfishMeter): Promise<TinyfishPage[]> {
  const list = Array.from(new Set(urls)).slice(0, 10);
  if (!list.length) return [];
  const data = await call('fetch', key, meter, list.length, {
    body: { urls: list, format: 'markdown', links: true, per_url_timeout_ms: 15000, purpose: 'Read what this person or company has shipped: product names, one-line descriptions, launch dates' },
  });
  const rows = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
  return rows.map((row) => ({
    url: str(row.final_url) || str(row.url),
    title: str(row.title),
    description: str(row.description),
    published: str(row.published_date) || null,
    text: str(row.text),
    links: Array.isArray(row.links) ? (row.links as unknown[]).filter((link): link is string => typeof link === 'string') : [],
  }));
}
