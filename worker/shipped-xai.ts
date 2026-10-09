// xAI is a GAP-FILL only. Free sources (GitHub, PH, App Store, npm, HN, changelogs, TinyFish)
// plus OpenAI Decisions run first. x_search runs when a prolific-looking person still has
// fewer than ~6 verified lines, or to resolve a missing handle/role. Absent XAI_API_KEY,
// or a closed monthly cap, skips to the non-xAI pipeline.
//
// Billing (docs.x.ai): x_search is $5/1k posts fetched + $10/1k profiles; web_search $5/1k
// calls; plus tokens. Exact charge is usage.cost_in_usd_ticks (1 USD = 1e10 ticks).
import { clean, publicUrl, type Found } from './shipped-sources';
import type { Affiliation } from './shipped-affiliation';

export const XAI_RESPONSES = 'https://api.x.ai/v1/responses';
/** Cheap tools-capable Grok. Override with SHIPPED_XAI_MODEL. */
export const XAI_MODEL = 'grok-4-fast-non-reasoning';
/** Fallback token estimate when cost_in_usd_ticks is missing. */
const IN_PER_M = 0.2;
const OUT_PER_M = 0.5;
export const XAI_POST_MICROS = 5_000;
export const XAI_PROFILE_MICROS = 10_000;
export const XAI_WEB_MICROS = 5_000;
export const XAI_TICKS_PER_USD = 10_000_000_000;
export const XAI_GAP_BELOW = 6;
export const XAI_DEFAULT_MAX_POSTS = 10;
export const XAI_HARD_MAX_POSTS = 25;
export const XAI_DEEP_MAX_POSTS = 40;
export const XAI_DEEP_HARD_MAX_POSTS = 50;
export const XAI_DEFAULT_MONTHLY_USD = 15;
export const XAI_SALE_ALLOWANCE_USD = 0.3;

export type XaiEnv = {
  XAI_API_KEY?: string;
  XAI_API_BASE?: string;
  SHIPPED_XAI_MODEL?: string;
  XAI_MAX_POSTS?: string;
  SHIPPED_XAI_MAX_POSTS?: string;
  SHIPPED_XAI_DEEP_MAX_POSTS?: string;
  XAI_MONTHLY_CAP_USD?: string;
  SHIPPED_XAI_MONTHLY_CAP_USD?: string;
  SHIPPED_FULL_ALLOWANCE_USD?: string;
  xaiMeter?: XaiMeter;
};

export type XaiSpend = {
  inputTokens: number;
  outputTokens: number;
  posts: number;
  profiles: number;
  web: number;
  ticks: number;
  costMicros: number;
};

export type XaiMeter = {
  allow: () => Promise<boolean>;
  record: (spend: XaiSpend) => Promise<void>;
};

export const emptyXaiSpend = (): XaiSpend => ({
  inputTokens: 0,
  outputTokens: 0,
  posts: 0,
  profiles: 0,
  web: 0,
  ticks: 0,
  costMicros: 0,
});

export function xaiConfigured(env: XaiEnv): boolean {
  return Boolean(env.XAI_API_KEY?.trim());
}

/** @deprecated use xaiConfigured; enabled also needs the monthly cap (async). */
export function xaiEnabled(env: XaiEnv): boolean {
  return xaiConfigured(env);
}

export function xaiMaxPosts(env: XaiEnv): number {
  const raw = env.XAI_MAX_POSTS ?? env.SHIPPED_XAI_MAX_POSTS ?? String(XAI_DEFAULT_MAX_POSTS);
  return Math.min(XAI_HARD_MAX_POSTS, Math.max(0, Math.round(Number(raw)) || 0));
}

export function xaiDeepMaxPosts(env: XaiEnv): number {
  const raw = (env as XaiEnv & { SHIPPED_XAI_DEEP_MAX_POSTS?: string }).SHIPPED_XAI_DEEP_MAX_POSTS ?? String(XAI_DEEP_MAX_POSTS);
  return Math.min(XAI_DEEP_HARD_MAX_POSTS, Math.max(0, Math.round(Number(raw)) || XAI_DEEP_MAX_POSTS));
}

export function xaiSaleAllowanceUsd(env: XaiEnv): number {
  const raw = (env as XaiEnv & { SHIPPED_FULL_ALLOWANCE_USD?: string }).SHIPPED_FULL_ALLOWANCE_USD ?? String(XAI_SALE_ALLOWANCE_USD);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(2, n) : XAI_SALE_ALLOWANCE_USD;
}

