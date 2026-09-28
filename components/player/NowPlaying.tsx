'use client';

import React, { useState } from 'react';
import { formatTime, releases, type Track } from '../../lib/tracks';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { useSheet } from '../useSheet';
import { usePlayer } from './context';
import { ChevronDownIcon, EqualizerBars, ExplicitBadge, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';
import { useProgress } from './useProgress';

function Scrubber() {
  const { seek } = usePlayer();
  const { time, duration } = useProgress();
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const shown = scrubValue ?? time;
  const percent = duration > 0 ? (Math.min(shown, duration) / duration) * 100 : 0;

  const commit = () => {
    if (scrubValue !== null) seek(scrubValue);
    setScrubValue(null);
  };

  return (
    <div className="mt-6">
      <input
        type="range"
        aria-label="Seek"
        aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(shown, duration || 0)}
        onChange={(event) => setScrubValue(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="scrubber w-full"
        style={{ '--pct': `${percent}%` } as React.CSSProperties}
      />
      <div className="mt-1.5 flex justify-between text-[12px] font-medium tabular-nums text-white/50">
        <span>{formatTime(shown)}</span>
        <span>-{formatTime(Math.max(0, duration - shown))}</span>
      </div>
    </div>
  );
}

function TrackRow({ track }: { track: Track }) {
  const { current, isPlaying, playTrack, failedTrackIds } = usePlayer();
  const isCurrent = current?.id === track.id;

  return (
    <li>
      <button
        type="button"
        onClick={() => playTrack(track)}
        aria-current={isCurrent ? 'true' : undefined}
        className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${isCurrent ? 'bg-white/[0.08]' : ''}`}
      >
        <span className="flex w-5 shrink-0 justify-center text-[14px] tabular-nums text-white/40">
          {isCurrent ? <EqualizerBars playing={isPlaying} className="scale-90" /> : track.number}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[15px] ${isCurrent ? 'font-semibold text-white' : 'text-white/85'}`}>
          {track.title}
        </span>
        {failedTrackIds.includes(track.id) ? <span className="text-[12px] text-white/40">Unavailable</span> : null}
        {track.explicit ? <ExplicitBadge /> : null}
        <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-white/40">{formatTime(track.durationMs / 1000)}</span>
      </button>
    </li>
  );
}

export function NowPlaying() {
  const { current, isPlaying, isLoading, isExpanded, toggle, next, previous, collapse } = usePlayer();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isExpanded, collapse);
  if (!isExpanded || !current) return null;

  const release = current.release;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      className={`fixed inset-0 z-[110] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60 backdrop-blur-md" />

      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative isolate flex h-[calc(100dvh-10px)] w-full max-w-[460px] flex-col overflow-hidden rounded-t-[32px] text-white outline-none ring-1 ring-white/[0.08] sm:h-[min(860px,calc(100dvh-48px))] sm:rounded-[32px]"
        style={sheetStyle}
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#0e0e10]" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 scale-150 opacity-80 blur-3xl"
          style={placeholderBackground(release.cover)}
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-black/25 via-black/55 to-black/85" />

        <div {...dragHandlers} className="flex-none touch-none select-none px-4 pb-1 pt-2.5">
          <div aria-hidden="true" className="mx-auto h-[5px] w-10 rounded-full bg-white/25 sm:invisible" />
          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close player"
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
            >
              <ChevronDownIcon size={22} />
            </button>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">Now playing</p>
            <span className="h-10 w-10" aria-hidden="true" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <div
            className="relative mx-auto mt-3 aspect-square w-full max-w-[340px] overflow-hidden rounded-[24px] shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition-transform duration-500"
            style={{
              ...placeholderBackground(release.cover),
              transform: isPlaying ? 'scale(1)' : 'scale(0.9)',
              transitionTimingFunction: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
            }}
          >
            <ResponsiveImage
              asset={release.cover}
              alt={`${release.title} cover`}
              sizes="340px"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>

          <div className="mt-7 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
                <span className="truncate">{current.title}</span>
                {current.explicit ? <ExplicitBadge /> : null}
              </h2>
              <p className="mt-1 truncate text-[16px] text-white/55">Bryton Zoz &middot; {release.title}</p>
            </div>
          </div>

          <Scrubber />

          <div className="mt-4 flex items-center justify-center gap-10">
            <button
              type="button"
              onClick={previous}
              aria-label="Previous song"
              className="flex h-14 w-14 items-center justify-center rounded-full text-white/90 transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
            >
              <PreviousIcon size={30} />
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70"
            >
              {isLoading ? <span className="player-spinner absolute inset-[-4px] rounded-full" aria-hidden="true" /> : null}
              {isPlaying ? <PauseIcon size={30} /> : <PlayIcon size={30} className="translate-x-[2px]" />}
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next song"
              className="flex h-14 w-14 items-center justify-center rounded-full text-white/90 transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
            >
              <NextIcon size={30} />
            </button>
          </div>

          <div className="mt-10 space-y-8">
            {releases.map((entry) => (
              <section key={entry.id} aria-label={entry.title}>
                <div className="mb-2 flex items-center gap-3 px-1">
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[9px]" style={placeholderBackground(entry.cover)}>
                    <ResponsiveImage asset={entry.cover} alt="" sizes="40px" className="absolute inset-0 h-full w-full object-cover" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold">{entry.title}</h3>
                    <p className="text-[12px] text-white/45">
                      {entry.tracks.length} {entry.tracks.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>
                <ol>
                  {entry.tracks.map((track) => (
                    <TrackRow key={track.id} track={track} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
