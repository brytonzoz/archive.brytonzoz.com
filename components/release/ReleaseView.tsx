'use client';

import React from 'react';
import { releaseMinutes, type Release, type Track } from '../../lib/tracks';
import { Project, getProjectTypeLabel, isProjectReleased } from '../../lib/utils';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { EqualizerBars, PauseIcon, PlayIcon, ShuffleIcon } from '../player/icons';
import { TrackMenu } from '../player/TrackMenu';

export const releaseKey = (project: Project, release?: Release) =>
  release?.id ?? project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function TrackRow({ track, focused }: { track: Track; focused: boolean }) {
  const { current, isPlaying, playTrack, failedTrackIds } = usePlayer();
  const isCurrent = current?.id === track.id;
  const failed = failedTrackIds.includes(track.id);

  return (
    <li
      className={`flex items-center rounded-[12px] pr-1 transition-colors ${focused ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
      data-focused={focused ? '' : undefined}
    >
      <button
        type="button"
        onClick={() => playTrack(track)}
        aria-current={isCurrent ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-[12px] py-3 pl-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 active:opacity-70"
      >
        <span className="flex w-5 shrink-0 justify-center text-[15px] tabular-nums text-white/40">
          {isCurrent ? <EqualizerBars playing={isPlaying} className="scale-90" /> : track.number}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[16px] ${isCurrent ? 'font-semibold text-white' : failed ? 'text-white/35' : 'text-white/90'}`}>
          {track.title}
        </span>
      </button>
      <TrackMenu track={track} />
    </li>
  );
}

// Everything about one release: artwork, Play and Shuffle, and the tracklist. A song link
// (focusTrack) leads with that song and highlights it in the list.
export function ReleaseView({ project, release, focusTrack, inSheet = true }: { project: Project; release?: Release; focusTrack?: Track; inSheet?: boolean }) {
  const player = usePlayer();
  const cover = release?.cover ?? project.image;
  const isThisRelease = Boolean(release) && player.current?.release.id === release?.id;
  const isPlayingThis = isThisRelease && player.isPlaying && (!focusTrack || player.current?.id === focusTrack.id);

  const play = () => {
    if (!release) return;
    if (focusTrack) {
      if (player.current?.id === focusTrack.id) player.toggle();
      else player.playTrack(focusTrack);
    } else if (isThisRelease) {
      player.toggle();
    } else {
      player.playRelease(release, { shuffle: false });
    }
  };

  const meta = release
    ? `${getProjectTypeLabel(project)} · ${release.tracks.length} songs · ${releaseMinutes(release)} min`
    : getProjectTypeLabel(project);

  return (
    <div className={`px-5 ${inSheet ? '' : 'pb-2'}`} style={inSheet ? { paddingBottom: 'calc(8rem + var(--sheet-player-offset, 0px))' } : undefined}>
      <div className="flex flex-col items-center pt-4 text-center">
        {cover ? (
          <div className="release-art relative w-[min(62vw,260px)] overflow-hidden rounded-[12px]" style={{ aspectRatio: '1 / 1', ...placeholderBackground(cover) }}>
            <ResponsiveImage asset={cover} alt={`${release?.title ?? project.name} cover`} sizes="260px" priority className="absolute inset-0 h-full w-full object-cover" />
          </div>
        ) : null}
        <h1 className="mt-6 text-balance text-[24px] font-bold leading-tight tracking-[-0.025em]">
          {focusTrack ? focusTrack.title : (release?.title ?? project.name)}
        </h1>
        <p className="mt-1 text-[17px] text-white/65">
          {focusTrack ? `${release?.title} · Bryton Zoz` : 'Bryton Zoz'}
        </p>
        <p className="mt-1.5 text-[13px] text-white/40">{meta}</p>
      </div>

      {release && isProjectReleased(project) ? (
        <>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={play}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-white text-[17px] font-semibold text-black transition-transform duration-150 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              {isPlayingThis ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
              {isPlayingThis ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => player.playRelease(release, { shuffle: true })}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-white/[0.14] text-[17px] font-semibold text-white transition-[transform,background-color] duration-150 hover:bg-white/[0.18] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              <ShuffleIcon size={18} />
              Shuffle
            </button>
          </div>

          <ol className="mt-5">
            {release.tracks.map((track) => (
              <TrackRow key={track.id} track={track} focused={focusTrack?.id === track.id} />
            ))}
          </ol>
          <p className="mt-4 px-3 text-[13px] text-white/40">
            {release.tracks.length} songs, {releaseMinutes(release)} minutes
            <br />© Bryton Zoz
          </p>
        </>
      ) : null}
    </div>
  );
}
