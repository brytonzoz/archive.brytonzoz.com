// Sponsors on /shipped/: your name or logo in the "THIS RECEIPT PAID FOR BY" block on the Shipped receipts
// people print and share (not on Bryton's own receipt page). Paid through Stripe (tax added at checkout),
// approved by Bryton in /admin, then in the rotation for a fixed number of days. No impressions promised.

export type SponsorTier = 'name' | 'logo' | 'header';

export type TierConfig = {
  label: string;
  cents: number;
  /** Days in the rotation from approval. */
  days: number;
  /** Share of the rotation relative to other tiers (a logo line comes up 3× as often as a name line). */
  weight: number;
  /** Most at once (null: no limit). */
  slots: number | null;
  maxText: number;
  /** Takes a link (shown rel="sponsored nofollow"). */
  url: boolean;
  logo: boolean;
  blurb: string;
};

export const SPONSOR_CONFIG = {
  /** Lines in one receipt's PAID FOR BY block (the "presented by" slot is extra, at the top). */
  footerLines: 3,
  /** Unpaid checkouts stop holding a slot after this long. */
  checkoutHoldMinutes: 60,
  tiers: {
    name: {
      label: 'NAME LINE',
      cents: 500,
      days: 7,
      weight: 1,
      slots: null,
      maxText: 32,
      url: false,
      logo: false,
      blurb: 'Your name in the PAID FOR BY block on shared receipts, in rotation for 7 days.',
    },
    logo: {
      label: 'LOGO LINE',
      cents: 2500,
      days: 7,
      weight: 3,
      slots: null,
      maxText: 32,
      url: true,
      logo: true,
      blurb: 'Your logo in 1-bit print with a link in the PAID FOR BY block, in rotation for 7 days.',
    },
    header: {
      label: 'PRESENTED BY',
      cents: 10000,
      days: 7,
      weight: 0,
      slots: 1,
      maxText: 28,
      url: true,
      logo: false,
      blurb: '"Presented by" at the top of every shared receipt\'s PAID FOR BY block for 7 days. One at a time.',
    },
  } satisfies Record<SponsorTier, TierConfig>,
};

/** Shown when no paid sponsor is running: BRYTONZOZ.COM always, plus one rotating house line. */
export const HOUSE_SPONSORS = {
  main: { key: 'house:brytonzoz', text: 'BRYTONZOZ.COM', url: 'https://brytonzoz.com/' },
  rotating: [
    { key: 'house:mopkin', text: 'MOPKIN', url: 'https://mopkin.app/' },
    { key: 'house:habituize', text: 'HABITUIZE', url: 'https://habituize.app/' },
    { key: 'house:pocketfactory', text: 'POCKET FACTORY', url: 'https://getpocketfactory.com/' },
  ],
};

export const SPONSOR_TIERS = Object.keys(SPONSOR_CONFIG.tiers) as SponsorTier[];

export const isSponsorTier = (value: unknown): value is SponsorTier =>
  typeof value === 'string' && (SPONSOR_TIERS as string[]).includes(value);

export const priceCents = (tier: SponsorTier) => SPONSOR_CONFIG.tiers[tier].cents;

/** Deterministic 0..1 from a seed, so a receipt shows the same sponsors for a given hour. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted pick without replacement: each pick's chance is proportional to its tier weight. */
export function weightedPick<T extends { tier: SponsorTier }>(pool: T[], count: number, seed: number): T[] {
  const random = seeded(seed);
  const left = pool.filter((item) => SPONSOR_CONFIG.tiers[item.tier].weight > 0);
  const out: T[] = [];
  while (out.length < count && left.length) {
    const total = left.reduce((sum, item) => sum + SPONSOR_CONFIG.tiers[item.tier].weight, 0);
    let roll = random() * total;
    let index = 0;
    for (; index < left.length - 1; index++) {
      roll -= SPONSOR_CONFIG.tiers[left[index].tier].weight;
      if (roll < 0) break;
    }
    out.push(left.splice(index, 1)[0]);
  }
  return out;
}

export const houseLine = (seed: number) => HOUSE_SPONSORS.rotating[Math.floor(seeded(seed)() * HOUSE_SPONSORS.rotating.length)];

export const LOGO_LIMITS = { maxBytes: 64_000, maxWidth: 384, maxHeight: 160 };

// A short list on purpose: Bryton reviews every line before it prints.
// Matched anywhere (even s-p-a-c-e-d out); short ones only as whole words so "Hitchcock" and "spice" pass.
const BLOCKED_ANYWHERE = ['fuck', 'shit', 'cunt', 'nigg', 'faggot', 'retard', 'whore', 'porn', 'onlyfans', 'hitler'];
const BLOCKED_WORDS = new Set([
  'bitch', 'fag', 'fags', 'rape', 'nazi', 'kike', 'spic', 'chink', 'tranny', 'xxx', 'cock', 'pussy', 'dick', 'ass',
  'asshole', 'slut', 'casino',
]);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

export function hasBlockedWord(text: string): boolean {
  const lower = text.toLowerCase().replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch);
  const flat = lower.replace(/[^a-z]/g, '');
  if (BLOCKED_ANYWHERE.some((word) => flat.includes(word))) return true;
  return lower.split(/[^a-z]+/).some((word) => BLOCKED_WORDS.has(word));
}

const URL_LIKE = /(https?:|www\.|:\/\/|\b[a-z0-9-]+(\.|\(dot\)|\[dot\])(com|net|org|io|co|app|dev|xyz|gg|me|ai|so|sh|ly|to|us|uk|tv|link|site|shop|store)\b)/i;

export type SponsorInput = { tier: SponsorTier; text: string; url?: string | null };
export type SponsorCheck = { ok: true; text: string; url: string | null } | { ok: false; error: string };

export function cleanSponsorText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateSponsor(input: SponsorInput): SponsorCheck {
  const tier = SPONSOR_CONFIG.tiers[input.tier];
  const text = cleanSponsorText(input.text ?? '');
  if (text.length < 2) return { ok: false, error: 'Add at least 2 characters.' };
  if (text.length > tier.maxText) return { ok: false, error: `Keep it to ${tier.maxText} characters.` };
  if (!/^[A-Za-z0-9\u00C0-\u024F .,'&!?+#@()\-_/:]+$/.test(text)) return { ok: false, error: 'Letters, numbers and basic punctuation only.' };
  if (URL_LIKE.test(text)) {
    return { ok: false, error: tier.url ? 'Put the link in the link field, not the text.' : 'Name lines can’t include links or web addresses.' };
  }
  if (hasBlockedWord(text)) return { ok: false, error: 'That line won’t get approved. Try different words.' };

  if (!tier.url || !input.url) return { ok: true, text, url: null };
  const url = checkSponsorUrl(input.url);
  if (!url) return { ok: false, error: 'Use a full https:// link to a public site.' };
  if (hasBlockedWord(url)) return { ok: false, error: 'That link won’t get approved.' };
  return { ok: true, text, url };
}

export function checkSponsorUrl(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 200) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.local') || host === 'localhost') return null;
  return url.toString();
}
