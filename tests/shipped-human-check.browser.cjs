// Run with: node tests/shipped-human-check.browser.cjs
// Requires Playwright and Chromium in the browser-check environment. esbuild is
// provided by the repository's Wrangler dependency. Set CHROMIUM_PATH if needed.
// Never contacts the live printer or Cloudflare.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');

async function main() {
  const fixture = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { HumanCheck } from './components/shipped/HumanCheck';
        import { Turnstile } from './components/shipped/Turnstile';
        window.received = [];
        const onToken = value => window.received.push(value);
        const ref = value => { window.check = value; };
        const component = location.pathname === '/pow'
          ? <HumanCheck ref={ref} check={{ kind: 'pow', bits: 1 }} onToken={onToken} />
          : <Turnstile ref={ref} siteKey="test-only" onToken={onToken} />;
        createRoot(document.getElementById('root')).render(component);
      `,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  let challenges = 0;
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('content-type', 'application/javascript');
      response.end(fixture.outputFiles[0].text);
    } else if (request.url === '/api/shipped/challenge') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ challenge: `test-${++challenges}`, bits: 1 }));
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<div id="root"></div><script src="/fixture.js"></script>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  let failures = 0;

  async function check(name, test) {
    const page = await browser.newPage();
    try {
      await page.route('**/*', (route) => {
        if (route.request().url().startsWith(origin)) return route.continue();
        return route.abort();
      });
      await page.addInitScript(() => {
        if (location.pathname === '/network') return;
        let serial = 0;
        const widgets = new Map();
        window.turnstile = {
          render: (element, options) => {
            const id = String(++serial);
            widgets.set(id, options);
            window.latestChallenge = options;
            return id;
          },
          reset: () => {},
          remove: (id) => widgets.delete(id),
          execute: () => {},
        };
      });
      await test(page);
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  try {
    await check('POW execute mints a fresh proof after the background proof completed', async (page) => {
      await page.goto(`${origin}/pow`);
      await page.waitForFunction(() => window.received.some((value) => value?.startsWith('pow:')));
      const background = await page.evaluate(() => window.received.find(Boolean));
      await page.evaluate(() => { window.check.execute().then((value) => { window.result = value; }); });
      await page.waitForFunction(() => window.result !== undefined, null, { timeout: 2000 }).catch(() => {});
      const first = await page.evaluate(() => window.result);
      assert.match(first ?? '', /^pow:test-\d+:\d+$/, 'execute must resolve with proof instead of waiting on an already completed puzzle');
      assert.notEqual(first, background, 'execute must not reuse a potentially spent background proof');
      await page.evaluate(() => {
        delete window.result;
        window.check.execute().then((value) => { window.result = value; });
      });
      await page.waitForFunction(() => window.result !== undefined, null, { timeout: 2000 });
      assert.notEqual(await page.evaluate(() => window.result), first, 'a second execution needs a fresh challenge');
    });

    await check('Turnstile stops after 20 seconds and can retry', async (page) => {
      await page.goto(`${origin}/turnstile`);
      await page.waitForFunction(() => window.check && window.latestChallenge);
      await page.clock.install();
      await page.evaluate(() => { window.check.execute().then((value) => { window.result = value; }); });
      await page.clock.runFor(20_100);
      assert.equal(await page.evaluate(() => window.result), null, 'an unanswered challenge must return null at its deadline');
      await page.evaluate(() => {
        window.check.reset();
        delete window.result;
      });
      await page.evaluate(() => { window.check.execute().then((value) => { window.result = value; }); });
      await page.clock.runFor(100);
      await page.evaluate(() => window.latestChallenge.callback('fresh-retry-proof'));
      assert.equal(await page.evaluate(() => window.result), 'fresh-retry-proof');
    });

    await check('managed Turnstile interaction can still complete before the deadline', async (page) => {
      await page.goto(`${origin}/turnstile`);
      await page.waitForFunction(() => window.check && window.latestChallenge);
      await page.clock.install();
      await page.evaluate(() => { window.check.execute().then((value) => { window.result = value; }); });
      await page.clock.runFor(4_200);
      assert.equal(await page.evaluate(() => window.latestChallenge.appearance), 'always');
      await page.evaluate(() => window.latestChallenge.callback('managed-proof'));
      assert.equal(await page.evaluate(() => window.result), 'managed-proof');
      await page.clock.runFor(20_000);
      assert.equal(await page.evaluate(() => window.result), 'managed-proof', 'completed checks must not later time out');
    });

    await check('Turnstile retries a failed script download after the network returns', async (page) => {
      let restored = false;
      let attempts = 0;
      await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => {
        attempts++;
        if (!restored) return route.abort('failed');
        return route.fulfill({
          contentType: 'application/javascript',
          body: `window.turnstile = {
            render: (element, options) => { window.latestChallenge = options; return 'restored'; },
            reset: () => {}, remove: () => {},
            execute: () => window.latestChallenge.callback('restored-network-proof')
          };`,
        });
      });
      await page.goto(`${origin}/network`);
      await page.getByRole('button', { name: 'Tap to verify' }).waitFor();
      const failedAttempts = attempts;
      restored = true;
      await page.evaluate(() => { window.check.reset(); });
      await page.evaluate(() => { window.check.execute().then((value) => { window.result = value; }); });
      await page.waitForFunction(() => window.result !== undefined, null, { timeout: 2000 }).catch(() => {});
      assert.ok(attempts > failedAttempts, 'retry must request a new script instead of reusing the failed element');
      assert.equal(await page.evaluate(() => window.result), 'restored-network-proof');
    });

    await check('failed Turnstile preload and warm never produce uncaught rejections', async (page) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}/network`);
      await page.getByRole('button', { name: 'Tap to verify' }).waitFor();
      await page.clock.install();
      // Let any mount-triggered retry settle before warming an idle failed loader.
      await page.clock.runFor(8_200);
      await page.evaluate(() => { window.check.warm(); });
      await page.clock.runFor(8_200);
      assert.deepEqual(errors, [], 'background preparation must handle loader failures');
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
