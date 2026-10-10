// OpenAI Decisions API is the verification + ranking layer. ONLY POST /v1/decisions with
// gpt-6-luna. No other OpenAI models or endpoints. Input is $0.10 / 1M tokens; output is free.
// Docs: https://platform.openai.com/docs/guides/decisions
import type { Attribution, Affiliation } from './shipped-affiliation';
import { defaultAttribution, leadProductTokens } from './shipped-affiliation';
import type { Found } from './shipped-sources';
import { clean } from './shipped-sources';

export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';
export const DECISIONS_MODEL = 'gpt-6-luna';
/** $0.10 per 1M input tokens; output is free. */
const IN_PER_M = 0.1;
export const KEEP_PRODUCT = 0.7;

const PERSONAL_SHIP_SOURCE = /^(github|npm|producthunt|appstore)$/;

export function isPersonalShipSource(item: { source?: string; link?: string | null }): boolean {
  if (PERSONAL_SHIP_SOURCE.test(item.source ?? '')) return true;
  if ((item.source === 'site' || item.source === 'web') && item.link) {
    if (/\/(blog|posts?|news|articles?|p|index|customers|topic|resources|support)\//i.test(item.link)) return false;
    try {
      const path = new URL(item.link).pathname.replace(/\/+$/, '');
      if (!path) return true;
    } catch {
      /* ignore */
    }
    return item.source === 'site';
  }
  return false;
}

export type DecisionsEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE?: string;
};

export const SHIP_KINDS = [
  { value: 'product_launch', description: 'A new product or app made available to users.' },
  { value: 'feature', description: 'A user-facing feature added to an existing product.' },
  { value: 'model', description: 'A model release users can call or use.' },
  { value: 'release_version', description: 'A numbered version or changelog release users can install.' },
  { value: 'integration', description: 'An integration users can turn on.' },
  { value: 'pricing_plan', description: 'A new plan or SKU users can buy.' },
  { value: 'NOT_A_SHIP', description: 'Tutorial, case study, customer story, research paper, hiring post, opinion, engineering deep dive, event recap, or other non-ship.' },
] as const;

export type ShipKind = (typeof SHIP_KINDS)[number]['value'];

export type DecisionMark = {
  isRealShip: number;
  inYear: number;
  attribution: Attribution;
  significance: number;
  kind: ShipKind;
  /** is_real_ship × in_2026 (the keep product). */
  confidence: number;
};

export type DecisionsSpend = { inputTokens: number; requests: number; costMicros: number };

export const emptyDecisionsSpend = (): DecisionsSpend => ({ inputTokens: 0, requests: 0, costMicros: 0 });

export function decisionsEnabled(env: DecisionsEnv): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export function decisionsCostMicros(inputTokens: number): number {
  return Math.ceil(inputTokens * IN_PER_M);
}

export const SIGNIFICANCE_LEVELS = [
  { label: 'minor fix', description: 'A patch, typo, or internal tweak.' },
  { label: 'feature', description: 'A real feature or version bump people can use.' },
  { label: 'notable launch', description: 'A public launch, PH post, or new tool.' },
  { label: 'major product', description: 'A new product or a flagship upgrade.' },
  { label: 'landmark', description: 'A once-a-year ship that defines the company.' },
] as const;

const ATTRIBUTION_CHOICES = [
  { value: 'personal', description: 'The person shipped this themselves (repo, indie app, personal site).' },
  { value: 'company-led-by-person', description: 'A product or team this person leads (e.g. Codex under a Codex lead).' },
  { value: 'company-founded-by-person', description: 'A company-wide ship that counts because they founded or run the company.' },
  { value: 'unrelated', description: 'Someone else shipped this; it should not be on this receipt.' },
] as const;

type Answer =
  | { type: 'predicate'; name: string; probability: number }
  | { type: 'choice'; name: string; choice: string; confidence?: number }
  | { type: 'score'; name: string; score: number; confidence?: number }
  | { type: 'refusal'; name?: string };

type DecisionResponse = { answers?: Answer[]; usage?: { input_tokens?: number; prompt_tokens?: number } };

