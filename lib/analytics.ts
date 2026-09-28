// Anonymous listening metrics for the /admin dashboard. A random id per browser (no cookies, no
// personal data); events are batched and sent with sendBeacon so they never slow the site down.

type EventType = 'view' | 'play' | 'listen' | 'share' | 'outbound' | 'open' | 'like' | 'unlike' | 'product' | 'bag' | 'checkout' | 'purchase';

export type MetricEvent = {
  type: EventType;
  play?: string;
  release?: string;
  track?: string;
  seconds?: number;
  position?: number;
  detail?: string;
  referrer?: string;
};

const ENDPOINT = '/api/e';
const FLUSH_MS = 3000;
const OPT_OUT_KEY = 'bz.noTrack';

let queue: (MetricEvent & { visitor: string; session: string; campaign?: string })[] = [];
let timer: number | undefined;
let listening = false;

function stored(storage: 'localStorage' | 'sessionStorage', key: string): string {
  try {
    const store = window[storage];
    let value = store.getItem(key);
    if (!value) {
      value = randomId();
      store.setItem(key, value);
    }
    return value;
  } catch {
    return 'anonymous';
  }
}

export function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function isOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setOptedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(OPT_OUT_KEY, '1');
    else window.localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage blocked: nothing to remember.
  }
}

export const visitorId = () => stored('localStorage', 'bz.v');

// Which post or link brought this visit: `?ref=` (from /go/<code> links or shares) or `utm_source`,
// kept for the rest of the visit and then taken out of the address bar so it isn't shared onward.
const REF_KEY = 'bz.ref';
const REF_FORMAT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
let campaignCache: string | null | undefined;

export function campaign(): string | undefined {
  if (campaignCache !== undefined) return campaignCache ?? undefined;
  campaignCache = null;
  try {
    const url = new URL(window.location.href);
    const raw = (url.searchParams.get('ref') ?? url.searchParams.get('utm_source') ?? '').trim().toLowerCase();
    if (REF_FORMAT.test(raw)) window.sessionStorage.setItem(REF_KEY, raw);
    if (url.searchParams.has('ref') || url.searchParams.has('utm_source')) {
      for (const key of Array.from(url.searchParams.keys())) if (key === 'ref' || key.startsWith('utm_')) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    campaignCache = window.sessionStorage.getItem(REF_KEY);
  } catch {
    // Storage blocked: no attribution.
  }
  return campaignCache ?? undefined;
}

function send(body: object): void {
  const payload = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([payload], { type: 'application/json' }))) return;
  } catch {
    // Fall through to fetch.
  }
  fetch(ENDPOINT, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
}

export function flush(): void {
  window.clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const events = queue;
  queue = [];
  send({ events });
}

function ensureListeners(): void {
  if (listening) return;
  listening = true;
  // Page going away (tab closed, app switched): send what's pending while we still can.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export function track(event: MetricEvent): void {
  if (typeof window === 'undefined' || isOptedOut()) return;
  ensureListeners();
  queue.push({ ...event, campaign: campaign(), visitor: visitorId(), session: stored('sessionStorage', 'bz.s') });
  if (queue.length >= 20) flush();
  else if (timer === undefined) timer = window.setTimeout(flush, FLUSH_MS);
}

// "Listening now" on the dashboard: refreshed while music plays, cleared when it stops.
export function reportLive(trackId: string | null): void {
  if (typeof window === 'undefined' || isOptedOut()) return;
  send({ live: { visitor: visitorId(), track: trackId } });
}

export function externalReferrer(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname.replace(/^www\./, '');
    return host === window.location.hostname.replace(/^www\./, '') ? undefined : host;
  } catch {
    return undefined;
  }
}
