import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const { applyPrintChunk, isReceiptOpen, openCheckout, parsePrintLine, readPrintResponse } = await import('../components/shipped/print-stream.ts');
const { receiptToDoc } = await import('../components/shipped/thermal/layout.ts');

const receipt = {
  id: 17,
  version: 2,
  year: 2026,
  subject: { kind: 'github', id: 'truell20', display: 'Michael Truell' },
  printedAt: '2026-10-10T00:00:00.000Z',
  items: [{ name: 'Cursor', description: 'The editor', date: '2026-01-01', status: 'LAUNCHED', link: null, logo: null, source: 'web', confidence: 0.7 }],
  note: 'Keep going.',
  potential: false,
  demo: false,
  listed: true,
};

test('a print ack with only id is finished; growing / provisional / pending / upgrading stay open', () => {
  assert.equal(isReceiptOpen({ id: 17, pile: 'x' }), false);
  assert.equal(isReceiptOpen({ id: 17, growing: true }), true);
  assert.equal(isReceiptOpen({ id: 17, provisional: true }), true);
  assert.equal(isReceiptOpen({ id: 17, pending: true }), true);
  assert.equal(isReceiptOpen({ receipt: { ...receipt, growing: true }, sponsors: { slots: [], frozen: false } }), true);
  assert.equal(isReceiptOpen({ receipt: { ...receipt, upgrading: true }, sponsors: { slots: [], frozen: false } }), true);
  assert.equal(isReceiptOpen({ receipt: { ...receipt, provisional: true }, sponsors: { slots: [], frozen: false } }), true);
  assert.equal(isReceiptOpen({ id: 17, done: true, provisional: true }), false);
});

test('later stream chunks append items onto the same receipt', () => {
  const first = applyPrintChunk(null, { id: 17, provisional: true, receipt: { ...receipt, items: [receipt.items[0]] } });
  assert.equal(first?.receipt.items.length, 1);
  assert.equal(first?.receipt.provisional, true);
  const next = applyPrintChunk(first, {
    id: 17,
    done: true,
    items: [
      receipt.items[0],
      { ...receipt.items[0], name: 'Cursor 3' },
    ],
  });
  assert.equal(next?.receipt.items.length, 2);
  assert.equal(next?.receipt.provisional, false);
  assert.equal(next?.receipt.items[1].name, 'Cursor 3');
});

test('NDJSON and SSE lines parse; junk is ignored', () => {
  assert.deepEqual(parsePrintLine('{"id":17,"provisional":true}'), { id: 17, provisional: true });
  assert.deepEqual(parsePrintLine('data: {"id":17,"done":true}'), { id: 17, done: true });
  assert.equal(parsePrintLine('data: [DONE]'), null);
  assert.equal(parsePrintLine('not json'), null);
});

test('readPrintResponse walks a streamed body and a single JSON object', async () => {
  const chunks = [];
  const stream = new Response('{"id":1,"provisional":true}\n{"id":1,"done":true}\n', {
    headers: { 'content-type': 'application/x-ndjson' },
  });
  const last = await readPrintResponse(stream, (chunk) => chunks.push(chunk));
  assert.equal(chunks.length, 2);
  assert.equal(last.done, true);

  const ones = [];
  await readPrintResponse(new Response(JSON.stringify({ id: 9, pile: 'p' }), { headers: { 'content-type': 'application/json' } }), (chunk) => ones.push(chunk));
  assert.equal(ones[0].id, 9);
});

