#!/usr/bin/env node
// Serve the app first. All generation, verification, and sharing requests stay local.
// Usage: node scripts/check-shipped-ux.cjs [http://localhost:3000]
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const origin = process.argv[2] || 'http://localhost:3000';
const receiptId = 424201;
const candidates = [
  { kind: 'github', id: 'alex-river', display: 'Alex River', detail: 'GitHub · Builds developer tools in Portland' },
  { kind: 'github', id: 'alex-rivera', display: 'Alex Rivera', detail: 'GitHub · Independent app developer in Austin' },
];
const sponsors = { slots: [], frozen: false };
const receipt = {
  id: receiptId, version: 2, year: 2026, subject: candidates[1],
  printedAt: '2026-10-14T12:00:00.000Z', potential: false, demo: false, listed: false, full: true,
  note: 'Three ideas made it out into the world.', shipScore: 78,
  items: [
    { name: 'Pocket Fieldnotes', description: 'An offline notebook for field research.', date: '2026-02-11', status: 'LAUNCHED', link: 'https://example.com/fieldnotes', logo: null, source: 'github', significance: 3 },
    { name: 'Trailhead API', description: 'A small API for planning local walks.', date: '2026-06-08', status: 'RELEASED', link: 'https://example.com/trailhead', logo: null, source: 'github', significance: 2 },
    { name: 'Pocket Fieldnotes 2.0', description: 'Shared notebooks and accessible export.', date: '2026-09-21', status: 'SHIPPED', link: 'https://example.com/fieldnotes/releases', logo: null, source: 'github', significance: 2 },
  ],
};
const pile = ['Maya Chen', 'Alex Rivera', 'Jordan Brooks', 'Sam Okafor', 'Robin Lee', 'Taylor Morgan'].map((who, index) => ({
  id: 424190 + index, who, count: index + 2, potential: false, full: index % 2 === 0,
  printedAt: receipt.printedAt,
  items: [{ name: ['Tiny Garden', 'Pocket Fieldnotes', 'Launch Calendar', 'Transit Sketch', 'Quiet Reader', 'Campfire Notes'][index], status: 'LAUNCHED' }, { name: 'Accessibility improvements', status: 'RELEASED' }],
}));
const turnstile = `(() => {
  const widgets = new Map(); let next = 0;
  const state = window.__turnstile = { hold: true, executions: 0, pending: [], release() {
    state.hold = false;
    state.pending.splice(0).forEach(callback => callback('fixture-human-token'));
  } };
  window.turnstile = {
    render(element, options) { const id = String(++next); widgets.set(id, options); return id; },
    execute(id) { const callback = widgets.get(id)?.callback; state.executions++;
      if (callback) state.hold ? state.pending.push(callback) : setTimeout(() => callback('fixture-human-token'), 5);
    },
    reset() {}, remove(id) { widgets.delete(id); }
  };
})();`;

