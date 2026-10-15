// Listening metrics: /api/e takes anonymous events from the site, /api/admin/* serves the
// dashboard at /admin. Data lives in D1 (schema: worker/schema.sql).
import catalog from '../lib/tracks.json';
import { atLimit, overLimit } from './shipped-guard';
import type { MerchEnv } from './merch';
import { adminShipped, type ShippedEnv } from './shipped';
import { adminStore } from './store';

export interface MetricsEnv extends MerchEnv, ShippedEnv {
  DB?: D1Database;
  ADMIN_PASSWORD?: string;
}

const EVENT_TYPES = new Set(['view', 'play', 'listen', 'share', 'outbound', 'open', 'like', 'unlike', 'product', 'bag', 'checkout', 'purchase']);
const MAX_EVENTS = 25;
const LIVE_WINDOW_MS = 90_000;
const STREAM_SECONDS = 30;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor/i;

type IncomingEvent = Record<string, unknown>;

const text = (value: unknown, max = 80) => (typeof value === 'string' && value ? value.slice(0, max) : null);
const num = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;

function deviceOf(ua: string): string {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'desktop';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function ingest(request: Request, env: MetricsEnv): Promise<Response> {
  const noContent = new Response(null, { status: 204 });
  const ua = request.headers.get('user-agent') ?? '';
  if (!env.DB || BOT_UA.test(ua)) return noContent;

  let body: { events?: IncomingEvent[]; live?: IncomingEvent };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const country = cf?.country ?? null;
  const device = deviceOf(ua);
  const statements: D1PreparedStatement[] = [];

  for (const event of (body.events ?? []).slice(0, MAX_EVENTS)) {
    const type = text(event.type, 16);
    if (!type || !EVENT_TYPES.has(type)) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO events (ts, day, type, visitor, session, play, release, track, seconds, position, detail, referrer, country, device, campaign)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        now, day, type,
        text(event.visitor, 40), text(event.session, 40), text(event.play, 40),
        text(event.release, 60), text(event.track, 80),
        num(event.seconds, 0, 3600), num(event.position, 0, 1),
        text(event.detail, 120), text(event.referrer, 120),
        country, device, text(event.campaign, 40),
      ),
    );
  }

  const live = body.live;
  const liveVisitor = live ? text(live.visitor, 40) : null;
  if (liveVisitor) {
    statements.push(
      live?.track
        ? env.DB.prepare('INSERT INTO live (visitor, ts, track) VALUES (?, ?, ?) ON CONFLICT(visitor) DO UPDATE SET ts = excluded.ts, track = excluded.track')
          .bind(liveVisitor, now, text(live.track, 80))
        : env.DB.prepare('DELETE FROM live WHERE visitor = ?').bind(liveVisitor),
    );
  }

  if (statements.length) await env.DB.batch(statements);
  return noContent;
}

// The "Notify me" list: an email per person, where they signed up, and which post brought them.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function subscribe(request: Request, env: MetricsEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: 'invalid-email' }, 400);
  // Filled only by bots (the field is hidden from people): pretend it worked.
  if (body.website || BOT_UA.test(request.headers.get('user-agent') ?? '') || !env.DB) return json({ ok: true });

  const cf = (request as Request & { cf?: { country?: string } }).cf;
  await env.DB.prepare(
    'INSERT INTO subscribers (email, ts, source, campaign, country, visitor) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
  ).bind(email, Date.now(), text(body.source, 40), text(body.campaign, 40), cf?.country ?? null, text(body.visitor, 40)).run();
  return json({ ok: true });
}

