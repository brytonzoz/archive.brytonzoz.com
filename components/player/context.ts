'use client';

import React, { createContext, useContext } from 'react';
import type { Release, Track } from '../../lib/tracks';

export type PlayerContextValue = {
  available: boolean;
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  failedTrackIds: string[];
  isExpanded: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  playTrack: (track: Track) => void;
  playRelease: (release: Release) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  expand: () => void;
  collapse: () => void;
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
  playTrack: noop,
  playRelease: noop,
  toggle: noop,
  next: noop,
  previous: noop,
  seek: noop,
  expand: noop,
  collapse: noop,
});

export function usePlayer() {
  return useContext(PlayerContext);
}
