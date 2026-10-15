// Scan every public /r/<id>/ page (and receipt API) for junk sub-line patterns.
//   node scripts/scan-shipped-junk.mjs [origin] [maxId]
import '../tests/resolve-ts.mjs';
const { storedSublineLooksJunk, receiptItemSublineIsClean } = await import('../worker/shipped-polish.ts');

const origin = (process.argv[2] || process.env.SHIPPED_ORIGIN || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const maxArg = Number(process.argv[3] || process.env.SHIPPED_MAX_ID || 0);

const JUNK_PAGE =
  /\b(breaking changes|patch changes|what'?s changed|to install\b|see what'?s new)\b|^[0-9a-f]{7,40}\b[:\s-]/im;

async function maxId() {
  if (maxArg > 0) return maxArg;
  const password = process.env.ADMIN_PASSWORD || '';
  if (password) {
    const res = await fetch(`${origin}/api/admin/shipped`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${password}` },
      body: JSON.stringify({ action: 'sanitize-receipt-sublines', dryRun: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.maxId) return body.maxId;
  }
  let hi = 500;
  for (let probe = 50; probe <= 2000; probe *= 2) {
    const r = await fetch(`${origin}/api/shipped/receipts/${probe}`, { cache: 'no-store' });
    if (r.ok) hi = probe;
  }
  return hi;
}

const limit = await maxId();
const hits = [];

for (let id = 1; id <= limit; id++) {
  const apiRes = await fetch(`${origin}/api/shipped/receipts/${id}?t=${Date.now()}`, { cache: 'no-store' });
  if (!apiRes.ok) continue;
  const payload = await apiRes.json();
  const receipt = payload.receipt ?? payload;
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  for (const item of items) {
    if (!item?.name || item.name === 'YOUR POTENTIAL' || item.source === 'none') continue;
    if (!receiptItemSublineIsClean(item)) {
      hits.push({ id, via: 'api', name: item.name, description: item.description ?? '' });
    }
  }

  const pageRes = await fetch(`${origin}/r/${id}/`, { cache: 'no-store', headers: { 'user-agent': 'shipped-junk-scan' } });
  if (!pageRes.ok) continue;
  const html = await pageRes.text();
  const dataMatch = html.match(/id="shipped-receipt-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (dataMatch) {
    try {
      const embedded = JSON.parse(dataMatch[1]);
      for (const item of embedded.receipt?.items || []) {
        if (!item?.name || item.name === 'YOUR POTENTIAL' || item.source === 'none') continue;
        const desc = item.description ?? '';
        if (desc && (storedSublineLooksJunk(desc) || JUNK_PAGE.test(desc))) {
          hits.push({ id, via: 'page-json', name: item.name, description: desc });
        }
      }
    } catch {
      /* ignore parse */
    }
  }
  if (JUNK_PAGE.test(html) && !dataMatch) {
    hits.push({ id, via: 'page-html', name: '(html)', description: 'pattern match' });
  }
}

if (hits.length) {
  console.error(JSON.stringify({ ok: false, origin, scanned: limit, hits }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, origin, scanned: limit, hits: 0 }));