export function xaiMonthlyCapUsd(env: XaiEnv): number {
  const raw = env.XAI_MONTHLY_CAP_USD ?? env.SHIPPED_XAI_MONTHLY_CAP_USD ?? String(XAI_DEFAULT_MONTHLY_USD);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : XAI_DEFAULT_MONTHLY_USD;
}

export function ticksToMicros(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.round(ticks / 10_000);
}

export function ticksToUsd(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return ticks / XAI_TICKS_PER_USD;
}

export function xaiCostMicros(spend: Omit<XaiSpend, 'costMicros' | 'ticks'> & { ticks?: number }): number {
  if (spend.ticks && spend.ticks > 0) return ticksToMicros(spend.ticks);
  return (
    Math.ceil(spend.inputTokens * IN_PER_M + spend.outputTokens * OUT_PER_M) +
    spend.posts * XAI_POST_MICROS +
    spend.profiles * XAI_PROFILE_MICROS +
    spend.web * XAI_WEB_MICROS
  );
}

/** Free harvest + Decisions first. xAI only when a prolific tape is still thin. */
export function xaiShouldGapFill(verified: number, prolific: boolean): boolean {
  return prolific && verified < XAI_GAP_BELOW;
}

export function xaiKeywordQuery(handle: string, year: number): string {
  const who = handle.replace(/^@/, '');
  return `from:${who} (shipped OR launched OR live OR released) since:${year}-01-01`;
}

/** Per-sale meter for a paid FULL run. Does not touch the free monthly xAI budget. */
export function saleXaiMeter(maxUsd = XAI_SALE_ALLOWANCE_USD): XaiMeter & { ticks: number; micros: number } {
  const state = { ticks: 0 };
  const capTicks = Math.max(0, maxUsd) * XAI_TICKS_PER_USD;
  return {
    get ticks() {
      return state.ticks;
    },
    get micros() {
      return ticksToMicros(state.ticks);
    },
    async allow() {
      return state.ticks < capTicks;
    },
    async record(spend) {
      state.ticks += spend.ticks || spend.costMicros * 10_000;
    },
  };
}

export function memoryXaiMeter(capUsd = XAI_DEFAULT_MONTHLY_USD): XaiMeter & { ticks: number; receipts: number } {
  const state = { ticks: 0, receipts: 0 };
  const capTicks = capUsd * XAI_TICKS_PER_USD;
  return {
    get ticks() {
      return state.ticks;
    },
    get receipts() {
      return state.receipts;
    },
    async allow() {
      return state.ticks < capTicks;
    },
    async record(spend) {
      state.ticks += spend.ticks || spend.costMicros * 10_000;
      if (spend.ticks || spend.costMicros) state.receipts += 1;
    },
  };
}

export function xaiMonthKey(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function d1XaiMeter(db: D1Database, env: XaiEnv): XaiMeter {
  const month = xaiMonthKey();
  const capTicks = xaiMonthlyCapUsd(env) * XAI_TICKS_PER_USD;
  return {
    async allow() {
      const row = await db.prepare('SELECT ticks FROM shipped_xai WHERE month = ?').bind(month).first<{ ticks: number }>().catch(() => null);
      return (row?.ticks ?? 0) < capTicks;
    },
    async record(spend) {
      const ticks = spend.ticks || spend.costMicros * 10_000;
      if (!ticks) return;
      await db
        .prepare(
          `INSERT INTO shipped_xai (month, ticks, posts, receipts) VALUES (?, ?, ?, 1)
           ON CONFLICT(month) DO UPDATE SET ticks = ticks + excluded.ticks, posts = posts + excluded.posts, receipts = receipts + 1`,
        )
        .bind(month, ticks, spend.posts)
        .run()
        .catch((error) => console.warn('shipped: xai-meter', error instanceof Error ? error.message : error));
    },
  };
}

type ResponsesBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[]; text?: string }[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_in_usd_ticks?: number;
    server_side_tool_usage_details?: {
      x_posts_fetched?: number;
      x_users_fetched?: number;
      web_search_calls?: number;
      x_search_calls?: number;
    };
  };
};

function outputText(body: ResponsesBody): string {
  if (typeof body.output_text === 'string' && body.output_text) return body.output_text;
  const chunks: string[] = [];
  for (const item of body.output ?? []) {
    if (typeof item.text === 'string') chunks.push(item.text);
    for (const part of item.content ?? []) if (part.text) chunks.push(part.text);
  }
  return chunks.join('\n');
}

