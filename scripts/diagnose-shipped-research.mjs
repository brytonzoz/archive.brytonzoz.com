// Live diagnosis of the Shipped 2026 research pipeline. Reads the same modules the Worker uses.
import '../tests/resolve-ts.mjs';
import { writeFileSync } from 'node:fs';

const year = Number(process.env.SHIPPED_YEAR || 2026);
const staging = process.env.SHIPPED_STAGING || 'https://shipped-staging.brytonzoz.com';
const queries = (process.env.SHIPPED_QUERIES ||
  'levelsio,marclou,tibo_maker,rauchg,dannypostmaa,tdinh_me,steventey,shadcn,pontusab,nutlope,arvidkahl,yongfook,Tibo from OpenAI').split(',');

const { readQuery } = await import('../lib/shipped-year.ts');
const {
  SOURCES,
  gather,
  githubUser,
  inYearCount,
  tinyfishAccess,
  resolveIdentity,
  candidatesFromIdentity,
} = await import('../worker/shipped-sources.ts');
const { demoReceipt, SEARCH_BELOW, maxSearches } = await import('../worker/shipped-ai.ts');

const env = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || process.env.SHIPPED_GITHUB_TOKEN || '',
  PRODUCTHUNT_TOKEN: process.env.PRODUCTHUNT_TOKEN || '',
  PRODUCTHUNT_KEY: process.env.PRODUCTHUNT_KEY || '',
  PRODUCTHUNT_SECRET: process.env.PRODUCTHUNT_SECRET || '',
  TINYFISH_API_KEY: process.env.TINYFISH_API_KEY || process.env.tinyfish || '',
  BRANDFETCH_API: process.env.BRANDFETCH_API || '',
};

const tinyfishMeter = {
  async take() {
    return true;
  },
  async exhausted() {},
};

