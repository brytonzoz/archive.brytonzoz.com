'use client';

import React, { useState } from 'react';
import { Project, getProjectDescription, getProjectTypeLabel, getStreamingLinks, isProjectReleased } from '../lib/utils';
import { ListenSheet } from './ListenSheet';
import { ResponsiveImage, placeholderBackground } from './ResponsiveImage';

function ArrowIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
            {getProjectTypeLabel(project)}
          </p>
          <h2 className="mt-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-white">{project.name}</h2>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-white/55">{getProjectDescription(project)}</p>
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
        <ListenSheet
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