function parseShips(text: string, year: number): Found[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: unknown = null;
  if (start >= 0 && end > start) {
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      raw = null;
    }
  }
  const rows = raw && typeof raw === 'object' && Array.isArray((raw as { ships?: unknown }).ships) ? (raw as { ships: unknown[] }).ships : [];
  const found: Found[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const name = clean(item.name, 60);
    const link = publicUrl(item.url) ?? publicUrl(item.link);
    if (!name || !link) continue;
    const date = typeof item.date === 'string' && /^\d{4}-\d{2}/.test(item.date) ? item.date.slice(0, 10) : null;
    if (date && !date.startsWith(String(year))) continue;
    found.push({
      name,
      description: clean(item.why ?? item.description, 140),
      date,
      dateConfidence: date ? 'exact' : 'unknown',
      link,
      icon: null,
      source: 'x',
      status: 'LAUNCHED',
      score: 7,
      thisYear: !date || date.startsWith(String(year)),
    });
  }
  return found;
}

function parseIdentity(text: string): { handle: string | null; company: string | null; role: string | null } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { handle: null, company: null, role: null };
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const handle = typeof raw.handle === 'string' ? raw.handle.replace(/^@/, '').trim() : '';
    return {
      handle: /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null,
      company: typeof raw.company === 'string' ? clean(raw.company, 40) || null : null,
      role: typeof raw.role === 'string' ? clean(raw.role, 20) || null : null,
    };
  } catch {
    return { handle: null, company: null, role: null };
  }
}

async function xaiOpen(env: XaiEnv): Promise<boolean> {
  if (!xaiConfigured(env)) return false;
  if (!env.xaiMeter) return true;
  return env.xaiMeter.allow();
}

async function xaiResponses(env: XaiEnv, payload: Record<string, unknown>): Promise<{ body: ResponsesBody; spend: XaiSpend } | null> {
  const key = env.XAI_API_KEY?.trim();
  if (!key) return null;
  if (!(await xaiOpen(env))) {
    console.log(JSON.stringify({ shipped: 'xai', skipped: 'monthly-cap' }));
    return null;
  }
  const base = (env.XAI_API_BASE || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const model = env.SHIPPED_XAI_MODEL || XAI_MODEL;
  const response = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, ...payload }),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (!response?.ok) {
    if (response) console.warn('shipped: xai', response.status, (await response.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const body = (await response.json().catch(() => null)) as ResponsesBody | null;
  if (!body) return null;
  const details = body.usage?.server_side_tool_usage_details ?? {};
  const ticks = body.usage?.cost_in_usd_ticks ?? 0;
  const spendBase = {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    posts: details.x_posts_fetched ?? 0,
    profiles: details.x_users_fetched ?? 0,
    web: details.web_search_calls ?? 0,
    ticks,
  };
  const spend = { ...spendBase, costMicros: xaiCostMicros(spendBase) };
  await env.xaiMeter?.record(spend);
  return { body, spend };
}

export async function searchXShips(opts: {
  env: XaiEnv;
  year: number;
  handles: string[];
  who: string;
  company?: string | null;
  kind: 'person' | 'company';
  maxPosts?: number;
  /** Paid full run: up to ~40 posts, billed to the sale meter. */
  deep?: boolean;
}): Promise<{ found: Found[]; spend: XaiSpend }> {
  const cap = opts.deep ? xaiDeepMaxPosts(opts.env) : xaiMaxPosts(opts.env);
  const posts = Math.min(cap, opts.maxPosts ?? cap);
  const handles = [...new Set(opts.handles.map((h) => h.replace(/^@/, '')).filter(Boolean))].slice(0, 4);
  if (!xaiConfigured(opts.env) || posts <= 0 || !handles.length) return { found: [], spend: emptyXaiSpend() };
  const query = xaiKeywordQuery(handles[0], opts.year);
  const prompt = [
    `Gap-fill only. Run ONE x_keyword_search with this exact query (do not change it):`,
    query,
    `Fetch at most ${posts} latest posts. Do NOT call x_semantic_search, x_user_search, or x_thread_fetch — the handle is already known.`,
    `List distinct ${opts.year} ships by ${opts.who}${opts.company ? ` (at ${opts.company})` : ''} that those posts prove, each with a real public URL.`,
    `JSON only: {"ships":[{"name":"","date":"YYYY-MM-DD or null","url":"https://...","why":""}]}`,
  ].join('\n');
  const result = await xaiResponses(opts.env, {
    input: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'x_search',
        allowed_x_handles: handles,
        from_date: `${opts.year}-01-01`,
        to_date: `${opts.year + 1}-01-01`,
        enable_image_understanding: false,
        enable_video_understanding: false,
      },
    ],
    max_turns: 1,
  });
  if (!result) return { found: [], spend: emptyXaiSpend() };
  const found = parseShips(outputText(result.body), opts.year).slice(0, 40);
  console.log(
    JSON.stringify({
      shipped: 'xai',
      kind: opts.kind,
      who: opts.who,
      items: found.length,
      query,
      ticks: result.spend.ticks,
      costUsd: Number(ticksToUsd(result.spend.ticks).toFixed(6)),
      ...result.spend,
    }),
  );
  return { found, spend: result.spend };
}

