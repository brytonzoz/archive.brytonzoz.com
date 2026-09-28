'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasPlayableMusic, releases, warmTrack, type Release, type Track } from '../../lib/tracks';
import { PlayerContext, type PlayerContextValue } from './context';
import { MiniPlayer } from './MiniPlayer';
import { NowPlaying } from './NowPlaying';

// One continuous queue: every available release in order, so music keeps going while people browse.
const queue: Track[] = releases.flatMap((release) => release.tracks);
const RESTART_THRESHOLD_S = 3;
const SKIP_AFTER_ERROR_MS = 1500;

function artworkFor(track: Track): MediaImage[] {
  const cover = track.release.cover;
  return cover.webp.split(', ').map((entry) => {
    const [src, width] = entry.split(' ');
    const w = parseInt(width, 10);
    const h = Math.round((w * cover.height) / cover.width);
    return { src: new URL(src, window.location.href).href, sizes: `${w}x${h}`, type: 'image/webp' };
  });
}

function ActivePlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failedTrackIds, setFailedTrackIds] = useState<string[]>([]);
  const failedRef = useRef<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);
  const indexRef = useRef(-1);

  // Called straight from click handlers so play() stays inside the user gesture (required on iOS).
  const load = useCallback((index: number) => {
    const audio = audioRef.current;
    const track = queue[index];
    if (!audio || !track) return;
    // Re-assigning src also retries a song that failed earlier.
    if (indexRef.current !== index || audio.error) {
      indexRef.current = index;
      audio.src = track.src;
      setCurrentIndex(index);
      setIsLoading(true);
    }
    audio.play().catch((error: DOMException) => {
      if (error.name !== 'AbortError') {
        setIsPlaying(false);
        setIsLoading(false);
      }
    });
  }, []);

  const next = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let upcoming = indexRef.current + 1;
    while (upcoming < queue.length && failedRef.current.has(queue[upcoming].id)) upcoming++;
    if (upcoming < queue.length) {
      load(upcoming);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [load]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.currentTime > RESTART_THRESHOLD_S || indexRef.current <= 0) {
      audio.currentTime = 0;
    } else {
      load(indexRef.current - 1);
    }
  }, [load]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (indexRef.current < 0) {
      load(0);
    } else if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [load]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) audio.currentTime = Math.max(0, seconds);
  }, []);

  const playTrack = useCallback((track: Track) => {
    load(queue.findIndex((candidate) => candidate.id === track.id));
  }, [load]);

  const playRelease = useCallback((release: Release) => {
    load(queue.findIndex((candidate) => candidate.release.id === release.id));
  }, [load]);

  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updatePosition = () => {
      if (!('mediaSession' in navigator) || !Number.isFinite(audio.duration)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          position: Math.min(audio.currentTime, audio.duration),
          playbackRate: audio.playbackRate,
        });
      } catch {
        // Some browsers reject position updates mid-seek; the next event corrects it.
      }
    };
    const onPlay = () => { setIsPlaying(true); updatePosition(); };
    const onPause = () => { setIsPlaying(false); updatePosition(); };
    const onWaiting = () => setIsLoading(true);
    const onReady = () => setIsLoading(false);
    const onPlaying = () => {
      setIsLoading(false);
      const id = queue[indexRef.current]?.id;
      if (id && failedRef.current.delete(id)) setFailedTrackIds(Array.from(failedRef.current));
    };
    const onEnded = () => nextRef.current();
    const onError = () => {
      if (!audio.getAttribute('src')) return;
      const failedIndex = indexRef.current;
      setIsLoading(false);
      setIsPlaying(false);
      const failedId = queue[failedIndex]?.id;
      if (failedId) {
        failedRef.current.add(failedId);
        setFailedTrackIds(Array.from(failedRef.current));
      }
      window.setTimeout(() => {
        if (indexRef.current === failedIndex) nextRef.current();
      }, SKIP_AFTER_ERROR_MS);
    };

    const listeners: [string, () => void][] = [
      ['play', onPlay],
      ['pause', onPause],
      ['waiting', onWaiting],
      ['playing', onPlaying],
      ['canplay', onReady],
      ['ended', onEnded],
      ['error', onError],
      ['loadedmetadata', updatePosition],
      ['seeked', updatePosition],
    ];
    listeners.forEach(([name, handler]) => audio.addEventListener(name, handler));
    return () => listeners.forEach(([name, handler]) => audio.removeEventListener(name, handler));
  }, []);

  // Lock screen, headphones and car controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const audio = audioRef.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { audio?.play().catch(() => {}); }],
      ['pause', () => audio?.pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekto', (details) => { if (details.seekTime !== undefined) seek(details.seekTime); }],
      ['seekbackward', (details) => { if (audio) seek(audio.currentTime - (details.seekOffset ?? 10)); }],
      ['seekforward', (details) => { if (audio) seek(audio.currentTime + (details.seekOffset ?? 10)); }],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Unsupported action on this browser.
        }
      }
    };
  }, [next, previous, seek]);

  const current = currentIndex >= 0 ? queue[currentIndex] : null;

  // Once a song is actually playing, get the next one ready.
  useEffect(() => {
    if (isPlaying && currentIndex >= 0) warmTrack(queue[currentIndex + 1]);
  }, [isPlaying, currentIndex]);

  useEffect(() => {
    if (!current || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: 'Bryton Zoz',
      album: current.release.title,
      artwork: artworkFor(current),
    });
  }, [current]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = current ? (isPlaying ? 'playing' : 'paused') : 'none';
  }, [current, isPlaying]);

  // Lets fixed page elements (footer, catalog padding) sit above the mini player.
  useEffect(() => {
    const root = document.documentElement;
    if (current) {
      root.style.setProperty('--player-offset', '84px');
    } else {
      root.style.removeProperty('--player-offset');
    }
  }, [current]);

  const expand = useCallback(() => setIsExpanded(true), []);
  const collapse = useCallback(() => setIsExpanded(false), []);

  const value = useMemo<PlayerContextValue>(() => ({
    available: true,
    current,
    isPlaying,
    isLoading,
    failedTrackIds,
    isExpanded,
    audioRef,
    playTrack,
    playRelease,
    toggle,
    next,
    previous,
    seek,
    expand,
    collapse,
  }), [current, isPlaying, isLoading, failedTrackIds, isExpanded, playTrack, playRelease, toggle, next, previous, seek, expand, collapse]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="auto" aria-hidden="true" />
      <MiniPlayer />
      <NowPlaying />
    </PlayerContext.Provider>
  );
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  return hasPlayableMusic ? <ActivePlayerProvider>{children}</ActivePlayerProvider> : <>{children}</>;
}
