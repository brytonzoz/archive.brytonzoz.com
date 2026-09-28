'use client';

import React, { useEffect, useId } from 'react';
import { Project, getProjectTypeLabel, isProjectReleased } from '../lib/utils';
import { getStreamingServices } from '../lib/streaming';
import { getReleaseForProject, warmTrack } from '../lib/tracks';
import { ResponsiveImage, placeholderBackground } from './ResponsiveImage';
import { usePlayer } from './player/context';
import { CloseIcon, PauseIcon, PlayIcon } from './player/icons';
import { useSheet } from './useSheet';

// Where to listen, laid out like the iOS share sheet: the release, then one tap per app.
export function ListenSheet({
  project,
  isOpen,
  onClose,
  showPlay = true,
}: {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  showPlay?: boolean;
}) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const player = usePlayer();
  const isReleased = isProjectReleased(project);
  const release = showPlay && isReleased ? getReleaseForProject(project.name) : undefined;

  useEffect(() => {
    if (isOpen) warmTrack(release?.tracks[0]);
  }, [isOpen, release]);

  const services = getStreamingServices(project);
  if (!isOpen || (!services.length && !release)) return null;

  const isThisRelease = Boolean(release) && player.current?.release.id === release?.id;
  const isPlayingThis = isThisRelease && player.isPlaying;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/50" />

      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative w-full max-w-[400px] rounded-t-[28px] bg-[#1c1c1e] text-white shadow-[0_-1px_0_rgba(255,255,255,0.06),0_-20px_60px_rgba(0,0,0,0.5)] outline-none sm:rounded-[28px]"
        style={{ ...sheetStyle, paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="touch-none select-none px-5 pt-2" {...dragHandlers}>
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/20 sm:invisible" />

          <div className="mt-3 flex items-center gap-3.5">
            {project.image ? (
              <span
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[10px] shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
                style={placeholderBackground(project.image)}
              >
                <ResponsiveImage asset={project.image} alt="" sizes="56px" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
                <span aria-hidden="true" className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-white/10" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em]">
                {project.name}
              </h2>
              <p className="mt-0.5 text-[15px] leading-tight text-white/50">{getProjectTypeLabel(project)}</p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        {release ? (
          <div className="px-5 pt-5">
            <button
              type="button"
              onClick={() => {
                if (isThisRelease) player.toggle();
                else player.playRelease(release);
                requestClose();
              }}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-white text-[17px] font-semibold text-black transition-transform duration-150 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              {isPlayingThis ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
              {isPlayingThis ? 'Pause' : 'Play'}
            </button>
          </div>
        ) : null}

        {services.length ? (
          <ul className="mt-5 grid grid-cols-3 gap-2 px-3" aria-label="Listen on">
            {services.map((service) => {
              const label = !service.url ? 'Soon' : isReleased ? service.name : 'Pre-save';
              const content = (
                <>
                  <span
                    className="relative h-[60px] w-[60px] overflow-hidden rounded-[15px] shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
                    style={{ backgroundColor: service.tile }}
                  >
                    <ResponsiveImage asset={service.icon} alt="" sizes="60px" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
                    <span aria-hidden="true" className="absolute inset-0 rounded-[15px] ring-1 ring-inset ring-white/10" />
                  </span>
                  <span className="mt-2 max-w-full truncate text-[12px] font-medium leading-tight">{label}</span>
                </>
              );

              return (
                <li key={service.key}>
                  {service.url ? (
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${isReleased ? 'Open in' : 'Pre-save on'} ${service.name}`}
                      className="flex flex-col items-center rounded-[18px] px-1 py-3 text-white/85 transition-[background-color,transform] duration-150 hover:bg-white/[0.06] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                    >
                      {content}
                    </a>
                  ) : (
                    <span aria-label={`${service.name}, available on release day`} className="flex flex-col items-center px-1 py-3 text-white/35 opacity-50 grayscale">
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
