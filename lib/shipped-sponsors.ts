// The sponsor block at the foot of every Shipped 2026 receipt, share image and mailed print: one hero slot on
// top and a 3×3 grid of nine small slots. Each slot has a name (or 1-bit logo), a one-line call to action and
// its own QR code to the sponsor's link.
//
// Pure bidding, enforced on the server. House ads are $0 and are not bids: the first outside bid is $1.
// After that each raise is a whole-dollar amount, at least +$1 and at most +max($5, floor(10% of the holder's
// price)). The holder cannot raise their own slot. A takeover cools the slot for 60 seconds. A bid in the last
// 10 minutes of that slot extends that slot by 10 minutes. A sponsor who is taken over is refunded for the time
// they lose: payment × (time left until that slot's close) / (time from going live until close). Checkouts that
// miss the price, arrive after the slot closes, or come from the holder are refunded in full. Logos print only
// after a review; a slot taken down in review is refunded in full.

export const SLOT_COUNT = 10;
export const HERO_SLOT = 0;

export const BID_RULES = {
  minCents: 100,
  incrementCents: 100,
  /** Floor of the max raise: $5, or 10% of the current price when that's bigger. */
  maxRaiseFloorCents: 500,
  maxCents: 500_000,
  /** Stripe's shortest checkout; checkouts in progress don't hold the slot. */
  checkoutMinutes: 30,
  /** Bidding stays open until the slot's close (anti-snipe extends the slot, not a separate lock). */
  lockMinutes: 0,
  /** After a slot changes hands, nobody else can take it for this long. */
  cooldownSeconds: 60,
  /** A bid inside this window before that slot's close slides that slot forward. */
  antiSnipeMinutes: 10,
};

export const lockAt = (closesAt: number) => closesAt - BID_RULES.lockMinutes * 60_000;

/** Whether this slot can still change hands at `now` (per-slot close, which anti-snipe can extend). */
export const takeoversOpen = (now: number, closesAt: number) => now < lockAt(closesAt);

const COOLDOWN_MS = BID_RULES.cooldownSeconds * 1000;

/** True while this slot's current holder just went live (the next buyer has to wait). */
export const slotCooling = (liveAt: number | null | undefined, now: number) => Boolean(liveAt && now - liveAt < COOLDOWN_MS);

export const cooldownUntil = (liveAt: number | null | undefined) => (liveAt && liveAt > 0 ? liveAt + COOLDOWN_MS : null);

/** A paid takeover this close to the slot's close extends that slot so the next person can still answer. */
export const inAntiSnipeWindow = (now: number, closesAt: number) => {
  const lock = lockAt(closesAt);
  return now >= lock - BID_RULES.antiSnipeMinutes * 60_000 && now < lock;
};

export const extendClose = (closesAt: number) => closesAt + BID_RULES.antiSnipeMinutes * 60_000;

const wholeDollars = (cents: number) => Number.isSafeInteger(cents) && cents >= 0 && cents % 100 === 0;

/** Max raise in cents: +$1 on a house ad; otherwise +max($5, floor(10% of the current whole-dollar price)). */
export function maxRaiseCents(currentCents: number): number {
  if (!wholeDollars(currentCents) || currentCents <= 0) return BID_RULES.minCents;
  const tenPercent = Math.floor(currentCents / 1000) * 100;
  return Math.max(BID_RULES.maxRaiseFloorCents, tenPercent);
}

export type BidRange = { min: number; max: number };

/** Posted range to take a slot: $1 on a house ad, else [holder+$1, holder+max raise], capped, whole dollars. */
export function bidRange(currentCents: number): BidRange {
  const current = wholeDollars(currentCents) ? currentCents : 0;
  if (current <= 0) return { min: BID_RULES.minCents, max: BID_RULES.minCents };
  const min = Math.min(BID_RULES.maxCents, current + BID_RULES.incrementCents);
  const max = Math.min(BID_RULES.maxCents, current + maxRaiseCents(current));
  return { min, max: Math.max(min, max) };
}

