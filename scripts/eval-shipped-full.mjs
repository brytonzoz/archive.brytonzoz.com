// Full Shipped pipeline eval: gather + Claude assemble. Used by .github/workflows/shipped-eval.yml.
// Secrets (never printed): CLAUDE_KEY / ANTHROPIC_API_KEY, PRODUCTHUNT_KEY+SECRET, SHIPPED_GITHUB_TOKEN.
import '../tests/resolve-ts.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const year = Number(process.env.SHIPPED_YEAR || 2026);
const original = JSON.parse(readFileSync(new URL('../docs/shipped-ground-truth.json', import.meta.url), 'utf8'));
const heldOut = JSON.parse(readFileSync(new URL('../docs/shipped-heldout-ground-truth.json', import.meta.url), 'utf8'));
const builders = [
  ...original.builders.map((b) => ({ ...b, set: 'original' })),
  ...heldOut.builders.map((b) => ({ ...b, set: 'held-out' })),
];

const { readQuery } = await import('../lib/shipped-year.ts');
const { gather, inYearCount } = await import('../worker/shipped-sources.ts');
const { assembleReceipt, demoReceipt } = await import('../worker/shipped-ai.ts');

const pick = (...names) => names.map((n) => process.env[n]).find((v) => typeof v === 'string' && v.trim()) || '';

