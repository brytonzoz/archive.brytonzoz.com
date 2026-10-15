// Run: node --experimental-transform-types --no-warnings tests/shipped-wall.browser.cjs
// Requires Playwright and Chromium; all receipt data and images stay local.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = process.env.WALL_BROWSER_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-wall-browser-'));
fs.mkdirSync(ARTIFACTS, { recursive: true });
const sharp = require('sharp');
const { initWasm, Resvg } = require('@resvg/resvg-wasm');
const { createServer } = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright');

(async () => {
  const { yearRolloSvg } = await import(pathToFileURL(path.join(ROOT, 'lib/receipt-svg.ts')).href);
  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const fonts = ['Regular', 'SemiBold'].map(weight => fs.readFileSync(path.join(ROOT, `worker/fonts/IBMPlexMono-${weight}.ttf`)));
  const artifacts = new Map();
  for (let index = 0; index < 6; index++) {
    const itemCount = index === 2 ? 16 : index + 2;
    const svg = yearRolloSvg({
      year: 2026, number: String(120 - index).padStart(6, '0'), who: `Maker ${index + 1}`, date: 'OCT 15, 2026',
      items: Array.from({length: itemCount}, (_, i) => ({ name: i % 2 ? 'Tiny synth' : 'Field notes', status: i % 2 ? 'RELEASED' : 'PUBLISHED', description: 'A public project made and released this year.', date: 'OCT 15', logo: null })),
      count: itemCount, note: 'Made it real. Shipped it.', printedAt: '2026-10-15T10:00:00Z',
      sponsors: Array.from({length:10}, (_, slot) => ({slot, house:true, name:'YOUR AD HERE', cta:'Advertise on receipts', logo:null, qr:null})),
      url:'shipped.brytonzoz.com', barcode:[2,1,3,1,2,1,2,1,3,1,2], modules:[], badges:[], deepCut:null,
    });
    const render = new Resvg(svg, { font:{fontBuffers:fonts, defaultFontFamily:'IBM Plex Mono', loadSystemFonts:false} });
    const raster = render.render();
    artifacts.set(120-index, Buffer.from(raster.asPng()));
    raster.free(); render.free();
  }
  const fixture = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { ReceiptWall } from './components/shipped/wall/ReceiptWall'; import './app/shipped/receipt.css'; createRoot(document.getElementById('root')).render(<div className="shipped-page"><div className="shipped-stack"><ReceiptWall page={location.pathname === '/wall'} /></div></div>);`,
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, write: false, outdir: path.join(ARTIFACTS, 'fixture'),
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const js = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = fixture.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'application/javascript'); response.end(js); }
    else if (/^\/r\/\d+\/rollo.png$/.test(request.url)) { response.setHeader('content-type', 'image/png'); response.end(artifacts.get(Number(request.url.split('/')[2])) || artifacts.get(120)); }
    else if (request.url === '/mono.ttf') { response.setHeader('content-type', 'font/ttf'); response.end(fonts[0]); }
    else if (request.url === '/fixture.css') { response.setHeader('content-type', 'text/css'); response.end(css); }
    else { response.setHeader('content-type', 'text/html'); response.end('<style>@font-face{font-family:Mono;src:url(/mono.ttf)}*{box-sizing:border-box}body{margin:0}button{font:inherit}.shipped-page{--font-ui:Arial;--font-receipt:Mono}.shipped-stack{max-width:960px;margin:auto}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const rows = Array.from({ length: 48 }, (_, index) => ({ id: 120 - index, who: `Maker ${index + 1}`, count: index === 2 ? 16 : index < 6 ? index + 2 : 2, potential: false, items: [{ name: 'Field notes', status: 'published' }, { name: 'Tiny synth', status: 'released' }], printedAt: '2026-10-14T10:00:00Z' }));
  let failures = 0;
  async function check(name, test) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try { await test(page); assert.deepEqual(errors, []); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}; browser errors: ${JSON.stringify(errors)}`); }
    finally { await page.close(); }
  }
  try {
    await check('home has six real pins, true total, no pagination; lift and local crumple work', async page => {
      const calls = [];
      await page.route('**/api/shipped/state', route => route.fulfill({ json: { recent: [], piled: 48 } }));
      await page.route('**/api/shipped/pile*', route => { calls.push(new URL(route.request().url()).searchParams.toString()); return route.fulfill({ json: { receipts: rows.slice(0, 12), total: 48, next: 109, frozen: false } }); });
      await page.goto(`${origin}/home`);
      await page.locator('[data-wall-pin="120"]').waitFor();
      assert.equal(await page.locator('[data-wall-pin]').count(), 6);
      assert.equal(await page.locator('.shipped-wall-head p').textContent(), '48 pinned');
      assert.equal(await page.getByRole('link', { name: 'Open wall →' }).getAttribute('href'), '/wall/');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      assert.deepEqual(calls, ['limit=6']);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-wall-artifact]')].every(el => el.dataset.wallArtifact === 'ready'));
      const sizes = await page.locator('[data-wall-pin]').evaluateAll(pins => pins.map(pin => { const img=pin.querySelector('img'); const paper=pin.querySelector('article'); return {ratio:img.naturalHeight/img.naturalWidth, displayed:img.clientHeight/img.clientWidth, fits:paper.clientHeight>=img.clientHeight-2}; }));
      for(const size of sizes) { assert.ok(Math.abs(size.ratio-size.displayed)<0.02); assert.ok(size.fits); }
      await page.evaluate(() => window.scrollTo(0,0));
      await page.waitForTimeout(250);
      const screenshot = await page.screenshot({path:path.join(ARTIFACTS, 'shipped-real-wall-mobile-viewport.png')});
      // A loaded image can still be blank inside a transformed pin with forced async decoding.
      // Inspect the printed header pixels after leaving and returning to the first row.
      const imageBox = await page.locator('[data-wall-pin="120"] img').boundingBox();
      const patch = await sharp(screenshot).extract({left:Math.round(imageBox.x + imageBox.width * .15), top:Math.round(imageBox.y + 8), width:Math.round(imageBox.width * .7), height:40}).removeAlpha().raw().toBuffer();
      let ink = 0;
      for(let i=0;i<patch.length;i+=3) if(patch[i]<180 && patch[i+1]<180 && patch[i+2]<180) ink++;
      assert.ok(ink > 20, `first receipt must visibly paint its header, got ${ink} ink pixels`);
      await page.screenshot({path:path.join(ARTIFACTS, 'shipped-real-wall-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1000});
      await page.waitForTimeout(150);
      await page.screenshot({path:path.join(ARTIFACTS, 'shipped-real-wall-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-wall-pin="120"]').click();
      await page.getByRole('dialog', { name: "Maker 1's receipt" }).waitFor();
      await page.getByRole('link', {name:'Open receipt', exact:true}).waitFor();
      const actionBox = await page.getByRole('link', {name:'Open receipt', exact:true}).boundingBox(); assert.ok(actionBox.y >= 0 && actionBox.y + actionBox.height <= 844);
      await page.screenshot({path:path.join(ARTIFACTS, 'shipped-real-wall-focus.png'),fullPage:true});
      await page.getByRole('button', { name: 'Crumple', exact: true }).click();
      await page.getByRole('button', { name: 'Uncrumple', exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('shipped:wall:crumpled'))), [120]);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-wall-pin="120"]').getAttribute('data-crumpled'), 'true');
      await page.screenshot({ path: path.join(ARTIFACTS, 'shipped-physical-wall-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: path.join(ARTIFACTS, 'shipped-physical-wall-desktop.png'), fullPage: true });
    });
    await check('missing print image retains a usable receipt link', async page => {
      await page.route('**/api/shipped/state', route => route.fulfill({ json: { recent: [], piled: 1 } }));
      await page.route('**/api/shipped/pile*', route => route.fulfill({ json: { receipts: rows.slice(0, 1), total: 1, next: null } }));
      await page.route('**/r/*/rollo.png', route => route.fulfill({ status: 404, body: 'Missing' }));
      await page.goto(`${origin}/missing`);
      await page.getByText('Open receipt to view').waitFor();
      await page.locator('[data-wall-pin]').click();
      assert.equal(await page.getByRole('link', {name:'Open receipt', exact:true}).getAttribute('href'), '/r/120/');
      assert.equal(await page.getByRole('list', {name:'Receipt items'}).locator('li').count(), 2);
      await page.setViewportSize({width:320,height:640});
      const scroll = page.locator('[class*="focusScroll"]');
      assert.ok(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.getByRole('button', {name:'Crumple', exact:true}).click();
      assert.ok(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth));
    });
    await check('home fallback is also bounded to six', async page => {
      await page.route('**/api/shipped/state', route => route.fulfill({ json: { recent: rows.slice(0, 12), piled: 48 } }));
      await page.route('**/api/shipped/pile*', route => route.fulfill({ json: { receipts: [], total: 48, next: null, frozen: false } }));
      await page.goto(`${origin}/fallback`);
      await page.locator('[data-wall-pin="120"]').waitFor();
      assert.equal(await page.locator('[data-wall-pin]').count(), 6);
    });
    await check('full wall pages beyond the first batch', async page => {
      const calls = [];
      await page.route('**/api/shipped/state', route => route.fulfill({ json: { recent: [], piled: 48 } }));
      await page.route('**/api/shipped/pile*', route => {
        const query = new URL(route.request().url()).searchParams;
        calls.push(query.toString());
        return route.fulfill({ json: { receipts: query.has('before') ? rows.slice(24) : rows.slice(0, 24), total: 48, next: query.has('before') ? null : 97, frozen: false } });
      });
      await page.goto(`${origin}/wall`);
      await page.locator('[data-wall-pin="120"]').waitFor();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      assert.deepEqual(calls, ['limit=24', 'limit=24&before=97']);
      assert.equal(await page.getByRole('link', { name: 'Open wall →' }).count(), 0);
    });
    await check('empty state removes placeholders; error state retries successfully', async page => {
      let failed = false;
      await page.route('**/api/shipped/state', route => route.fulfill({ json: { recent: [], piled: 0 } }));
      await page.route('**/api/shipped/pile*', route => failed ? route.fulfill({ status: 503, body: '{}' }) : route.fulfill({ json: { receipts: [], total: 0, next: null, frozen: false } }));
      await page.goto(`${origin}/empty`);
      await page.getByText('No receipts pinned yet.').waitFor();
      assert.equal(await page.locator('.shipped-wall-skel').count(), 0);
      failed = true;
      await page.reload();
      await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
      failed = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByText('No receipts pinned yet.').waitFor();
    });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`Wall browser screenshots: ${ARTIFACTS}`);
  process.exitCode = failures ? 1 : 0;
})();