export const slotPrice = (currentCents: number) => bidRange(currentCents).min;
export const minimumBid = slotPrice;
export const maximumBid = (currentCents: number) => bidRange(currentCents).max;

/** True when `cents` is a legal whole-dollar bid against the current holder (0 = house ad). */
export function isValidBid(currentCents: number, cents: number): boolean {
  if (!wholeDollars(cents) || cents < BID_RULES.minCents || cents > BID_RULES.maxCents) return false;
  const { min, max } = bidRange(currentCents);
  return cents >= min && cents <= max;
}

/** Same Stripe email = the current holder trying to raise their own price. */
export function sameHolder(a?: string | null, b?: string | null): boolean {
  const one = (a ?? '').trim().toLowerCase();
  const two = (b ?? '').trim().toLowerCase();
  return Boolean(one && one === two);
}

/** First paid sponsor is #001, then #002… */
export const sponsorTag = (serial: number) => `SPONSOR #${String(serial).padStart(3, '0')}`;

export const SLOT_LIMITS = {
  hero: { name: 26, cta: 48 },
  small: { name: 16, cta: 30 },
};

export type HouseSlot = { slot: number; name: string; cta: string; url: string };

/** Live and active work from data/shipped/businesses.json (never the maker's own site). */
export const HOUSE_SLOTS: HouseSlot[] = [
  { slot: 0, name: 'POCKET FACTORY', cta: 'Custom NFC tap cards for your business.', url: 'https://getpocketfactory.com/' },
  { slot: 1, name: 'MOPKIN', cta: 'Snap your mess. Get one step.', url: 'https://mopkin.app/' },
  { slot: 2, name: 'HABITUIZE', cta: 'Habits that survive missed days.', url: 'https://habituize.app/' },
  { slot: 3, name: 'NONPARALLEL', cta: 'Music, merch, artist sites.', url: 'https://nonprllel.com/' },
  { slot: 4, name: 'COVER ART', cta: 'Album covers, made to order.', url: 'https://nonprllel.com/' },
  { slot: 5, name: 'PROFITSCANNER', cta: 'Scan thrift. Spot the flip.', url: 'https://getprofitscanner.com/' },
  { slot: 6, name: 'ENTRELABZ', cta: 'Apps and sites in weeks.', url: 'https://entrelabz.com/' },
  { slot: 7, name: 'EMBODY ELEGANCE', cta: 'Color analysis and styling.', url: 'https://embody-elegance.com/' },
  { slot: 8, name: 'ZONOVA', cta: 'Med spa. Book online.', url: 'https://www.zonovaaesthetics.com/' },
  { slot: 9, name: 'BEARADISE', cta: 'Smoky Mountain cabin. Book direct.', url: 'https://absolutebearadise.com/' },
];

export const isSlot = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < SLOT_COUNT;

/** Same-origin color mark for a house slot (Brandfetch / favicon, never a thermal 1-bit). */
export const houseMarkPath = (slot: number) => (isSlot(slot) ? `/api/shipped/mark/${slot}` : null);