test('the tape and the DOM copy keep ITEMS SHIPPED · SCORE and drop the status tilde', () => {
  const doc = receiptToDoc({
    id: 'r17',
    year: 2026,
    who: 'Michael Truell',
    date: '10 OCT 2026',
    number: '000017',
    items: [{ name: 'Cursor', status: 'LAUNCHED', date: 'FEB 24', description: 'AI', confidence: 0.4 }],
    count: 1,
    note: 'Note.',
    paidBy: ['HOUSE'],
    barcode: 'SH000017',
    shipScore: 80,
  });
  assert.match(doc.text, /ITEMS SHIPPED · SCORE 80/);
  assert.doesNotMatch(doc.text, /LAUNCHED~/);
  assert.doesNotMatch(doc.text, /LAUNCHED ~/);

  const year = fs.readFileSync(new URL('../components/shipped/YearReceipt.tsx', import.meta.url), 'utf8');
  assert.match(year, /ITEMS SHIPPED/);
  assert.match(year, /shipped-totals-end/);
  assert.match(year, /SCORE \{props\.shipScore\}/);
  assert.match(year, /block opacity-60/);
  assert.equal(year.includes('opacity-40">'), false);
  assert.doesNotMatch(year, /sr-only">: /);
});

test('checkout always stands on /r/<id>/ in the same tab', () => {
  const calls = [];
  globalThis.window = {
    location: { pathname: '/', assign: (url) => calls.push(['assign', url]) },
  };
  globalThis.history = {
    pushState: (...args) => calls.push(['push', ...args]),
  };
  openCheckout('https://checkout.stripe.com/c/pay/cs_test', 17);
  assert.equal(calls[0][0], 'push');
  assert.equal(calls[0][3], '/r/17/');
  assert.deepEqual(calls[1], ['assign', 'https://checkout.stripe.com/c/pay/cs_test']);
  delete globalThis.window;
  delete globalThis.history;
});

test('after a print the stage auto-tears; sponsors stay collapsed; Turnstile has a visible fallback', () => {
  const stage = fs.readFileSync(new URL('../components/shipped/ShippedStage.tsx', import.meta.url), 'utf8');
  assert.match(stage, /currentRef\.current/);
  assert.match(stage, /setTearSignal/);
  assert.match(stage, /pageshow/);
  assert.match(stage, /readPrintResponse/);
  assert.doesNotMatch(stage, /opening\.kind === 'loaded' && !touched\.current/);

  const board = fs.readFileSync(new URL('../components/shipped/SponsorBoard.tsx', import.meta.url), 'utf8');
  assert.match(board, /useState\(false\)/);
  assert.match(board, /On the tape/);
  assert.match(board, /shipped-board-stack/);
  assert.match(board, /spots · from/);
  assert.doesNotMatch(board, /shipped-board-marks/);

  assert.match(stage, /SponsorBoard/);
  assert.match(stage, /DeskPins/);
  assert.match(stage, /shipped-clock-k/);
  const home = fs.readFileSync(new URL('../app/shipped/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /SponsorBoard/);

  const feel = fs.readFileSync(new URL('../components/shipped/feel.ts', import.meta.url), 'utf8');
  assert.match(feel, /pressPrint/);
  assert.match(feel, /pressTear/);
  assert.match(feel, /pressTick/);

  const css = fs.readFileSync(new URL('../app/shipped/receipt.css', import.meta.url), 'utf8');
  assert.match(css, /\.shipped-board-panel \{[\s\S]*max-height: 0;/);
  assert.match(css, /\.shipped-pill-root\.is-open/);
  assert.match(css, /\.shipped-turnstile\.is-challenge/);

  const turnstile = fs.readFileSync(new URL('../components/shipped/Turnstile.tsx', import.meta.url), 'utf8');
  assert.match(turnstile, /Tap to verify/);
  assert.match(turnstile, /askToVerify|setChallenge\(true\)/);
  assert.match(turnstile, /api\.current\.reset/);
  assert.match(turnstile, /spent/);

  assert.match(stage, /forgetTorn\(\)/);
  assert.match(stage, /human\.current\?\.reset\(\)/);
  assert.match(stage, /humanToken = token \?\? \(await human/);
  assert.match(stage, /const humanToken = \(await human\.current\?\.execute\(\)\)/);

  assert.match(css, /\.shipped-out \{[\s\S]*pointer-events: none;/);
  const wall = fs.readFileSync(new URL('../components/shipped/wall/ReceiptWall.tsx', import.meta.url), 'utf8');
  assert.match(wall, /useState\(320\)/);
  assert.doesNotMatch(wall, /typeof window === 'undefined' \? 320/);

  const machine = fs.readFileSync(new URL('../components/shipped/Machine.tsx', import.meta.url), 'utf8');
  assert.match(machine, /printed \+ line/);
  assert.match(machine, /stepMs/);
  assert.match(machine, /pressPrint/);
  assert.match(machine, /pressTear/);
  assert.match(machine, /pressTick/);
  assert.match(machine, /--burn/);
  assert.match(machine, /--inked/);
  assert.match(machine, /tearRevealClip/);
  assert.match(machine, /is-lifting/);
  assert.match(machine, /strokeHead|257%/);

  const stagePrinted = fs.readFileSync(new URL('../components/shipped/ShippedStage.tsx', import.meta.url), 'utf8');
  assert.match(stagePrinted, /720/);
});

test('shared receipt pages are the hero; DATE/RECEIPT pairs do not collide; checkout returns to the same receipt', () => {
  const stage = fs.readFileSync(new URL('../components/shipped/ShippedStage.tsx', import.meta.url), 'utf8');
  assert.match(stage, /is-shared/);
  assert.match(stage, /Print yours/);
  assert.match(stage, /hero=\{shared\}/);

  const paper = fs.readFileSync(new URL('../components/shipped/paper.tsx', import.meta.url), 'utf8');
  assert.match(paper, /shipped-lead-k/);
  assert.match(paper, /shipped-lead-v/);

  const css = fs.readFileSync(new URL('../app/shipped/receipt.css', import.meta.url), 'utf8');
  assert.match(css, /--shipped-pill-stack: 120px/);
  assert.match(css, /text-wrap: balance/);
  assert.match(css, /grid-template-areas:/);
  assert.match(css, /shipped-board-stack/);
  assert.match(css, /shipped-clock-k/);
  assert.match(css, /shipped-desk-pin/);
  assert.match(css, /\.shipped-printer\.is-hero \.shipped-printer-body/);
  assert.match(css, /\.shipped-printer\.is-hero \.shipped-tilt\.is-more::after/);
  assert.match(css, /\.shipped-printer\.is-hero \.shipped-tilt[\s\S]*overflow: visible/);
  assert.doesNotMatch(css, /100svh - 72px/);

  const pay = fs.readFileSync(new URL('../worker/shipped.ts', import.meta.url), 'utf8');
  assert.match(pay, /\/r\/\$\{id\}\/\?paid=\{CHECKOUT_SESSION_ID\}/);
  assert.match(pay, /\/r\/\$\{id\}\/\?canceled=1/);
  const pngStart = pay.indexOf('function png');
  const pngFn = pay.slice(pngStart, pay.indexOf('\n}', pngStart) + 2);
  assert.match(pngFn, /default-src 'none'/);
  assert.doesNotMatch(pngFn, /sandbox/);
  const guard = fs.readFileSync(new URL('../worker/shipped-guard.ts', import.meta.url), 'utf8');
  assert.match(guard, /IMAGE_CSP/);
  assert.match(guard, /type\.startsWith\('image\/'\)/);

  assert.match(css, /100svh - 7\.5rem/);
  assert.match(css, /\.shipped-wall-focus-canvas\.is-on/);

  const visitor = fs.readFileSync(new URL('../components/shipped/visitor.tsx', import.meta.url), 'utf8');
  assert.match(visitor, /This slip/);
  assert.match(visitor, /params\.get\('paid'\)/);
  assert.match(visitor, /canceled/);

  const human = fs.readFileSync(new URL('../components/shipped/HumanCheck.tsx', import.meta.url), 'utf8');
  assert.match(human, /setNeeded/);
  assert.match(human, /warm:/);

  const turnstile = fs.readFileSync(new URL('../components/shipped/Turnstile.tsx', import.meta.url), 'utf8');
  assert.match(turnstile, /api\.current\.execute/);
  assert.match(turnstile, /api\.current\.reset/);
  assert.match(turnstile, /minting/);
  assert.doesNotMatch(turnstile, /if \(token\.current && !spent\.current\)/);

  const machine = fs.readFileSync(new URL('../components/shipped/Machine.tsx', import.meta.url), 'utf8');
  assert.match(machine, /phase === 'torn' && !focus && !hero \? ' is-scroll'/);
  assert.match(machine, /type="button"/);
  assert.match(machine, /desk\.onPrint\(\)/);
  assert.match(machine, /onWarm/);
  assert.match(machine, /desk\?\.retry/);
  assert.doesNotMatch(machine, /!desk\.retry &&/);

  assert.match(stage, /humanToken = token \?\?/);
  assert.match(stage, /human\.current\?\.warm/);
  assert.match(stage, /is-retry/);

  const sound = fs.readFileSync(new URL('../components/shipped/sound.ts', import.meta.url), 'utf8');
  assert.match(sound, /allowSound/);
  assert.match(sound, /!gestured/);
});

test('item titles wrap, marks do not tile, keys read in one second, counters stay dotted until live', () => {
  const css = fs.readFileSync(new URL('../app/shipped/receipt.css', import.meta.url), 'utf8');
  const name = css.match(/\.shipped-item-name \{[^}]+\}/)?.[0] ?? '';
  assert.doesNotMatch(name, /line-clamp/);
  assert.doesNotMatch(name, /-webkit-box/);
  assert.match(css, /\.shipped-odo\.is-wait/);
  assert.match(css, /\.shipped-item-name \.shipped-link:active/);
  assert.match(css, /underline dotted/);
  assert.match(css, /\.shipped-thermal\[hidden\]/);
  assert.match(css, /\.shipped-group-head/);

  const year = fs.readFileSync(new URL('../components/shipped/YearReceipt.tsx', import.meta.url), 'utf8');
  assert.match(year, /logoPlacement/);
  assert.match(year, /ThermalMark/);
  assert.doesNotMatch(year, /<img[^>]*shipped-item-logo/);

  const machine = fs.readFileSync(new URL('../components/shipped/Machine.tsx', import.meta.url), 'utf8');
  assert.match(machine, /SpeakerIcon/);
  assert.match(machine, /ON WALL/);
  assert.match(machine, /OFF WALL/);
  assert.doesNotMatch(machine, /SND ON|SND OFF|KEEP OFF/);

  const ticker = fs.readFileSync(new URL('../components/shipped/Ticker.tsx', import.meta.url), 'utf8');
  assert.match(ticker, /is-wait/);
  assert.match(ticker, /ready \? state\.printed : null/);
  assert.doesNotMatch(ticker, /state\?\.printed \?\? 0/);
});
