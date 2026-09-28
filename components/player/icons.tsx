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

export function ShareIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5v11M8 7.2l4-3.9 4 3.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ShuffleIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6.5h3.2c2 0 3.2 1 4.3 2.7l3 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M3 17.5h3.2c1.3 0 2.3-.4 3.1-1.2M14.7 7.7c.8-.8 1.8-1.2 3.1-1.2H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m18.5 4 2.5 2.5L18.5 9M18.5 15l2.5 2.5-2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RepeatIcon({ size = 18, className, one = false }: IconProps & { one?: boolean }) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M17 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7 21l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {one ? <path d="M11.2 10.4 12.4 9.6V14.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

export function MoreIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18.5" cy="12" r="1.9" />
    </svg>
  );
}

export function GripIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 8.5h14M5 12h14M5 15.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function RemoveIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.18" />
      <path d="M8 12h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function PlayNextIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h10M4 11h7M4 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 11.5v7.3a.8.8 0 0 0 1.2.7l5.6-3.7a.8.8 0 0 0 0-1.3l-5.6-3.7a.8.8 0 0 0-1.2.7Z" fill="currentColor" />
    </svg>
  );
}

export function AddToQueueIcon({ size = 18, className }: IconProps) {
  return (
    <svg className={className} style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h10M4 11h10M4 16h6M17 13v7M13.5 16.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
