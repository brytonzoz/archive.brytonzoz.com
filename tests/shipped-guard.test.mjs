import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryD1, requestFrom } from './d1.mjs';

const guard = await import('../worker/shipped-guard.ts');
const { LIMITS, HOUR, MINUTE } = guard;

test('per-IP rate limit: the 9th print from one address in an hour is refused, the next hour is fresh', async () => {
  const db = memoryD1();
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  const results = [];
  for (let i = 0; i < LIMITS.print.ip + 1; i++) results.push(await guard.overLimit(db, requestFrom('203.0.113.7'), 'print', now));
  assert.deepEqual(results, [...Array(LIMITS.print.ip).fill(false), true]);
  assert.equal(await guard.overLimit(db, requestFrom('198.51.100.9'), 'print', now), false, 'someone else is unaffected');
  assert.equal(await guard.overLimit(db, requestFrom('203.0.113.7'), 'print', now + HOUR), false, 'a new window');
});

test('per-subnet rate limit: rotating addresses inside one /24 (or IPv6 /48) still runs out', async () => {
  const db = memoryD1();
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  let refused = 0;
  for (let i = 1; i <= LIMITS.print.subnet + 5; i++) if (await guard.overLimit(db, requestFrom(`203.0.113.${i}`), 'print', now)) refused++;
  assert.equal(refused, 5);
  assert.equal(guard.subnetOf('2001:db8:abcd:1::1'), guard.subnetOf('2001:db8:abcd:ffff::2'));
  assert.notEqual(guard.subnetOf('2001:db8:abcd::1'), guard.subnetOf('2001:db8:abce::1'));
  assert.equal(guard.subnetOf('203.0.113.250'), '203.0.113.0/24');
});

test('atLimit checks without counting (admin logins count only failures)', async () => {
  const db = memoryD1();
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  for (let i = 0; i < 20; i++) assert.equal(await guard.atLimit(db, requestFrom('192.0.2.1'), 'admin', now), false);
  for (let i = 0; i < LIMITS.admin.ip; i++) await guard.overLimit(db, requestFrom('192.0.2.1'), 'admin', now);
  assert.equal(await guard.atLimit(db, requestFrom('192.0.2.1'), 'admin', now), true);
});

test('IP addresses are never stored, only salted daily hashes', async () => {
  const db = memoryD1();
  await guard.overLimit(db, requestFrom('203.0.113.7'), 'lookup');
  const keys = db.raw.prepare('SELECT key FROM shipped_limits').all().map((row) => row.key);
  assert.equal(keys.length, 2);
  for (const key of keys) assert.equal(key.includes('203.0.113'), false, key);
  assert.notEqual(await guard.hashedKey('203.0.113.7', '2026-10-14'), await guard.hashedKey('203.0.113.7', '2026-10-15'));
});

test('global print limits: per minute and per day across everyone', async () => {
  const db = memoryD1();
  const env = { SHIPPED_PRINTS_PER_MINUTE: '3', SHIPPED_DAILY_PRINTS: '4' };
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(await guard.overGlobalPrintLimit(db, env, now));
  assert.deepEqual(seen, [null, null, null, 'minute']);
  assert.equal(await guard.overGlobalPrintLimit(db, env, now + MINUTE), null);
  assert.equal(await guard.overGlobalPrintLimit(db, env, now + 2 * MINUTE), 'day');
});

test('locks: one holder at a time, stale locks can be retaken, concurrency slots run out', async () => {
  const db = memoryD1();
  const now = 1_000_000;
  assert.equal(await guard.acquire(db, 'subject:x:levelsio', 1000, now), true);
  assert.equal(await guard.acquire(db, 'subject:x:levelsio', 1000, now + 10), false);
  assert.equal(await guard.acquire(db, 'subject:x:levelsio', 1000, now + 1001), true, 'stale');
  const env = { SHIPPED_MAX_CONCURRENT: '2' };
  const a = await guard.concurrencySlot(db, env, 60_000, now);
  const b = await guard.concurrencySlot(db, env, 60_000, now);
  assert.ok(a && b && a !== b);
  assert.equal(await guard.concurrencySlot(db, env, 60_000, now), null);
  await guard.release(db, a);
  assert.ok(await guard.concurrencySlot(db, env, 60_000, now));
});

