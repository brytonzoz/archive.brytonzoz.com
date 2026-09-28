'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toggleLoved, useLoved } from '../../lib/likes';
import { shareLink } from '../../lib/share';
import { trackPath, type Track } from '../../lib/tracks';
import { usePlayer } from './context';
import { AddToQueueIcon, HeartIcon, MoreIcon, PlayNextIcon, ShareIcon } from './icons';

const MENU_WIDTH = 230;

// The "…" on a song: Play Next, Add to Queue, Love, Share Song. Laid out like an iOS context menu
// (label left, icon right) and kept inside the screen.
export function TrackMenu({ track, className = '' }: { track: Track; className?: string }) {
  const { playNext, addToQueue, notify } = usePlayer();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const loved = useLoved(track.id);
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const up = rect.bottom + 215 > window.innerHeight;
    setPosition({
      top: up ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(12, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
      up,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const openedAt = performance.now();
    const close = (event: Event) => {
      // A scroll already in flight when the menu opened (momentum, scroll-into-view) doesn't count.
      if (event.type === 'scroll' && performance.now() - openedAt < 250) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && (menuRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node))) return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    document.addEventListener('scroll', close, true);
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
    buttonRef.current?.focus({ preventScroll: true });
  };

  const items = [
    { label: 'Play Next', icon: <PlayNextIcon size={19} />, action: () => playNext(track) },
    { label: 'Add to Queue', icon: <AddToQueueIcon size={19} />, action: () => addToQueue(track) },
    {
      label: loved ? 'Unlove' : 'Love',
      icon: <HeartIcon size={18} filled={loved} className={loved ? 'text-[#ff375f]' : ''} />,
      action: () => notify(toggleLoved(track.id, track.release.id) ? 'Loved' : 'Removed from Loved'),
    },
    {
      label: 'Share Song',
      icon: <ShareIcon size={18} />,
      action: () => {
        shareLink({ title: `${track.title} by Bryton Zoz`, text: `${track.title} · ${track.release.title}`, path: trackPath(track), release: track.release.id, trackId: track.id })
          .then((message) => message && notify(message));
      },
    },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 ${className}`}
      >
        <MoreIcon size={18} />
      </button>
      {open && position
        ? createPortal(
          <div className={`fixed z-[300] ${position.up ? '-translate-y-full' : ''}`} style={{ top: position.top, left: position.left, width: MENU_WIDTH }}>
          <div
            ref={menuRef}
            role="menu"
            aria-label={track.title}
            className={`track-menu overflow-hidden rounded-[14px] font-body text-white ${position.up ? 'origin-bottom-right' : 'origin-top-right'}`}
          >
            {items.map((item, i) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={choose(item.action)}
                className={`flex h-11 w-full items-center justify-between px-4 text-left text-[16px] transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none active:bg-white/15 ${i ? 'border-t border-white/[0.08]' : ''}`}
              >
                {item.label}
                <span className="text-white/85">{item.icon}</span>
              </button>
            ))}
          </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
