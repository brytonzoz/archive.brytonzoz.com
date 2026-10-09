// OpenAI Decisions API is the verification + ranking layer. ONLY POST /v1/decisions with
// gpt-6-luna. No other OpenAI models or endpoints. Input is $0.10 / 1M tokens; output is free.
// Docs: https://platform.openai.com/docs/guides/decisions
import type { Attribution, Affiliation } from './shipped-affiliation';
import { defaultAttribution } from './shipped-affiliation';
import type { Found } from './shipped-sources';
import { clean } from './shipped-sources';

export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';
export const DECISIONS_MODEL = 'gpt-6-luna';
/** $0.10 per 1M input tokens; output is free. */
const IN_PER_M = 0.1;
export const KEEP_PRODUCT = 0.7;

export type DecisionsEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE?: string;
};

export type DecisionMark = {
  isRealShip: number;
  inYear: number;
  attribution: Attribution;
  significance: number;
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
    instructions: 'Is this a real product, feature, release, or launch that actually shipped? Not a tease, hiring post, opinion, retweet, or roadmap item.',
  },
  {
    type: 'predicate',
    name: 'in_2026',
    instructions: 'Did it ship between 2026-01-01 and today (a 2026 release date, launch post, first public version, or changelog entry)?',
  },
  {
    type: 'choice',
    name: 'attribution',
    instructions: 'Who does this ship belong to, given the person and their role?',
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
    affiliation.role === 'unknown' && affiliation.company
      ? `Note: they were typed as being from ${affiliation.company}. Keep ships they lead, founded, or personally shipped — not every company announcement.`
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

export function heuristicMark(item: Found, year: number, affiliation: Affiliation): DecisionMark {
  const name = `${item.name} ${item.description}`.toLowerCase();
  const tease = /\b(teas(e|ing)|coming soon|hiring|we.?re hiring|roadmap|soon|maybe|thinking about|retweet|rt @)\b/i.test(name);
  const dated = Boolean(item.date && item.date.startsWith(String(year)));
  const thisYear = Boolean(item.thisYear) || dated;
  const isRealShip = tease ? 0.15 : item.link ? 0.82 : 0.4;
  const changelogYear = (item.source === 'changelog' || item.source === 'company') && thisYear;
  const inYear = dated ? 0.9 : changelogYear ? 0.86 : thisYear ? 0.78 : item.date ? 0.15 : 0.45;
  const attribution = item.via ? defaultAttribution(affiliation.role) : 'personal';
  const significance = Math.min(4, Math.max(0, Math.round(Math.log10(1 + (item.score ?? 1)) * 2)));
  return { isRealShip, inYear, attribution, significance, confidence: isRealShip * inYear };
}

export function shouldKeep(mark: DecisionMark): boolean {
  return mark.isRealShip * mark.inYear >= KEEP_PRODUCT && mark.attribution !== 'unrelated';
}

function markFromAnswers(answers: Answer[], fallback: DecisionMark): DecisionMark {
  const real = pick(answers, 'is_real_ship');
  const year = pick(answers, 'in_2026');
  const attr = pick(answers, 'attribution');
  const sig = pick(answers, 'significance');
  const isRealShip = real?.type === 'predicate' ? real.probability : fallback.isRealShip;
  const inYear = year?.type === 'predicate' ? year.probability : fallback.inYear;
  const attribution = attr?.type === 'choice' && ATTRIBUTION_CHOICES.some((c) => c.value === attr.choice) ? (attr.choice as Attribution) : fallback.attribution;
  const significance = sig?.type === 'score' ? sig.score : fallback.significance;
  const confidence = (attr?.type === 'choice' ? attr.confidence ?? 0.6 : 0.6) * isRealShip * inYear;
  return { isRealShip, inYear, attribution, significance, confidence };
}

export function applyMark(item: Found, mark: DecisionMark, via: string | null): Found {
  return {
    ...item,
    via: mark.attribution === 'personal' ? item.via ?? null : via || item.via,
    confidence: mark.confidence,
    isRealShip: mark.isRealShip,
    inYear: mark.inYear,
    significance: mark.significance,
    attribution: mark.attribution,
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
      .filter((item) => shouldKeep(heuristicMark(item, opts.year, opts.affiliation)));
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
    if (shouldKeep(mark)) kept.push(applyMark(item, mark, opts.via));
  }
  for (let i = 0; i < toDecide.length; i += batch) {
    const chunk = toDecide.slice(i, i + batch);
    const rows = await Promise.all(
      chunk.map(async (item) => {
        const fallback = heuristicMark(item, opts.year, opts.affiliation);
        const result = await decide(opts.env, evidenceOf(item, opts.who, opts.affiliation, opts.year), CANDIDATE_QUESTIONS);
        if (!result) return { item, mark: fallback };
        spend.inputTokens += result.inputTokens;
        spend.requests += 1;
        return { item, mark: markFromAnswers(result.answers, fallback) };
      }),
    );
    for (const row of rows) {
      if (!shouldKeep(row.mark)) continue;
      kept.push(applyMark(row.item, row.mark, opts.via));
    }
  }
  spend.costMicros = decisionsCostMicros(spend.inputTokens);
  console.log(JSON.stringify({ shipped: 'decisions', items: opts.items.length, kept: kept.length, ...spend }));
  return { items: kept, spend, usedDecisions: true };
}

const loose = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function shareKeywords(a: Found, b: Found): boolean {
  const x = loose(a.name);
  const y = loose(b.name);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
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
  if (a.link && b.link && host(a.link) && host(a.link) === host(b.link) && pa && pb && pa !== '/' && (pa === pb || pa.includes(pb) || pb.includes(pa))) return true;
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
