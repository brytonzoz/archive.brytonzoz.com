// Harvest first-party company changelogs from GitHub Actions (openai.com 403s from the Worker)
// and write the unscoped ship lists to D1 + R2. OpenAI is written first so staging can reprint
// Tibo / thsottiaux / Sam before the rest of the seed list runs.
//
//   CLOUDFLARE_API_TOKEN=… node --experimental-transform-types scripts/cache-shipped-companies.mjs
import '../tests/resolve-ts.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = '480a4eebfef4c5ba2d0e225fde891ae8';
const D1_IDS = {
  staging: '9f5fb652-b770-45c6-90a4-74c27ff947eb',
  production: 'be9007bc-0a13-4a48-8b21-5dd731620cb8',
};
const R2_BUCKETS = {
  staging: 'brytonzoz-shipped-staging',
  production: 'brytonzoz-shipped',
};
const STAGING_ORIGIN = 'https://shipped-staging.brytonzoz.com';
const REPRINT_IDS = '16,11,13';

const pick = (...names) => names.map((n) => process.env[n]).find((v) => typeof v === 'string' && v.trim()) || '';
const slugOf = (company) => String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const year = Number(process.env.SHIPPED_YEAR || 2026);
const only = slugOf(process.env.SHIPPED_CACHE_ONLY || '');
const ref = process.env.GITHUB_REF_NAME || '';
const targetFlag = (process.env.SHIPPED_CACHE_TARGET || (ref === 'main' ? 'both' : 'staging')).toLowerCase();
const targets = targetFlag === 'both' ? ['staging', 'production'] : targetFlag === 'production' ? ['production'] : ['staging'];

const token = pick('CLOUDFLARE_API_TOKEN');
if (!token) {
  console.error('CLOUDFLARE_API_TOKEN is required to write the company cache.');
  process.exit(1);
}

const seeds = JSON.parse(readFileSync(new URL('../data/shipped-companies.json', import.meta.url), 'utf8'));
const { harvestCompany } = await import('../worker/shipped-company.ts');
const { companyCacheObjectKey, stripVia, parseOffworkerCache } = await import('../worker/shipped-company-store.ts');
const { emptyAffiliation } = await import('../worker/shipped-affiliation.ts');
const { memoryXaiMeter } = await import('../worker/shipped-xai.ts');

const tinyfishMeter = {
  async take() {
    return true;
  },
  async exhausted() {},
};

const env = {
  GITHUB_TOKEN: pick('SHIPPED_GITHUB_TOKEN', 'GITHUB_TOKEN'),
  PRODUCTHUNT_TOKEN: pick('PRODUCTHUNT_TOKEN'),
  PRODUCTHUNT_KEY: pick('PRODUCTHUNT_KEY'),
  PRODUCTHUNT_SECRET: pick('PRODUCTHUNT_SECRET'),
  TINYFISH_API_KEY: pick('TINYFISH', 'TINYFISH_API_KEY'),
  XAI_API_KEY: pick('XAI_KEY', 'XAI_API_KEY'),
  OPENAI_API_KEY: pick('OPENAI_KEY', 'OPENAI_API_KEY'),
  XAI_MAX_POSTS: '4',
  SHIPPED_XAI_MAX_POSTS: '4',
  XAI_MONTHLY_CAP_USD: pick('XAI_MONTHLY_CAP_USD', 'SHIPPED_XAI_MONTHLY_CAP_USD') || '15',
  xaiMeter: memoryXaiMeter(Number(pick('XAI_MONTHLY_CAP_USD', 'SHIPPED_XAI_MONTHLY_CAP_USD') || 15)),
};

const tinyfish = env.TINYFISH_API_KEY ? { key: env.TINYFISH_API_KEY, meter: tinyfishMeter } : null;

async function d1(target, sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${D1_IDS[target]}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.errors?.[0]?.message || `d1 ${target} ${res.status}`);
  }
  return body.result?.[0]?.results ?? [];
}

async function ensureTables(target) {
  await d1(
    target,
    `CREATE TABLE IF NOT EXISTS shipped_company_cache (
      slug TEXT NOT NULL, year INTEGER NOT NULL, n INTEGER NOT NULL, found TEXT NOT NULL,
      r2_key TEXT, fetched_at INTEGER NOT NULL, PRIMARY KEY (slug, year))`,
  );
  await d1(
    target,
    `CREATE TABLE IF NOT EXISTS shipped_company_queue (
      slug TEXT PRIMARY KEY, company TEXT NOT NULL, product TEXT, site TEXT, queued_at INTEGER NOT NULL)`,
  );
}

async function queuedCompanies(target) {
  try {
    const rows = await d1(target, 'SELECT slug, company, product, site FROM shipped_company_queue');
    return rows.map((row) => ({
      company: row.company,
      products: row.product ? [row.product] : [],
      sites: row.site ? [row.site] : [],
    }));
  } catch {
    return [];
  }
}

