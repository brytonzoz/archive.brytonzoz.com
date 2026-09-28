import React from 'react';

type IconProps = { size?: number | string; className?: string };

export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.02-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PauseIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
    </svg>
  );
}

export function NextIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6.2v11.6a.9.9 0 0 0 1.38.76L13.5 13.4V17.8a.9.9 0 0 0 1.38.76l8.2-5.8a.9.9 0 0 0 0-1.52l-8.2-5.8A.9.9 0 0 0 13.5 6.2v4.4L5.38 5.44A.9.9 0 0 0 4 6.2Z" />
    </svg>
  );
}

export function PreviousIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 6.2v11.6a.9.9 0 0 1-1.38.76L10.5 13.4V17.8a.9.9 0 0 1-1.38.76l-8.2-5.8a.9.9 0 0 1 0-1.52l8.2-5.8a.9.9 0 0 1 1.38.76v4.4l8.12-5.16A.9.9 0 0 1 20 6.2Z" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M8.5 7H17v8.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 6.5l11 11m0-11-11 11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

// Up Next / tracklist toggle.
export function QueueIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function ExplicitBadge() {
  return (
    <span
      aria-label="Explicit"
      className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] bg-white/45 text-[9px] font-bold leading-none text-black"
    >
      E
    </span>
  );
}

// Three bars that bounce while music plays and rest when paused.
export function EqualizerBars({ playing, className = '' }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`equalizer ${playing ? 'is-playing' : ''} ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
}
