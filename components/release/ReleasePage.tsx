'use client';

import React from 'react';
import Link from 'next/link';
import { getProjects } from '../../lib/projects';
import { shareLink } from '../../lib/share';
import { getRelease, releasePath, trackPath } from '../../lib/tracks';
import { placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { ShareIcon } from '../player/icons';
import { PlatformBar } from './PlatformBar';
import { ReleaseView } from './ReleaseView';

// The page a shared link opens: brytonzoz.com/<release>/ or /<release>/<song>/.
export function ReleasePage({ releaseId, songSlug }: { releaseId: string; songSlug?: string }) {
  const { notify } = usePlayer();
  const release = getRelease(releaseId);
  const { music, fashion } = getProjects();
  const project = [...music, ...fashion].find((candidate) => candidate.name === release?.projectName);
  if (!release || !project) return null;
  const focusTrack = songSlug ? release.tracks.find((track) => track.slug === songSlug) : undefined;

  const share = () => {
    const target = focusTrack
      ? { title: `${focusTrack.title} by Bryton Zoz`, text: `${focusTrack.title} · ${release.title}`, path: trackPath(focusTrack), release: release.id, trackId: focusTrack.id }
      : { title: `${release.title} by Bryton Zoz`, text: `${release.title} by Bryton Zoz`, path: releasePath(release), release: release.id };
    shareLink(target).then((message) => message && notify(message));
  };

  return (
    <div className="relative isolate min-h-screen font-body text-white">
      <div aria-hidden="true" className="fixed inset-0 -z-10 bg-[#111]" />
      <div aria-hidden="true" className="fixed inset-[-20%] -z-10 opacity-80 blur-[70px] saturate-[1.5]" style={placeholderBackground(release.cover)} />
      <div aria-hidden="true" className="fixed inset-0 -z-10 bg-gradient-to-b from-black/30 via-black/60 to-black/90" />

      <header className="sticky top-0 z-20 flex items-center justify-between px-3 pb-2 backdrop-blur-xl [background:linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0))]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <Link
          href="/"
          className="flex h-10 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>
        <button
          type="button"
          onClick={share}
          aria-label={focusTrack ? 'Share song' : `Share ${release.title}`}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <ShareIcon size={19} />
        </button>
      </header>

      <div className="mx-auto max-w-[520px]">
        <ReleaseView project={project} release={release} focusTrack={focusTrack} />
      </div>

      <PlatformBar
        project={project}
        release={release}
        className="fixed inset-x-0 z-[80]"
        style={{ bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + var(--player-offset, 0px))' }}
      />
    </div>
  );
}
