#!/usr/bin/env node
// Serve the app first. Verification, bids, and checkout navigation are local fixtures only.
// Usage: node scripts/check-shipped-ads.cjs [http://localhost:3000]
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = process.argv[2] || 'http://localhost:3000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5Z8AAAAASUVORK5CYII=', 'base64');
const turnstile = `(() => {
  const widgets = new Map(); let serial = 0;
  const human = window.__adHuman = { hold: true, executions: 0, pending: [], release() {
    human.hold = false; human.pending.splice(0).forEach(done => done());
  } };
  window.turnstile = {
    render(element, options) { const id = String(++serial); widgets.set(id, options); return id; },
    execute(id) { const callback = widgets.get(id)?.callback;
      const token = 'ad-human-token-' + (++human.executions);
      if (callback) { const done = () => callback(token); human.hold ? human.pending.push(done) : setTimeout(done, 5); }
    },
    reset() {}, remove(id) { widgets.delete(id); }
  };
})();`;

async function until(check, message, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(message);
}

function makeState(mode) {
  const now = Date.now();
  const slots = Array.from({ length: 10 }, (_, slot) => ({
    slot, name: `HOUSE FIXTURE ${slot}`, cta: 'This house copy must stay hidden', url: 'https://example.org/house',
    qr: `house-${slot}`, logo: null, house: true, cents: 0, next: 100, maxNext: 100,
    impressions: 0, since: null, lastOutbid: null, holders: 0, serial: null, cooldownUntil: null,
    closesAt: now + 3600000,
  }));
  if (mode === 'paid') Object.assign(slots[1], {
    name: 'Trail Tools', cta: 'Tools for everyday trails', url: 'https://example.org/trails', qr: 'paid-trails',
    logo: '/fixture-paid-logo.png', house: false, cents: 500, next: 600, maxNext: 1000,
    since: now - 3600000, holders: 1, serial: 1,
  });
  return {
    event: { name: 'Shipped 2026', phase: 'open', opensAt: now - 86400000, closesAt: now + 14 * 86400000, now },
    payments: { open: mode !== 'blocked', prints: false, provider: 'sandbox', live: false, wallet: false, printCents: 500, lockMinutes: 0 },
    printed: 1284, shared: 351, shipped: 14, views: 8901, piled: 0, recent: [],
    generator: { enabled: true, demo: false, reason: null, turnstileSiteKey: 'fixture-site-key', human: { kind: 'turnstile', siteKey: 'fixture-site-key' }, year: 2026, sources: ['github'] },
    sponsors: { slots, frozen: mode === 'frozen' },
  };
}

