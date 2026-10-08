// Supporter shout-outs on /shipped/: a buyer pays (Stripe, tax added at checkout) for a shout-out printed
// on the receipt plus a downloadable receipt image, Bryton approves it in /admin, and only then does it print.
// No traffic or impressions are promised. Prices, roll size and slots are all set here.

export type SponsorTier = 'name' | 'logo' | 'header';

export type TierConfig = {
  label: string;
  /** Price on roll 1, in cents; later rolls step up by priceStepPercent. */
  baseCents: number;
  maxText: number;
  /** Takes a link (shown rel="sponsored nofollow"). */
  url: boolean;
  logo: boolean;
  blurb: string;
};

export const SPONSOR_CONFIG = {
  /** Every purchase is one numbered line on the current roll; a full roll is archived. */
  rollSize: 500,
  priceStepPercent: 20,
  headerDays: 7,
  headerSlots: 5,
  /** Logo sponsors shown in a generated receipt's "PAID FOR BY" footer. */
  footerRotation: 3,
  /** Unpaid checkouts stop holding a line after this long. */
  checkoutHoldMinutes: 60,
  tiers: {
    name: {
      label: 'NAME LINE',
      baseCents: 500,
      maxText: 32,
      url: false,
      logo: false,
      blurb: 'Your name as a numbered shout-out line on the master receipt.',
    },
    logo: {
      label: 'LOGO LINE',
      baseCents: 2500,
      maxText: 32,
      url: true,
      logo: true,
      blurb: 'Your logo in 1-bit thermal print with a link, plus turns in the "paid for by" rotation on printed receipts.',
    },
    header: {
      label: 'HEADER',
      baseCents: 10000,
      maxText: 28,
      url: true,
      logo: false,
      blurb: 'Your name under "Supported by" at the top of printed receipts for 7 days. 5 slots at a time.',
    },
  } satisfies Record<SponsorTier, TierConfig>,
};

export const SPONSOR_TIERS = Object.keys(SPONSOR_CONFIG.tiers) as SponsorTier[];

export const isSponsorTier = (value: unknown): value is SponsorTier =>
  typeof value === 'string' && (SPONSOR_TIERS as string[]).includes(value);

/** Whole dollars, stepping up per roll: $5 → $6 → $8 …, never below the base. */
export function priceCents(tier: SponsorTier, roll: number): number {
  const base = SPONSOR_CONFIG.tiers[tier].baseCents;
  const factor = (1 + SPONSOR_CONFIG.priceStepPercent / 100) ** Math.max(0, roll - 1);
  return Math.max(base, Math.ceil((base * factor) / 100) * 100);
}

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
