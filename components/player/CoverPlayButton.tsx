'use client';

import React from 'react';
import { getReleaseForProject } from '../../lib/tracks';
import { usePlayer } from './context';
import { PauseIcon, PlayIcon } from './icons';

// Play/pause for a whole release, sitting on its cover art. Renders nothing if the release
// isn't playable on the site.
export function CoverPlayButton({ projectName, style }: { projectName: string; style?: React.CSSProperties }) {
  const { current, isPlaying, isLoading, playRelease, toggle } = usePlayer();
  const release = getReleaseForProject(projectName);
  if (!release) return null;

  const isThisRelease = current?.release.id === release.id;
  const showPause = isThisRelease && isPlaying;

  return (
    <button
      type="button"
      onClick={() => (isThisRelease ? toggle() : playRelease(release))}
      aria-label={showPause ? `Pause ${release.title}` : `Play ${release.title}`}
      className="cover-play absolute z-10 flex items-center justify-center rounded-full bg-white/95 text-black shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur transition-transform duration-200 hover:scale-105 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
      style={style}
    >
      {isThisRelease && isLoading ? <span className="player-spinner absolute inset-[-3px] rounded-full" aria-hidden="true" /> : null}
      {showPause ? <PauseIcon className="h-[42%] w-[42%]" /> : <PlayIcon className="h-[44%] w-[44%] translate-x-[6%]" />}
    </button>
  );
}
