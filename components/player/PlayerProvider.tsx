'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flush as flushMetrics, randomId, reportLive, track as trackMetric } from '../../lib/analytics';
import { hasPlayableMusic, releases, warmTrack, type Release, type Track } from '../../lib/tracks';
import { PlayerContext, type PlayerContextValue, type QueueEntry, type RepeatMode } from './context';
import { MiniPlayer } from './MiniPlayer';
import { NowPlaying } from './NowPlaying';
import { Toast } from './Toast';

const RESTART_THRESHOLD_S = 3;
const SKIP_AFTER_ERROR_MS = 1500;
const CHECKPOINT_MS = 45_000;
const SEEK_STEP_S = 10;

let entrySeq = 0;
const toEntry = (track: Track): QueueEntry => ({ key: `q${++entrySeq}`, track });

// A release's songs first, then every other release, so the music keeps going.
function tracksFrom(release: Release): Track[] {
  const start = releases.findIndex((candidate) => candidate.id === release.id);
  return [...releases.slice(start), ...releases.slice(0, start)].flatMap((candidate) => candidate.tracks);
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function artworkFor(track: Track): MediaImage[] {
  const cover = track.release.cover;
  return cover.webp.split(', ').map((entry) => {
    const [src, width] = entry.split(' ');
    const w = parseInt(width, 10);
    const h = Math.round((w * cover.height) / cover.width);
    return { src: new URL(src, window.location.href).href, sizes: `${w}x${h}`, type: 'image/webp' };
  });
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName));

function ActivePlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const queueRef = useRef<QueueEntry[]>([]);
  const indexRef = useRef(-1);
  const loadedKeyRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failedTrackIds, setFailedTrackIds] = useState<string[]>([]);
  const failedRef = useRef<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const repeatRef = useRef<RepeatMode>('off');
  // Original order of every entry (for turning shuffle off); songs people queue sort first.
  const rankRef = useRef<Map<string, number>>(new Map());
  const userRankRef = useRef(-1_000_000);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const notify = useCallback((message: string) => setToast({ id: Date.now(), message }), []);

  const commit = useCallback((nextQueue: QueueEntry[], nextIndex: number) => {
    queueRef.current = nextQueue;
    indexRef.current = nextIndex;
    setQueue(nextQueue);
    setIndex(nextIndex);
  }, []);

  const rank = (entries: QueueEntry[]) => {
    rankRef.current = new Map(entries.map((entry, position) => [entry.key, position]));
  };

  // --- Listening metrics: each play of a song gets an id; heard time excludes seeks and pauses.
  const statsRef = useRef({ play: '', track: '', release: '', heard: 0, reached: 0, last: 0 });

  const beginPlay = useCallback((track: Track) => {
    const play = randomId();
    statsRef.current = { play, track: track.id, release: track.release.id, heard: 0, reached: 0, last: audioRef.current?.currentTime ?? 0 };
    trackMetric({ type: 'play', play, release: track.release.id, track: track.id });
  }, []);

  const endSegment = useCallback((detail: string) => {
    const stats = statsRef.current;
    if (stats.play && stats.heard >= 0.5) {
      trackMetric({
        type: 'listen',
        play: stats.play,
        release: stats.release,
        track: stats.track,
        seconds: Math.round(stats.heard * 10) / 10,
        position: Math.round(stats.reached * 1000) / 1000,
        detail,
      });
    }
    stats.heard = 0;
  }, []);

  // --- Playback. start() is called straight from click handlers so play() stays inside the user
  // gesture (required on iOS).
  const start = useCallback((nextQueue: QueueEntry[], nextIndex: number, reason: string) => {
    const audio = audioRef.current;
    const item = nextQueue[nextIndex];
    if (!audio || !item) return;
    commit(nextQueue, nextIndex);
    if (loadedKeyRef.current !== item.key || audio.error) {
      endSegment(reason);
      loadedKeyRef.current = item.key;
      audio.src = item.track.src;
      setIsLoading(true);
      beginPlay(item.track);
    }
    audio.play().catch((error: DOMException) => {
      if (error.name !== 'AbortError') {
        setIsPlaying(false);
        setIsLoading(false);
      }
    });
  }, [beginPlay, commit, endSegment]);

  const replay = useCallback((reason: string) => {
    const audio = audioRef.current;
    const current = queueRef.current[indexRef.current];
    if (!audio || !current) return;
    endSegment(reason);
    audio.currentTime = 0;
    beginPlay(current.track);
    audio.play().catch(() => setIsPlaying(false));
  }, [beginPlay, endSegment]);

  const advance = useCallback((reason: string) => {
    const audio = audioRef.current;
    const entries = queueRef.current;
    if (!audio) return;
    const playable = (i: number) => !failedRef.current.has(entries[i].track.id);
    let target = indexRef.current + 1;
    while (target < entries.length && !playable(target)) target++;
    if (target >= entries.length && repeatRef.current === 'all') {
      target = 0;
      while (target < entries.length && !playable(target)) target++;
    }
    if (target < entries.length) {
      if (target === indexRef.current) replay(reason);
      else start(entries, target, reason);
      return;
    }
    endSegment(reason);
    audio.pause();
    audio.currentTime = 0;
  }, [endSegment, replay, start]);

  const next = useCallback(() => advance('skip'), [advance]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const atStart = indexRef.current <= 0 && repeatRef.current !== 'all';
    if (audio.currentTime > RESTART_THRESHOLD_S || atStart) {
      audio.currentTime = 0;
      return;
    }
    const entries = queueRef.current;
    start(entries, indexRef.current > 0 ? indexRef.current - 1 : entries.length - 1, 'switch');
  }, [start]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (indexRef.current < 0) {
      const entries = tracksFrom(releases[0]).map(toEntry);
      rank(entries);
      start(entries, 0, 'switch');
    } else if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [start]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  }, []);

  const playTrack = useCallback((track: Track) => {
    const current = queueRef.current[indexRef.current];
    if (current?.track.id === track.id && loadedKeyRef.current === current.key) {
      audioRef.current?.play().catch(() => setIsPlaying(false));
      return;
    }
    const tracks = tracksFrom(track.release);
    const position = tracks.findIndex((candidate) => candidate.id === track.id);
    const entries = tracks.map(toEntry);
    rank(entries);
    if (shuffleRef.current) {
      start([entries[position], ...shuffled(entries.filter((_, i) => i !== position))], 0, 'switch');
    } else {
      start(entries, position, 'switch');
    }
  }, [start]);

  const setShuffleMode = (value: boolean) => {
    shuffleRef.current = value;
    setShuffle(value);
  };

  const playRelease = useCallback((release: Release, options: { shuffle?: boolean } = {}) => {
    const useShuffle = options.shuffle ?? shuffleRef.current;
    setShuffleMode(useShuffle);
    const entries = tracksFrom(release).map(toEntry);
    rank(entries);
    const own = release.tracks.length;
    start(useShuffle ? [...shuffled(entries.slice(0, own)), ...entries.slice(own)] : entries, 0, 'switch');
  }, [start]);

  const jumpTo = useCallback((key: string) => {
    const target = queueRef.current.findIndex((entry) => entry.key === key);
    if (target >= 0) start(queueRef.current, target, 'switch');
  }, [start]);

  const insertAfterCurrent = (track: Track, afterQueued: boolean) => {
    const entries = queueRef.current;
    const entry = toEntry(track);
    rankRef.current.set(entry.key, userRankRef.current++);
    let at = indexRef.current + 1;
    if (afterQueued) {
      while (at < entries.length && (rankRef.current.get(entries[at].key) ?? 0) < 0) at++;
    }
    commit([...entries.slice(0, at), entry, ...entries.slice(at)], indexRef.current);
  };

  const playNext = useCallback((track: Track) => {
    if (indexRef.current < 0) return playTrack(track);
    insertAfterCurrent(track, false);
    notify('Playing next');
  }, [notify, playTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToQueue = useCallback((track: Track) => {
    if (indexRef.current < 0) return playTrack(track);
    insertAfterCurrent(track, true);
    notify('Added to queue');
  }, [notify, playTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeFromQueue = useCallback((key: string) => {
    const entries = queueRef.current;
    const at = entries.findIndex((entry) => entry.key === key);
    if (at < 0 || at === indexRef.current) return;
    commit(entries.filter((entry) => entry.key !== key), at < indexRef.current ? indexRef.current - 1 : indexRef.current);
  }, [commit]);

  const moveInQueue = useCallback((key: string, toIndex: number) => {
    const entries = queueRef.current;
    const head = entries.slice(0, indexRef.current + 1);
    const upcoming = entries.slice(indexRef.current + 1);
    const from = upcoming.findIndex((entry) => entry.key === key);
    if (from < 0) return;
    const [moved] = upcoming.splice(from, 1);
    upcoming.splice(Math.max(0, Math.min(toIndex, upcoming.length)), 0, moved);
    commit([...head, ...upcoming], indexRef.current);
  }, [commit]);

  const clearUpNext = useCallback(() => {
    commit(queueRef.current.slice(0, indexRef.current + 1), indexRef.current);
    notify('Queue cleared');
  }, [commit, notify]);

  const toggleShuffle = useCallback(() => {
    const entries = queueRef.current;
    const head = entries.slice(0, indexRef.current + 1);
    const upcoming = entries.slice(indexRef.current + 1);
    const turningOn = !shuffleRef.current;
    const ordered = turningOn
      ? shuffled(upcoming)
      : [...upcoming].sort((a, b) => (rankRef.current.get(a.key) ?? 0) - (rankRef.current.get(b.key) ?? 0));
    setShuffleMode(turningOn);
    commit([...head, ...ordered], indexRef.current);
  }, [commit]);

  const cycleRepeat = useCallback(() => {
    const nextMode: RepeatMode = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = nextMode;
    setRepeat(nextMode);
  }, []);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const replayRef = useRef(replay);
  replayRef.current = replay;

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
    const onPause = () => {
      setIsPlaying(false);
      updatePosition();
      if (!audio.ended) endSegment('pause');
    };
    const onWaiting = () => setIsLoading(true);
    const onReady = () => setIsLoading(false);
    const onPlaying = () => {
      setIsLoading(false);
      statsRef.current.last = audio.currentTime;
      const id = queueRef.current[indexRef.current]?.track.id;
      if (id && failedRef.current.delete(id)) setFailedTrackIds(Array.from(failedRef.current));
    };
    const onTimeUpdate = () => {
      const stats = statsRef.current;
      const delta = audio.currentTime - stats.last;
      if (!audio.paused && delta > 0 && delta < 1.5) stats.heard += delta;
      stats.last = audio.currentTime;
      if (audio.duration > 0) stats.reached = Math.max(stats.reached, audio.currentTime / audio.duration);
    };
    const onSeeked = () => {
      statsRef.current.last = audio.currentTime;
      updatePosition();
    };
    const onEnded = () => {
      if (repeatRef.current === 'one') replayRef.current('ended');
      else advanceRef.current('ended');
    };
    const onError = () => {
      if (!audio.getAttribute('src')) return;
      const failedIndex = indexRef.current;
      setIsLoading(false);
      setIsPlaying(false);
      const failedId = queueRef.current[failedIndex]?.track.id;
      if (failedId) {
        failedRef.current.add(failedId);
        setFailedTrackIds(Array.from(failedRef.current));
      }
      window.setTimeout(() => {
        if (indexRef.current === failedIndex) advanceRef.current('error');
      }, SKIP_AFTER_ERROR_MS);
    };

    const listeners: [string, () => void][] = [
      ['play', onPlay],
      ['pause', onPause],
      ['waiting', onWaiting],
      ['playing', onPlaying],
      ['canplay', onReady],
      ['timeupdate', onTimeUpdate],
      ['ended', onEnded],
      ['error', onError],
      ['loadedmetadata', updatePosition],
      ['seeked', onSeeked],
    ];
    listeners.forEach(([name, handler]) => audio.addEventListener(name, handler));
    const onLeave = () => {
      endSegment('leave');
      flushMetrics();
    };
    window.addEventListener('pagehide', onLeave);
    return () => {
      listeners.forEach(([name, handler]) => audio.removeEventListener(name, handler));
      window.removeEventListener('pagehide', onLeave);
    };
  }, [endSegment]);

  const current = index >= 0 ? queue[index]?.track ?? null : null;

  // "Listening now" on the dashboard, plus a checkpoint so long listens are counted even if the
  // browser is closed without warning.
  useEffect(() => {
    if (!isPlaying || !current) {
      if (current) reportLive(null);
      return;
    }
    reportLive(current.id);
    const timer = window.setInterval(() => {
      endSegment('progress');
      flushMetrics();
      reportLive(current.id);
    }, CHECKPOINT_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, current, endSegment]);

  // Lock screen, headphones, car and keyboard media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const audio = audioRef.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { audio?.play().catch(() => {}); }],
      ['pause', () => audio?.pause()],
      ['stop', () => { audio?.pause(); }],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekto', (details) => { if (details.seekTime !== undefined) seek(details.seekTime); }],
      ['seekbackward', (details) => { if (audio) seek(audio.currentTime - (details.seekOffset ?? SEEK_STEP_S)); }],
      ['seekforward', (details) => { if (audio) seek(audio.currentTime + (details.seekOffset ?? SEEK_STEP_S)); }],
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

  // Keyboard: space plays/pauses, arrows seek, shift+arrows change song.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const audio = audioRef.current;
      if (!audio || indexRef.current < 0) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) next();
        else seek(audio.currentTime + SEEK_STEP_S);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.shiftKey) previous();
        else seek(audio.currentTime - SEEK_STEP_S);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, previous, seek, toggle]);

  // Once a song is actually playing, get the next one ready.
  const upNext = useMemo(() => (index >= 0 ? queue.slice(index + 1) : []), [queue, index]);
  const nextTrack = upNext[0]?.track;
  useEffect(() => {
    if (isPlaying) warmTrack(nextTrack);
  }, [isPlaying, nextTrack]);

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

  // The tab and window switcher show what's playing, like a native player.
  useEffect(() => {
    if (!current || !isPlaying) return;
    const base = document.title;
    document.title = `${current.title} · ${current.release.title}`;
    return () => {
      document.title = base;
    };
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
    upNext,
    shuffle,
    repeat,
    playTrack,
    playRelease,
    playNext,
    addToQueue,
    removeFromQueue,
    moveInQueue,
    jumpTo,
    clearUpNext,
    toggleShuffle,
    cycleRepeat,
    toggle,
    next,
    previous,
    seek,
    expand,
    collapse,
    notify,
  }), [current, isPlaying, isLoading, failedTrackIds, isExpanded, upNext, shuffle, repeat, playTrack, playRelease, playNext, addToQueue,
    removeFromQueue, moveInQueue, jumpTo, clearUpNext, toggleShuffle, cycleRepeat, toggle, next, previous, seek, expand, collapse, notify]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="auto" aria-hidden="true" />
      <MiniPlayer />
      <NowPlaying />
      <Toast toast={toast} />
    </PlayerContext.Provider>
  );
}

