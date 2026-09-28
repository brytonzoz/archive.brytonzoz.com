'use client';

import React, { useId } from 'react';
import { Project, getProjectTypeLabel, getStreamingLinks, isProjectReleased } from '../lib/utils';
import { streamingIconAssets } from '../lib/assets';
import { getReleaseForProject } from '../lib/tracks';
import { ResponsiveImage, placeholderBackground } from './ResponsiveImage';
import { usePlayer } from './player/context';
import { PlayIcon } from './player/icons';
import { useSheet } from './useSheet';

const SERVICES = [
  { key: 'applemusic', name: 'Apple Music', icon: streamingIconAssets.applemusic, tile: '#FA2D48', button: '#FA2D48', buttonText: '#FFFFFF' },
  { key: 'spotify', name: 'Spotify', icon: streamingIconAssets.spotify, tile: '#121212', button: '#1ED760', buttonText: '#000000' },
  { key: 'youtubemusic', name: 'YouTube Music', icon: streamingIconAssets.youtubemusic, tile: '#0F0F0F', button: '#FF0033', buttonText: '#FFFFFF' },
] as const;

const RELEASE_NOUNS: Record<string, string> = {
  album: 'album',
  'streaming-ep': 'EP',
  mixtape: 'mixtape',
};

// Tell people exactly where a button lands, derived from the link itself.
function describeDestination(url: string, releaseNoun: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Opens in the app';
  }
  const path = parsed.pathname;
  if (parsed.searchParams.has('i') || path.includes('/track/') || path.startsWith('/watch')) return 'Opens the song';
  if (path.includes('/album/') || parsed.searchParams.get('list')?.startsWith('OLAK5uy')) return `Opens the ${releaseNoun}`;
  if (path.includes('/playlist')) return 'Opens the playlist';
  if (path.includes('/artist/') || path.includes('/channel/') || path.includes('/browse/')) return 'Opens the artist page';
  return 'Opens in the app';
}

export function ListenSheet({
  project,
  isOpen,
  onClose,
}: {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const player = usePlayer();
  const siteRelease = getReleaseForProject(project.name);

  const links = getStreamingLinks(project);
  if (!isOpen || !links) return null;

  const isReleased = isProjectReleased(project);
  const releaseNoun = RELEASE_NOUNS[project.type] ?? 'release';
  // Before release every service is listed, but only Apple Music (the pre-save) is live.
  const services = SERVICES
    .map((service) => ({
      ...service,
      url: isReleased || service.key === 'applemusic' ? links[service.key] : undefined,
    }))
    .filter((service) => service.url || !isReleased);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div
        aria-hidden="true"
        onClick={requestClose}
        className="sheet-backdrop absolute inset-0 touch-none bg-black/60 backdrop-blur-md"
      />

      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative w-full max-w-[420px] rounded-t-[32px] bg-[#131315] text-white shadow-[0_-10px_60px_rgba(0,0,0,0.45)] outline-none ring-1 ring-white/[0.08] sm:rounded-[32px]"
        style={sheetStyle}
      >
        <div
          className="touch-none select-none px-6 pb-5 pt-2.5 text-center"
          {...dragHandlers}
        >
          <div aria-hidden="true" className="mx-auto h-[5px] w-10 rounded-full bg-white/20 sm:invisible" />
          {project.image ? (
            <div
              className="relative mx-auto mt-5 h-[92px] w-[92px] overflow-hidden rounded-[20px] shadow-[0_12px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/10"
              style={placeholderBackground(project.image)}
            >
              <ResponsiveImage
                asset={project.image}
                alt=""
                sizes="92px"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}
          <h2 id={titleId} className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {project.name}
          </h2>
          <p className="mt-1 text-[14px] text-white/50">
            Bryton Zoz &middot; {getProjectTypeLabel(project)}
          </p>
        </div>

        <p className="px-6 pb-2 text-[13px] font-medium text-white/40">
          {isReleased ? 'Choose where to listen' : 'Pre-save now, listen on release day'}
        </p>

        <ul className="space-y-2 px-3">
          {siteRelease && isReleased ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  if (player.current?.release.id === siteRelease.id) {
                    player.expand();
                  } else {
                    player.playRelease(siteRelease);
                  }
                  requestClose();
                }}
                className="flex w-full items-center gap-3.5 rounded-[20px] bg-white/[0.1] p-3 pr-3.5 text-left ring-1 ring-inset ring-white/10 transition-[background-color,transform] duration-150 hover:bg-white/[0.14] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white text-black">
                  <PlayIcon size={20} className="translate-x-[1px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold leading-tight">Play here</span>
                  <span className="mt-0.5 block text-[13px] leading-tight text-white/55">
                    {player.current?.release.id === siteRelease.id
                      ? 'Playing now on this site'
                      : `${siteRelease.tracks.length} songs · keeps playing as you browse`}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-white px-4 py-[7px] text-[14px] font-semibold text-black">
                  {player.current?.release.id === siteRelease.id ? 'View' : 'Play'}
                </span>
              </button>
            </li>
          ) : null}
          {services.map((service) => {
            const tile = (
              <span
                className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[12px]"
                style={{ backgroundColor: service.tile }}
              >
                <ResponsiveImage
                  asset={service.icon}
                  alt=""
                  sizes="44px"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </span>
            );

            if (!service.url) {
              return (
                <li key={service.key} className="flex items-center gap-3.5 rounded-[20px] bg-white/[0.03] p-3 pr-3.5">
                  <span className="flex shrink-0 opacity-40 grayscale">{tile}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-tight text-white/45">{service.name}</span>
                    <span className="mt-0.5 block text-[13px] leading-tight text-white/35">Available on release day</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-4 py-[7px] text-[14px] font-semibold text-white/40">
                    Soon
                  </span>
                </li>
              );
            }

            return (
              <li key={service.key}>
                <a
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${service.name}: ${describeDestination(service.url, releaseNoun)}`}
                  className="flex items-center gap-3.5 rounded-[20px] bg-white/[0.06] p-3 pr-3.5 transition-[background-color,transform] duration-150 hover:bg-white/[0.1] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                >
                  {tile}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-tight">{service.name}</span>
                    <span className="mt-0.5 block text-[13px] leading-tight text-white/50">
                      {isReleased ? describeDestination(service.url, releaseNoun) : `Pre-save the ${releaseNoun}`}
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-4 py-[7px] text-[14px] font-semibold"
                    style={{ backgroundColor: service.button, color: service.buttonText }}
                  >
                    {isReleased ? 'Open' : 'Pre-save'}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="px-3 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button
            type="button"
            onClick={requestClose}
            className="h-[52px] w-full rounded-[20px] text-[16px] font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
