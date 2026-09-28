// Anonymous listening metrics for the /admin dashboard. A random id per browser (no cookies, no
// personal data); events are batched and sent with sendBeacon so they never slow the site down.

type EventType = 'view' | 'play' | 'listen' | 'share' | 'outbound' | 'open';

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

let queue: (MetricEvent & { visitor: string; session: string })[] = [];
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

const visitorId = () => stored('localStorage', 'bz.v');

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
  queue.push({ ...event, visitor: visitorId(), session: stored('sessionStorage', 'bz.s') });
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
