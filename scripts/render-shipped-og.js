// Renders the first /shipped scene at 1200x630 for its link preview (public/og-shipped.jpg).
// Usage: node scripts/render-shipped-og.js <origin> [out]
// The origin is a running server for the built site (for example `npm run build`, then
// `cd out && python3 -m http.server 8816`, then `node scripts/render-shipped-og.js http://localhost:8816`).
const { chromium } = require('playwright');
const origin = process.argv[2];
const out = process.argv[3] || 'public/og-shipped.jpg';
if (!origin) throw new Error('usage: node scripts/render-shipped-og.js <origin> [out]');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${origin}/shipped/`, { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  await page.addStyleTag({ content: '.shipped-home, .scene-dots { display: none !important; }' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, type: 'jpeg', quality: 86 });
  await browser.close();
  console.log('saved', out);
})();