const timed = async (label, work) => {
  const started = Date.now();
  try {
    const value = await work();
    return { ok: true, ms: Date.now() - started, value };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
};

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function stagingJson(path, init = {}) {
  const response = await fetch(`${staging}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': BROWSER_UA,
      origin: staging,
      'sec-fetch-site': 'same-origin',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: response.status, body };
}

async function probeX(handle) {
  const urls = [
    `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${encodeURIComponent(handle)}`,
    `https://api.fxtwitter.com/${encodeURIComponent(handle)}`,
  ];
  const out = {};
  for (const url of urls) {
    const result = await timed(url, async () => {
      const response = await fetch(url, { headers: { 'user-agent': 'brytonzoz.com-shipped-diagnosis' }, signal: AbortSignal.timeout(8000) });
      return { status: response.status, text: (await response.text()).slice(0, 800) };
    });
    out[url] = result;
  }
  return out;
}

function seedProfile(subject) {
  const profile = { name: '', bio: '', site: null, x: null, github: null };
  if (subject.kind === 'github') profile.github = subject.id;
  if (subject.kind === 'x') profile.x = subject.id;
  if (subject.kind === 'domain') profile.site = `https://${subject.id}/`;
  if (subject.kind === 'name') profile.name = subject.display;
  return profile;
}

async function resolveLikeWorker(query) {
  const parsed = readQuery(query);
  if (!parsed) return { parsed: null, candidates: [], notes: ['readQuery rejected the input'] };
  const seed =
    parsed.kind === 'domain'
      ? { kind: 'domain', id: parsed.value, display: parsed.value }
      : parsed.kind === 'handle'
        ? { kind: 'x', id: parsed.value, display: `@${parsed.value}` }
        : { kind: 'name', id: parsed.value, display: parsed.value };
  const resolved = await timed('resolveIdentity', () => resolveIdentity(seed, env, tinyfishAccess(env, tinyfishMeter)));
  if (!resolved.ok) return { parsed, candidates: [], notes: [resolved.error], seed };
  return {
    parsed,
    candidates: candidatesFromIdentity(seed, resolved.value),
    notes: resolved.value.notes,
    profile: resolved.value.profile,
    identityMs: resolved.ms,
  };
}

async function runSources(subject, profile) {
  const ctx = { subject, profile, year, env, tinyfish: tinyfishAccess(env, tinyfishMeter) };
  const per = [];
  for (const source of SOURCES) {
    if (!source.enabled(ctx)) {
      per.push({ id: source.id, enabled: false, reason: 'enabled() false', found: [], ms: 0 });
      continue;
    }
    const result = await timed(source.id, () => source.run(ctx));
    per.push({
      id: source.id,
      enabled: true,
      ok: result.ok,
      ms: result.ms,
      error: result.error,
      found: result.value ?? [],
    });
  }
  return per;
}

function dropAnalysis(found) {
  const dropped = [];
  const kept = [];
  for (const item of found) {
    const inYear = item.thisYear || (item.date && item.date.startsWith(String(year)));
    const row = { name: item.name, source: item.source, date: item.date, thisYear: Boolean(item.thisYear), link: item.link, score: item.score };
    if (!item.name) dropped.push({ ...row, why: 'empty-name' });
    else if (!inYear && item.date) dropped.push({ ...row, why: `date-not-${year}` });
    else if (!inYear) dropped.push({ ...row, why: 'no-date-and-not-thisYear' });
    else kept.push(row);
  }
  return { kept, dropped };
}

async function diagnoseOne(query) {
  const started = Date.now();
  const lookup = await resolveLikeWorker(query);
  const stagingLookup = await timed('staging-lookup', () =>
    stagingJson('/api/shipped/lookup', { method: 'POST', body: JSON.stringify({ q: query }) }),
  );
  const subject = lookup.candidates[0] ?? (lookup.parsed
    ? { kind: lookup.parsed.kind === 'handle' ? 'x' : lookup.parsed.kind, id: lookup.parsed.value, display: lookup.parsed.value }
    : null);
  if (!subject) {
    return { query, ms: Date.now() - started, lookup, stagingLookup, error: 'no-subject' };
  }

  const profile = seedProfile(subject);
  if (subject.kind === 'x' && /^[A-Za-z0-9-]{1,39}$/.test(subject.id)) {
    const user = await githubUser(subject.id, env, tinyfishAccess(env, tinyfishMeter)).catch(() => null);
    if (user?.x && user.x.toLowerCase() === subject.id.toLowerCase()) profile.github = subject.id;
  }
  if (profile.github) {
    const user = await githubUser(profile.github, env, tinyfishAccess(env, tinyfishMeter)).catch(() => null);
    if (user) {
      profile.name ||= user.name;
      profile.bio ||= user.bio;
      profile.site ||= user.blog;
      profile.x ||= user.x;
    }
  }

  const sources = await runSources(subject, profile);
  const gathered = await timed('gather', () => gather(subject, env, year, env.TINYFISH_API_KEY ? tinyfishMeter : null));
  const xProbe = subject.kind === 'x' || profile.x ? await probeX(profile.x || subject.id) : null;
  const draft = gathered.ok ? demoReceipt(gathered.value, year, 1) : null;
  const yearItems = gathered.ok ? inYearCount(gathered.value, year) : 0;
  const analysis = gathered.ok ? dropAnalysis(gathered.value.found) : null;

  return {
    query,
    ms: Date.now() - started,
    parsed: lookup.parsed,
    localCandidates: lookup.candidates,
    resolverNotes: lookup.notes,
    stagingLookup: stagingLookup.ok ? stagingLookup.value : { error: stagingLookup.error, ms: stagingLookup.ms },
    chosenSubject: subject,
    profileAfterResolve: profile,
    identityGaps: {
      hasGithub: Boolean(profile.github),
      hasX: Boolean(profile.x),
      hasSite: Boolean(profile.site),
      hasName: Boolean(profile.name),
      xEqualsGithub: Boolean(profile.x && profile.github && profile.x.toLowerCase() === profile.github.toLowerCase()),
      githubLinkedFromX: subject.kind === 'x' && Boolean(profile.github),
    },
    sources: sources.map((row) => ({
      ...row,
      found: (row.found ?? []).map((item) => ({
        name: item.name,
        date: item.date,
        thisYear: item.thisYear ?? false,
        status: item.status,
        link: item.link,
        score: item.score,
      })),
    })),
    gather: gathered.ok
      ? {
          ms: gathered.ms,
          ran: gathered.value.ran,
          failed: gathered.value.failed,
          foundCount: gathered.value.found.length,
          inYearCount: yearItems,
          web: gathered.value.web.length,
          pages: gathered.value.pages.length,
          site: gathered.value.site ? { url: gathered.value.site.url, title: gathered.value.site.title, links: gathered.value.site.links.length } : null,
          profile: gathered.value.profile,
          items: gathered.value.found.map((item) => ({
            name: item.name,
            source: item.source,
            date: item.date,
            thisYear: Boolean(item.thisYear),
            status: item.status,
            link: item.link,
          })),
        }
      : { error: gathered.error, ms: gathered.ms },
    dropped: analysis,
    demoReceipt: draft
      ? { itemCount: draft.items.length, potential: draft.potential, note: draft.note, items: draft.items.map((item) => `${item.name} [${item.source}] ${item.date ?? 'undated'}`) }
      : null,
    searchWouldRun: yearItems < SEARCH_BELOW,
    searchCap: maxSearches({ SHIPPED_MAX_SEARCHES: process.env.SHIPPED_MAX_SEARCHES }),
    xProbe,
  };
}

const report = {
  at: new Date().toISOString(),
  year,
  staging,
  envPresent: {
    GITHUB_TOKEN: Boolean(env.GITHUB_TOKEN),
    PRODUCTHUNT: Boolean(env.PRODUCTHUNT_TOKEN || (env.PRODUCTHUNT_KEY && env.PRODUCTHUNT_SECRET)),
    TINYFISH: Boolean(env.TINYFISH_API_KEY),
    BRANDFETCH: Boolean(env.BRANDFETCH_API),
    ANTHROPIC: Boolean(process.env.ANTHROPIC_API_KEY || process.env.claude_key),
  },
  stagingState: null,
  stagingPile: null,
  queries,
  results: [],
};

report.stagingState = await timed('state', () => stagingJson('/api/shipped/state'));
report.stagingPile = await timed('pile', () => stagingJson('/api/shipped/pile?limit=20'));

for (const query of queries) {
  console.error(`diagnose ${query}...`);
  const row = await diagnoseOne(query.trim());
  report.results.push(row);
  console.error(
    `  ${query}: ${row.demoReceipt?.itemCount ?? 0} demo items, gather ${row.gather?.foundCount ?? 0} found / ${row.gather?.inYearCount ?? 0} in-year, ${row.ms}ms`,
  );
}

const out = process.argv[2] || 'docs/shipped-research-diagnosis.raw.json';
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(out);
