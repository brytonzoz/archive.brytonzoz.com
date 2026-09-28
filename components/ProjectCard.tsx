'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Project, getProjectTypeLabel, isProjectReleased } from '../lib/utils';
import { getStreamingServices } from '../lib/streaming';
import { getReleaseForProject } from '../lib/tracks';
import { ReleaseSheet } from './release/ReleaseSheet';
import { ArrowUpRightIcon } from './player/icons';
import { ResponsiveImage, placeholderBackground } from './ResponsiveImage';

interface ProjectCardProps {
  project: Project;
  className?: string;
  style?: React.CSSProperties;
  onModalStateChange?: (isOpen: boolean) => void;
}

// A grid tile, as in a music library: artwork, title, and what it is. Releases open the listen
// sheet; pages on this site open in place; everything else opens its site.
export function ProjectCard({ project, className = '', style, onModalStateChange }: ProjectCardProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const hasSheet = getStreamingServices(project).length > 0 || (isProjectReleased(project) && Boolean(getReleaseForProject(project.name)));
  const isInternal = Boolean(project.url?.startsWith('/'));
  const isExternal = !hasSheet && !isInternal && Boolean(project.url);

  const content = (
    <>
      <div
        className="tile-cover relative aspect-square overflow-hidden rounded-[10px] bg-white/[0.04]"
        style={project.image ? placeholderBackground(project.image) : undefined}
      >
        {project.image ? (
          <ResponsiveImage
            asset={project.image}
            alt=""
            sizes="(min-width: 640px) 260px, calc(50vw - 28px)"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
      </div>
      <p className="mt-2.5 line-clamp-2 text-[15px] font-medium leading-snug tracking-[-0.01em] text-white">
        {project.name}
        {isExternal ? <ArrowUpRightIcon size={13} className="ml-1 inline-block align-[-1px] text-white/40" /> : null}
      </p>
      <p className="text-[13px] leading-snug text-white/45">{getProjectTypeLabel(project)}</p>
    </>
  );

  const tileClassName = `tile group block w-full min-w-0 rounded-[12px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60 ${className}`;

  if (hasSheet) {
    return (
      <>
        <button
          type="button"
          className={tileClassName}
          style={style}
          onClick={() => {
            setIsSheetOpen(true);
            onModalStateChange?.(true);
          }}
        >
          {content}
        </button>
        <ReleaseSheet
          project={project}
          isOpen={isSheetOpen}
          onClose={() => {
            setIsSheetOpen(false);
            onModalStateChange?.(false);
          }}
        />
      </>
    );
  }

  if (isInternal && project.url) {
    return (
      <Link href={project.url} className={tileClassName} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <a href={project.url} target="_blank" rel="noopener noreferrer" className={tileClassName} style={style}>
      {content}
    </a>
  );
}