async function fixture(browser, viewport, mode = 'empty') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const state = makeState(mode);
  const requests = { bids: [], unexpected: [], states: 0 };
  const replies = [];
  const errors = [];
  await context.addInitScript(() => { try { localStorage.setItem('bz.noTrack', '1'); } catch {} });
  await context.route('**/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: turnstile }));
  await context.route('**/fixture-paid-logo.png', route => route.fulfill({ contentType: 'image/png', body: png }));
  await context.route('**/__ad-checkout-fixture*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Local checkout fixture</h1>' }));
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/shipped/state') { requests.states++; return json(state); }
    if (path === '/api/shipped/pile') return json({ receipts: [], total: 0, frozen: state.sponsors.frozen, next: null });
    if (path === '/api/shipped/bid') {
      const form = await new Request(`${origin}/api/shipped/bid`, { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
      requests.bids.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : { name: value.name, type: value.type, size: value.size }])));
      const reply = replies.shift() || { body: { url: `${origin}/__ad-checkout-fixture?session=local` } };
      if (reply.wait) await reply.wait;
      reply.beforeReply?.();
      return json(reply.body, reply.status);
    }
    if (request.method() !== 'GET' && path.startsWith('/api/shipped/')) requests.unexpected.push(`${request.method()} ${path}`);
    return json({ ok: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/shipped/`, { waitUntil: 'domcontentloaded' });
  const board = page.getByRole('region', { name: 'Advertisement slots', exact: true });
  await board.waitFor({ state: 'visible' });
  await until(() => requests.states > 0, 'Live sponsor fixture loads');
  await until(() => page.getByRole('button', { name: 'Print your receipt for free', exact: true }).isEnabled(), 'Shared live state reaches the page');
  await page.waitForFunction(() => Boolean(window.__adHuman));
  return { context, page, board, state, requests, replies, errors };
}

async function editor(f, slot = 0) {
  await f.board.getByRole('button', { name: slot === 0 ? /^Wide ad —/ : new RegExp(`^Ad slot ${slot} —`) }).click();
  const dialog = f.page.getByRole('dialog', { name: 'Your ad, on the receipt', exact: true });
  await dialog.waitFor({ state: 'visible' });
  const preview = dialog.getByRole('region', { name: 'Receipt placement preview', exact: true });
  return {
    dialog, preview,
    name: dialog.getByLabel('Brand or project name', { exact: true }),
    cta: dialog.getByLabel('One line', { exact: false }),
    url: dialog.getByLabel('Website for your QR code', { exact: false }),
    logo: dialog.getByLabel('Upload logo', { exact: false }),
    terms: dialog.getByRole('checkbox'),
    submit: dialog.locator('button[type="submit"]'),
  };
}

async function fillAd(e) {
  await e.name.fill('Quiet Kit');
  await e.cta.fill('Small tools. Good days.');
  await e.url.fill('https://example.org/quiet-kit');
}

async function addLogo(page, input) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 48, 32);
    ctx.fillStyle = '#000'; ctx.fillRect(4, 4, 12, 24); ctx.fillRect(20, 4, 24, 10); ctx.fillRect(20, 18, 24, 10);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await input.setInputFiles({ name: 'quiet-kit.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
}

async function layout(page, dialog, label) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.document <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, `${label}: page has no horizontal overflow`);
  if (dialog) {
    const box = await dialog.boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= sizes.viewport + 1, `${label}: dialog fits viewport`);
    for (const input of await dialog.locator('input:not([type="checkbox"])').all()) {
      if (!await input.isVisible()) continue;
      const field = await input.boundingBox();
      assert.ok(field.x >= -1 && field.x + field.width <= sizes.viewport + 1, `${label}: fields are not clipped`);
    }
  }
}

async function artworkFits(slot, withLogo) {
  const frame = await slot.boundingBox();
  const images = withLogo ? slot.getByRole('img') : slot.getByRole('img', { name: /^QR code for/ });
  for (const image of await images.all()) {
    const box = await image.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, 'Selected ad artwork is visible');
    assert.ok(box.x >= frame.x - 1 && box.x + box.width <= frame.x + frame.width + 1 && box.y >= frame.y - 1 && box.y + box.height <= frame.y + frame.height + 1, 'Logo and QR fit inside the selected printed slot');
  }
}

async function checkEmptyJourney(browser, viewport, label, withLogo) {
  const f = await fixture(browser, viewport);
  const { page, board, requests } = f;
  assert.equal(await board.getByRole('button').count(), 10, 'All ten ad positions are selectable');
  assert.equal(await board.getByRole('button', { name: /— Empty — \$1$/ }).count(), 10, 'Every empty position starts at $1');
  assert.doesNotMatch(await board.innerText(), /HOUSE FIXTURE|This house copy|\$0/, 'House brand placeholders are not shown');
  assert.doesNotMatch(await page.locator('body').innerText(), /HOUSE FIXTURE|This house copy/, 'No house brands appear elsewhere on the receipt page');
  await page.screenshot({ path: `/tmp/shipped-ads-${label}-home.png`, fullPage: true });
  let e = await editor(f);
  assert.equal(await e.preview.locator('.shipped-paidby').count(), 1, 'Preview uses the receipt advertisement block');
  assert.equal(await e.preview.locator('[data-ad-slot="0"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await e.dialog.waitFor({ state: 'hidden' });
  const slot = withLogo ? 3 : 1;
  e = await editor(f, slot);
  await e.submit.click();
  await e.dialog.getByRole('alert').filter({ hasText: /Name it|name/i }).waitFor({ state: 'visible' });
  assert.equal(requests.bids.length, 0, 'Invalid input never starts checkout');
  await fillAd(e);
  const selected = e.preview.locator(`[data-ad-slot="${slot}"]`);
  assert.equal(await selected.getAttribute('aria-pressed'), 'true');
  assert.equal(await e.preview.locator('[aria-pressed="true"]').count(), 1, 'Exactly one placement is selected');
  assert.ok((await selected.innerText()).includes('Quiet Kit'));
  const qr = selected.getByRole('img', { name: 'QR code for Quiet Kit', exact: true });
  await qr.waitFor({ state: 'visible' });
  const firstPath = await qr.locator('path').getAttribute('d');
  await e.url.fill('https://example.org/quiet-kit-v2');
  await until(async () => await qr.locator('path').getAttribute('d') !== firstPath, 'QR updates when the destination changes');
  if (withLogo) {
    await addLogo(page, e.logo);
    await selected.getByRole('img', { name: 'Quiet Kit logo', exact: true }).waitFor({ state: 'visible' });
    assert.ok(await qr.isVisible(), 'Uploaded logo and QR remain visible together in the selected ad');
  }
  await artworkFits(selected, withLogo);
  await e.submit.click();
  await e.dialog.getByRole('alert').filter({ hasText: /terms/i }).waitFor({ state: 'visible' });
  assert.equal(requests.bids.length, 0, 'Terms must be accepted before checkout');
  await e.terms.check();
  await until(async () => await e.dialog.getByRole('alert').filter({ hasText: /terms/i }).count() === 0, 'Accepting terms clears its validation error');
  assert.match(await e.submit.innerText(), /Continue to checkout.*\$1\.00/);
  await layout(page, e.dialog, label);
  await page.screenshot({ path: `/tmp/shipped-ads-${label}-form.png`, fullPage: false });
  const seePreview = e.dialog.getByRole('button', { name: /See your ad on the receipt/ });
  if (await seePreview.isVisible()) await seePreview.click();
  await page.screenshot({ path: `/tmp/shipped-ads-${label}.png`, fullPage: false });
  let releaseResponse;
  f.replies.push({ wait: new Promise(resolve => { releaseResponse = resolve; }), status: 503, body: { error: 'checkout-failed' } });
  await e.submit.click();
  await until(() => e.submit.isDisabled(), 'Checkout locks immediately during verification').catch(async error => {
    throw new Error(`${error.message}; alerts: ${JSON.stringify(await e.dialog.getByRole('alert').allTextContents())}`);
  });
  await until(() => page.evaluate(() => window.__adHuman.executions === 1), 'Fresh human verification begins');
  assert.equal(requests.bids.length, 0, 'Bid waits for verification');
  await e.submit.dispatchEvent('click');
  await e.submit.locator('xpath=ancestor::form').evaluate(form => form.requestSubmit());
  assert.equal(await page.evaluate(() => window.__adHuman.executions), 1, 'Repeated submission does not start duplicate verification');
  await page.evaluate(() => window.__adHuman.release());
  try {
    await until(() => requests.bids.length === 1, 'Bid reaches the fixture after verification');
    assert.ok(await e.submit.isDisabled(), 'Checkout remains locked while the server responds');
  } finally { releaseResponse(); }
  await e.dialog.getByRole('alert').filter({ hasText: /Checkout didn.t open/ }).waitFor({ state: 'visible' });
  const first = requests.bids[0];
  assert.equal(first.slot, String(slot)); assert.equal(first.cents, '100'); assert.equal(first.terms, '1');
  assert.equal(first.name, 'Quiet Kit'); assert.equal(first.cta, 'Small tools. Good days.');
  assert.equal(first.url, 'https://example.org/quiet-kit-v2'); assert.equal(first.token, 'ad-human-token-1');
  if (withLogo) { assert.equal(first.logo.type, 'image/png'); assert.ok(first.logo.size > 0); }
  else assert.equal(first.logo, undefined, 'Logo is optional');
  assert.equal(await e.name.inputValue(), 'Quiet Kit', 'Checkout failure preserves the draft');
  await page.evaluate(() => { window.__adHuman.hold = true; });
  await e.submit.click();
  await until(() => page.evaluate(() => window.__adHuman.executions === 2), 'Retry requests a fresh human token');
  assert.equal(requests.bids.length, 1, 'Retry waits for its fresh token');
  await page.evaluate(() => window.__adHuman.release());
  await page.waitForURL(`${origin}/__ad-checkout-fixture?session=local`);
  assert.equal(requests.bids.length, 2); assert.equal(requests.bids[1].token, 'ad-human-token-2');
  assert.equal(requests.bids[1].cents, '100'); assert.equal(requests.bids[1].slot, String(slot));
  assert.deepEqual(f.errors, []); assert.deepEqual(requests.unexpected, []);
  await f.context.close();
  console.log(`PASS ads ${label}: ten empty slots, live QR${withLogo ? ' + logo' : ''}, validation, exact $1 placement, duplicate lock, fresh-token retry, local checkout`);
}

async function checkNarrow(browser) {
  const f = await fixture(browser, { width: 320, height: 844 });
  const e = await editor(f, 1);
  await fillAd(e); await addLogo(f.page, e.logo);
  const selected = e.preview.locator('[data-ad-slot="1"]');
  await selected.getByRole('img', { name: 'Quiet Kit logo', exact: true }).waitFor({ state: 'visible' });
  assert.ok(await selected.getByRole('img', { name: 'QR code for Quiet Kit', exact: true }).isVisible());
  await artworkFits(selected, true);
  await layout(f.page, e.dialog, '320px');
  await e.dialog.getByRole('button', { name: /See your ad on the receipt/ }).click();
  await f.page.screenshot({ path: '/tmp/shipped-ads-narrow.png', fullPage: false });
  await f.page.keyboard.press('Escape'); await e.dialog.waitFor({ state: 'hidden' });
  assert.equal(f.requests.bids.length, 0); assert.deepEqual(f.errors, []);
  await f.context.close();
  console.log('PASS ads narrow: 320px editor, selected logo + QR, keyboard dismissal, no overflow');
}

async function checkPaidAndFrozen(browser) {
  const f = await fixture(browser, { width: 1440, height: 1000 }, 'paid');
  assert.ok(await f.board.getByRole('button', { name: 'Ad slot 1 — Trail Tools — $6', exact: true }).isVisible());
  const e = await editor(f);
  await fillAd(e);
  const retained = e.preview.locator('[data-ad-slot="1"]');
  assert.ok((await retained.innerText()).includes('Trail Tools'), 'Existing paid advertiser remains in the preview');
  assert.ok(await retained.getByRole('img', { name: 'Trail Tools logo', exact: true }).isVisible());
  assert.ok(await retained.getByRole('img', { name: 'QR code for Trail Tools', exact: true }).isVisible());
  await retained.click();
  const lowest = e.dialog.getByRole('radio', { name: /Lowest.*\$6(?:\.00)?$/ });
  const highest = e.dialog.getByRole('radio', { name: /Highest.*\$10(?:\.00)?$/ });
  assert.ok(await lowest.isVisible(), 'Server minimum is retained'); assert.ok(await highest.isVisible(), 'Server maximum is retained');
  await highest.click();
  assert.match(await e.submit.innerText(), /\$10\.00/);
  await e.terms.check(); await f.page.evaluate(() => window.__adHuman.release());
  f.replies.push({ status: 409, beforeReply: () => { f.state.sponsors.frozen = true; }, body: { error: 'price-changed', price: 1100 } });
  await e.submit.click();
  await until(() => f.requests.bids.length === 1, 'Paid-slot bid reaches fixture');
  assert.equal(f.requests.bids[0].slot, '1'); assert.equal(f.requests.bids[0].cents, '1000', 'Highest server price is sent exactly');
  await until(() => f.requests.states >= 2, 'Price change refreshes sponsor state');
  await until(async () => await e.submit.count() === 0 || await e.submit.isDisabled(), 'Frozen refreshed state prevents checkout');
  const form = e.dialog.locator('form');
  if (await form.count()) await form.evaluate(element => element.requestSubmit());
  await f.page.waitForTimeout(150);
  assert.equal(f.requests.bids.length, 1, 'A stale form submission cannot bid after state freezes');
  assert.deepEqual(f.errors, []); assert.deepEqual(f.requests.unexpected, []);
  await f.context.close();
  console.log('PASS ads paid: retained real ad, server min/max, exact highest bid, refreshed frozen state blocks stale submission');
}

async function checkUnavailable(browser) {
  for (const mode of ['blocked', 'frozen']) {
    const f = await fixture(browser, { width: 390, height: 844 }, mode);
    const e = await editor(f);
    assert.ok(await e.submit.count() === 0 || await e.submit.isDisabled(), `${mode}: checkout is unavailable`);
    const form = e.dialog.locator('form');
    if (await form.count()) await form.evaluate(element => element.requestSubmit());
    await f.page.waitForTimeout(150);
    assert.equal(f.requests.bids.length, 0, `${mode}: stale interaction cannot create a bid`);
    assert.deepEqual(f.errors, []); await f.context.close();
  }
  console.log('PASS ads unavailable: payments blocked and frozen sponsors cannot create a bid');
}

async function checkExpiryDuringVerification(browser) {
  const f = await fixture(browser, { width: 390, height: 844 });
  const e = await editor(f);
  await fillAd(e); await e.terms.check(); await e.submit.click();
  await until(() => f.page.evaluate(() => window.__adHuman.executions === 1), 'Verification is pending');
  await f.page.clock.setSystemTime(Date.now() + 2 * 3600000);
  await f.page.evaluate(() => window.__adHuman.release());
  await until(async () => await e.submit.count() === 0 || await e.submit.getAttribute('aria-busy') !== 'true', 'Expired slot finishes verification without checkout');
  await f.page.waitForTimeout(150);
  assert.equal(f.requests.bids.length, 0, 'A slot that closes during verification cannot create a checkout');
  assert.deepEqual(f.errors, []); await f.context.close();
  console.log('PASS ads stale verification: a slot closing during the human check cannot POST a bid');
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    await checkEmptyJourney(browser, { width: 1440, height: 1000 }, 'desktop', true);
    await checkEmptyJourney(browser, { width: 390, height: 844 }, 'mobile', false);
    await checkNarrow(browser);
    await checkPaidAndFrozen(browser);
    await checkUnavailable(browser);
    await checkExpiryDuringVerification(browser);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
