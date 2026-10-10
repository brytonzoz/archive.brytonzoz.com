// Harvest first-party company changelogs from GitHub Actions (openai.com 403s from the Worker)
// and POST the unscoped lists to the Worker, which writes D1 + R2. OpenAI is written first so
// staging can reprint Tibo / thsottiaux / Sam before the rest of the seed list runs.
//
//   ADMIN_PASSWORD=… node --experimental-transform-types scripts/cache-shipped-companies.mjs
import '../tests/resolve-ts.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ORIGINS = {
  staging: 'https://shipped-staging.brytonzoz.com',
  production: 'https://shipped.brytonzoz.com',
};
const REPRINT_IDS = '16,17,13,11,7,6,14';

const pick = (...names) => names.map((n) => process.env[n]).find((v) => typeof v === 'string' && v.trim()) || '';
const slugOf = (company) => String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const year = Number(process.env.SHIPPED_YEAR || 2026);
const only = slugOf(process.env.SHIPPED_CACHE_ONLY || '');
const ref = process.env.GITHUB_REF_NAME || '';
const targetFlag = (process.env.SHIPPED_CACHE_TARGET || (ref === 'main' ? 'both' : 'staging')).toLowerCase();
const targets = targetFlag === 'both' ? ['staging', 'production'] : targetFlag === 'production' ? ['production'] : ['staging'];

const password = pick('ADMIN_PASSWORD');
if (!password) {
  console.error('ADMIN_PASSWORD is required to write the company cache through the Worker.');
  process.exit(1);
}

const seeds = JSON.parse(readFileSync(new URL('../data/shipped-companies.json', import.meta.url), 'utf8'));
const { harvestCompany } = await import('../worker/shipped-company.ts');
const { offworkerPayload } = await import('../worker/shipped-company-store.ts');
const { emptyAffiliation } = await import('../worker/shipped-affiliation.ts');
const { denyXaiMeter } = await import('../worker/shipped-xai.ts');

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
  XAI_API_KEY: '',
  OPENAI_API_KEY: pick('OPENAI_KEY', 'OPENAI_API_KEY'),
  SHIPPED_XAI_OFF: '1',
  xaiMode: 'off',
  xaiMeter: denyXaiMeter(),
};

const tinyfish = env.TINYFISH_API_KEY ? { key: env.TINYFISH_API_KEY, meter: tinyfishMeter } : null;
const adminHeaders = { authorization: `Bearer ${password}`, 'content-type': 'application/json' };

async function adminGet(origin) {
  const res = await fetch(`${origin}/api/admin/shipped/company-cache`, { headers: adminHeaders, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `admin GET ${res.status}`);
  return body;
}

async function adminPut(origin, payload, timeoutMs = 15 * 60 * 1000) {
  const start = Date.now();
  let last = 'not-tried';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${origin}/api/admin/shipped/company-cache`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 160) };
      }
      if (res.ok && body.ok) return body;
      last = `${res.status} ${body.error || text.slice(0, 80)}`;
    } catch (error) {
      last = error.message;
    }
    console.log(`waiting for Worker ingest (${last})`);
    await new Promise((ok) => setTimeout(ok, 20_000));
  }
  throw new Error(`Worker ingest timed out: ${last}`);
}

async function queuedCompanies(origin) {
  try {
    const body = await adminGet(origin);
    return (body.queue || []).map((row) => ({
      company: row.company,
      products: row.product ? [row.product] : [],
      sites: row.site ? [row.site] : [],
    }));
  } catch {
    return [];
  }
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
  const payload = offworkerPayload({ slug, year, found: harvested.found, ran: harvested.ran });
  if (!payload) {
    console.warn(`  ${seed.company}: 0 usable ships (${harvested.ran.join(', ') || 'no sources'})`);
    return null;
  }
  console.log(`  ${seed.company}: ${payload.found.length} ships · ${harvested.ran.slice(0, 8).join(', ')}`);
  return payload;
}

async function waitForWorkerCache(origin, timeoutMs = 8 * 60 * 1000) {
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
    await new Promise((ok) => setTimeout(ok, 15_000));
  }
  return false;
}

function reprintLeaders(origin) {
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

const queued = [];
for (const target of targets) queued.push(...(await queuedCompanies(ORIGINS[target])));
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
    const written = await adminPut(ORIGINS[target], payload);
    console.log(`wrote ${payload.slug} → ${target} (${written.n})`);
  }
  if (payload.slug === 'openai' && targets.includes('staging')) {
    openaiWritten = true;
    const ready = await waitForWorkerCache(ORIGINS.staging);
    console.log(ready ? 'staging Worker sees company-cache' : 'staging Worker did not list company-cache yet; reprinting anyway');
    reprintLeaders(ORIGINS.staging);
  }
}

if (!openaiWritten && targets.includes('staging') && (!only || only === 'openai')) {
  console.warn('OpenAI cache was not written; Tibo/Sam reprints will stay short until the next harvest.');
}

console.log(`done: ${companies.length} companies, targets ${targets.join('+')}`);