/** One or two letters for when a mark image is missing. */
export function monogram(name: string): string {
  const words = name.trim().split(/[\s/]+/).filter((word) => /[A-Za-z0-9]/.test(word));
  if (words.length >= 2) {
    const a = words[0].match(/[A-Za-z0-9]/)?.[0] ?? '';
    const b = words[1].match(/[A-Za-z0-9]/)?.[0] ?? '';
    return (a + b).toUpperCase() || '?';
  }
  const letters = (words[0] ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return (letters[0] || '?').toUpperCase();
}
export const slotLabel = (slot: number) => (slot === HERO_SLOT ? 'HERO' : `SLOT ${slot}`);
export const limitsFor = (slot: number) => (slot === HERO_SLOT ? SLOT_LIMITS.hero : SLOT_LIMITS.small);

/** What an outbid sponsor gets back: their payment for the share of the run they lose, in whole cents. */
export function proratedRefund(paidCents: number, liveAt: number, outbidAt: number, closesAt: number): number {
  const run = closesAt - liveAt;
  if (run <= 0 || outbidAt >= closesAt) return 0;
  const left = Math.min(run, Math.max(0, closesAt - outbidAt));
  return Math.max(0, Math.min(paidCents, Math.floor((paidCents * left) / run)));
}

export const LOGO_LIMITS = { maxBytes: 64_000, maxWidth: 384, maxHeight: 160 };

// A short list on purpose: every bid can be taken down from /admin.
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
const PRINTABLE = /^[A-Za-z0-9\u00C0-\u024F .,'&!?+#@()\-_/:$%]+$/;

export function cleanSponsorText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Scam and impersonation wording: a sponsor line on a stranger's receipt must never look like a giveaway,
// a wallet prompt or a message from a payment company.
const SCAM = /\b(air ?drops?|giveaways?|free (money|crypto|btc|eth|nft)|seed ?phrase|private ?key|recovery ?phrase|wallet ?connect|connect (your )?wallet|claim (your|now|free)|double your|verify (your )?(account|identity|wallet)|account (suspended|locked)|urgent|stripe|paypal|apple pay|google pay|cash ?app|venmo|zelle|irs|login|log in|sign in to|password|bitcoin|crypto|nft|forex|betting|casino|gambl\w*|loan|payday|viagra|cialis|escort)\b/i;

/** Link shorteners and redirectors hide where a QR code really goes. */
const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc',
  'rb.gy', 'lnkd.in', 'bl.ink', 'short.io', 'v.gd', 'qrco.de', 'linktr.ee', 'beacons.ai', 'l.ead.me', 'urlz.fr', 's.id',
  'trib.al', 'dub.sh', 'shorturl.com', 'x.gd', 'clck.ru', 'adf.ly', 'bitly.com', 'tr.ee', 'msha.ke', 'snip.ly',
]);
/** TLDs that are mostly abuse in practice, and anonymous hosting/tunnels. */
const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'tk', 'ml', 'ga', 'cf', 'gq', 'click', 'country', 'kim', 'work', 'rest', 'fit', 'loan', 'win', 'bid', 'icu', 'cam', 'monster', 'support', 'onion', 'su', 'ru', 'cn']);
const RISKY_HOST = /(^|\.)(ngrok(-free)?\.(io|app|dev)|trycloudflare\.com|workers\.dev|pages\.dev|vercel\.app|netlify\.app|glitch\.me|repl\.co|000webhostapp\.com|duckdns\.org|no-ip\.\w+|ddns\.net|blogspot\.com|weebly\.com|wixsite\.com|firebaseapp\.com|web\.app|herokuapp\.com|github\.io|gitlab\.io|sites\.google\.com|forms\.gle|docs\.google\.com|drive\.google\.com|dropbox\.com|mega\.nz|t\.me|telegram\.(me|org)|wa\.me|discord\.(gg|com))$/;
/** Wildcard DNS that resolves to whatever IP is in the name (127.0.0.1.nip.io): an IP in disguise. */
const IP_IN_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|nip\.direct|traefik\.me|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com|localho\.st|1u\.ms|rbndr\.us)$/;
/** Brand names that aren't the brand's own domain are impersonation. */
const IMPERSONATED = /(paypal|stripe|apple|google|microsoft|metamask|coinbase|binance|amazon|chase|wellsfargo|bankofamerica|venmo|cashapp|irs|usps|fedex|ups|dhl|github|openai|anthropic|brytonzoz)/;

export type UrlProblem = 'format' | 'https' | 'host' | 'shortener' | 'risky' | 'lookalike';

