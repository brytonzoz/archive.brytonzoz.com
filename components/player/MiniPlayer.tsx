'use client';

import React from 'react';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from './context';
import { EqualizerBars, NextIcon, PauseIcon, PlayIcon } from './icons';
import { useProgressBar } from './useProgress';

export function MiniPlayer() {
  const { current, isPlaying, isLoading, failedTrackIds, toggle, next, expand } = usePlayer();
  const barRef = useProgressBar<HTMLSpanElement>();
  if (!current) return null;

  const cover = current.release.cover;
  const failed = failedTrackIds.includes(current.id);

  return (
    <div
      className="mini-player pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-3 font-body"
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto relative flex h-[64px] w-full max-w-[440px] items-center gap-2 overflow-hidden rounded-[22px] bg-[#1b1b1e]/85 pl-2 pr-2 text-white shadow-[0_18px_50px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-2xl backdrop-saturate-150">
        <button
          type="button"
          onClick={expand}
          aria-label={`Open player: ${current.title}`}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[16px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[11px]" style={placeholderBackground(cover)}>
            <ResponsiveImage asset={cover} alt="" sizes="44px" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/35">
              <EqualizerBars playing={isPlaying && !isLoading} />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-tight">{current.title}</span>
            <span className="mt-0.5 block truncate text-[13px] leading-tight text-white/50">
              {failed ? 'Couldn’t load this song, skipping' : `${current.release.title} · Bryton Zoz`}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        >
          {isLoading ? <span className="player-spinner absolute inset-[-3px] rounded-full" aria-hidden="true" /> : null}
          {isPlaying ? <PauseIcon size={17} /> : <PlayIcon size={17} className="translate-x-[1px]" />}
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next song"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/85 transition-transform hover:text-white active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <NextIcon size={19} />
        </button>

        <span aria-hidden="true" className="absolute inset-x-4 bottom-[5px] h-[2px] overflow-hidden rounded-full bg-white/10">
          <span ref={barRef} className="block h-full origin-left rounded-full bg-white/75" style={{ transform: 'scaleX(0)' }} />
        </span>
      </div>
    </div>
  );
}
