// Reprint wall receipts via POST /api/admin/shipped { action: 'reprint-receipt', affiliation? }.
// Names and counts only. Never prints the admin password or receipt bodies.
// Push-default FORCE_IDS: 6, 7, 13, 16, 17, 18, 19, 20, 21, 22
// (levelsio, Guillermo, Sam, Tibo, Cursor, jackfriks, Zod, Theo, Tony, Stephan).
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
// After 05fa76d: revert npm dating (Zod is older than 2026); take earliest URL evidence.
// After de3d3e3: version monthly rollup, person-name gate, archive/RDAP beats npm for the product itself.
// After 80487e7: GitLab prefix-only merge; reject copied cashier examples.
// After c85e99e: seeded note styles, undated ownership gate, leftover Codex fragments.
// After b2fb93f: invented few-shots so cashier notes are not copies of Tibo/Colin.
// After f8503e1: hard-reject only; first-publish-year drops old npm; site crumbs need a description.
// After 75284d0: own-host + blurb is not ownership (TRPC / TRANSFORM).
// After 8f16288: one print-time gate; company cache stays raw; junk fixture in CI.
// After de7f69d: docs/category hrefs and HTML-entity nav titles drop at print time.
// After 1c92c1e: E2E goldens on cached tapes; changelog cards keep /changelog/ hrefs.
// After floors restore: Truell ≥40, Tibo ≥35, Rauch ≥25, Sam ≥20. Live uses fixture mins.
// After f325d85: named Codex reserve, Vercel changelog harvest, prerelease/org-repo junk, note rejects.
// After this pass: Atom/RSC changelog cards, keep "can now" titles, no cache-time leader reprints, canned notes die.
// After 95a3c53: Codex changelog cards stay in Tibo scope via #codex- hashes; Gateway models roll up by URL.
// After 04668b7: 60-char wrap, date-or-drop changelog, OpenAI /index, no bare notes, drop Ship or Die for Jack.
// After note/self-name pass: word-number counts, bio/thin-tape notes, LEGAL/TRUELL20.
// After f063801: reprint #6, #7, #13, #16–#22 on the leftover-nav / weak-note gate.
// Optional SHIPPED_PRINT_SUBJECTS=handle,handle prints two fresh names via admin print-subject.
//
//   ADMIN_PASSWORD=… node scripts/reprint-shipped.mjs [origin]
const RECEIPT_PATH = (id) => `/r/${id}/`;

