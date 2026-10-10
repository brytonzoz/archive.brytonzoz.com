// Measure PRINT → first receipt line on staging (browser + Turnstile + POST /api/shipped/print).
// Usage: node scripts/measure-shipped-print-first-line.mjs [origin] query1 query2 ...
import { chromium } from 'playwright';

const origin = (process.argv[2] || 'https://shipped-staging.brytonzoz.com').replace(/\/+$/, '');
const queries = process.argv.slice(3);
if (!queries.length) {
  console.error('Pass at least one lookup query, e.g. node scripts/measure-shipped-print-first-line.mjs https://shipped-staging.brytonzoz.com jackfriks');
  process.exit(1);
}

const realItems = (receipt) => {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  return items.filter((item) => item && item.name && item.name !== 'YOUR POTENTIAL' && item.source !== 'none');
};

async function measureOne(page, query) {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#shipped-query', { timeout: 30_000 });
  await page.fill('#shipped-query', query);
  await page.waitForTimeout(500);
  await page.click('button.is-print', { timeout: 15_000 }).catch(() => undefined);
  const turnstile = page.locator('.shipped-turnstile-hit, .shipped-turnstile iframe');
  if (await turnstile.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    await turnstile.first().click({ timeout: 5_000 }).catch(() => undefined);
    const frame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]').first();
    await frame.locator('body').click({ timeout: 8_000, force: true }).catch(() => undefined);
  }

  const t0 = Date.now();
  const [printRes] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/shipped/print') && res.request().method() === 'POST', { timeout: 120_000 }),
    page.click('button.is-print'),
  ]);
  const firstJson = await printRes.json().catch(() => ({}));
  if (!printRes.ok && !firstJson.id) {
    return { query, error: firstJson.error || `print ${printRes.status}`, ms: Date.now() - t0 };
  }
  const id = firstJson.id;
  if (!id) return { query, error: 'no-id', ms: Date.now() - t0 };

  let items = realItems(firstJson.receipt);
  if (items.length > 0) {
    return { query, id, items: items.length, ms: Date.now() - t0, cached: Boolean(firstJson.cached) };
  }

  const pollEnd = Date.now() + 25_000;
  while (Date.now() < pollEnd) {
    const recRes = await page.request.get(`${origin}/api/shipped/receipts/${id}`);
    if (recRes.ok()) {
      const body = await recRes.json();
      const receipt = body.receipt ?? body;
      items = realItems(receipt);
      if (items.length > 0) {
        return {
          query,
          id,
          items: items.length,
          ms: Date.now() - t0,
          cached: Boolean(firstJson.cached),
          growing: Boolean(receipt.growing),
        };
      }
    }
    await page.waitForTimeout(200);
  }
  return { query, id, items: 0, ms: Date.now() - t0, error: 'first-line-timeout' };
}

const headed = process.env.SHIPPED_MEASURE_HEADED === '1' || process.env.DISPLAY;
const browser = await chromium.launch({
  headless: !headed,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

const rows = [];
for (const query of queries) {
  try {
    const row = await measureOne(page, query);
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (error) {
    const row = { query, error: error instanceof Error ? error.message : String(error) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  await page.waitForTimeout(2000);
}

await browser.close();
console.log(JSON.stringify({ origin, rows }, null, 2));
