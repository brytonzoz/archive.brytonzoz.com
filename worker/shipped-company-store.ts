// Off-worker company ship lists. GitHub Actions harvests first-party changelogs (openai.com
// 403s from the Worker) and writes D1 + R2. The Worker reads those lists for 7 days.
import { companySlug } from './shipped-affiliation';
import type { Found } from './shipped-sources';

export const COMPANY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPANY_CACHE_VERSION = 'v1';

export type OffworkerCache = {
  fetchedAt: number;
  slug: string;
  year: number;
  found: Found[];
  ran: string[];
};

export type CompanyQueueRow = {
  slug: string;
  company: string;
  product: string | null;
  site: string | null;
};

export type CompanyStore = {
  get(year: number, slug: string): Promise<OffworkerCache | null>;
  queue(row: CompanyQueueRow): Promise<boolean>;
  dispatch?(slug: string): Promise<void>;
};

export type CompanyStoreEnv = {
  DB?: D1Database;
  SHIPPED?: R2Bucket;
  GITHUB_TOKEN?: string;
};

const DISPATCH_REPO = 'brytonzoz/archive.brytonzoz.com';
const DISPATCH_EVENT = 'shipped-company-cache';
const QUEUE_FRESH_MS = 6 * 60 * 60 * 1000;

export function makeCompanyStore(env: CompanyStoreEnv, db?: D1Database | null): CompanyStore {
  const database = db ?? env.DB ?? null;
  return {
    async get(year, slug) {
      if (database) {
        const row = await database
          .prepare('SELECT found, fetched_at, r2_key FROM shipped_company_cache WHERE slug = ? AND year = ?')
          .bind(slug, year)
          .first<{ found: string; fetched_at: number; r2_key: string | null }>()
          .catch(() => null);
        if (row) {
          try {
            const parsed = parseOffworkerCache(JSON.parse(row.found));
            if (parsed) return parsed;
          } catch {
            /* fall through to R2 */
          }
        }
        const key = row?.r2_key || companyCacheObjectKey(year, slug);
        const object = await env.SHIPPED?.get(key);
        if (object) {
          const parsed = parseOffworkerCache(await object.json());
          if (parsed) return parsed;
        }
        return null;
      }
      const object = await env.SHIPPED?.get(companyCacheObjectKey(year, slug));
      if (!object) return null;
      return parseOffworkerCache(await object.json());
    },
    async queue(row) {
      if (!database) return false;
      const existing = await database
        .prepare('SELECT queued_at FROM shipped_company_queue WHERE slug = ?')
        .bind(row.slug)
        .first<{ queued_at: number }>()
        .catch(() => null);
      await database
        .prepare(
          `INSERT INTO shipped_company_queue (slug, company, product, site, queued_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             company = excluded.company,
             product = COALESCE(excluded.product, shipped_company_queue.product),
             site = COALESCE(excluded.site, shipped_company_queue.site)`,
        )
        .bind(row.slug, row.company, row.product, row.site, Date.now())
        .run()
        .catch(() => undefined);
      return !existing || Date.now() - existing.queued_at > QUEUE_FRESH_MS;
    },
    async dispatch(slug) {
      const token = env.GITHUB_TOKEN;
      if (!token || !slug) return;
      await fetch(`https://api.github.com/repos/${DISPATCH_REPO}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'shipped-company-cache',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: { slug } }),
      }).catch(() => undefined);
    },
  };
}

export function companyCacheObjectKey(year: number, slug: string): string {
  return `company-cache/${COMPANY_CACHE_VERSION}/${year}/${slug}.json`;
}

export function parseOffworkerCache(raw: unknown): OffworkerCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<OffworkerCache>;
  if (typeof row.fetchedAt !== 'number' || typeof row.year !== 'number' || !Array.isArray(row.found)) return null;
  if (Date.now() - row.fetchedAt > COMPANY_CACHE_TTL_MS) return null;
  const found = row.found.filter((item): item is Found => Boolean(item && typeof item === 'object' && typeof (item as Found).name === 'string'));
  if (!found.length) return null;
  return { fetchedAt: row.fetchedAt, slug: String(row.slug || ''), year: row.year, found, ran: Array.isArray(row.ran) ? row.ran.map(String) : [] };
}

export function stripVia(items: Found[]): Found[] {
  return items.map((item) => {
    const { via: _via, ...rest } = item;
    return rest;
  });
}

export function slugForCompany(company: string | null | undefined): string | null {
  return companySlug(company);
}

export function offworkerPayload(input: { slug: string; year: number; found: Found[]; ran?: string[]; fetchedAt?: number }): OffworkerCache | null {
  return parseOffworkerCache({
    fetchedAt: input.fetchedAt ?? Date.now(),
    slug: input.slug,
    year: input.year,
    found: stripVia(input.found),
    ran: input.ran ?? [],
  });
}

export async function putOffworkerCache(db: D1Database, bucket: R2Bucket | undefined, payload: OffworkerCache): Promise<void> {
  const key = companyCacheObjectKey(payload.year, payload.slug);
  const row: OffworkerCache = {
    fetchedAt: payload.fetchedAt,
    slug: payload.slug,
    year: payload.year,
    found: stripVia(payload.found),
    ran: payload.ran,
  };
  await db
    .prepare(
      `INSERT INTO shipped_company_cache (slug, year, n, found, r2_key, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, year) DO UPDATE SET
         n = excluded.n, found = excluded.found, r2_key = excluded.r2_key, fetched_at = excluded.fetched_at`,
    )
    .bind(row.slug, row.year, row.found.length, JSON.stringify(row), key, row.fetchedAt)
    .run();
  await bucket?.put(key, JSON.stringify(row), { httpMetadata: { contentType: 'application/json' } });
  await db.prepare('DELETE FROM shipped_company_queue WHERE slug = ?').bind(row.slug).run().catch(() => undefined);
}