const origin = (process.argv[2] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const password = process.env.ADMIN_PASSWORD || '';
const FORCE = process.env.SHIPPED_REPRINT_FORCE === '1';
const WALL = process.env.SHIPPED_REPRINT_WALL === '1';
const KEEP_IDS = new Set([6, 7, 13, 16, 17, 18, 19, 20, 21, 22, 26, 28]);
const BROKEN_TITLE = [
  /###/,
  /<\/?[a-z]/i,
  /^@[a-z0-9._-]+\//i,
  /^what[’']s new in\b/i,
  /:\s*$/,
  /commission analytics you can$/i,
  /^(i|i'm|i've|we|we've|it's)\b/i,
];
const FORCE_IDS = new Set(
  (process.env.SHIPPED_REPRINT_FORCE_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0),
);
const PRINT_SUBJECTS = (process.env.SHIPPED_PRINT_SUBJECTS || '')
  .split(',')
  .map((value) => value.trim().replace(/^@/, ''))
  .filter(Boolean);
const realCount = (receipt) => {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  return items.filter((item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none').length;
};

/** Wall CEOs whose public bios are misleading; admin reprints attach the warm company-cache tape. */
const AFFILIATION_BY_ID = {
  16: { company: 'OpenAI', role: 'lead', product: 'Codex' },
  17: { company: 'Cursor', role: 'ceo' },
  13: { company: 'OpenAI', role: 'ceo' },
  7: { company: 'Vercel', role: 'ceo' },
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
  { id: 21, who: 'Tony Dinh' },
  { id: 22, who: 'Stephanj' },
];

if (!password) {
  console.error('ADMIN_PASSWORD is required to reprint.');
  process.exit(1);
}

async function fetchPile() {
  const receipts = [];
  let before = '';
  for (let page = 0; page < 8; page++) {
    const url = `${origin}/api/shipped/pile?limit=200&t=${Date.now()}${before ? `&before=${before}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) break;
    const body = await res.json();
    const rows = Array.isArray(body.receipts) ? body.receipts : [];
    receipts.push(...rows);
    if (!body.next || !rows.length) break;
    before = String(body.next);
  }
  return receipts;
}

if (WALL) {
  const pile = await fetchPile();
  for (const row of pile) {
    const id = Number(row?.id);
    if (Number.isFinite(id) && id > 0) FORCE_IDS.add(id);
  }
  console.log(`Wall reprint: ${[...FORCE_IDS].sort((a, b) => a - b).join(',') || '(empty pile)'}`);
}

const TARGETS =
  FORCE_IDS.size > 0
    ? [...FORCE_IDS]
        .sort((a, b) => a - b)
        .map((id) => DEFAULT_TARGETS.find((t) => t.id === id) ?? { id, who: `#${id}` })
    : DEFAULT_TARGETS;

const headers = { authorization: `Bearer ${password}`, 'content-type': 'application/json' };

async function readReceipt(id) {
  const res = await fetch(`${origin}/api/shipped/receipts/${id}?t=${Date.now()}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.receipt ?? body;
}

function titlesOf(receipt) {
  return (receipt?.items || [])
    .filter((item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none')
    .map((item) => item.name);
}

function usageOf(body) {
  return {
    costMicros: Number.isFinite(Number(body?.costMicros)) ? Number(body.costMicros) : null,
    inputTokens: Number.isFinite(Number(body?.inputTokens)) ? Number(body.inputTokens) : null,
    outputTokens: Number.isFinite(Number(body?.outputTokens)) ? Number(body.outputTokens) : null,
    count: Number.isFinite(Number(body?.count)) ? Number(body.count) : null,
    titles: Array.isArray(body?.titles) ? body.titles.filter((name) => typeof name === 'string') : [],
  };
}

async function reprint(id) {
  const affiliation = AFFILIATION_BY_ID[id];
  const started = Date.now();
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
  return {
    ok: res.ok && body.ok === true,
    status: res.status,
    error: body.error || null,
    note: typeof body.note === 'string' ? body.note : null,
    noteCandidates: Array.isArray(body.noteCandidates) ? body.noteCandidates : [],
    ms: Date.now() - started,
    ...usageOf(body),
  };
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
    if (!WALL) process.exit(1);
    rows.push({ id: target.id, who, items: prior, url: `${origin}${RECEIPT_PATH(target.id)}`, skipped: false, error: last.error, ms: last.ms });
    continue;
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  let after = await readReceipt(target.id);
  if (!after || realCount(after) === prior) {
    await new Promise((ok) => setTimeout(ok, 8000));
    after = (await readReceipt(target.id)) || before;
  }
  const items = last.count ?? realCount(after) ?? (after?.potential ? 0 : prior);
  const titles = last.titles?.length ? last.titles : titlesOf(after);
  const url = `${origin}${RECEIPT_PATH(target.id)}`;
  console.log(`#${target.id} ${who} → ${items} items ${last.costMicros ?? '?'}µs ${last.ms}ms ${url}`);
  console.log(JSON.stringify({ shipped: 'reprint', id: target.id, who, items, titles, note: last.note, costMicros: last.costMicros, inputTokens: last.inputTokens, outputTokens: last.outputTokens, ms: last.ms }));
  if (last.noteCandidates?.length || last.note) {
    console.log(
      JSON.stringify({
        shipped: 'note-reject',
        id: target.id,
        who,
        note: last.note,
        candidates: last.noteCandidates,
      }),
    );
  }
  rows.push({
    id: target.id,
    who,
    items,
    titles,
    url,
    skipped: false,
    note: last.note,
    noteCandidates: last.noteCandidates,
    costMicros: last.costMicros,
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    ms: last.ms,
  });
}

async function printSubject(q) {
  const started = Date.now();
  const res = await fetch(`${origin}/api/admin/shipped`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'print-subject', q }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 160) };
  }
  return {
    ok: res.ok && body.ok === true,
    status: res.status,
    error: body.error || null,
    id: Number(body.id) || 0,
    note: typeof body.note === 'string' ? body.note : null,
    noteCandidates: Array.isArray(body.noteCandidates) ? body.noteCandidates : [],
    ms: Date.now() - started,
    ...usageOf(body),
  };
}

for (const q of PRINT_SUBJECTS) {
  let last = { ok: false, status: 0, error: 'not-tried', id: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((ok) => setTimeout(ok, 8000));
    last = await printSubject(q);
    if (last.ok) break;
    console.log(`@${q} print ${last.status} ${last.error || ''} (try ${attempt + 1})`);
  }
  if (!last.ok) {
    console.error(`@${q} print failed: ${last.status} ${last.error || ''}`);
    process.exit(1);
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  let after = last.id ? await readReceipt(last.id) : null;
  if (!after) {
    await new Promise((ok) => setTimeout(ok, 8000));
    after = last.id ? await readReceipt(last.id) : null;
  }
  const who = after?.subject?.display || after?.login || `@${q}`;
  const items = last.count ?? realCount(after);
  const titles = last.titles?.length ? last.titles : titlesOf(after);
  const note = last.note || after?.note || null;
  const url = last.id ? `${origin}${RECEIPT_PATH(last.id)}` : origin;
  console.log(`#${last.id} ${who} → ${items} items ${last.costMicros ?? '?'}µs ${last.ms}ms ${url}`);
  console.log(JSON.stringify({ shipped: 'print-subject', q, id: last.id, who, items, titles, note, costMicros: last.costMicros, inputTokens: last.inputTokens, outputTokens: last.outputTokens, ms: last.ms }));
  if (note) {
    console.log(
      JSON.stringify({
        shipped: 'note-writer',
        q,
        who,
        note,
        fallback: /is the (first line|only ship|named product)( printed)? on this receipt/i.test(note),
        candidates: last.noteCandidates,
      }),
    );
  }
  rows.push({
    id: last.id,
    who,
    items,
    titles,
    url,
    skipped: false,
    fresh: true,
    q,
    note,
    noteCandidates: last.noteCandidates,
    costMicros: last.costMicros,
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    ms: last.ms,
  });
}

function titleLooksBroken(name) {
  return BROKEN_TITLE.some((re) => re.test(String(name || '')));
}

function tapeLooksBroken(titles) {
  const names = Array.isArray(titles) ? titles : [];
  if (names.some(titleLooksBroken)) return true;
  if (names.some((name) => String(name || '').trim().split(/\s+/).filter(Boolean).length >= 12)) return true;
  return names.filter((name) => /^VERCEL \d/i.test(name)).length >= 8;
}

function looseWho(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]/g, '');
}

