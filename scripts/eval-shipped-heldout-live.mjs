// Live held-out prints on staging. xAI stays off (admin print-subject).
//   ADMIN_PASSWORD=… node scripts/eval-shipped-heldout-live.mjs [origin]
// Optional SHIPPED_HELD_OUT=handle,handle to print a subset.
const origin = (process.argv[2] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const password = process.env.ADMIN_PASSWORD || '';
const QUERIES = (
  process.env.SHIPPED_HELD_OUT ||
  'steventey,shadcn,swyx,levelsio,jarredsumner,yyx990803,dannypostmaa,nico_jeannen,Rich-Harris,leerob,mckaywrigley,pontusab'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const JUNK = [
  /###/,
  /<\/?[a-z]/i,
  /\bminor changes\b/i,
  /\b17ee736\b/i,
  /commission analytics you can$/i,
  /\bteams\s*&\s*$/i,
  /\beslint[- ]plugin[- ]vue\b/i,
  /\bdeepwiki\b/i,
  /\bhow to\b/i,
  /\bcustomer stor/i,
  /^@[a-z0-9._-]+\//i,
  /^(i|i'm|i've|we|we've|it's)\b/i,
];

function essayTitle(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length >= 12;
}

function realItems(receipt) {
  return (receipt?.items || []).filter((item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none');
}

function echoNote(note, items) {
  const text = String(note || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const first = String(items[0]?.name || items[0]?.spoken || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return Boolean(text && first && text === first);
}

async function admin(action, extra = {}) {
  const response = await fetch(`${origin}/api/admin/shipped`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${password}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${action} ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function receiptOf(id) {
  const response = await fetch(`${origin}/api/shipped/receipts/${id}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`receipt ${id} ${response.status}`);
  return response.json();
}

async function pileCount(id) {
  const response = await fetch(`${origin}/api/shipped/pile?limit=200`, { cache: 'no-store' });
  if (!response.ok) return null;
  const body = await response.json();
  const row = (body.receipts || []).find((entry) => entry.id === id);
  return row ? row.count : null;
}

async function printOne(query) {
  const started = Date.now();
  const printed = await admin('print-subject', { q: query });
  const loaded = await receiptOf(printed.id);
  const receipt = loaded.receipt || loaded;
  const items = realItems(receipt);
  const wall = await pileCount(printed.id);
  const titles = items.map((item) => item.name);
  const junk = titles.filter((name) => JUNK.some((re) => re.test(name)) || essayTitle(name));
  const note = String(receipt.note || printed.note || '');
  return {
    query,
    id: printed.id,
    count: items.length,
    wallCount: wall,
    titles,
    note,
    echoNote: echoNote(note, items),
    junk,
    costMicros: printed.costMicros ?? loaded.cost_micros ?? loaded.costMicros ?? null,
    inputTokens: printed.inputTokens ?? loaded.input_tokens ?? loaded.inputTokens ?? null,
    outputTokens: printed.outputTokens ?? loaded.output_tokens ?? loaded.outputTokens ?? null,
    ms: Date.now() - started,
    ok: !junk.length && !echoNote(note, items) && (wall == null || wall === items.length),
  };
}

if (!password) {
  console.error('ADMIN_PASSWORD is required');
  process.exit(2);
}

const rows = [];
for (const query of QUERIES) {
  try {
    const row = await printOne(query);
    rows.push(row);
    console.log(JSON.stringify(row, null, 2));
  } catch (error) {
    rows.push({ query, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.error(query, error);
  }
}

const summary = {
  origin,
  xai: 'off',
  sha: process.env.GITHUB_SHA || null,
  rows: rows.map((row) => ({
    query: row.query,
    id: row.id,
    count: row.count,
    wallCount: row.wallCount,
    note: row.note,
    echoNote: row.echoNote,
    junk: row.junk,
    costMicros: row.costMicros,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    ms: row.ms,
    ok: row.ok,
    error: row.error,
    titles: row.titles,
  })),
};
console.log('\n--- held-out live ---\n');
console.log(JSON.stringify(summary, null, 2));
const reportPath = process.env.SHIPPED_REPORT;
if (reportPath) {
  await import('node:fs/promises').then((fs) => fs.writeFile(reportPath, JSON.stringify(summary, null, 2)));
}
const failed = rows.filter((row) => !row.ok);
process.exit(failed.length ? 1 : 0);