const CANDIDATE_QUESTIONS = [
  {
    type: 'predicate',
    name: 'is_real_ship',
    instructions:
      'A ship is a product, feature, model, app, version, or release MADE AVAILABLE to users. A GitHub repo, npm package, Product Hunt launch, or App Store app this person published in 2026 IS a ship. Tutorials, how-tos, case studies, customer stories ("X uses PRODUCT"), research papers, system cards, hiring posts, opinion, engineering deep dives, event recaps, teasers, roadmaps, and retweets are NOT ships — answer no, even if they mention the product.',
  },
  {
    type: 'predicate',
    name: 'in_2026',
    instructions: 'Did it ship between 2026-01-01 and today (a 2026 release date, launch post, first public version, or changelog entry)?',
  },
  {
    type: 'choice',
    name: 'kind',
    instructions:
      'What kind of ship is this? Pick NOT_A_SHIP for tutorials, how-tos, case studies, customer stories, research papers, hiring posts, opinion, engineering deep dives, and event recaps.',
    choices: SHIP_KINDS,
  },
  {
    type: 'choice',
    name: 'attribution',
    instructions: 'Who does this ship belong to, given the person and their role? A product lead only gets their product plus things they personally posted that they shipped. A CEO gets company-wide ships.',
    choices: ATTRIBUTION_CHOICES,
  },
  {
    type: 'score',
    name: 'significance',
    instructions: 'How significant is this ship on a public receipt?',
    levels: SIGNIFICANCE_LEVELS,
  },
];