/** One cheap identity call when free resolve found no handle and no company. */
export async function resolveRoleWithXai(opts: {
  env: XaiEnv;
  who: string;
}): Promise<{ handle: string | null; company: string | null; role: string | null; spend: XaiSpend }> {
  if (!xaiConfigured(opts.env) || !opts.who.trim()) return { handle: null, company: null, role: null, spend: emptyXaiSpend() };
  const result = await xaiResponses(opts.env, {
    input: [
      {
        role: 'user',
        content: `Who is "${opts.who}" on X? Return JSON only: {"handle":"","company":"","role":"ceo|founder|lead|employee|unknown"}. One x_user_search at most. Do not fetch posts or threads.`,
      },
    ],
    tools: [{ type: 'x_search', enable_image_understanding: false, enable_video_understanding: false }],
    max_turns: 1,
  });
  if (!result) return { handle: null, company: null, role: null, spend: emptyXaiSpend() };
  const ident = parseIdentity(outputText(result.body));
  console.log(JSON.stringify({ shipped: 'xai-identity', who: opts.who, ...ident, ticks: result.spend.ticks, costUsd: Number(ticksToUsd(result.spend.ticks).toFixed(6)) }));
  return { ...ident, spend: result.spend };
}

function addSpend(into: XaiSpend, extra: XaiSpend): XaiSpend {
  return {
    inputTokens: into.inputTokens + extra.inputTokens,
    outputTokens: into.outputTokens + extra.outputTokens,
    posts: into.posts + extra.posts,
    profiles: into.profiles + extra.profiles,
    web: into.web + extra.web,
    ticks: into.ticks + extra.ticks,
    costMicros: into.costMicros + extra.costMicros,
  };
}

export async function searchPersonAndCompanyX(opts: {
  env: XaiEnv;
  year: number;
  personX: string | null;
  personName: string;
  affiliation: Affiliation;
  deep?: boolean;
}): Promise<{ found: Found[]; spend: XaiSpend; ran: string[] }> {
  const ran: string[] = [];
  let spend = emptyXaiSpend();
  const found: Found[] = [];
  if (opts.personX) {
    const row = await searchXShips({
      env: opts.env,
      year: opts.year,
      handles: [opts.personX],
      who: opts.personName || `@${opts.personX}`,
      company: opts.affiliation.company,
      kind: 'person',
      deep: opts.deep,
    });
    found.push(...row.found);
    spend = addSpend(spend, row.spend);
    if (row.found.length || row.spend.costMicros) ran.push(opts.deep ? 'xai-person-deep' : 'xai-person');
  }
  return { found, spend, ran };
}

/** Extra web gap-fill for a paid full run. Billed to the sale meter. */
export async function searchWebShips(opts: {
  env: XaiEnv;
  year: number;
  who: string;
  company?: string | null;
}): Promise<{ found: Found[]; spend: XaiSpend }> {
  if (!xaiConfigured(opts.env)) return { found: [], spend: emptyXaiSpend() };
  const prompt = [
    `Web gap-fill only. Use web_search (at most 4 calls) for public ${opts.year} ships by ${opts.who}${opts.company ? ` or ${opts.company} while they led it` : ''}.`,
    `Each ship needs a real public URL (changelog, repo, Product Hunt, App Store, blog). No invented names.`,
    `JSON only: {"ships":[{"name":"","date":"YYYY-MM-DD or null","url":"https://...","why":""}]}`,
  ].join('\n');
  const result = await xaiResponses(opts.env, {
    input: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search' }],
    max_turns: 2,
  });
  if (!result) return { found: [], spend: emptyXaiSpend() };
  const found = parseShips(outputText(result.body), opts.year).slice(0, 40);
  console.log(
    JSON.stringify({
      shipped: 'xai-web',
      who: opts.who,
      items: found.length,
      ticks: result.spend.ticks,
      costUsd: Number(ticksToUsd(result.spend.ticks).toFixed(6)),
      ...result.spend,
    }),
  );
  return { found, spend: result.spend };
}