// Compare hashes so the check takes the same time whatever the guess.
async function isAuthorized(request: Request, env: MetricsEnv): Promise<boolean> {
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_PASSWORD || !supplied) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.ADMIN_PASSWORD)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function sinceDay(url: URL): string {
  const days = Number(url.searchParams.get('days') ?? '30');
  if (!Number.isFinite(days) || days <= 0) return '0000-00-00';
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

// One row per play of a song: how long it was actually heard and how far it got.
const PLAYS = `SELECT play, MIN(day) AS day, visitor, MAX(campaign) AS campaign, release, track, SUM(seconds) AS heard, MAX(position) AS reached,
  MAX(CASE WHEN detail = 'skip' THEN 1 ELSE 0 END) AS skipped
  FROM events WHERE type = 'listen' AND day >= ?1 AND play IS NOT NULL GROUP BY play`;

async function stats(url: URL, db: D1Database): Promise<Response> {
  const since = sinceDay(url);
  const q = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(since, ...params);
  const trackCounts = Object.fromEntries(catalog.releases.map((release) => [release.id, release.tracks.length]));

  const [totals, plays, daily, dailyPlays, tracks, releases, dropoff, countries, devices, referrers, outbound, shares, opens, returning, live, fullListens,
    campaigns, campaignPlays, loved, storeFunnel, storeViews, subscribers] =
    await db.batch([
      q(`SELECT
          (SELECT COUNT(DISTINCT visitor) FROM events WHERE day >= ?1) AS visitors,
          (SELECT COUNT(DISTINCT visitor) FROM events WHERE type = 'listen' AND day >= ?1) AS listeners,
          (SELECT COALESCE(SUM(seconds), 0) FROM events WHERE type = 'listen' AND day >= ?1) AS seconds,
          (SELECT COUNT(*) FROM events WHERE type = 'share' AND day >= ?1) AS shares,
          (SELECT COUNT(*) FROM events WHERE type = 'outbound' AND day >= ?1) AS outbound,
          (SELECT COUNT(*) FROM events WHERE type = 'view' AND day >= ?1) AS views`),
      q(`SELECT COUNT(*) AS plays,
          SUM(CASE WHEN heard >= ${STREAM_SECONDS} THEN 1 ELSE 0 END) AS streams,
          AVG(reached) AS avgReached,
          AVG(CASE WHEN reached >= 0.9 THEN 1.0 ELSE 0 END) AS completionRate,
          AVG(CASE WHEN skipped = 1 AND reached < 0.9 THEN 1.0 ELSE 0 END) AS skipRate
          FROM (${PLAYS})`),
      q(`SELECT day, COUNT(DISTINCT visitor) AS visitors,
          COUNT(DISTINCT CASE WHEN type = 'listen' THEN visitor END) AS listeners,
          COALESCE(SUM(CASE WHEN type = 'listen' THEN seconds END), 0) AS seconds
          FROM events WHERE day >= ?1 GROUP BY day ORDER BY day`),
      q(`SELECT day, COUNT(*) AS plays, SUM(CASE WHEN heard >= ${STREAM_SECONDS} THEN 1 ELSE 0 END) AS streams
          FROM (${PLAYS}) GROUP BY day ORDER BY day`),
      q(`SELECT track, release, COUNT(*) AS plays, SUM(CASE WHEN heard >= ${STREAM_SECONDS} THEN 1 ELSE 0 END) AS streams,
          COUNT(DISTINCT visitor) AS listeners, SUM(heard) AS seconds, AVG(reached) AS avgReached,
          AVG(CASE WHEN reached >= 0.9 THEN 1.0 ELSE 0 END) AS completionRate,
          AVG(CASE WHEN skipped = 1 AND reached < 0.9 THEN 1.0 ELSE 0 END) AS skipRate
          FROM (${PLAYS}) GROUP BY track ORDER BY streams DESC, plays DESC`),
      q(`SELECT release, COUNT(*) AS plays, SUM(CASE WHEN heard >= ${STREAM_SECONDS} THEN 1 ELSE 0 END) AS streams,
          COUNT(DISTINCT visitor) AS listeners, SUM(heard) AS seconds
          FROM (${PLAYS}) GROUP BY release ORDER BY streams DESC`),
      q(`SELECT MIN(9, CAST(reached * 10 AS INTEGER)) AS bucket, COUNT(*) AS plays FROM (${PLAYS}) GROUP BY bucket ORDER BY bucket`),
      q(`SELECT COALESCE(country, '??') AS label, COUNT(DISTINCT visitor) AS value FROM events WHERE day >= ?1 GROUP BY label ORDER BY value DESC LIMIT 12`),
      q(`SELECT device AS label, COUNT(DISTINCT visitor) AS value FROM events WHERE day >= ?1 GROUP BY label ORDER BY value DESC`),
      q(`SELECT COALESCE(referrer, 'Direct') AS label, COUNT(DISTINCT visitor) AS value FROM events WHERE type = 'view' AND day >= ?1 GROUP BY label ORDER BY value DESC LIMIT 12`),
      q(`SELECT detail AS label, COUNT(*) AS value FROM events WHERE type = 'outbound' AND day >= ?1 GROUP BY label ORDER BY value DESC`),
      q(`SELECT COALESCE(track, release) AS label, COUNT(*) AS value FROM events WHERE type = 'share' AND day >= ?1 GROUP BY label ORDER BY value DESC LIMIT 12`),
      q(`SELECT release AS label, COUNT(*) AS value FROM events WHERE type = 'open' AND day >= ?1 GROUP BY label ORDER BY value DESC`),
      q(`SELECT COUNT(*) AS value FROM (SELECT visitor FROM events WHERE type = 'listen' AND day >= ?1 GROUP BY visitor HAVING COUNT(DISTINCT day) >= 2)`),
      db.prepare('SELECT COUNT(*) AS value, track FROM live WHERE ts > ? GROUP BY track ORDER BY value DESC').bind(Date.now() - LIVE_WINDOW_MS),
      // Visitors who heard every song of a release to (nearly) the end.
      q(`SELECT release, visitor, COUNT(DISTINCT track) AS finished FROM (${PLAYS}) WHERE reached >= 0.9 GROUP BY release, visitor`),
      // Which post or link brought people in, and what they did.
      q(`SELECT campaign AS label, COUNT(DISTINCT visitor) AS visitors FROM events WHERE campaign IS NOT NULL AND day >= ?1 GROUP BY campaign ORDER BY visitors DESC LIMIT 20`),
      q(`SELECT campaign AS label, COUNT(*) AS plays, SUM(CASE WHEN heard >= ${STREAM_SECONDS} THEN 1 ELSE 0 END) AS streams
          FROM (${PLAYS}) WHERE campaign IS NOT NULL GROUP BY campaign`),
      // Hearts: each person's latest choice per song counts once.
      q(`SELECT track AS label, COUNT(*) AS value FROM (
          SELECT visitor, track, type FROM events e WHERE type IN ('like', 'unlike') AND day >= ?1
            AND ts = (SELECT MAX(ts) FROM events WHERE visitor = e.visitor AND track = e.track AND type IN ('like', 'unlike'))
        ) WHERE type = 'like' GROUP BY track ORDER BY value DESC LIMIT 12`),
      // Scrapwrk: people who opened a piece, bagged it, started checkout, and paid.
      q(`SELECT type, COUNT(DISTINCT visitor) AS visitors FROM events
          WHERE type IN ('product', 'bag', 'checkout', 'purchase') AND day >= ?1 GROUP BY type`),
      q(`SELECT detail AS label, COUNT(DISTINCT visitor) AS value FROM events WHERE type = 'product' AND day >= ?1 GROUP BY detail ORDER BY value DESC`),
      q(`SELECT (SELECT COUNT(*) FROM subscribers) AS total,
          (SELECT COUNT(*) FROM subscribers WHERE ts >= CAST(strftime('%s', ?1) AS INTEGER) * 1000) AS recent`),
    ]);

  const full: Record<string, number> = {};
  for (const row of fullListens.results as { release: string; finished: number }[]) {
    if (row.finished >= (trackCounts[row.release] ?? Infinity)) full[row.release] = (full[row.release] ?? 0) + 1;
  }
  const liveRows = live.results as { value: number; track: string }[];

  return json({
    since,
    generatedAt: new Date().toISOString(),
    totals: { ...(totals.results[0] as object), ...(plays.results[0] as object), returningListeners: (returning.results[0] as { value: number }).value },
    live: { listeners: liveRows.reduce((sum, row) => sum + row.value, 0), tracks: liveRows },
    daily: daily.results,
    dailyPlays: dailyPlays.results,
    tracks: tracks.results,
    releases: (releases.results as { release: string }[]).map((row) => ({ ...row, fullListens: full[row.release] ?? 0 })),
    dropoff: dropoff.results,
    countries: countries.results,
    devices: devices.results,
    referrers: referrers.results,
    outbound: outbound.results,
    shares: shares.results,
    opens: opens.results,
    campaigns: (campaigns.results as { label: string; visitors: number }[]).map((row) => {
      const played = (campaignPlays.results as { label: string; plays: number; streams: number }[]).find((p) => p.label === row.label);
      return { ...row, plays: played?.plays ?? 0, streams: played?.streams ?? 0 };
    }),
    loved: loved.results,
    subscribers: subscribers.results[0],
    store: {
      funnel: Object.fromEntries((storeFunnel.results as { type: string; visitors: number }[]).map((row) => [row.type, row.visitors])),
      views: storeViews.results,
    },
  });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(lines: string[], name: string): Response {
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="brytonzoz-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

// The notify list, ready to import into any email tool.
async function exportSubscribers(db: D1Database): Promise<Response> {
  const { results } = await db.prepare('SELECT email, ts, source, campaign, country FROM subscribers ORDER BY ts').all();
  const lines = ['email,signed_up,source,campaign,country'];
  for (const row of results as Record<string, unknown>[]) {
    lines.push([row.email, new Date(row.ts as number).toISOString(), row.source, row.campaign, row.country].map(csvCell).join(','));
  }
  return csvResponse(lines, 'notify-list');
}

async function exportCsv(url: URL, db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare('SELECT ts, day, type, visitor, session, play, release, track, seconds, position, detail, referrer, campaign, country, device FROM events WHERE day >= ? ORDER BY ts LIMIT 200000')
    .bind(sinceDay(url))
    .all();
  const columns = ['time', 'day', 'type', 'visitor', 'session', 'play', 'release', 'track', 'seconds', 'position', 'detail', 'referrer', 'campaign', 'country', 'device'];
  const lines = [columns.join(',')];
  for (const row of results as Record<string, unknown>[]) {
    lines.push([new Date(row.ts as number).toISOString(), ...columns.slice(1).map((c) => row[c])].map(csvCell).join(','));
  }
  return csvResponse(lines, 'listening');
}

export async function handleApi(request: Request, env: MetricsEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/e') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    return ingest(request, env);
  }

  if (url.pathname === '/api/subscribe') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    return subscribe(request, env);
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!env.ADMIN_PASSWORD) return json({ error: 'not-configured' }, 503);
    if (!env.DB) return json({ error: 'no-database' }, 503);
    // Failed logins are counted per IP and subnet (10 / 30 an hour); past that, even the right password waits.
    if (await atLimit(env.DB, request, 'admin')) return json({ error: 'slow-down' }, 429);
    if (!(await isAuthorized(request, env))) {
      await overLimit(env.DB, request, 'admin');
      await new Promise((resolve) => setTimeout(resolve, 400));
      return json({ error: 'unauthorized' }, 401);
    }
    if (url.pathname === '/api/admin/stats') return stats(url, env.DB);
    if (url.pathname === '/api/admin/export.csv') return exportCsv(url, env.DB);
    if (url.pathname === '/api/admin/subscribers.csv') return exportSubscribers(env.DB);
    if (url.pathname === '/api/admin/store') return adminStore(request, { ...env, DB: env.DB });
    if (url.pathname.startsWith('/api/admin/shipped')) return adminShipped(request, env);
  }

  return json({ error: 'not-found' }, 404);
}
