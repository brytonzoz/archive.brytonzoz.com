'use client';

import React, { createContext, useContext } from 'react';
import type { Release, Track } from '../../lib/tracks';

// One slot in the queue. The same song can be queued twice, so entries carry their own key.
export type QueueEntry = { key: string; track: Track };
export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerContextValue = {
  available: boolean;
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  failedTrackIds: string[];
  isExpanded: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  /** Everything after the current song, in play order. */
  upNext: QueueEntry[];
  shuffle: boolean;
  repeat: RepeatMode;
  playTrack: (track: Track) => void;
  playRelease: (release: Release, options?: { shuffle?: boolean }) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (key: string) => void;
  moveInQueue: (key: string, toIndex: number) => void;
  jumpTo: (key: string) => void;
  clearUpNext: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  expand: () => void;
  collapse: () => void;
  notify: (message: string) => void;
};

const noop = () => {};

export const PlayerContext = createContext<PlayerContextValue>({
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
  playTrack: noop,
  playRelease: noop,
  playNext: noop,
  addToQueue: noop,
  removeFromQueue: noop,
  moveInQueue: noop,
  jumpTo: noop,
  clearUpNext: noop,
  toggleShuffle: noop,
  cycleRepeat: noop,
  toggle: noop,
  next: noop,
  previous: noop,
  seek: noop,
  expand: noop,
  collapse: noop,
  notify: noop,
});

export function usePlayer() {
  return useContext(PlayerContext);
}
