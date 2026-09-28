'use client';

import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { track as trackMetric } from '../../lib/analytics';
import { shareLink } from '../../lib/share';
import { getReleaseForProject, releasePath } from '../../lib/tracks';
import { Project, isProjectReleased } from '../../lib/utils';
import { placeholderBackground } from '../ResponsiveImage';
import { usePlayer } from '../player/context';
import { ChevronDownIcon, ShareIcon } from '../player/icons';
import { useSheet } from '../useSheet';
import { PlatformBar } from './PlatformBar';
import { ReleaseView, releaseKey } from './ReleaseView';

const iconButton =
  'flex h-10 w-10 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70';

// "Listen Now": the whole release in a sheet, playable right here, with the streaming apps
// floating at the bottom.
export function ReleaseSheet({ project, isOpen, onClose }: { project: Project; isOpen: boolean; onClose: () => void }) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const { notify } = usePlayer();
  const release = isProjectReleased(project) ? getReleaseForProject(project.name) : undefined;
  const key = releaseKey(project, release);

  useEffect(() => {
    if (isOpen) trackMetric({ type: 'open', release: key });
  }, [isOpen, key]);

  if (!isOpen) return null;
  const cover = release?.cover ?? project.image;

  // Portaled to <body> so it sits above the page dots and the mini player, whatever opened it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />

      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative isolate flex h-[calc(100dvh-8px)] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[32px] text-white outline-none sm:h-[min(860px,calc(100dvh-48px))] sm:rounded-[32px]"
        style={sheetStyle}
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#111]" />
        {cover ? <div aria-hidden="true" className="absolute inset-[-20%] -z-10 opacity-80 blur-[60px] saturate-[1.5]" style={placeholderBackground(cover)} /> : null}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-black/30 via-black/60 to-black/85" />

        <div {...dragHandlers} className="relative flex-none touch-none select-none px-3 pb-1 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/30 sm:invisible" />
          <div className="-mt-1 flex items-center justify-between">
            <button type="button" onClick={requestClose} aria-label="Close" className={iconButton}>
              <ChevronDownIcon size={22} />
            </button>
            <span id={titleId} className="sr-only">{project.name}</span>
            {release ? (
              <button
                type="button"
                aria-label={`Share ${release.title}`}
                onClick={() =>
                  shareLink({ title: `${release.title} by Bryton Zoz`, text: `${release.title} by Bryton Zoz`, path: releasePath(release), release: release.id })
                    .then((message) => message && notify(message))
                }
                className={iconButton}
              >
                <ShareIcon size={19} />
              </button>
            ) : <span className="h-10 w-10" />}
          </div>
        </div>

        <div className="sheet-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32">
          <ReleaseView project={project} release={release} />
        </div>

        <PlatformBar
          project={project}
          release={release}
          className="platform-fade absolute inset-x-0 bottom-0 pt-10"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        />
      </div>
    </div>,
    document.body,
  );
}
