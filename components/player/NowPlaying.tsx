'use client';

import React, { useEffect, useRef, useState } from 'react';
import { formatTime, releases, type Track } from '../../lib/tracks';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { useSheet } from '../useSheet';
import { usePlayer } from './context';
import { ChevronDownIcon, EqualizerBars, ExplicitBadge, NextIcon, PauseIcon, PlayIcon, PreviousIcon, QueueIcon } from './icons';
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
    <div>
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
        className={`scrubber w-full ${scrubValue !== null ? 'is-scrubbing' : ''}`}
        style={{ '--pct': `${percent}%` } as React.CSSProperties}
      />
      <div className="mt-1 flex justify-between text-[12px] font-medium tabular-nums text-white/45">
        <span>{formatTime(shown)}</span>
        <span>-{formatTime(Math.max(0, duration - shown))}</span>
      </div>
    </div>
  );
}

function TrackRow({ track }: { track: Track }) {
  const { current, isPlaying, playTrack, failedTrackIds } = usePlayer();
  const isCurrent = current?.id === track.id;
  const failed = failedTrackIds.includes(track.id);

  return (
    <li>
      <button
        type="button"
        onClick={() => playTrack(track)}
        aria-current={isCurrent ? 'true' : undefined}
        data-current={isCurrent ? '' : undefined}
        className="flex w-full items-center gap-4 rounded-[12px] px-3 py-[11px] text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
      >
        <span className="flex w-5 shrink-0 justify-center text-[15px] tabular-nums text-white/35">
          {isCurrent ? <EqualizerBars playing={isPlaying} className="scale-90" /> : track.number}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[16px] ${isCurrent ? 'font-semibold text-white' : failed ? 'text-white/35' : 'text-white/85'}`}>
          {track.title}
        </span>
        <span className="shrink-0 text-[14px] tabular-nums text-white/35">
          {failed ? 'Unavailable' : formatTime(track.durationMs / 1000)}
        </span>
      </button>
    </li>
  );
}

function Tracklist() {
  const listRef = useRef<HTMLDivElement>(null);

  // Open on the song that's playing.
  useEffect(() => {
    listRef.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div ref={listRef} className="tracklist h-full overflow-y-auto overscroll-contain px-3 pb-4">
      {releases.map((release) => (
        <section key={release.id} aria-label={release.title} className="pt-4 first:pt-1">
          <h3 className="px-3 pb-1 text-[13px] font-semibold text-white/45">{release.title}</h3>
          <ol>
            {release.tracks.map((track) => (
              <TrackRow key={track.id} track={track} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

const iconButton =
  'flex items-center justify-center rounded-full transition-[transform,background-color] duration-150 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';

export function NowPlaying() {
  const { current, isPlaying, isLoading, isExpanded, toggle, next, previous, collapse } = usePlayer();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isExpanded, collapse);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    if (!isExpanded) setShowList(false);
  }, [isExpanded]);

  if (!isExpanded || !current) return null;

  const release = current.release;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      className={`fixed inset-0 z-[110] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />

      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative isolate flex h-[calc(100dvh-8px)] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[28px] text-white outline-none sm:h-[min(820px,calc(100dvh-48px))] sm:rounded-[28px]"
        style={sheetStyle}
      >
        {/* The artwork itself, blurred, is the backdrop, so every release gets its own colour. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#111]" />
        <div aria-hidden="true" className="absolute inset-[-20%] -z-10 opacity-90 blur-[60px] saturate-[1.6]" style={placeholderBackground(release.cover)} />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-black/20 via-black/40 to-black/70" />

        <div {...dragHandlers} className="relative flex-none touch-none select-none px-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/30 sm:invisible" />
          <button type="button" onClick={requestClose} aria-label="Close player" className={`${iconButton} absolute left-3 top-2 h-10 w-10 text-white/70 hover:bg-white/10 hover:text-white`}>
            <ChevronDownIcon size={22} />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          {showList ? (
            <div key="list" className="np-swap absolute inset-0 pt-6">
              <Tracklist />
            </div>
          ) : (
            <div key="art" {...dragHandlers} className="np-swap np-art-area absolute inset-0 flex touch-none select-none items-center justify-center px-7 pt-8 pb-2">
              <div
                className="np-art relative overflow-hidden rounded-[14px] transition-transform duration-500"
                style={{
                  ...placeholderBackground(release.cover),
                  transform: isPlaying ? 'scale(1)' : 'scale(0.86)',
                  transitionTimingFunction: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
                }}
              >
                <ResponsiveImage asset={release.cover} alt={`${release.title} cover`} sizes="380px" className="absolute inset-0 h-full w-full object-cover" />
              </div>
            </div>
          )}
        </div>

        <div className="flex-none px-7" style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}>
          <div className="mt-5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-[21px] font-semibold leading-tight tracking-[-0.02em]">
                <span className="truncate">{current.title}</span>
                {current.explicit ? <ExplicitBadge /> : null}
              </h2>
              <p className="mt-0.5 truncate text-[17px] text-white/55">{release.title}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowList((value) => !value)}
              aria-label="Tracklist"
              aria-pressed={showList}
              className={`${iconButton} h-9 w-9 shrink-0 ${showList ? 'bg-white text-black' : 'bg-white/10 text-white/85 hover:bg-white/15'}`}
            >
              <QueueIcon size={17} />
            </button>
          </div>

          <div className="mt-5">
            <Scrubber />
          </div>

          <div className="mt-3 flex items-center justify-center gap-12">
            <button type="button" onClick={previous} aria-label="Previous song" className={`${iconButton} h-16 w-16 text-white hover:bg-white/[0.06]`}>
              <PreviousIcon size={34} />
            </button>
            <button type="button" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'} className={`${iconButton} relative h-[76px] w-[76px] text-white hover:bg-white/[0.06]`}>
              {isLoading ? <span className="player-spinner absolute inset-1 rounded-full" aria-hidden="true" /> : null}
              {isPlaying ? <PauseIcon size={46} /> : <PlayIcon size={46} className="translate-x-[2px]" />}
            </button>
            <button type="button" onClick={next} aria-label="Next song" className={`${iconButton} h-16 w-16 text-white hover:bg-white/[0.06]`}>
              <NextIcon size={34} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