const env = {
  GITHUB_TOKEN: pick('SHIPPED_GITHUB_TOKEN', 'EVAL_GITHUB_TOKEN'),
  PRODUCTHUNT_TOKEN: pick('PRODUCTHUNT_TOKEN'),
  PRODUCTHUNT_KEY: pick('PRODUCTHUNT_KEY'),
  PRODUCTHUNT_SECRET: pick('PRODUCTHUNT_SECRET'),
  TINYFISH_API_KEY: pick('TINYFISH', 'TINYFISH_API_KEY'),
  BRANDFETCH_API: pick('BRANDFETCH_API'),
  ANTHROPIC_API_KEY: pick('CLAUDE_KEY', 'ANTHROPIC_API_KEY'),
  ANTHROPIC_WORKSPACE_ID: pick('CLAUDE_WORKSPACE', 'ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_WORKSPACE_DEFAULT'),
  SHIPPED_MODEL: process.env.SHIPPED_MODEL || 'claude-haiku-5-5',
  SHIPPED_MAX_SEARCHES: process.env.SHIPPED_MAX_SEARCHES || '3',
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

const templated = (note) =>
  /is first on the tape|led the year|closed the year|set the tone|through-line|Receipt paper running low|Someone likes the publish button|Thank you for shipping/i.test(
    note || '',
  );

const rows = [];
for (const builder of builders) {
  const subject = seed(builder.query);
  const started = Date.now();
  console.error(`full ${builder.set} ${builder.query}...`);
  let gathered = null;
  let draft = null;
  let error = null;
  let costMicros = 0;
  let searches = 0;
  let model = null;
  try {
    gathered = await gather(subject, env, year, null);
    if (env.ANTHROPIC_API_KEY) {
      const ai = await assembleReceipt(subject, gathered, year, 1, env);
      draft = ai;
      costMicros = ai.costMicros ?? 0;
      searches = ai.searches ?? 0;
      model = ai.model;
    } else {
      draft = demoReceipt(gathered, year, 1);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    if (gathered && !draft) draft = demoReceipt(gathered, year, 1);
  }
  const found = gathered?.found ?? [];
  const must = builder.ships.filter((ship) => ship.must !== false);
  const hits = must.filter((ship) => hit(found, ship));
  const misses = must.filter((ship) => !hit(found, ship));
  const recall = must.length ? hits.length / must.length : 0;
  const statHits = (builder.stats || []).filter((s) => statHit(gathered?.stats, s));
  const phStats = (gathered?.stats ?? []).filter((s) => s.kind === 'upvotes' || /producthunt/i.test(s.url || ''));
  const row = {
    set: builder.set,
    query: builder.query,
    ms: Date.now() - started,
    error,
    identity: gathered?.profile ?? null,
    github: gathered?.profile?.github ?? null,
    site: gathered?.profile?.site ?? null,
    items: found.length,
    inYear: gathered ? inYearCount(gathered, year) : 0,
    receiptItems: draft?.items?.length ?? 0,
    recall: Number(recall.toFixed(3)),
    foundShips: hits.map((s) => s.name),
    missedShips: misses.map((s) => s.name),
    statsFound: statHits.length,
    statsExpected: (builder.stats || []).length,
    statLabels: (gathered?.stats ?? []).map((s) => `${s.label} · ${s.url.replace(/^https?:\/\/(www\.)?/, '')}`),
    phUpvotes: phStats.map((s) => `${s.label} · ${s.url.replace(/^https?:\/\/(www\.)?/, '')}`),
    note: draft?.note ?? '',
    noteTemplated: templated(draft?.note),
    names: (draft?.items ?? []).map((i) => i.name),
    costMicros,
    costUsd: Number((costMicros / 1_000_000).toFixed(4)),
    searches,
    model,
    usedClaude: Boolean(env.ANTHROPIC_API_KEY && !error),
    ran: gathered?.ran ?? [],
  };
  rows.push(row);
  console.error(
    `  ${builder.query}: recall ${(recall * 100).toFixed(0)}% note=${JSON.stringify(row.note)} cost=$${row.costUsd} ph=${row.phUpvotes.length} ${row.ms}ms`,
  );
}

const recalls = rows.map((r) => r.recall).sort((a, b) => a - b);
const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const report = {
  at: new Date().toISOString(),
  year,
  usedClaude: Boolean(env.ANTHROPIC_API_KEY),
  envPresent: {
    GITHUB_TOKEN: Boolean(env.GITHUB_TOKEN),
    PRODUCTHUNT: Boolean(env.PRODUCTHUNT_TOKEN || (env.PRODUCTHUNT_KEY && env.PRODUCTHUNT_SECRET)),
    TINYFISH: Boolean(env.TINYFISH_API_KEY),
    ANTHROPIC: Boolean(env.ANTHROPIC_API_KEY),
    WORKSPACE: Boolean(env.ANTHROPIC_WORKSPACE_ID),
  },
  medianRecall: Number(median(recalls).toFixed(3)),
  medianRecallOriginal: Number(median(rows.filter((r) => r.set === 'original').map((r) => r.recall)).toFixed(3)),
  medianRecallHeldOut: Number(median(rows.filter((r) => r.set === 'held-out').map((r) => r.recall)).toFixed(3)),
  totalCostUsd: Number((rows.reduce((n, r) => n + r.costUsd, 0)).toFixed(4)),
  meanCostUsd: Number((rows.reduce((n, r) => n + r.costUsd, 0) / Math.max(1, rows.length)).toFixed(4)),
  templatedNotes: rows.filter((r) => r.noteTemplated).map((r) => r.query),
  rows,
};

const jsonOut = process.argv[2] || 'artifacts/shipped-eval.json';
mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify(report, null, 2));

const mdOut = process.argv[3] || 'artifacts/shipped-eval.md';
const md = [
  `# Shipped full-pipeline eval`,
  '',
  `- At: ${report.at}`,
  `- Claude: ${report.usedClaude ? 'yes' : 'NO (demoReceipt placeholders)'}`,
  `- Product Hunt: ${report.envPresent.PRODUCTHUNT ? 'yes' : 'no'}`,
  `- GitHub token: ${report.envPresent.GITHUB_TOKEN ? 'yes' : 'no'}`,
  `- Median recall original: ${(report.medianRecallOriginal * 100).toFixed(0)}%`,
  `- Median recall held-out: ${(report.medianRecallHeldOut * 100).toFixed(0)}%`,
  `- Total cost: $${report.totalCostUsd}`,
  `- Mean cost / receipt: $${report.meanCostUsd}`,
  report.templatedNotes.length ? `- Templated notes: ${report.templatedNotes.join(', ')}` : '- Templated notes: none',
  '',
  '| Set | Query | Recall | PH | Cost | Note |',
  '| --- | --- | ---: | --- | ---: | --- |',
  ...rows.map(
    (r) =>
      `| ${r.set} | ${r.query} | ${(r.recall * 100).toFixed(0)}% | ${r.phUpvotes[0] || '—'} | $${r.costUsd.toFixed(4)} | ${r.note.replace(/\|/g, '/')} |`,
  ),
  '',
  '## Notes verbatim',
  '',
  ...rows.map((r) => `- **${r.query}** ($${r.costUsd.toFixed(4)}): ${r.note}`),
  '',
].join('\n');
writeFileSync(mdOut, md);
console.log(
  JSON.stringify(
    {
      jsonOut,
      mdOut,
      usedClaude: report.usedClaude,
      productHunt: report.envPresent.PRODUCTHUNT,
      medianRecallOriginal: report.medianRecallOriginal,
      medianRecallHeldOut: report.medianRecallHeldOut,
      totalCostUsd: report.totalCostUsd,
      templatedNotes: report.templatedNotes,
    },
    null,
    2,
  ),
);
