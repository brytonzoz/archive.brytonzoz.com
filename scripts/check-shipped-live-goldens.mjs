// After a reprint, assert LIVE /api receipts against the same golden rules.
// Fails the reprint workflow when #7 is under the floor or a required ship is missing.
import '../tests/resolve-ts.mjs';
import { LIVE_RECEIPT_IDS, evaluateLiveReceipt, junkKeys } from '../tests/lib/shipped-goldens.mjs';

const origin = (process.argv[2] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const waitMs = Number(process.env.SHIPPED_LIVE_WAIT_MS ?? 65_000);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const polish = await import('../worker/shipped-polish.ts');
const ai = await import('../worker/shipped-ai.ts');

const helpers = {
  junkHit: junkKeys(),
  endsWithCutOffWord: polish.endsWithCutOffWord,
  isBareProductNote: ai.isBareProductNote,
};

async function readReceipt(id) {
  const url = `${origin}/api/shipped/receipts/${id}?t=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', 'user-agent': UA, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`#${id} ${res.status} ${url}`);
  const body = await res.json();
  return body.receipt ?? body;
}

if (waitMs > 0) {
  console.log(`waiting ${waitMs}ms for /api cache to expire`);
  await new Promise((ok) => setTimeout(ok, waitMs));
}

const report = [];
const failures = [];
for (const id of LIVE_RECEIPT_IDS) {
  let receipt = await readReceipt(id);
  const first = evaluateLiveReceipt(id, receipt, helpers);
  if (!first.ok) {
    await new Promise((ok) => setTimeout(ok, 15_000));
    receipt = await readReceipt(id);
  }
  const result = evaluateLiveReceipt(id, receipt, helpers);
  report.push({ id, count: result.count, note: result.note, names: result.names, failures: result.failures });
  if (!result.ok) failures.push(`#${id}: ${result.failures.join('; ')}`);
  console.log(`#${id} ${result.count} items${result.ok ? '' : ` FAIL ${result.failures.join('; ')}`}`);
}

console.log(JSON.stringify({ origin, ok: failures.length === 0, failures, report }, null, 2));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
