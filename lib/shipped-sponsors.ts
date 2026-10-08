// The sponsor block at the foot of every Shipped 2026 receipt, share image and mailed print: one hero slot on
// top and a 3×3 grid of nine small slots. Each slot has a name (or 1-bit logo), a one-line call to action and
// its own QR code to the sponsor's link.
//
// Fixed price, not an auction: every slot has one posted price, set by the server: $1 for a house ad, else
// what the current holder paid plus $1. Paying it takes the slot. The holder keeps it until someone pays the
// next price or the event ends; when the printer shuts off, whoever holds each slot keeps it forever in the
// frozen archive. A sponsor who is taken over is refunded automatically for the time they lose: their payment
// times (time left until close) / (time from going live until close). Takeovers stop an hour before close so
// nobody can be sniped in the last seconds; a payment that arrives after that, or for a price that has since
// moved, is refunded in full. Logos print only after a review; a slot taken down in review is refunded in full.

export const SLOT_COUNT = 10;
export const HERO_SLOT = 0;

export const BID_RULES = {
  minCents: 100,
  incrementCents: 100,
  maxCents: 500_000,
  /** Stripe's shortest checkout; checkouts in progress don't hold the slot. */
  checkoutMinutes: 30,
  /** No takeovers in the last hour before close. */
  lockMinutes: 60,
};

/** Whether slots can still change hands at `now`. */
export const takeoversOpen = (now: number, closesAt: number) => now < closesAt - BID_RULES.lockMinutes * 60_000;

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
export const slotLabel = (slot: number) => (slot === HERO_SLOT ? 'HERO' : `SLOT ${slot}`);
export const limitsFor = (slot: number) => (slot === HERO_SLOT ? SLOT_LIMITS.hero : SLOT_LIMITS.small);

/** The slot's posted price when its holder paid `currentCents` (0 for a house ad). */
export const minimumBid = (currentCents: number) => Math.max(BID_RULES.minCents, currentCents + BID_RULES.incrementCents);
export const slotPrice = minimumBid;

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
  if (labels.some((label) => label.startsWith('xn--'))) return { problem: 'lookalike' };
  if (SHORTENERS.has(host) || SHORTENERS.has(labels.slice(-2).join('.'))) return { problem: 'shortener' };
  if (RISKY_TLDS.has(tld) || RISKY_HOST.test(host)) return { problem: 'risky' };
  const registrable = labels.slice(-2)[0];
  const brand = host.match(IMPERSONATED)?.[1];
  if (brand && registrable !== brand) return { problem: 'lookalike' };
  if (/[?&](url|redirect|redirect_uri|next|dest|destination|goto|continue|return|returnto|r|u)=/i.test(url.search)) return { problem: 'risky' };
  url.hash = '';
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
