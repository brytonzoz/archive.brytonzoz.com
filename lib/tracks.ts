import catalog from './tracks.json';
import { media, type MediaAsset, type MediaKey } from './media';

export type Track = {
  id: string;
  title: string;
  number: number;
  src: string;
  durationMs: number;
  explicit: boolean;
  release: Release;
};

export type Release = {
  id: string;
  title: string;
  projectName: string;
  cover: MediaAsset;
  tracks: Track[];
};

// A release only appears in the player once `available` is true in tracks.json;
// scripts/check-tracks.mjs verifies every file of an available release exists before deploys.
export const releases: Release[] = catalog.releases
  .filter((entry) => entry.available && entry.tracks.length > 0)
  .map((entry) => {
    const release: Release = {
      id: entry.id,
      title: entry.title,
      projectName: entry.projectName,
      cover: media[entry.cover as MediaKey],
      tracks: [],
    };
    release.tracks = entry.tracks.map((track, index) => ({
      id: `${entry.id}/${index + 1}`,
      title: track.title,
      number: index + 1,
      src: `${catalog.baseUrl}/${track.file}`,
      durationMs: track.durationMs,
      explicit: track.explicit,
      release,
    }));
    return release;
  });

export const hasPlayableMusic = releases.length > 0;

export function getReleaseForProject(projectName: string): Release | undefined {
  return releases.find((release) => release.projectName === projectName);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const warmed = new Set<string>();

// Fetches a song's opening bytes in the background so pressing play starts almost instantly;
// the first request also warms Cloudflare's edge cache for that song.
export function warmTrack(track: Track | undefined): void {
  if (!track || warmed.has(track.src) || typeof fetch === 'undefined') return;
  warmed.add(track.src);
  fetch(track.src, { headers: { Range: 'bytes=0-131071' }, priority: 'low' } as RequestInit).catch(() => {
    warmed.delete(track.src);
  });
}
