'use client';

import React from 'react';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from './context';
import { NextIcon, PauseIcon, PlayIcon } from './icons';
import { useProgressBar } from './useProgress';

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

// While a song is loading the ring becomes a short spinning arc instead.
const drawRing = (element: SVGCircleElement, fraction: number) => {
  element.style.strokeDashoffset = element.dataset.loading ? '0' : String(RING_LENGTH * (1 - fraction));
};

// A floating glass capsule, above the Listen Now sheet too (below Now Playing): artwork and title (tap to open the player), play/pause wrapped in a
// thin progress ring, and next.
export function MiniPlayer() {
  const { current, isPlaying, isLoading, failedTrackIds, isExpanded, toggle, next, expand } = usePlayer();
  const ringRef = useProgressBar<SVGCircleElement>(drawRing);
  if (!current) return null;

  const cover = current.release.cover;
  const failed = failedTrackIds.includes(current.id);

  return (
    <div
      className={`mini-player pointer-events-none fixed inset-x-0 z-[105] flex justify-center px-3 font-body transition-opacity duration-200 ${isExpanded ? 'opacity-0' : ''}`}
      aria-hidden={isExpanded || undefined}
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="glass-capsule pointer-events-auto flex h-[60px] w-full max-w-[400px] items-center gap-1 rounded-full pl-[9px] pr-2 text-white">
        <button
          type="button"
          onClick={expand}
          aria-label={`Open player: ${current.title}`}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <span
            className={`relative h-[42px] w-[42px] shrink-0 overflow-hidden rounded-full transition-transform duration-500 ease-out ${isPlaying ? 'scale-100' : 'scale-[0.92]'}`}
            style={placeholderBackground(cover)}
          >
            <ResponsiveImage asset={cover} alt="" sizes="42px" className="absolute inset-0 h-full w-full object-cover" />
          </span>
          <span className={`min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] ${failed ? 'text-white/45' : ''}`}>
            {failed ? 'Couldn’t load, skipping…' : current.title}
          </span>
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <svg aria-hidden="true" viewBox="0 0 44 44" className={`absolute inset-0 h-full w-full -rotate-90 ${isLoading ? 'animate-[playerSpin_900ms_linear_infinite]' : ''}`}>
            <circle cx="22" cy="22" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <circle
              ref={ringRef}
              data-loading={isLoading ? '1' : undefined}
              cx="22"
              cy="22"
              r={RING_RADIUS}
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={isLoading ? `${RING_LENGTH * 0.25} ${RING_LENGTH}` : RING_LENGTH}
              style={{ strokeDashoffset: RING_LENGTH }}
            />
          </svg>
          {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} className="translate-x-[1px]" />}
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next song"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <NextIcon size={21} />
        </button>
      </div>
    </div>
  );
}