test('cycle budget: $180 from the 8th plus 80% of this cycle settled sales; missing sales tables are $0', async () => {
  const budget = await import('../lib/shipped-budget.ts');
  const oct9 = Date.UTC(2026, 9, 9, 15);
  const oct7 = Date.UTC(2026, 9, 7, 15);
  assert.deepEqual(budget.cycleBounds(oct9), {
    start: '2026-10-08',
    end: '2026-11-08',
    startMs: Date.UTC(2026, 9, 8),
    endMs: Date.UTC(2026, 10, 8),
  });
  assert.equal(budget.cycleBounds(oct7).start, '2026-09-08');
  assert.equal(budget.cycleRowKey(oct9), 'c:2026-10-08');
  assert.equal(budget.cycleCapMicros(180, 0), 180_000_000);
  assert.equal(budget.cycleCapMicros(180, 10_000), 260_000_000, '$100 net this cycle → +$80');
  assert.equal(budget.stripeFeeCents(5000), 175);
  assert.equal(budget.saleNetCents(5000, 0), 4825);
  assert.equal(budget.budgetAlertLevel(90_000_000, 180_000_000), 50);
  assert.equal(budget.budgetAlertLevel(144_000_000, 180_000_000), 80);
  assert.equal(budget.budgetAlertLevel(180_000_000, 180_000_000), 100);
  assert.equal(budget.budgetAlertLevel(0, 180_000_000), 0);

  const empty = memoryD1();
  assert.equal(await guard.cycleBudgetCap(null, {}), null, 'no database still fails closed');
  assert.equal(await guard.cycleBudgetCap(empty, {}, oct9), 180_000_000, 'missing sales tables count as $0 sales, not a dead printer');

  const db = memoryD1();
  db.raw.exec(`CREATE TABLE shipped_bids (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  db.raw.exec(`CREATE TABLE print_orders (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  assert.equal(await guard.cycleBudgetCap(db, {}, oct9), 180_000_000, 'first cycle, no sales');
  const lastCycle = Date.UTC(2026, 8, 20);
  const thisCycle = oct9;
  db.raw.exec(`INSERT INTO shipped_bids (status, amount_cents, total_cents, refund_cents, paid_at) VALUES
    ('live', 5000, 5000, 0, ${thisCycle}),
    ('outbid', 2000, 2000, 800, ${thisCycle}),
    ('lost', 9000, 9000, 9000, ${thisCycle}),
    ('checkout', 1000, NULL, NULL, NULL),
    ('live', 4000, 4000, 0, ${lastCycle})`);
  db.raw.exec(`INSERT INTO print_orders (status, amount_cents, total_cents, refund_cents, paid_at) VALUES
    ('to_print', 500, 500, 0, ${thisCycle})`);
  const net =
    budget.saleNetCents(5000, 0) + budget.saleNetCents(2000, 800) + budget.saleNetCents(500, 0);
  assert.equal(await guard.netSettledCents(db, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8)), net);
  assert.equal(await guard.cycleBudgetCap(db, {}, oct9), budget.cycleCapMicros(180, net));
  assert.ok(net < 6700, 'Stripe fees come off; last-cycle $40 does not count; the unpaid hold does not count');

  const brokenPrints = memoryD1();
  brokenPrints.raw.exec(`CREATE TABLE shipped_bids (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  brokenPrints.raw.exec(`CREATE TABLE print_orders (id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, paid_at INTEGER)`);
  brokenPrints.raw.exec(`INSERT INTO shipped_bids (status, amount_cents, total_cents, refund_cents, paid_at) VALUES ('live', 5000, 5000, 0, ${thisCycle})`);
  brokenPrints.raw.exec(`INSERT INTO print_orders (status, amount_cents, paid_at) VALUES ('to_print', 500, ${thisCycle})`);
  const bidOnly = budget.saleNetCents(5000, 0);
  assert.equal(await guard.netSettledCents(brokenPrints, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8)), bidOnly, 'missing print_orders.refund_cents is $0 prints, not a dead cap');
  assert.equal(await guard.cycleBudgetCap(brokenPrints, {}, oct9), budget.cycleCapMicros(180, bidOnly));

  assert.equal(budget.parsePrintPostageCents(''), null);
  assert.equal(budget.parsePrintPostageCents('  '), null);
  assert.equal(budget.parsePrintPostageCents(undefined), null);
  assert.equal(budget.parsePrintPostageCents(80), 80);
  const five = memoryD1();
  five.raw.exec(`CREATE TABLE shipped_bids (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  five.raw.exec(`CREATE TABLE print_orders (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  five.raw.exec(`INSERT INTO print_orders (status, amount_cents, total_cents, refund_cents, paid_at) VALUES
    ('to_print', 500, 500, 0, ${thisCycle})`);
  const printOnly = budget.saleNetCents(500, 0);
  assert.equal(await guard.netSettledCents(five, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8)), printOnly, 'unset postage does not invent a cost');
  assert.equal(await guard.netSettledCents(five, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8), 80), budget.saleNetCents(500, 80));

  const mixed = memoryD1();
  mixed.raw.exec(`CREATE TABLE shipped_bids (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER
  )`);
  mixed.raw.exec(`CREATE TABLE print_orders (
    id INTEGER PRIMARY KEY, status TEXT, amount_cents INTEGER, total_cents INTEGER, refund_cents INTEGER, paid_at INTEGER, kind TEXT
  )`);
  mixed.raw.exec(`INSERT INTO print_orders (status, amount_cents, total_cents, refund_cents, paid_at, kind) VALUES
    ('paid', 300, 300, 0, ${thisCycle}, 'full'),
    ('to_print', 700, 700, 0, ${thisCycle}, 'bundle'),
    ('checkout', 300, NULL, NULL, NULL, 'full')`);
  const mixedNet = budget.saleNetCents(300, 0) + budget.saleNetCents(700, 0);
  assert.equal(await guard.netSettledCents(mixed, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8)), mixedNet, '$3 and $7 settled sales refill the budget; the unpaid hold does not');
  assert.equal(
    await guard.netSettledCents(mixed, Date.UTC(2026, 9, 8), Date.UTC(2026, 10, 8), 80),
    budget.saleNetCents(300, 0) + budget.saleNetCents(700, 80),
    'postage comes off the mailed bundle only, not the digital full receipt',
  );
  assert.deepEqual(await guard.configuredPrintPostageCents({}, five), { cents: null, fromEnv: false });
  await guard.setPrintPostageCents(five, 80);
  assert.deepEqual(await guard.configuredPrintPostageCents({}, five), { cents: 80, fromEnv: false });
  assert.deepEqual(await guard.configuredPrintPostageCents({ SHIPPED_PRINT_COST_CENTS: '120' }, five), { cents: 120, fromEnv: true }, 'env wins over the admin flag');
  assert.equal(await guard.cycleBudgetCap(five, {}, oct9), budget.cycleCapMicros(180, budget.saleNetCents(500, 80)));
  await guard.setPrintPostageCents(five, null);
  assert.deepEqual(await guard.configuredPrintPostageCents({}, five), { cents: null, fromEnv: false });

  assert.deepEqual(await guard.recordBudgetAlerts(db, 90_000_000, 180_000_000, oct9), [50]);
  assert.deepEqual(await guard.recordBudgetAlerts(db, 90_000_000, 180_000_000, oct9), [], 'once per cycle');
  assert.deepEqual(await guard.recordBudgetAlerts(db, 180_000_000, 180_000_000, oct9), [80, 100]);
  assert.equal(await guard.currentBudgetAlert(db, oct9), 100);
});

test('budget cap: reservations stop at the cap, settling swaps the hold for the real cost', async () => {
  const db = memoryD1();
  const day = '2026-10-14';
  const cap = guard.capMicros({ SHIPPED_DAILY_CAP_USD: '1' });
  assert.equal(cap, 1_000_000);
  assert.equal(guard.capMicros({}), 5_000_000, 'conservative default: $5/day');
  assert.equal(guard.capMicros({ SHIPPED_DAILY_CAP_USD: '999999' }), 1_000_000_000, 'clamped');
  assert.equal(await guard.reserveBudget(db, cap, 400_000, day), true);
  assert.equal(await guard.reserveBudget(db, cap, 400_000, day), true);
  assert.equal(await guard.reserveBudget(db, cap, 400_000, day), false, 'would pass the cap with two in flight');
  await guard.settleBudget(db, 400_000, 30_000, day);
  assert.deepEqual(await guard.budgetUsed(db, day), { spent: 30_000, reserved: 400_000 });
  assert.equal(await guard.reserveBudget(db, cap, 400_000, day), true, 'room again once the first settled cheap');
  assert.equal(await guard.reserveBudget(db, cap, cap + 1, '2026-10-15'), false, 'one call over the whole cap never starts');
  await guard.settleBudget(db, 400_000, 2_000_000, day);
  assert.equal(await guard.reserveBudget(db, cap, 1, day), false, 'an overrun blocks the rest of the day');
});

test('kill switches: D1 flags and the SHIPPED_OFF var, site switches everything', async () => {
  const db = memoryD1();
  assert.deepEqual([...(await guard.switchedOff({}, db))], []);
  await guard.setSwitch(db, 'sponsors', true);
  assert.deepEqual([...(await guard.switchedOff({}, db))], ['sponsors']);
  assert.deepEqual([...(await guard.switchedOff({ SHIPPED_OFF: 'generate, bogus' }, db))].sort(), ['generate', 'sponsors']);
  await guard.setSwitch(db, 'sponsors', false);
  await guard.setSwitch(db, 'site', true);
  assert.deepEqual([...(await guard.switchedOff({}, db))].sort(), [...guard.SWITCHES].sort());
  assert.deepEqual([...(await guard.switchedOff({ SHIPPED_OFF: 'site' }, null))].sort(), [...guard.SWITCHES].sort(), 'works without a database');
});

async function solve(challenge, bits) {
  for (let nonce = 0; ; nonce++) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge}:${nonce}`)));
    if (guard.leadingZeroBits(digest) >= bits) return `pow:${challenge}:${nonce}`;
  }
}

test('proof of work: solved tokens pass once; forged, stale, easy or reused ones fail', async () => {
  const env = { SHIPPED_POW_BITS: '8', SHIPPED_POW_SECRET: 'test-secret', SITE_ENV: 'production' };
  assert.deepEqual(guard.humanCheck(env), { kind: 'pow', bits: 8 }, 'production without Turnstile keys falls back to the puzzle');
  const db = memoryD1();
  const now = Date.now();
  const { challenge, bits } = await guard.issueChallenge(env, now);
  const token = await solve(challenge, bits);
  assert.equal(await guard.verifyPow(env, db, token, now + 1000), true);
  assert.equal(await guard.verifyPow(env, db, token, now + 2000), false, 'single use');
  const fresh = await guard.issueChallenge(env, now);
  const solved = await solve(fresh.challenge, fresh.bits);
  assert.equal(await guard.verifyPow(env, db, solved, now + 11 * MINUTE), false, 'expired');
  assert.equal(await guard.verifyPow({ ...env, SHIPPED_POW_SECRET: 'other' }, db, solved, now), false, 'signed by someone else');
  const [, body, nonce] = solved.match(/^pow:(.+):(\d+)$/);
  const easier = body.replace(/^(\d{13})\.\d+\./, '$1.1.');
  assert.equal(await guard.verifyPow(env, db, `pow:${easier}:${nonce}`, now), false, 'difficulty is signed');
  assert.equal(await guard.verifyPow(env, db, `pow:${body}:${Number(nonce) + 1}`, now), false, 'wrong nonce');
  assert.equal(await guard.verifyHuman(env, db, 'x'.repeat(5000), requestFrom('192.0.2.1')), false, 'oversized token');
  assert.equal(await guard.verifyHuman(env, db, { token: 1 }, requestFrom('192.0.2.1')), false, 'not a string');
  assert.equal(guard.leadingZeroBits(new Uint8Array([0, 0, 0x0f])), 20);
});

test('request hygiene: other origins, scripts and oversized bodies are refused before any work', () => {
  const ok = requestFrom('192.0.2.1', { headers: { origin: 'https://shipped.example.org', 'sec-fetch-site': 'same-origin' } });
  assert.equal(guard.refuseRequest(ok, 1000), null);
  assert.deepEqual(guard.refuseRequest(requestFrom('192.0.2.1', { headers: { origin: 'https://evil.example' } }), 1000), { status: 403, error: 'cross-origin' });
  assert.deepEqual(guard.refuseRequest(requestFrom('192.0.2.1', { headers: { 'sec-fetch-site': 'cross-site' } }), 1000), { status: 403, error: 'cross-origin' });
  for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', 'Go-http-client/2.0', 'x']) {
    assert.deepEqual(guard.refuseRequest(requestFrom('192.0.2.1', { headers: { 'user-agent': ua } }), 1000), { status: 403, error: 'browser-only' }, ua);
  }
  assert.deepEqual(guard.refuseRequest(requestFrom('192.0.2.1', { headers: { 'content-length': '5000' } }), 1000), { status: 413, error: 'too-big' });
});

