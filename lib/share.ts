import { track } from './analytics';

export type ShareTarget = { title: string; text: string; path: string; release?: string; trackId?: string };

// Opens the phone's or computer's own share sheet; where there isn't one, copies the link.
// Resolves with what should be confirmed to the person (or null when they cancelled).
export async function shareLink(target: ShareTarget): Promise<string | null> {
  const url = new URL(target.path, window.location.origin).href;
  const metric = { type: 'share' as const, release: target.release, track: target.trackId };

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: target.title, text: target.text, url });
      track({ ...metric, detail: 'native' });
      return null;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return null;
      // Share sheet unavailable here (e.g. desktop without it): fall back to copying.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  track({ ...metric, detail: 'copy' });
  return 'Link copied';
}