async function until(check, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

async function fixture(browser, viewport, mode = 'open') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const requests = { lookup: [], print: [], shared: [], unexpected: [] };
  const replies = { lookup: [], print: [] };
  const errors = [];
  await context.addInitScript(() => {
    window.__shares = [];
    window.__clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__clipboard.push(text); } } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
      window.__shares.push({ text: payload.text, url: payload.url, files: payload.files?.map(file => ({ name: file.name, type: file.type, size: file.size })) });
    } });
  });
  await context.route('**/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: turnstile }));
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const now = Date.now();
    if (path === '/api/shipped/state') return json({
      event: { name: 'Shipped 2026', phase: mode === 'closed' ? 'closed' : 'open', opensAt: now - 86400000, closesAt: now + 86400000 * 14, now },
      payments: { open: false, prints: false, provider: null, live: false, wallet: false, printCents: 500, lockMinutes: 10 },
      printed: 1284, shared: 351, shipped: 14, views: 8901, piled: 842, recent: [],
      generator: { enabled: mode !== 'offline', demo: false, reason: mode === 'offline' ? 'offline' : null, turnstileSiteKey: 'fixture-site-key', human: { kind: 'turnstile', siteKey: 'fixture-site-key' }, year: 2026, sources: ['github', 'web'] },
      sponsors,
    });
    if (path === '/api/shipped/lookup' || path === '/api/shipped/print') {
      const kind = path.split('/').at(-1);
      requests[kind].push(request.postDataJSON());
      const reply = replies[kind].shift() || (kind === 'lookup'
        ? { body: { candidates, auto: false } }
        : { body: { id: receiptId, receipt, sponsors, done: true } });
      if (reply.wait) await reply.wait;
      return json(reply.body, reply.status);
    }
    if (path === '/api/shipped/shared') {
      requests.shared.push(request.postDataJSON());
      return json({ ok: true });
    }
    if (path === '/api/shipped/pile') return json({ receipts: pile, total: 842, frozen: mode === 'closed', next: null });
    if (path === '/api/shipped/proof') return json({});
    if (path.startsWith('/api/shipped/receipts/')) return json({ receipt, sponsors });
    if (request.method() !== 'GET' && path.startsWith('/api/shipped/')) requests.unexpected.push(`${request.method()} ${path}`);
    return json({ ok: true });
  });
  // A real PNG lets the share flow construct and pass a File without contacting the receipt service.
  await context.route(`**/r/${receiptId}/receipt.png*`, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5Z8AAAAASUVORK5CYII=', 'base64') }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/shipped/`, { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('textbox', { name: 'Who are we printing for?', exact: true });
  await input.waitFor({ state: 'visible' });
  const form = input.locator('xpath=ancestor::form');
  const submit = form.locator('button[type="submit"]');
  if (mode === 'open') await until(() => submit.isEnabled(), 'Print button becomes available after state loads');
  else await page.getByRole('status').filter({ hasText: mode === 'closed' ? /This printing event has ended/ : /printer is temporarily offline/ }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(window.__turnstile));
  return { context, page, input, form, submit, requests, replies, errors };
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function assertBusy(f) {
  await until(() => f.input.isDisabled(), 'Input is disabled immediately while verification is pending');
  assert.ok(await f.input.isVisible(), 'Input stays visible while verifying');
  assert.ok(await f.submit.isDisabled(), 'Print button is disabled while verifying');
  assert.equal(await f.submit.getAttribute('aria-busy'), 'true', 'Verification exposes an accessible busy state');
  await until(() => f.page.evaluate(() => window.__turnstile.executions > 0), 'Verification started');
}

async function checkJourney(browser, viewport, name) {
  const f = await fixture(browser, viewport);
  const { page, input, submit, requests } = f;
  const heading = page.getByRole('heading', { name: 'Your year. On a receipt.', exact: true });
  assert.ok(await heading.isVisible(), 'A visible heading explains the page');
  const headingBox = await heading.boundingBox();
  assert.ok(headingBox.height > 20 && headingBox.width > 100, 'Heading is readable rather than screen-reader-only');
  assert.match(await submit.innerText(), /Print my receipt/i);
  const submitBox = await submit.boundingBox();
  assert.ok(submitBox.y + submitBox.height <= viewport.height, 'Print action is visible without scrolling');
  const listed = page.getByRole('checkbox', { name: 'Add my receipt to the public wall', exact: true });
  assert.ok(await listed.isChecked(), 'Public wall defaults on');
  const preview = page.getByRole('region', { name: 'Fresh off the printer', exact: true });
  const cards = preview.getByRole('link').filter({ hasText: /Open receipt/ });
  await until(async () => await cards.count() === 6, 'Six recent receipts load in the preview');
  for (let index = 0; index < pile.length; index++) {
    assert.equal(await cards.nth(index).getAttribute('href'), `/r/${pile[index].id}/`, 'Preview links directly to each receipt');
    assert.ok((await cards.nth(index).innerText()).includes(pile[index].who));
    const box = await cards.nth(index).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'Receipt preview cards fit the viewport');
  }
  await noOverflow(page, `${name} initial`);
  await page.screenshot({ path: `/tmp/shipped-ux-${name}-initial.png`, fullPage: true });

  await submit.click();
  await page.getByRole('alert').filter({ hasText: /Type a name/ }).waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), '');
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  const alertId = await page.getByRole('alert').filter({ hasText: /Type a name/ }).getAttribute('id');
  assert.ok((await input.getAttribute('aria-describedby')).split(' ').includes(alertId), 'Error is associated with the input');
  assert.ok(await input.evaluate(element => element === document.activeElement), 'Invalid input receives focus');
  assert.equal(requests.lookup.length, 0, 'Empty input never starts lookup');

  await input.fill('Alex River');
  await listed.uncheck();
  await input.press('Enter');
  await assertBusy(f);
  assert.equal(requests.lookup.length, 0, 'Lookup waits for verification');
  await page.keyboard.press('Enter');
  await submit.dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.__turnstile.executions), 1, 'Repeated submission does not mint another token');
  await page.evaluate(() => window.__turnstile.release());
  const choice = page.getByRole('button', { name: /Alex Rivera.*Independent app developer in Austin/ });
  await choice.waitFor({ state: 'visible' });
  assert.ok(await page.getByRole('button', { name: /Alex River.*Builds developer tools in Portland/ }).isVisible(), 'Ambiguous results contain person and disambiguating detail');
  assert.equal(await input.inputValue(), 'Alex River', 'Ambiguity preserves the typed query');
  assert.equal(requests.print.length, 0, 'Ambiguous lookup waits for a choice');
  await noOverflow(page, `${name} candidates`);
  let releasePrint;
  f.replies.print.push({ wait: new Promise(resolve => { releasePrint = resolve; }), body: { id: receiptId, receipt, sponsors, done: true } });
  await choice.click();
  try {
    await until(() => requests.print.length === 1, 'Candidate selection starts printing');
    assert.ok(await input.isVisible(), 'Input stays visible while printing');
    assert.ok(await input.isDisabled(), 'Input stays locked while printing');
    assert.ok(await submit.isDisabled(), 'Print stays locked while printing');
    assert.equal(await input.inputValue(), 'Alex River', 'Printing preserves the query');
    await noOverflow(page, `${name} printing`);
  } finally {
    releasePrint();
  }
  await page.getByRole('button', { name: 'Share this slip', exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  assert.deepEqual(requests.lookup, [{ q: 'Alex River' }]);
  assert.equal(requests.print.length, 1);
  assert.deepEqual(requests.print[0], { subject: { kind: 'github', id: 'alex-rivera', display: 'Alex Rivera' }, token: 'fixture-human-token', listed: false });
  assert.ok(await page.getByText('Pocket Fieldnotes', { exact: true }).first().isVisible(), 'The generated receipt renders its sourced work');
  await noOverflow(page, `${name} receipt`);

  await page.getByRole('button', { name: 'Share this slip', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: 'Share your receipt' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'COPY LINK', exact: true }).click();
  await until(() => page.evaluate(() => window.__clipboard.length === 1), 'Copy action writes the receipt URL');
  assert.equal(await page.evaluate(() => window.__clipboard[0]), `${origin}/r/${receiptId}/`);
  const post = new URL(await dialog.getByRole('link', { name: 'POST TO X' }).getAttribute('href'));
  assert.equal(post.searchParams.get('url'), `${origin}/r/${receiptId}/`);
  assert.match(post.searchParams.get('text'), /2026/);
  await dialog.getByRole('button', { name: 'SHARE IMAGE', exact: true }).click();
  await until(() => page.evaluate(() => window.__shares.length === 1), 'Image sharing invokes native share');
  const share = await page.evaluate(() => window.__shares[0]);
  assert.equal(share.url, `${origin}/r/${receiptId}/`);
  assert.equal(share.files[0].type, 'image/png');
  assert.ok(share.files[0].size > 0);
  await noOverflow(page, `${name} share dialog`);
  await page.screenshot({ path: `/tmp/shipped-ux-${name}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0, 'Escape closes sharing');
  await page.getByRole('button', { name: 'Print another', exact: true }).click();
  await input.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), '', 'Print another returns to an empty form');
  assert.equal(await listed.isChecked(), false, 'Print another keeps the wall preference');
  assert.deepEqual(requests.unexpected, [], 'No unmocked mutation endpoints called');
  assert.deepEqual(f.errors, [], 'No uncaught browser errors');
  await f.context.close();
  console.log(`PASS ${name}: validation, Enter, verification lock, ambiguity, receipt, sharing, reset, layout`);
}

async function checkRetries(browser) {
  const f = await fixture(browser, { width: 1440, height: 1000 });
  const { page, input, submit, requests, replies } = f;
  await page.evaluate(() => window.__turnstile.release());
  replies.lookup.push({ status: 503, body: { error: 'busy' } }, { body: { candidates: [candidates[1]], auto: true } }, { body: { candidates: [candidates[1]], auto: true } });
  replies.print.push({ status: 502, body: { error: 'ai-error' } });
  await input.fill('alex-rivera');
  await submit.click();
  await page.getByRole('alert').filter({ hasText: /Lots of people printing/ }).waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'alex-rivera', 'Lookup failure preserves query');
  assert.ok(await input.isEnabled(), 'Lookup failure allows editing and retry');
  await submit.click();
  await page.getByRole('alert').filter({ hasText: /Paper jam/ }).waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'alex-rivera', 'Print failure preserves query');
  assert.ok(await input.isEnabled(), 'Print failure allows editing and retry');
  await submit.click();
  await page.getByRole('button', { name: 'Share this slip', exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  assert.deepEqual(requests.lookup.map(request => request.q), ['alex-rivera', 'alex-rivera', 'alex-rivera']);
  assert.equal(requests.print.length, 2);
  assert.equal(requests.print[1].listed, true, 'Checked public wall preference is included in retry payload');
  assert.deepEqual(f.errors, []);
  assert.deepEqual(requests.unexpected, []);
  await f.context.close();
  console.log('PASS retry: lookup error, print error, preserved query, successful retry, public-wall payload');
}

async function checkUnavailable(browser) {
  for (const mode of ['closed', 'offline']) {
    const f = await fixture(browser, { width: 390, height: 844 }, mode);
    assert.ok(await f.input.isVisible(), `${mode}: the form remains visible`);
    assert.ok(await f.input.isDisabled(), `${mode}: input is disabled`);
    assert.ok(await f.submit.isDisabled(), `${mode}: print button is disabled`);
    assert.ok(await f.page.getByRole('checkbox', { name: 'Add my receipt to the public wall', exact: true }).isDisabled());
    await f.submit.dispatchEvent('click');
    await f.page.keyboard.press('Enter');
    assert.equal(f.requests.lookup.length, 0, `${mode}: unavailable state never starts lookup`);
    assert.equal(f.requests.print.length, 0, `${mode}: unavailable state never prints`);
    assert.ok(await f.page.getByRole('link', { name: /Explore the receipt wall/ }).isVisible(), `${mode}: visitors can still browse receipts`);
    await noOverflow(f.page, mode);
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }
  console.log('PASS unavailable: closed event with enabled generator, offline generator, browsing remains available');
}

async function checkLookupTimeout(browser) {
  const f = await fixture(browser, { width: 1440, height: 1000 });
  const { page, input, submit, replies, requests } = f;
  await page.evaluate(() => window.__turnstile.release());
  let releaseLookup;
  replies.lookup.push({ wait: new Promise(resolve => { releaseLookup = resolve; }), body: { candidates, auto: false } });
  await input.fill('Alex River');
  await submit.click();
  try {
    await until(() => requests.lookup.length === 1, 'Lookup started');
    assert.ok(await input.isDisabled());
    // Exercise the actual AbortSignal deadline; a network error is not a lookup timeout.
    await page.getByRole('alert').filter({ hasText: /That search took too long/ }).waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await input.inputValue(), 'Alex River', 'Lookup timeout preserves query');
    assert.ok(await input.isEnabled(), 'Lookup timeout releases the form');
    assert.ok(await input.evaluate(element => element === document.activeElement), 'Timeout returns focus to the input');
    assert.equal(requests.print.length, 0);
  } finally {
    releaseLookup();
  }
  await submit.click();
  await page.getByRole('button', { name: /Alex Rivera.*Independent app developer in Austin/ }).waitFor({ state: 'visible' });
  assert.deepEqual(requests.lookup.map(request => request.q), ['Alex River', 'Alex River']);
  assert.equal(await page.getByRole('alert').filter({ hasText: /That search took too long/ }).count(), 0, 'Retry clears the timeout message');
  assert.deepEqual(f.errors, []);
  await f.context.close();
  console.log('PASS timeout: real 15-second lookup deadline, focused preserved query, successful retry');
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    await checkJourney(browser, { width: 1440, height: 1000 }, 'desktop');
    await checkJourney(browser, { width: 390, height: 844 }, 'mobile');
    await checkRetries(browser);
    await checkUnavailable(browser);
    await checkLookupTimeout(browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