test('JSON bodies are capped whatever content-length claims', async () => {
  const big = requestFrom('192.0.2.1', { body: JSON.stringify({ q: 'x'.repeat(20_000) }) });
  assert.equal(await guard.readJsonCapped(big, 8192), null);
  assert.deepEqual(await guard.readJsonCapped(requestFrom('192.0.2.1', { body: '{"q":"levelsio"}' })), { q: 'levelsio' });
  assert.equal(await guard.readJsonCapped(requestFrom('192.0.2.1', { body: '[1,2]' })), null);
  assert.equal(await guard.readJsonCapped(requestFrom('192.0.2.1', { body: 'nope' })), null);
});

test('every page gets strict headers and a CSP without unsafe-inline scripts', async () => {
  const html = '<!doctype html><html><head><script>self.__x=1</script></head><body>hi</body></html>';
  const page = await guard.hardenPage(new Response(html, { headers: { 'content-type': 'text/html' } }));
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src [^;]*'sha256-/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|'unsafe-eval'/, 'only WebAssembly compiling is allowed, never JS eval');
  assert.match(csp, /object-src 'none'/);
  assert.match(page.headers.get('strict-transport-security'), /max-age=\d{8}/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(page.headers.get('referrer-policy'));
  assert.ok(page.headers.get('permissions-policy'));
});