function evidenceOf(item: Found, who: string, affiliation: Affiliation, year: number): string {
  return [
    `Person: ${who}`,
    affiliation.company ? `Company: ${affiliation.company}` : '',
    `Role: ${affiliation.role}${affiliation.product ? ` (leads ${affiliation.product})` : ''}`,
    affiliation.role === 'lead' && affiliation.product
      ? `This person leads ${affiliation.product} only. Other ${affiliation.company ?? 'company'} products are unrelated unless harvest source is github, x, npm, producthunt, appstore, or site (they personally posted it).`
      : affiliation.typedCompany && affiliation.company
        ? `They were looked up as being from ${affiliation.company}. Keep that company's dated changelog ships.`
        : '',
    `Year: ${year}`,
    `Candidate: ${item.name}`,
    item.description ? `Description: ${item.description}` : '',
    item.date ? `Date: ${item.date}` : 'Date: unknown',
    item.link ? `Source: ${item.link}` : '',
    `Harvest source: ${item.source}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function decide(env: DecisionsEnv, input: string, questions: unknown[]): Promise<{ answers: Answer[]; inputTokens: number } | null> {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const base = (env.OPENAI_API_BASE || 'https://api.openai.com').replace(/\/+$/, '');
  const response = await fetch(`${base}/v1/decisions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: DECISIONS_MODEL, input, questions }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) {
    if (response) console.warn('shipped: decisions', response.status, (await response.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const body = (await response.json().catch(() => null)) as DecisionResponse | null;
  if (!body?.answers) return null;
  const inputTokens = body.usage?.input_tokens ?? body.usage?.prompt_tokens ?? Math.ceil(input.length / 4);
  return { answers: body.answers, inputTokens };
}

function pick(answers: Answer[], name: string): Answer | undefined {
  return answers.find((a) => 'name' in a && a.name === name);
}

const NOT_A_SHIP =
  /\b(how to|tutorial|case stud(?:y|ies)|customer stor(?:y|ies)|deep dive|event recap|hiring|we.?re hiring|opinion piece|explainer|what we learned|behind the scenes|lessons? from|research paper|whitepaper|preprint|teas(?:e|ing)|coming soon|roadmap|retweet|rt @|customer spotlight|success stor(?:y|ies)|frontier firms|pulling ahead|what i ship(?:ped)? here)\b/i;

export function looksLikeNotAShip(item: { name?: string; description?: string; link?: string | null }): boolean {
  const name = (item.name ?? '').trim();
  const hay = `${item.name ?? ''} ${item.description ?? ''} ${item.link ?? ''}`;
  if (/^authors?\s*[:\-–—]/i.test(name)) return true;
  if (/^week of\b/i.test(name)) return true;
  if (/^by\s+\S/i.test(name)) return true;
  if (NOT_A_SHIP.test(hay)) return true;
  if (/^how\s+\w+\s+is\b/i.test(name)) return true;
  if (/\baccelerating\b/i.test(name) && !/\b(launch|released?|version|v\d)\b/i.test(name)) return true;
  if (/^[A-Za-z0-9][\w.-]{1,40}\s+(builds|engineers?)\b/i.test(name)) return true;
  if (/\busing\b.{0,48}\bto\s+(search|find|build|make|create|train)\b/i.test(name)) return true;
  if (/^(rapidly|safely|simply)\s+\w+ing\b/i.test(name)) return true;
  if (/\b(uses|using)\b.{0,48}\b(to|for)\b/i.test(name)) return true;
  if (/\bsystem card\b/i.test(name)) return true;
  if (/\b(gartner|cfo council|analyst|keynote)\b/i.test(name)) return true;
  if (/^(blog|company|research|sign in|contact|resources|customers|support|next|submit now|see the changelog|timeline|of the year|do not sell|series [abc]|what i ship)\b/i.test(name)) return true;
  if (/^(inside|beyond|securing|decision time|cfos?)\b/i.test(name)) return true;
  if (/\b(ships faster with|running .{0,40} safely|harness engineering|beyond rate limits|leveraging|economics of|guidance)\b/i.test(name)) return true;
  if (/^(output:|screenshot|to get started|each dot |design \()/i.test(name)) return true;
  if (/^(launched|released|shipped|live|available)(\s+as(\s+a)?\s+\w+)?$/i.test(name)) return true;
  if (/^v?\d+(?:\.\d+){1,4}[a-z0-9.-]*$/i.test(name) || /^20\d\d(?:-\d{2}){0,2}$/.test(name)) return true;
  if (/\/(customers|topic|resources|support)(\/|$)/i.test(item.link ?? '')) return true;
  if (/\/(research|blog)\//i.test(item.link ?? '') && /\b(how |why |tutorial|case |stor(?:y|ies)|accelerat|engineers?|rakuten|ramp )\b/i.test(name)) return true;
  return false;
}

function scopedAttribution(item: Found, affiliation: Affiliation): Attribution {
  const tokens = leadProductTokens(affiliation.product, affiliation.company).map((t) => t.toLowerCase());
  const hay = `${item.name} ${item.description} ${item.link ?? ''}`.toLowerCase();
  const matchesProduct = tokens.length ? tokens.some((token) => hay.includes(token)) : false;
  const isLead = affiliation.role === 'lead' || (affiliation.typedCompany && Boolean(affiliation.product));
  if (isLead && item.via) {
    return matchesProduct ? 'company-led-by-person' : 'unrelated';
  }
  if (item.via) return defaultAttribution(affiliation.role, affiliation.typedCompany);
  return 'personal';
}

export function heuristicMark(item: Found, year: number, affiliation: Affiliation): DecisionMark {
  const name = `${item.name} ${item.description}`.toLowerCase();
  const tease = /\b(teas(e|ing)|coming soon|hiring|we.?re hiring|roadmap|soon|maybe|thinking about|retweet|rt @)\b/i.test(name);
  const article = looksLikeNotAShip(item);
  const dated = Boolean(item.date && item.date.startsWith(String(year)));
  const thisYear = Boolean(item.thisYear) || dated;
  const isRealShip = article ? 0.08 : tease ? 0.15 : item.link ? 0.88 : 0.4;
  const changelogYear = (item.source === 'changelog' || item.source === 'company') && thisYear;
  const inYear = dated ? 0.9 : changelogYear ? 0.86 : thisYear ? 0.82 : item.date ? 0.15 : 0.45;
  const attribution = scopedAttribution(item, affiliation);
  const significance = Math.min(4, Math.max(0, Math.round(Math.log10(1 + (item.score ?? 1)) * 2)));
  const kind: ShipKind = article || tease ? 'NOT_A_SHIP' : changelogYear || dated ? 'release_version' : 'feature';
  return { isRealShip, inYear, attribution, significance, kind, confidence: isRealShip * inYear };
}

export function shouldKeep(mark: DecisionMark, item?: Found): boolean {
  if (mark.attribution === 'unrelated') return false;
  const personal = item ? isPersonalShipSource(item) && !looksLikeNotAShip(item) : false;
  if (mark.kind === 'NOT_A_SHIP' && !personal) return false;
  if (personal && (item?.thisYear || (item?.date && /^\d{4}/.test(item.date)))) return true;
  return mark.isRealShip * mark.inYear >= KEEP_PRODUCT;
}

function markFromAnswers(answers: Answer[], fallback: DecisionMark, item?: Found): DecisionMark {
  const real = pick(answers, 'is_real_ship');
  const year = pick(answers, 'in_2026');
  const attr = pick(answers, 'attribution');
  const sig = pick(answers, 'significance');
  const kindAns = pick(answers, 'kind');
  let isRealShip = real?.type === 'predicate' ? real.probability : fallback.isRealShip;
  const inYear = year?.type === 'predicate' ? year.probability : fallback.inYear;
  const attribution = attr?.type === 'choice' && ATTRIBUTION_CHOICES.some((c) => c.value === attr.choice) ? (attr.choice as Attribution) : fallback.attribution;
  const significance = sig?.type === 'score' ? sig.score : fallback.significance;
  let kind = kindAns?.type === 'choice' && SHIP_KINDS.some((c) => c.value === kindAns.choice) ? (kindAns.choice as ShipKind) : fallback.kind;
  if (item && kind === 'NOT_A_SHIP' && isPersonalShipSource(item) && !looksLikeNotAShip(item)) {
    kind = 'release_version';
    if (isRealShip < 0.75) isRealShip = 0.8;
  }
  // Dated first-party changelog cards are already ships. Do not let the model
  // flatten a Codex tape into "NOT_A_SHIP" version-bump noise.
  if (item && kind === 'NOT_A_SHIP' && isDatedChangelogShip(item) && !looksLikeNotAShip(item)) {
    kind = 'release_version';
    if (isRealShip < 0.8) isRealShip = 0.85;
  }
  if (item && attribution === 'unrelated' && isDatedChangelogShip(item) && fallback.attribution !== 'unrelated' && !looksLikeNotAShip(item)) {
    return { ...fallback, isRealShip: Math.max(isRealShip, fallback.isRealShip, 0.85), inYear: Math.max(inYear, fallback.inYear), kind: kind === 'NOT_A_SHIP' ? 'release_version' : kind, confidence: 0.7 };
  }
  const confidence = (attr?.type === 'choice' ? attr.confidence ?? 0.6 : 0.6) * isRealShip * inYear;
  return { isRealShip, inYear, attribution, significance, kind, confidence };
}

export function applyMark(item: Found, mark: DecisionMark, via: string | null): Found {
  return {
    ...item,
    via: mark.attribution === 'personal' ? null : via || item.via,
    confidence: mark.confidence,
    isRealShip: mark.isRealShip,
    inYear: mark.inYear,
    significance: mark.significance,
    attribution: mark.attribution,
    kind: mark.kind,
    score: item.score + mark.significance * 2 + mark.confidence,
  };
}

export async function verifyCandidates(opts: {
  env: DecisionsEnv;
  items: Found[];
  year: number;
  who: string;
  affiliation: Affiliation;
  via: string | null;
}): Promise<{ items: Found[]; spend: DecisionsSpend; usedDecisions: boolean }> {
  const spend = emptyDecisionsSpend();
  if (!opts.items.length) return { items: [], spend, usedDecisions: false };
  if (!decisionsEnabled(opts.env)) {
    const kept = opts.items
      .map((item) => applyMark(item, heuristicMark(item, opts.year, opts.affiliation), opts.via))
      .filter((item) => shouldKeep(heuristicMark(item, opts.year, opts.affiliation), item));
    return { items: kept, spend, usedDecisions: false };
  }

  const kept: Found[] = [];
  const batch = 6;
  /** Hard cap so a 200-candidate tape cannot hold the print lock on 15s timeouts. */
  const queue = [...opts.items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const toDecide = queue.slice(0, 100);
  const heuristicRest = queue.slice(100);
  for (const item of heuristicRest) {
    const mark = heuristicMark(item, opts.year, opts.affiliation);
    if (shouldKeep(mark, item)) kept.push(applyMark(item, mark, opts.via));
  }
  for (let i = 0; i < toDecide.length; i += batch) {
    const chunk = toDecide.slice(i, i + batch);
    const rows = await Promise.all(
      chunk.map(async (item) => {
        const fallback = heuristicMark(item, opts.year, opts.affiliation);
        if (looksLikeNotAShip(item)) return { item, mark: fallback };
        const result = await decide(opts.env, evidenceOf(item, opts.who, opts.affiliation, opts.year), CANDIDATE_QUESTIONS);
        if (!result) return { item, mark: fallback };
        spend.inputTokens += result.inputTokens;
        spend.requests += 1;
        return { item, mark: markFromAnswers(result.answers, fallback, item) };
      }),
    );
    for (const row of rows) {
      if (!shouldKeep(row.mark, row.item)) continue;
      kept.push(applyMark(row.item, row.mark, opts.via));
    }
  }
  spend.costMicros = decisionsCostMicros(spend.inputTokens);
  console.log(JSON.stringify({ shipped: 'decisions', items: opts.items.length, kept: kept.length, ...spend }));
  return { items: kept, spend, usedDecisions: true };
}

const loose = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const STOP_SHIP = new Set([
  'the',
  'and',
  'for',
  'app',
  'desktop',
  'cli',
  'api',
  'web',
  'new',
  'now',
  'from',
  'with',
  'via',
  'launch',
  'launched',
  'launches',
  'introduces',
  'introduced',
  'introducing',
  'released',
  'release',
  'ships',
  'shipped',
  'available',
  'live',
  'flow',
  'version',
]);

function coreTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_SHIP.has(token)),
  );
}

function isDatedChangelogShip(item: Found): boolean {
  if (item.source !== 'changelog' && item.source !== 'company') return false;
  return Boolean(item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.thisYear !== false);
}

function containedName(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A bare product word ("Codex") is not the same ship as a versioned card ("Codex app 26.608").
  if (shorter.length <= 8 && !/\d/.test(shorter) && /\d/.test(longer)) return false;
  const at = longer.indexOf(shorter);
  if (at < 0) return false;
  const after = longer.slice(at + shorter.length);
  const before = longer.slice(0, at);
  if (after && /^\d/.test(after)) return false;
  if (before && /\d$/.test(before)) return false;
  return true;
}

export function shareKeywords(
  a: { name: string; link?: string | null; date?: string | null },
  b: { name: string; link?: string | null; date?: string | null },
): boolean {
  const x = loose(a.name);
  const y = loose(b.name);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  const day = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');
  // Dated changelog cards are different ships even when they share "Codex" + "app".
  if (day(a.date) && day(b.date) && day(a.date) !== day(b.date) && x !== y) return false;
  if (containedName(x, y)) return true;
  const ta = coreTokens(a.name);
  const tb = coreTokens(b.name);
  let overlap = 0;
  for (const token of ta) if (tb.has(token)) overlap += 1;
  if (overlap >= 2) return true;
  const host = (url: string | null) => {
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  };
  const pathOf = (url: string | null) => {
    try {
      return url ? new URL(url).pathname.replace(/\/+$/, '').toLowerCase() : '';
    } catch {
      return '';
    }
  };
  const pa = pathOf(a.link);
  const pb = pathOf(b.link);
  const changelogIndex = (path: string) =>
    /\/(changelog|release-notes|whats-new|updates|docs\/changelog|docs\/whats-new)(\/|$)/i.test(path);
  if (a.link && b.link && host(a.link) && host(a.link) === host(b.link) && pa && pb && pa !== '/') {
    // One changelog index lists many ships; sharing that URL is not the same launch.
    if (changelogIndex(pa) || changelogIndex(pb)) return false;
    if (pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)) return true;
  }
  return false;
}

/** Drop the weaker of two candidates Decisions (or heuristics) say are the same ship. */
export async function dedupeSameShips(opts: { env: DecisionsEnv; items: Found[] }): Promise<{ items: Found[]; spend: DecisionsSpend }> {
  const spend = emptyDecisionsSpend();
  const items = [...opts.items];
  const drop = new Set<number>();
  let pairCalls = 0;
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (drop.has(j) || !shareKeywords(items[i], items[j])) continue;
      let same = loose(items[i].name) === loose(items[j].name);
      if (!same && decisionsEnabled(opts.env) && pairCalls < 25) {
        const result = await decide(
          opts.env,
          `A: ${items[i].name} ${items[i].link ?? ''} ${items[i].description}\nB: ${items[j].name} ${items[j].link ?? ''} ${items[j].description}`,
          [
            {
              type: 'predicate',
              name: 'same_ship_as',
              instructions: 'Are A and B the same shipped product, feature, or launch (a repo and its site, a package and its GitHub)?',
            },
          ],
        );
        if (result) {
          pairCalls += 1;
          spend.inputTokens += result.inputTokens;
          spend.requests += 1;
          const answer = pick(result.answers, 'same_ship_as');
          same = answer?.type === 'predicate' ? answer.probability >= 0.7 : same;
        }
      }
      if (!same) continue;
      const weaker = (items[i].significance ?? 0) + (items[i].score ?? 0) >= (items[j].significance ?? 0) + (items[j].score ?? 0) ? j : i;
      drop.add(weaker);
    }
  }
  spend.costMicros = decisionsCostMicros(spend.inputTokens);
  return { items: items.filter((_, i) => !drop.has(i)), spend };
}