export function sponsorUrlProblem(raw: string): { url: string } | { problem: UrlProblem } {
  let value = raw.trim();
  if (value.length > 200 || /[\s<>"'`\\]/.test(value)) return { problem: 'format' };
  if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem: 'format' };
  }
  if (url.protocol !== 'https:') return { problem: 'https' };
  if (url.username || url.password || url.port) return { problem: 'format' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || /^[\d.]+$/.test(host) || host.includes(':') || /^\[/.test(host) || /\.(local|localhost|internal|lan|home|arpa|test|invalid|example)$/.test(host) || host === 'localhost') {
    return { problem: 'host' };
  }
  if (!/^[a-z]{2,24}$/.test(tld) || labels.some((label) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return { problem: 'host' };
  if (IP_IN_DNS.test(host)) return { problem: 'host' };
  if (labels.some((label) => label.startsWith('xn--'))) return { problem: 'lookalike' };
  if (SHORTENERS.has(host) || SHORTENERS.has(labels.slice(-2).join('.'))) return { problem: 'shortener' };
  if (RISKY_TLDS.has(tld) || RISKY_HOST.test(host)) return { problem: 'risky' };
  const registrable = labels.slice(-2)[0];
  const brand = host.match(IMPERSONATED)?.[1];
  if (brand && registrable !== brand) return { problem: 'lookalike' };
  if (/[?&](url|redirect|redirect_uri|next|dest|destination|goto|continue|return|returnto|r|u)=/i.test(url.search)) return { problem: 'risky' };
  url.hash = '';
  url.hostname = host;
  return { url: url.toString() };
}

export function checkSponsorUrl(raw: string): string | null {
  const result = sponsorUrlProblem(raw);
  return 'url' in result ? result.url : null;
}

export const hasScamWording = (text: string) => SCAM.test(text.normalize('NFKC'));

const URL_MESSAGES: Record<UrlProblem, string> = {
  format: 'A public https:// link.',
  https: 'Links have to start with https://.',
  host: 'A public website, please.',
  shortener: 'Use the real link, not a shortener.',
  risky: 'That host isn\u2019t accepted. Use your own domain.',
  lookalike: 'That domain looks like another brand.',
};

export type BidInput = { slot: number; name: string; cta: string; url: string };
export type BidCheck = { ok: true; name: string; cta: string; url: string } | { ok: false; field: 'name' | 'cta' | 'url'; error: string };

/** The same checks in the sheet (as you type) and in the Worker (before checkout). */
export function validateBid(input: BidInput): BidCheck {
  const limits = limitsFor(input.slot);
  const name = cleanSponsorText(input.name ?? '');
  const cta = cleanSponsorText(input.cta ?? '');
  if (name.length < 2) return { ok: false, field: 'name', error: 'Name it (2+ characters).' };
  if (name.length > limits.name) return { ok: false, field: 'name', error: `${limits.name} characters max.` };
  if (!PRINTABLE.test(name)) return { ok: false, field: 'name', error: 'Letters, numbers, basic punctuation.' };
  if (URL_LIKE.test(name)) return { ok: false, field: 'name', error: 'The link goes in the link field.' };
  if (hasBlockedWord(name) || hasScamWording(name)) return { ok: false, field: 'name', error: 'Try different words.' };
  if (cta.length < 2) return { ok: false, field: 'cta', error: 'One line. What should people do?' };
  if (cta.length > limits.cta) return { ok: false, field: 'cta', error: `${limits.cta} characters max.` };
  if (!PRINTABLE.test(cta)) return { ok: false, field: 'cta', error: 'Letters, numbers, basic punctuation.' };
  if (URL_LIKE.test(cta)) return { ok: false, field: 'cta', error: 'The QR code carries the link.' };
  if (hasBlockedWord(cta) || hasScamWording(cta)) return { ok: false, field: 'cta', error: 'Try different words.' };
  const checked = sponsorUrlProblem(input.url ?? '');
  if (!('url' in checked)) return { ok: false, field: 'url', error: URL_MESSAGES[checked.problem] };
  if (hasBlockedWord(checked.url) || hasScamWording(new URL(checked.url).hostname.replace(/[.-]/g, ' '))) return { ok: false, field: 'url', error: 'Try a different link.' };
  return { ok: true, name, cta, url: checked.url };
}
