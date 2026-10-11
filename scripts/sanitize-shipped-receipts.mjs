// Re-run deterministic sub-line cleaner on every stored receipt (no AI).
//   ADMIN_PASSWORD=… node scripts/sanitize-shipped-receipts.mjs [origin] [--dry-run]
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const origin = (args[0] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const dryRun = process.argv.includes('--dry-run');
const password = process.env.ADMIN_PASSWORD || '';
if (!password) {
  console.error('Set ADMIN_PASSWORD');
  process.exit(1);
}

const res = await fetch(`${origin}/api/admin/shipped`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${password}` },
  body: JSON.stringify({ action: 'sanitize-receipt-sublines', dryRun }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('sanitize failed', res.status, body);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
if (body.remainingJunk?.length) {
  console.error(`remaining junk: ${body.remainingJunk.length}`);
  process.exit(2);
}
