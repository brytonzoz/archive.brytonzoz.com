'use client';

import React, { useEffect, useState } from 'react';
import { Project, isProjectReleased } from '../lib/utils';
import { streamingIconAssets } from '../lib/assets';
import { ResponsiveImage, placeholderBackground } from './ResponsiveImage';

const STREAMING_SERVICES = [
  { key: 'applemusic', name: 'Apple Music', icon: streamingIconAssets.applemusic },
  { key: 'spotify', name: 'Spotify', icon: streamingIconAssets.spotify },
  { key: 'youtubemusic', name: 'YouTube Music', icon: streamingIconAssets.youtubemusic },
] as const;

const TYPE_LABELS: Record<string, string> = {
  album: 'Album',
  'streaming-ep': 'EP',
  mixtape: 'Mixtape',
  'multi-purpose-stream': 'Platform',
  'video-series': 'Video series',
  ecommerce: 'Store',
};

function getStreamingLinks(project: Project) {
  return isProjectReleased(project)
    ? (project.postReleaseStreamingLinks || project.streamingLinks)
    : project.streamingLinks;
}

function getDescription(project: Project) {
  return isProjectReleased(project)
    ? (project.postReleaseDescription || project.description)
    : (project.preReleaseDescription || project.description);
}

function ArrowIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const StreamingModal = ({
  project,
  isOpen,
  onClose,
}: {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const links = getStreamingLinks(project);
  if (!isOpen || !links) return null;

  const isReleased = isProjectReleased(project);
  // Before release every service is listed, but only Apple Music (the pre-save) is live.
  const services = STREAMING_SERVICES
    .map((service) => ({
      ...service,
      url: isReleased || service.key === 'applemusic' ? links[service.key] : undefined,
    }))
    .filter((service) => service.url || !isReleased);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Listen to ${project.name}`}
      className="fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="modal-backdrop absolute inset-0 cursor-default bg-black/60 backdrop-blur-xl"
      />

      <div
        className="modal-sheet relative w-full max-w-[380px] rounded-t-[28px] bg-[#161618] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] ring-1 ring-white/10 sm:rounded-[28px]"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center gap-4">
          {project.image ? (
            <div
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl"
              style={placeholderBackground(project.image)}
            >
              <ResponsiveImage
                asset={project.image}
                alt=""
                sizes="56px"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
              {isReleased ? 'Listen on' : 'Pre-save on'}
            </p>
            <h2 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.01em] text-white">{project.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ul className="mt-5 space-y-2">
          {services.map((service) => {
            const row = (
              <>
                <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/10">
                  <ResponsiveImage
                    asset={service.icon}
                    alt=""
                    sizes="32px"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </span>
                <span className="flex-1 text-[15px] font-medium">{service.name}</span>
              </>
            );

            return (
              <li key={service.key}>
                {service.url ? (
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-white transition-colors hover:bg-white/[0.11] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    {row}
                    <ArrowIcon className="text-white/40 transition-transform group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-white" />
                  </a>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-4 py-3 text-white/40">
                    {row}
                    <span className="text-[12px]">At release</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

interface ProjectCardProps {
  project: Project;
  className?: string;
  style?: React.CSSProperties;
  onModalStateChange?: (isOpen: boolean) => void;
}

export function ProjectCard({ project, className = '', style, onModalStateChange }: ProjectCardProps) {
  const [isStreamingModalOpen, setIsStreamingModalOpen] = useState(false);
  const links = getStreamingLinks(project);
  const isReleased = isProjectReleased(project);
  const action = links
    ? (isReleased ? 'Listen' : 'Pre-save')
    : project.type === 'video-series'
      ? 'Watch'
      : project.type === 'ecommerce'
        ? 'Shop'
        : 'Visit';

  const content = (
    <>
      <div
        className="relative aspect-square overflow-hidden rounded-[22px] bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]"
        style={project.image ? placeholderBackground(project.image) : undefined}
      >
        {project.image ? (
          <ResponsiveImage
            asset={project.image}
            alt={project.name}
            sizes="(min-width: 640px) 420px, calc(100vw - 40px)"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          />
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-4 px-0.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
            {TYPE_LABELS[project.type] ?? project.type.replace(/-/g, ' ')}
          </p>
          <h2 className="mt-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-white">{project.name}</h2>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-white/55">{getDescription(project)}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-black transition-transform duration-200 group-hover:translate-x-0.5">
          {action}
          {links ? null : <ArrowIcon />}
        </span>
      </div>
    </>
  );

  const cardClassName = `group block w-full rounded-[26px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60 ${className}`;

  if (links) {
    return (
      <>
        <button
          type="button"
          className={cardClassName}
          style={style}
          onClick={() => {
            setIsStreamingModalOpen(true);
            onModalStateChange?.(true);
          }}
        >
          {content}
        </button>
        <StreamingModal
          project={project}
          isOpen={isStreamingModalOpen}
          onClose={() => {
            setIsStreamingModalOpen(false);
            onModalStateChange?.(false);
          }}
        />
      </>
    );
  }

  return (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cardClassName}
      style={style}
    >
      {content}
    </a>
  );
}
