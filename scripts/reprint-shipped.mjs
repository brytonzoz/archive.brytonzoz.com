// Reprint wall receipts via POST /api/admin/shipped { action: 'reprint-receipt', affiliation? }.
// Names and counts only. Never prints the admin password or receipt bodies.
// Push-default FORCE_IDS: 16, 17, 18, 19, 20 (Tibo, Cursor, jackfriks, Zod, Theo).
// After 7bdfa60: undated changelog rows stay, handle.com pins, musl rollup.
// After 712cf78: thisYear survives polish; #16 attaches OpenAI cache.
// After 5dd73e8: friend homepages are not project lists.
// After 1f2b408: tighter title gate (verb/article/cutoff leftovers).
// After 3f41609: flagship 2026 keep, Graphite 2025 drop, pin dates, GitHub junk.
// After 48897bb: Graphite never stays on a 2026 tape; YES/T3DOTGG drop on npm too.
// After 0003ca8: pre-2026 pin evidence also drops same-name leftover npm lines (POST BRIDGE).
// After 5dd8ef4: multi-word pins date on hyphenated hosts (ship-or-die.com, not shipordie.com).
// After c600749: product hosts listed on the maker's profile are still first-launch evidence.
// After 4b865b5: npm packages are dated from the product homepage too.
// After (next): revert npm dating (Zod is older than 2026); take earliest URL evidence.
//
//   ADMIN_PASSWORD=… node scripts/reprint-shipped.mjs [origin]
const RECEIPT_PATH = (id) => `/r/${id}/`;

const origin = (process.argv[2] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const password = process.env.ADMIN_PASSWORD || '';
const FORCE = process.env.SHIPPED_REPRINT_FORCE === '1';
const FORCE_IDS = new Set(
  (process.env.SHIPPED_REPRINT_FORCE_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0),
);
const realCount = (receipt) => {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  return items.filter((item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none').length;
};

/** Wall CEOs whose public bios are misleading; admin reprints attach the warm company-cache tape. */
const AFFILIATION_BY_ID = {
  16: { company: 'OpenAI', role: 'lead' },
  17: { company: 'Cursor', role: 'ceo' },
  13: { company: 'OpenAI', role: 'ceo' },
};

const DEFAULT_TARGETS = [
  { id: 16, who: 'Tibo from OpenAI' },
  { id: 17, who: 'Michael Truell' },
  { id: 11, who: '@thsottiaux' },
  { id: 13, who: 'Sam Altman' },
  { id: 14, who: 'Marc Lou' },
  { id: 6, who: 'levelsio' },
  { id: 7, who: 'Guillermo Rauch' },
  { id: 18, who: 'jackfriks' },
  { id: 19, who: 'colinhacks' },
  { id: 20, who: 't3dotgg' },
];

const TARGETS =
  FORCE_IDS.size > 0
    ? [...FORCE_IDS]
        .sort((a, b) => a - b)
        .map((id) => DEFAULT_TARGETS.find((t) => t.id === id) ?? { id, who: `#${id}` })
    : DEFAULT_TARGETS;

if (!password) {
  console.error('ADMIN_PASSWORD is required to reprint.');
  process.exit(1);
}

const headers = { authorization: `Bearer ${password}`, 'content-type': 'application/json' };

async function readReceipt(id) {
  const res = await fetch(`${origin}/api/shipped/receipts/${id}?t=${Date.now()}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.receipt ?? body;
}

async function reprint(id) {
  const affiliation = AFFILIATION_BY_ID[id];
  const res = await fetch(`${origin}/api/admin/shipped`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'reprint-receipt', id, ...(affiliation ? { affiliation } : {}) }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 160) };
  }
  return { ok: res.ok && body.ok === true, status: res.status, error: body.error || null };
}

const rows = [];
for (const target of TARGETS) {
  const before = await readReceipt(target.id);
  const who = before?.subject?.display || before?.login || target.who;
  const prior = realCount(before);
  if (!FORCE && !FORCE_IDS.has(target.id) && prior >= 15 && !before?.potential) {
    console.log(`#${target.id} ${who} already has ${prior} items; skip`);
    rows.push({ id: target.id, who, items: prior, url: `${origin}${RECEIPT_PATH(target.id)}`, skipped: true });
    continue;
  }
  let last = { ok: false, status: 0, error: 'not-tried' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((ok) => setTimeout(ok, 8000));
    last = await reprint(target.id);
    if (last.ok) break;
    console.log(`#${target.id} reprint ${last.status} ${last.error || ''} (try ${attempt + 1})`);
  }
  if (!last.ok) {
    console.error(`#${target.id} ${who} reprint failed: ${last.status} ${last.error || ''}`);
    process.exit(1);
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  let after = await readReceipt(target.id);
  if (!after || realCount(after) === prior) {
    await new Promise((ok) => setTimeout(ok, 8000));
    after = (await readReceipt(target.id)) || before;
  }
  const items = realCount(after) || (after?.potential ? 0 : prior);
  const url = `${origin}${RECEIPT_PATH(target.id)}`;
  console.log(`#${target.id} ${who} → ${items} items ${url}`);
  rows.push({ id: target.id, who, items, url, skipped: false });
}

console.log(JSON.stringify({ origin, receipts: rows }, null, 2));