// Without any playable release the site ships no player at all; toasts still work for sharing.
function StaticProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const notify = useCallback((message: string) => setToast({ id: Date.now(), message }), []);
  const value = useMemo(() => ({ ...defaultValue, notify }), [notify]);
  return (
    <PlayerContext.Provider value={value}>
      {children}
      <Toast toast={toast} />
    </PlayerContext.Provider>
  );
}

const defaultValue: PlayerContextValue = {
  available: false,
  current: null,
  isPlaying: false,
  isLoading: false,
  failedTrackIds: [],
  isExpanded: false,
  audioRef: { current: null },
  upNext: [],
  shuffle: false,
  repeat: 'off',
  playTrack: () => {},
  playRelease: () => {},
  playNext: () => {},
  addToQueue: () => {},
  removeFromQueue: () => {},
  moveInQueue: () => {},
  jumpTo: () => {},
  clearUpNext: () => {},
  toggleShuffle: () => {},
  cycleRepeat: () => {},
  toggle: () => {},
  next: () => {},
  previous: () => {},
  seek: () => {},
  expand: () => {},
  collapse: () => {},
  notify: () => {},
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  return hasPlayableMusic ? <ActivePlayerProvider>{children}</ActivePlayerProvider> : <StaticProvider>{children}</StaticProvider>;
}