async function hideReceipt(id) {
  const res = await fetch(`${origin}/api/admin/shipped`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'hide-receipt', id }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && body.ok === true;
}

const hidden = [];
if (WALL) {
  const pile = await fetchPile();
  const byWho = new Map();
  for (const row of pile) {
    const key = looseWho(row.who);
    if (!key) continue;
    const list = byWho.get(key) || [];
    list.push(row);
    byWho.set(key, list);
  }
  for (const row of pile) {
    const id = Number(row.id);
    if (!id || KEEP_IDS.has(id)) continue;
    const titles = (row.items || []).map((item) => item.name);
    const twins = byWho.get(looseWho(row.who)) || [];
    const newerTwin = twins.some((other) => Number(other.id) > id);
    const empty = !titles.length || Number(row.count) === 0;
    const hasLiveTwin = twins.some((other) => Number(other.id) !== id && Number(other.count) > 0);
    if (tapeLooksBroken(titles) || newerTwin || (empty && hasLiveTwin)) {
      const why = tapeLooksBroken(titles) ? 'broken' : empty && hasLiveTwin ? 'empty-duplicate' : 'duplicate';
      const ok = await hideReceipt(id);
      hidden.push({ id, who: row.who, count: row.count, why, ok });
      console.log(`hide #${id} ${row.who} (${why}) ${ok ? 'ok' : 'failed'}`);
    }
  }
}

const report = { origin, xai: 'off', sha: process.env.GITHUB_SHA || null, receipts: rows, hidden };
console.log(JSON.stringify(report, null, 2));
const reportPath = process.env.SHIPPED_REPORT;
if (reportPath) {
  await import('node:fs/promises').then((fs) => fs.writeFile(reportPath, JSON.stringify(report, null, 2)));
}
