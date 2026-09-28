import { flush } from './analytics';
import type { StreamingService } from './streaming';

// Opens a release in the streaming app itself, not its website. Links opened in a new tab, from
// a home-screen web app, or inside in-app browsers (Instagram, Threads…) never reach the app on
// iOS, so phones get each app's own link and the website is only the fallback.

const ANDROID_PACKAGES: Record<StreamingService['key'], string> = {
  applemusic: 'com.apple.android.music',
  spotify: 'com.spotify.music',
  youtubemusic: 'com.google.android.apps.youtube.music',
};

const FALLBACK_MS = 1600;

function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

// The app's own link for this web link, where the app has one we can rely on.
function appLink(key: StreamingService['key'], web: URL): string | null {
  if (key === 'applemusic') return `music://${web.host}${web.pathname}${web.search}`;
  if (key === 'spotify') {
    const match = web.pathname.match(/^\/(album|artist|track|playlist|show|episode)\/([A-Za-z0-9]+)/);
    return match ? `spotify:${match[1]}:${match[2]}` : null;
  }
  return null;
}

function androidIntent(key: StreamingService['key'], web: URL): string {
  return `intent://${web.host}${web.pathname}${web.search}#Intent;scheme=https;package=${ANDROID_PACKAGES[key]};S.browser_fallback_url=${encodeURIComponent(web.href)};end`;
}

// Returns true when it took over the navigation (the caller should preventDefault).
export function openInApp(key: StreamingService['key'], url: string): boolean {
  let web: URL;
  try {
    web = new URL(url);
  } catch {
    return false;
  }
  const os = platform();
  if (os === 'other') return false; // Computers: the website opens in a new tab and offers the app.

  flush(); // Send the tap to the dashboard before the page is left.

  if (os === 'android') {
    window.location.href = androidIntent(key, web);
    return true;
  }

  const app = appLink(key, web);
  if (!app) {
    // No dependable app link (YouTube Music): same-tab navigation lets iOS hand the link to the app.
    window.location.href = web.href;
    return true;
  }

  // If the app didn't open (not installed), the page is still showing: go to the website instead.
  const timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') window.location.href = web.href;
  }, FALLBACK_MS);
  const cancel = () => {
    if (document.visibilityState === 'hidden') window.clearTimeout(timer);
  };
  document.addEventListener('visibilitychange', cancel, { once: true });
  window.addEventListener('pagehide', () => window.clearTimeout(timer), { once: true });
  window.location.href = app;
  return true;
}
