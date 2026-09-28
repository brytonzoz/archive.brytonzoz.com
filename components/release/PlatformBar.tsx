'use client';

import React, { useEffect, useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { track as trackMetric } from '../../lib/analytics';
import { openInApp } from '../../lib/open-app';
import { getStreamingServices, type StreamingService } from '../../lib/streaming';
import type { Release } from '../../lib/tracks';
import { Project, isProjectReleased } from '../../lib/utils';
import { ResponsiveImage } from '../ResponsiveImage';
import { ArrowUpRightIcon, ChevronDownIcon } from '../player/icons';
import { releaseKey } from './ReleaseView';

// Morphs between the small bar and the panel where the browser can (View Transitions);
// elsewhere the panel animates in on its own.
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduced) doc.startViewTransition(() => flushSync(update));
  else update();
}

function AppIcon({ service, size }: { service: StreamingService; size: number }) {
  return (
    <span
      className="relative block shrink-0 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
      style={{ width: size, height: size, borderRadius: size * 0.27, backgroundColor: service.tile }}
    >
      <ResponsiveImage asset={service.icon} alt="" sizes={`${size}px`} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      <span aria-hidden="true" className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
    </span>
  );
}

// Floats at the bottom of a release: the apps people already pay for. Tapping "Add to your library"
// opens a larger panel with big buttons; every button opens the app itself (lib/open-app.ts).
export function PlatformBar({ project, release, className = '', style }: { project: Project; release?: Release; className?: string; style?: React.CSSProperties }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const services = getStreamingServices(project);
  const isReleased = isProjectReleased(project);
  const key = releaseKey(project, release);
  const label = isReleased ? 'Add to your library' : 'Pre-save';

  const setOpen = (value: boolean) => transition(() => setExpanded(value));

  // Escape closes the panel first (not the sheet behind it).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!services.length && !project.url) return null;

  const open = (service: StreamingService) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    trackMetric({ type: 'outbound', release: key, detail: service.key });
    if (service.url && openInApp(service.key, service.url)) event.preventDefault();
  };

  if (!services.length) {
    return (
      <div className={`pointer-events-none flex justify-center px-4 ${className}`} style={style}>
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackMetric({ type: 'outbound', release: key, detail: 'website' })}
          className="platform-bar pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-semibold text-black shadow-[0_10px_30px_rgba(0,0,0,0.4)] transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
        >
          Website
          <ArrowUpRightIcon size={14} />
        </a>
      </div>
    );
  }

  return (
    <>
      {expanded ? <div aria-hidden="true" onClick={() => setOpen(false)} className="platform-scrim fixed inset-0 z-[1] bg-black/50" /> : null}
      <div className={`pointer-events-none z-[2] flex justify-center px-3 ${className}`} style={style}>
        {expanded ? (
          <div
            id={panelId}
            role="group"
            aria-label={label}
            className="platform-panel glass-capsule glass-solid pointer-events-auto w-full max-w-[440px] rounded-[20px] p-4 pb-3"
            style={{ viewTransitionName: 'platform-bar', minHeight: 'min(34dvh, 320px)' } as React.CSSProperties}
          >
            <div className="flex items-start justify-between gap-3 px-1">
              <div>
                <p className="text-[20px] font-bold leading-tight tracking-[-0.02em]">{label}</p>
                <p className="mt-0.5 text-[14px] text-white/50">{isReleased ? 'Opens in the app' : 'Save it for release day'}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                aria-controls={panelId}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
              >
                <ChevronDownIcon size={20} />
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {services.map((service, i) => (
                <li key={service.key} className="platform-row" style={{ animationDelay: `${60 + i * 45}ms` }}>
                  {service.url ? (
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={open(service)}
                      aria-label={`${isReleased ? 'Open in' : 'Pre-save on'} ${service.name}`}
                      className="flex h-[68px] items-center gap-4 rounded-[12px] bg-white/[0.08] pl-3 pr-4 transition-[background-color,transform] duration-150 hover:bg-white/[0.12] active:scale-[0.98] active:bg-white/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                    >
                      <AppIcon service={service} size={46} />
                      <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{service.name}</span>
                      <span className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[14px] font-semibold text-black">{isReleased ? 'Open' : 'Pre-save'}</span>
                    </a>
                  ) : (
                    <span className="flex h-[68px] items-center gap-4 rounded-[12px] bg-white/[0.04] pl-3 pr-4 text-white/50">
                      <span className="opacity-40 grayscale"><AppIcon service={service} size={46} /></span>
                      <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{service.name}</span>
                      <span className="shrink-0 text-[14px] font-semibold">Release day</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            className="platform-bar glass-capsule glass-solid pointer-events-auto flex items-center gap-1 rounded-full py-2 pl-2 pr-2"
            style={{ viewTransitionName: 'platform-bar' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded="false"
              aria-controls={panelId}
              className="flex h-10 items-center gap-1.5 rounded-full pl-3 pr-2 text-[13px] font-semibold text-white/80 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
            >
              {label}
              <ChevronDownIcon size={14} className="rotate-180 text-white/50" />
            </button>
            <span className="flex items-center gap-1.5">
              {services.map((service) =>
                service.url ? (
                  <a
                    key={service.key}
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={open(service)}
                    aria-label={`${isReleased ? 'Open in' : 'Pre-save on'} ${service.name}`}
                    title={service.name}
                    className="block rounded-[11px] transition-transform duration-150 hover:scale-105 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                  >
                    <AppIcon service={service} size={40} />
                  </a>
                ) : (
                  <span key={service.key} aria-label={`${service.name}, on release day`} className="block opacity-40 grayscale">
                    <AppIcon service={service} size={40} />
                  </span>
                ),
              )}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