function putR2(bucket, key, payload) {
  const file = join(tmpdir(), `shipped-company-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(payload));
  try {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--remote', '--content-type', 'application/json'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

async function writeCache(target, payload) {
  const key = companyCacheObjectKey(payload.year, payload.slug);
  let foundJson = JSON.stringify(payload);
  try {
    await d1(
      target,
      `INSERT INTO shipped_company_cache (slug, year, n, found, r2_key, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, year) DO UPDATE SET
         n = excluded.n, found = excluded.found, r2_key = excluded.r2_key, fetched_at = excluded.fetched_at`,
      [payload.slug, payload.year, payload.found.length, foundJson, key, payload.fetchedAt],
    );
  } catch (error) {
    console.warn(`${target} D1 write of ${payload.slug} failed (${error.message}); writing R2 and a stub row.`);
    foundJson = JSON.stringify({ ...payload, found: [] });
    await d1(
      target,
      `INSERT INTO shipped_company_cache (slug, year, n, found, r2_key, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, year) DO UPDATE SET
         n = excluded.n, found = excluded.found, r2_key = excluded.r2_key, fetched_at = excluded.fetched_at`,
      [payload.slug, payload.year, payload.found.length, foundJson, key, payload.fetchedAt],
    ).catch((err) => console.warn(`${target} stub D1 write failed: ${err.message}`));
  }
  putR2(R2_BUCKETS[target], key, payload);
  await d1(target, 'DELETE FROM shipped_company_queue WHERE slug = ?', [payload.slug]).catch(() => undefined);
}

function affiliationFor(seed) {
  return {
    ...emptyAffiliation(),
    company: seed.company,
    role: 'ceo',
    product: seed.products?.[0] ?? null,
    companySite: seed.sites?.[0] ?? null,
    typedCompany: true,
  };
}

function mergeSeeds(list) {
  const bySlug = new Map();
  for (const seed of list) {
    const slug = slugOf(seed.company);
    if (!slug) continue;
    const prev = bySlug.get(slug) || { company: seed.company, products: [], sites: [] };
    prev.products = [...new Set([...(prev.products || []), ...(seed.products || [])])];
    prev.sites = [...new Set([...(prev.sites || []), ...(seed.sites || [])])];
    bySlug.set(slug, prev);
  }
  const all = [...bySlug.values()];
  const openai = all.filter((c) => slugOf(c.company) === 'openai');
  const rest = all.filter((c) => slugOf(c.company) !== 'openai');
  const ordered = [...openai, ...rest];
  return only ? ordered.filter((c) => slugOf(c.company) === only) : ordered;
}

async function harvestOne(seed) {
  const slug = slugOf(seed.company);
  console.log(`Harvest ${seed.company} (${slug})…`);
  const harvested = await harvestCompany({
    affiliation: affiliationFor(seed),
    year,
    env,
    rebuild: true,
    extraSites: (seed.sites || []).slice(1),
    tinyfish,
    gapFillX: false,
  });
  const found = stripVia(harvested.found).filter((item) => item && item.name);
  const payload = parseOffworkerCache({
    fetchedAt: Date.now(),
    slug,
    year,
    found,
    ran: harvested.ran,
  });
  if (!payload) {
    console.warn(`  ${seed.company}: 0 usable ships (${harvested.ran.join(', ') || 'no sources'})`);
    return null;
  }
  console.log(`  ${seed.company}: ${payload.found.length} ships · ${harvested.ran.slice(0, 8).join(', ')}`);
  return payload;
}

async function waitForWorkerCache(origin, timeoutMs = 12 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${origin}/api/shipped/state`, { cache: 'no-store' });
      const body = await res.json();
      const sources = body.generator?.sources ?? [];
      if (sources.includes('company-cache')) return true;
      console.log(`waiting for Worker company-cache (${sources.join(', ') || 'no sources'})`);
    } catch (error) {
      console.log(`waiting for Worker (${error.message})`);
    }
    await new Promise((ok) => setTimeout(ok, 20_000));
  }
  return false;
}

function reprintLeaders(origin) {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('ADMIN_PASSWORD missing; skip reprint.');
    return false;
  }
  const script = new URL('./reprint-shipped.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, ['--no-warnings', script], {
    env: {
      ...process.env,
      SHIPPED_ORIGIN: origin,
      SHIPPED_REPRINT_FORCE_IDS: REPRINT_IDS,
    },
    stdio: 'inherit',
  });
  return result.status === 0;
}

for (const target of targets) await ensureTables(target);

const queued = [];
for (const target of targets) queued.push(...(await queuedCompanies(target)));
const companies = mergeSeeds([...(seeds.companies || []), ...queued]);
if (!companies.length) {
  console.log('No companies to harvest.');
  process.exit(0);
}

let openaiWritten = false;
for (const seed of companies) {
  const payload = await harvestOne(seed);
  if (!payload) continue;
  for (const target of targets) {
    await writeCache(target, payload);
    console.log(`wrote ${payload.slug} → ${target} (${payload.found.length})`);
  }
  if (payload.slug === 'openai' && targets.includes('staging')) {
    openaiWritten = true;
    const ready = await waitForWorkerCache(STAGING_ORIGIN);
    console.log(ready ? 'staging Worker sees company-cache' : 'staging Worker did not list company-cache yet; reprinting anyway');
    reprintLeaders(STAGING_ORIGIN);
  }
}

if (!openaiWritten && targets.includes('staging') && (!only || only === 'openai')) {
  console.warn('OpenAI cache was not written; Tibo/Sam reprints will stay short until the next harvest.');
}

console.log(`done: ${companies.length} companies, targets ${targets.join('+')}`);
