import { useSyncExternalStore } from 'react';
import { track } from './analytics';

// Loved songs, kept on this device (no account needed). Each change is counted, anonymously, for
// the "Most loved" list on the dashboard.

const KEY = 'bz.loved';
const listeners = new Set<() => void>();
let cache: Set<string> | null = null;

function read(): Set<string> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    cache = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isLoved(trackId: string): boolean {
  return typeof window !== 'undefined' && read().has(trackId);
}

export function toggleLoved(trackId: string, release: string): boolean {
  const next = new Set(read());
  const loved = !next.has(trackId);
  if (loved) next.add(trackId);
  else next.delete(trackId);
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Storage blocked: remembered until the page closes.
  }
  track({ type: loved ? 'like' : 'unlike', release, track: trackId });
  listeners.forEach((listener) => listener());
  return loved;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLoved(trackId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (trackId ? isLoved(trackId) : false), () => false);
}
