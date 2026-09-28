'use client';

import React, { useEffect, useState } from 'react';
import { shareLink } from '../../lib/share';
import { formatTime, trackPath } from '../../lib/tracks';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { useSheet } from '../useSheet';
import { usePlayer } from './context';
import {
  ChevronDownIcon, ExplicitBadge, GripIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, QueueIcon, RemoveIcon, RepeatIcon, ShareIcon, ShuffleIcon,
} from './icons';
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

const ROW_HEIGHT = 60;

// Up Next: what plays after this song. Tap to jump, drag the handle to reorder (or use the arrow
// keys on it), remove with the minus. Shuffle and repeat live here too, as in Apple Music.
function QueueView() {
  const { upNext, shuffle, repeat, toggleShuffle, cycleRepeat, jumpTo, removeFromQueue, moveInQueue, clearUpNext } = usePlayer();
  const [drag, setDrag] = useState<{ key: string; from: number; startY: number; dy: number } | null>(null);
  const target = drag ? Math.max(0, Math.min(upNext.length - 1, drag.from + Math.round(drag.dy / ROW_HEIGHT))) : -1;

  const toggleClass = (active: boolean) =>
    `flex h-8 w-11 items-center justify-center rounded-[9px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${active ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/15'}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center justify-between px-6 pb-2">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">Playing Next</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} className={toggleClass(shuffle)}>
            <ShuffleIcon size={17} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat'}
            aria-pressed={repeat !== 'off'}
            className={toggleClass(repeat !== 'off')}
          >
            <RepeatIcon size={17} one={repeat === 'one'} />
          </button>
        </div>
      </div>

      {upNext.length ? (
        <ol className="tracklist relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2" aria-label="Up next">
          {upNext.map((entry, i) => {
            const isDragged = drag?.key === entry.key;
            let shift = 0;
            if (drag && !isDragged) {
              if (drag.from < i && i <= target) shift = -ROW_HEIGHT;
              else if (target <= i && i < drag.from) shift = ROW_HEIGHT;
            }
            return (
              <li
                key={entry.key}
                className={`queue-row relative flex items-center gap-3 rounded-[12px] pr-1 ${isDragged ? 'z-10 bg-white/[0.12] shadow-[0_10px_30px_rgba(0,0,0,0.45)]' : ''}`}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${isDragged ? drag.dy : shift}px)`,
                  transition: isDragged ? 'none' : 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)',
                }}
              >
                <button
                  type="button"
                  onClick={() => jumpTo(entry.key)}
                  className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[12px] pl-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 active:opacity-70"
                >
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[6px]" style={placeholderBackground(entry.track.release.cover)}>
                    <ResponsiveImage asset={entry.track.release.cover} alt="" sizes="40px" className="absolute inset-0 h-full w-full object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-white/90">{entry.track.title}</span>
                    <span className="block truncate text-[13px] text-white/45">{entry.track.release.title}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeFromQueue(entry.key)}
                  aria-label={`Remove ${entry.track.title} from queue`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                >
                  <RemoveIcon size={22} />
                </button>
                <button
                  type="button"
                  aria-label={`Reorder ${entry.track.title}`}
                  className="flex h-10 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-[8px] text-white/45 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDrag({ key: entry.key, from: i, startY: event.clientY, dy: 0 });
                  }}
                  onPointerMove={(event) => {
                    if (drag?.key === entry.key) setDrag({ ...drag, dy: event.clientY - drag.startY });
                  }}
                  onPointerUp={() => {
                    if (drag?.key === entry.key && target !== drag.from) moveInQueue(entry.key, target);
                    setDrag(null);
                  }}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' && i > 0) { event.preventDefault(); moveInQueue(entry.key, i - 1); }
                    if (event.key === 'ArrowDown' && i < upNext.length - 1) { event.preventDefault(); moveInQueue(entry.key, i + 1); }
                  }}
                >
                  <GripIcon size={20} />
                </button>
              </li>
            );
          })}
          <li className="flex justify-center pt-3">
            <button type="button" onClick={clearUpNext} className="rounded-full px-4 py-2 text-[14px] font-semibold text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
              Clear
            </button>
          </li>
        </ol>
      ) : (
        <p className="px-6 pt-6 text-[15px] text-white/45">Nothing up next. Add songs from any album with “…”.</p>
      )}
    </div>
  );
}

const iconButton =
  'flex items-center justify-center rounded-full transition-[transform,background-color] duration-150 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';

export function NowPlaying() {
  const { current, isPlaying, isLoading, isExpanded, toggle, next, previous, collapse, notify } = usePlayer();
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
            <div key="list" className="np-swap absolute inset-0 pt-9">
              <QueueView />
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
              aria-label="Share song"
              onClick={() =>
                shareLink({ title: `${current.title} by Bryton Zoz`, text: `${current.title} · ${release.title}`, path: trackPath(current), release: release.id, trackId: current.id })
                  .then((message) => message && notify(message))
              }
              className={`${iconButton} h-9 w-9 shrink-0 bg-white/10 text-white/85 hover:bg-white/15`}
            >
              <ShareIcon size={17} />
            </button>
            <button
              type="button"
              onClick={() => setShowList((value) => !value)}
              aria-label="Up Next"
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
