// Completeness eval: gather() vs hand-built ground truth for ~10 builders.
import '../tests/resolve-ts.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const year = Number(process.env.SHIPPED_YEAR || 2026);
const truth = JSON.parse(readFileSync(new URL('../docs/shipped-ground-truth.json', import.meta.url), 'utf8'));
const { readQuery } = await import('../lib/shipped-year.ts');
const { gather, inYearCount } = await import('../worker/shipped-sources.ts');
const { demoReceipt } = await import('../worker/shipped-ai.ts');

const env = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || process.env.SHIPPED_GITHUB_TOKEN || '',
  PRODUCTHUNT_TOKEN: process.env.PRODUCTHUNT_TOKEN || '',
  PRODUCTHUNT_KEY: process.env.PRODUCTHUNT_KEY || '',
  PRODUCTHUNT_SECRET: process.env.PRODUCTHUNT_SECRET || '',
  TINYFISH_API_KEY: process.env.TINYFISH_API_KEY || '',
  BRANDFETCH_API: process.env.BRANDFETCH_API || '',
};

const loose = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const hostOf = (url) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : '';
  } catch {
    return '';
  }
};

function hit(found, ship) {
  const keys = [loose(ship.name), ...(ship.aliases || []).map(loose)].filter((k) => k.length >= 3);
  return found.some((item) => {
    const name = loose(item.name);
    const link = loose(item.link);
    const host = hostOf(item.link);
    if (keys.some((k) => name.includes(k) || k.includes(name))) return true;
    if (ship.url && host && host === hostOf(ship.url)) return true;
    if (ship.url && link && loose(ship.url).includes(name) && name.length >= 4) return true;
    return false;
  });
}

function statHit(stats, want) {
  const about = loose(want.about || '');
  return (stats || []).some((s) => {
    if (want.kind && s.kind !== want.kind) return false;
    if (want.min != null && (s.value ?? 0) < want.min * 0.5) return false;
    if (!about) return true;
    const hay = loose(`${s.about || ''} ${s.label} ${s.url}`);
    if (hay.includes(about) || about.includes(hay.slice(0, 8))) return true;
    return want.kind === 'repos' || want.kind === 'contributions' || want.kind === 'mrr';
  });
}

function seed(query) {
  const parsed = readQuery(query);
  if (!parsed) return null;
  if (parsed.kind === 'domain') return { kind: 'domain', id: parsed.value, display: parsed.value };
  if (parsed.kind === 'handle') return { kind: 'x', id: parsed.value, display: `@${parsed.value}` };
  return { kind: 'name', id: parsed.value, display: parsed.value };
}

const rows = [];
for (const builder of truth.builders) {
  const subject = seed(builder.query);
  const started = Date.now();
  console.error(`recall ${builder.query}...`);
  let gathered = null;
  let error = null;
  try {
    gathered = await gather(subject, env, year, null);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const draft = gathered ? demoReceipt(gathered, year, 1) : null;
  const found = gathered?.found ?? [];
  const must = builder.ships.filter((ship) => ship.must !== false);
  const should = builder.ships.filter((ship) => ship.must === false);
  const hits = must.filter((ship) => hit(found, ship));
  const misses = must.filter((ship) => !hit(found, ship));
  const shouldHits = should.filter((ship) => hit(found, ship));
  const recall = must.length ? hits.length / must.length : 0;
  const statHits = (builder.stats || []).filter((s) => statHit(gathered?.stats, s));
  const sourcedPct = draft?.items?.length ? Math.round((draft.items.filter((i) => i.link).length / draft.items.length) * 100) : 0;
  const row = {
    query: builder.query,
    ms: Date.now() - started,
    error,
    identity: gathered?.profile ?? null,
    items: found.length,
    inYear: gathered ? inYearCount(gathered, year) : 0,
    receiptItems: draft?.items?.length ?? 0,
    recall: Number(recall.toFixed(3)),
    foundShips: hits.map((s) => s.name),
    missedShips: misses.map((s) => s.name),
    shouldFound: shouldHits.map((s) => s.name),
    shouldMissed: should.filter((ship) => !hit(found, ship)).map((s) => s.name),
    statsFound: statHits.length,
    statsExpected: (builder.stats || []).length,
    statLabels: (gathered?.stats ?? []).map((s) => `${s.label} · ${s.url.replace(/^https?:\/\/(www\.)?/, '')}`),
    gaps: gathered?.gaps ?? [],
    ran: gathered?.ran ?? [],
    sourcedPct,
    note: draft?.note ?? '',
    names: (draft?.items ?? []).map((i) => i.name),
  };
  rows.push(row);
  console.error(
    `  ${builder.query}: recall ${(recall * 100).toFixed(0)}% (${hits.length}/${builder.ships.length}) stats ${statHits.length}/${builder.stats?.length ?? 0} items=${found.length} ${row.ms}ms`,
  );
}

const recalls = rows.map((r) => r.recall).sort((a, b) => a - b);
const median = recalls.length ? recalls[Math.floor((recalls.length - 1) / 2)] : 0;
const report = {
  at: new Date().toISOString(),
  year,
  envPresent: {
    GITHUB_TOKEN: Boolean(env.GITHUB_TOKEN),
    PRODUCTHUNT: Boolean(env.PRODUCTHUNT_TOKEN || (env.PRODUCTHUNT_KEY && env.PRODUCTHUNT_SECRET)),
    TINYFISH: Boolean(env.TINYFISH_API_KEY),
    ANTHROPIC: Boolean(process.env.ANTHROPIC_API_KEY),
  },
  medianRecall: Number(median.toFixed(3)),
  pass: median >= 0.8,
  costNote:
    'Deterministic harvest is $0. Claude Haiku + 3 web searches worst-case is about $0.03–$0.04 of the $0.05 receipt cap. A fourth search wave would be +$0.01 and is only skipped when the remaining budget cannot buy it (coverageCapped).',
  rows,
};

const out = process.argv[2] || 'docs/shipped-recall.json';
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, medianRecall: report.medianRecall, pass: report.pass }, null, 2));
