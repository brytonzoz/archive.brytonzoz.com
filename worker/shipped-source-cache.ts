/** Per-subject source harvests. Time-boxes must fall back to the last good tape, never empty. */

import type { Found } from './shipped-sources';

export const SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SOURCE_CACHE_TTL_SEC = 24 * 60 * 60;
/** Live refresh when a fresh cache already streamed to the printer. */
export const WARM_SOURCE_MS = 6000;

export type CachedSourceHarvest = {
  at: number;
  found: Found[];
  ran?: string[];
  orgs?: string[];
};

export type SourceCacheStore = {
  get(key: string): Promise<CachedSourceHarvest | null>;
  put(key: string, value: CachedSourceHarvest): Promise<void>;
};

export function sourceHarvestKey(source: string, year: number, subject: string): string {
  const who = String(subject || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 80);
  return `src:${source}:v1:${year}:${who || 'unknown'}`;
}

export function githubEtagCacheKey(auth: string, path: string): string {
  return `gh:etag:v1:${auth}:${path}`;
}

export function githubRequestHeaders(
  auth: 'token' | 'anonymous',
  token: string | undefined,
  etag?: string | null,
): Record<string, string> {
  return {
    'user-agent': 'brytonzoz.com-shipped (+https://shipped.brytonzoz.com/)',
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(auth === 'token' && token ? { authorization: `Bearer ${token}` } : {}),
    ...(etag ? { 'if-none-match': etag } : {}),
  };
}

export function harvestItemKey(item: { name?: string; link?: string | null }): string {
  const link = String(item.link || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (link) return `l:${link}`;
  return `n:${String(item.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')}`;
}

function alreadyHas<T extends { name?: string; link?: string | null }>(tape: T[], item: T): boolean {
  const key = harvestItemKey(item);
  if (!key || key === 'n:' || key === 'l:') return false;
  return tape.some((row) => harvestItemKey(row) === key);
}

/** Live tape wins when it is within 10% of the cached count; otherwise keep the cache and merge new lines. */
export function preferSourceHarvest<T extends { name?: string; link?: string | null }>(
  live: T[] | null | undefined,
  cached: T[] | null | undefined,
): { items: T[]; from: 'live' | 'cache' | 'merge' } {
  const fresh = Array.isArray(live) ? live : [];
  const prior = Array.isArray(cached) ? cached : [];
  if (!fresh.length && prior.length) return { items: prior, from: 'cache' };
  if (!prior.length) return { items: fresh, from: 'live' };
  if (fresh.length >= Math.ceil(prior.length * 0.9)) return { items: fresh, from: 'live' };
  const extra = fresh.filter((item) => !alreadyHas(prior, item));
  return { items: extra.length ? [...prior, ...extra] : prior, from: extra.length ? 'merge' : 'cache' };
}

export function isFreshSourceHarvest(row: CachedSourceHarvest | null | undefined, now = Date.now()): boolean {
  return Boolean(row && now - row.at < SOURCE_CACHE_TTL_MS);
}

export function parseSourceHarvest(raw: unknown): CachedSourceHarvest | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as CachedSourceHarvest;
  if (!Array.isArray(row.found)) return null;
  const at = Number(row.at);
  return {
    at: Number.isFinite(at) ? at : 0,
    found: row.found,
    ran: Array.isArray(row.ran) ? row.ran.map(String) : undefined,
    orgs: Array.isArray(row.orgs) ? row.orgs.map(String) : undefined,
  };
}

const memory = new Map<string, { until: number; value: unknown }>();

function cacheStore(): Cache | undefined {
  return typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: Cache }).default;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const url = `https://shipped-cache.brytonzoz.com/v1/${encodeURIComponent(key)}`;
  const stored = await cacheStore()
    ?.match(url)
    .catch(() => undefined);
  if (!stored) return null;
  const value = (await stored.json()) as T;
  memory.set(key, { until: Date.now() + 5 * 60 * 1000, value });
  return value;
}

export async function cachePut<T>(key: string, value: T, ttlSec = SOURCE_CACHE_TTL_SEC): Promise<void> {
  memory.set(key, { until: Date.now() + ttlSec * 1000, value });
  if (memory.size > 400) memory.delete(memory.keys().next().value as string);
  const url = `https://shipped-cache.brytonzoz.com/v1/${encodeURIComponent(key)}`;
  await cacheStore()
    ?.put(
      url,
      new Response(JSON.stringify(value ?? null), {
        headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttlSec}` },
      }),
    )
    .catch(() => {});
}

export function makeSourceCache(db: D1Database): SourceCacheStore {
  return {
    async get(key) {
      const row = await db
        .prepare('SELECT data, updated_at FROM shipped_source_cache WHERE cache_key = ?')
        .bind(key)
        .first<{ data: string; updated_at: number }>()
        .catch(() => null);
      if (!row?.data) return cacheGet<CachedSourceHarvest>(key).then((value) => parseSourceHarvest(value));
      try {
        const parsed = parseSourceHarvest(JSON.parse(row.data));
        if (parsed) return parsed;
      } catch {
        /* fall through */
      }
      return cacheGet<CachedSourceHarvest>(key).then((value) => parseSourceHarvest(value));
    },
    async put(key, value) {
      await db
        .prepare(
          'INSERT INTO shipped_source_cache (cache_key, data, n, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, n = excluded.n, updated_at = excluded.updated_at',
        )
        .bind(key, JSON.stringify(value), value.found.length, value.at)
        .run()
        .catch(() => {});
      await cachePut(key, value);
    },
  };
}

export async function readSourceHarvest(
  store: SourceCacheStore | undefined,
  key: string,
): Promise<CachedSourceHarvest | null> {
  if (store) {
    const row = await store.get(key).catch(() => null);
    if (row) return row;
  }
  return parseSourceHarvest(await cacheGet<CachedSourceHarvest>(key));
}

export async function writeSourceHarvest(
  store: SourceCacheStore | undefined,
  key: string,
  value: CachedSourceHarvest,
): Promise<void> {
  if (!value.found.length) return;
  if (store) {
    await store.put(key, value).catch(() => {});
    return;
  }
  await cachePut(key, value);
}