export function sortBySignificance(items: Found[]): Found[] {
  return [...items].sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0) || (b.score ?? 0) - (a.score ?? 0) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

export function sortByDate(items: Found[]): Found[] {
  return [...items].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (b.significance ?? 0) - (a.significance ?? 0));
}

/** Fast verify for the first-paint tape. Decisions still run on the full pass. */
export function heuristicVerify(items: Found[], year: number, affiliation: Affiliation, via: string | null): Found[] {
  return items
    .map((item) => {
      const mark = heuristicMark(item, year, affiliation);
      return shouldKeep(mark, item) ? applyMark(item, mark, via) : null;
    })
    .filter((item): item is Found => Boolean(item));
}

/** Confirm a cheap name→handle guess before we treat it as the person. */
export async function verifyResolvedPerson(opts: {
  env: DecisionsEnv;
  query: string;
  company: string | null;
  candidate: { name: string | null; handle: string | null; company: string | null; role: string | null; product: string | null };
}): Promise<{ keep: boolean; spend: DecisionsSpend }> {
  const spend = emptyDecisionsSpend();
  const hasIdentity = Boolean(opts.candidate.handle || (opts.candidate.name && /\s/.test(opts.candidate.name || '')));
  if (!hasIdentity) return { keep: false, spend };
  if (!decisionsEnabled(opts.env)) return { keep: true, spend };
  const input = [
    `Typed query: ${opts.query}`,
    `Company hint: ${opts.company ?? 'none'}`,
    `Candidate name: ${opts.candidate.name ?? ''}`,
    `Handle: ${opts.candidate.handle ? `@${opts.candidate.handle}` : ''}`,
    `Company: ${opts.candidate.company ?? ''}`,
    `Role: ${opts.candidate.role ?? ''}`,
    `Product: ${opts.candidate.product ?? ''}`,
  ].join('\n');
  const result = await decide(opts.env, input, [
    {
      type: 'predicate',
      name: 'is_same_person',
      instructions: 'Is this candidate the real person the typed query refers to (same human, not a namesake or the company account)?',
    },
  ]);
  if (!result) return { keep: true, spend };
  spend.inputTokens = result.inputTokens;
  spend.requests = 1;
  spend.costMicros = decisionsCostMicros(result.inputTokens);
  const answer = pick(result.answers, 'is_same_person');
  const keep = answer?.type === 'predicate' ? answer.probability >= 0.55 : true;
  return { keep, spend };
}
