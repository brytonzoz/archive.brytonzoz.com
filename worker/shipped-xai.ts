// xAI (Grok) is the paid search source: X search + web, capped hard per receipt, cached 24h
// per person handle and per company. Absent XAI_API_KEY → skip. Docs: POST /v1/responses,
// tools x_search + web_search (https://docs.x.ai/developers/tools/x-search). grok-4.3 tokens
// plus $5/1k X posts and $5/1k web calls.
import { clean, publicUrl, type Found } from './shipped-sources';
import type { Affiliation } from './shipped-affiliation';

export const XAI_RESPONSES = 'https://api.x.ai/v1/responses';
export const XAI_MODEL = 'grok-4.3';
/** $1.25 / $2.50 per 1M tokens (grok-4.3, under 200k). */
const IN_PER_M = 1.25;
const OUT_PER_M = 2.5;
/** $5 per 1,000 X posts fetched; $5 per 1,000 web_search calls. */
export const XAI_POST_MICROS = 5_000;
export const XAI_WEB_MICROS = 5_000;

export type XaiEnv = {
  XAI_API_KEY?: string;
  XAI_API_BASE?: string;
  SHIPPED_XAI_MODEL?: string;
  /** Max X posts one search may fetch (default 8 → $0.04). */
  SHIPPED_XAI_MAX_POSTS?: string;
};

export type XaiSpend = { inputTokens: number; outputTokens: number; posts: number; web: number; costMicros: number };

export const emptyXaiSpend = (): XaiSpend => ({ inputTokens: 0, outputTokens: 0, posts: 0, web: 0, costMicros: 0 });

export function xaiEnabled(env: XaiEnv): boolean {
  return Boolean(env.XAI_API_KEY?.trim());
}

export function xaiMaxPosts(env: XaiEnv): number {
  return Math.min(12, Math.max(0, Math.round(Number(env.SHIPPED_XAI_MAX_POSTS ?? 8)) || 0));
}

export function xaiCostMicros(spend: Omit<XaiSpend, 'costMicros'>): number {
  return Math.ceil(spend.inputTokens * IN_PER_M + spend.outputTokens * OUT_PER_M) + spend.posts * XAI_POST_MICROS + spend.web * XAI_WEB_MICROS;
}

type ResponsesBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[]; text?: string }[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_side_tool_usage_details?: { x_posts_fetched?: number; web_search_calls?: number; x_search_calls?: number };
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

async function xaiResponses(env: XaiEnv, payload: Record<string, unknown>): Promise<{ body: ResponsesBody; spend: XaiSpend } | null> {
  const key = env.XAI_API_KEY?.trim();
  if (!key) return null;
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
  const spendBase = {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    posts: details.x_posts_fetched ?? 0,
    web: details.web_search_calls ?? 0,
  };
  return { body, spend: { ...spendBase, costMicros: xaiCostMicros(spendBase) } };
}

export async function searchXShips(opts: {
  env: XaiEnv;
  year: number;
  handles: string[];
  who: string;
  company?: string | null;
  kind: 'person' | 'company';
  /** Cap X posts fetched (cost), not how many sourced ships the model may list. */
  maxPosts?: number;
  /** Web search without an X handle (typed "Tibo from OpenAI", "CEO of Higgsfield"). */
  allowWebOnly?: boolean;
}): Promise<{ found: Found[]; spend: XaiSpend }> {
  const posts = Math.min(xaiMaxPosts(opts.env), opts.maxPosts ?? xaiMaxPosts(opts.env));
  if (!xaiEnabled(opts.env)) return { found: [], spend: emptyXaiSpend() };
  const handles = [...new Set(opts.handles.map((h) => h.replace(/^@/, '')).filter(Boolean))].slice(0, 8);
  const useX = handles.length > 0 && posts > 0;
  if (!useX && !opts.allowWebOnly) return { found: [], spend: emptyXaiSpend() };
  const prompt =
    opts.kind === 'company'
      ? `List every distinct product, model, feature, API, app, and launch ${opts.who} shipped in ${opts.year} (from ${opts.year}-01-01 through today). Use X and the public web (blog, changelog, news, docs). Only real ships that are live, released, launched, or GA — not hiring, teasers, opinions, or roadmaps. Return as many distinct ships as you can prove, each with a real public URL (blog, changelog, news, or X). JSON only: {"ships":[{"name":"","date":"YYYY-MM-DD or null","url":"https://...","why":""}]}`
      : `List every distinct thing ${opts.who}${opts.company ? ` (at ${opts.company})` : ''} shipped in ${opts.year}: products, features, launches, releases, models, and company ships they lead or founded. Use X and the public web. Only real ships with a public URL. JSON only: {"ships":[{"name":"","date":"YYYY-MM-DD or null","url":"https://...","why":""}]}`;
  const tools: Record<string, unknown>[] = [];
  if (useX) {
    tools.push({
      type: 'x_search',
      allowed_x_handles: handles,
      from_date: `${opts.year}-01-01`,
      to_date: `${opts.year + 1}-01-01`,
    });
  }
  tools.push({ type: 'web_search' });
  const result = await xaiResponses(opts.env, {
    input: [{ role: 'user', content: prompt }],
    tools,
    max_turns: 2,
  });
  if (!result) return { found: [], spend: emptyXaiSpend() };
  // Post cap is a fetch-cost guard. The tape may list every sourced ship the tools proved.
  const found = parseShips(outputText(result.body), opts.year).slice(0, 80);
  console.log(JSON.stringify({ shipped: 'xai', kind: opts.kind, who: opts.who, items: found.length, ...result.spend }));
  return { found, spend: result.spend };
}

export async function searchPersonAndCompanyX(opts: {
  env: XaiEnv;
  year: number;
  personX: string | null;
  personName: string;
  affiliation: Affiliation;
}): Promise<{ found: Found[]; spend: XaiSpend; ran: string[] }> {
  const ran: string[] = [];
  const spend = emptyXaiSpend();
  const found: Found[] = [];
  const add = (row: { found: Found[]; spend: XaiSpend }, tag: string) => {
    found.push(...row.found);
    spend.inputTokens += row.spend.inputTokens;
    spend.outputTokens += row.spend.outputTokens;
    spend.posts += row.spend.posts;
    spend.web += row.spend.web;
    spend.costMicros += row.spend.costMicros;
    if (row.found.length || row.spend.costMicros) ran.push(tag);
  };
  if (opts.personX) {
    add(
      await searchXShips({
        env: opts.env,
        year: opts.year,
        handles: [opts.personX],
        who: opts.personName || `@${opts.personX}`,
        company: opts.affiliation.company,
        kind: 'person',
      }),
      'xai-person',
    );
  }
  const companyHandle = opts.affiliation.companyX;
  if (companyHandle && (opts.affiliation.role === 'ceo' || opts.affiliation.role === 'founder' || opts.affiliation.role === 'lead')) {
    add(
      await searchXShips({
        env: opts.env,
        year: opts.year,
        handles: [companyHandle],
        who: opts.affiliation.company || companyHandle,
        kind: 'company',
      }),
      'xai-company',
    );
  }
  return { found, spend, ran };
}
