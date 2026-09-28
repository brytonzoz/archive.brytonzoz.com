'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const CLOSE_MS = 220;
// Open sheets, most recent last: Escape closes only the top one (e.g. Now Playing over Listen Now).
const openSheets: object[] = [];
const DISMISS_DRAG_PX = 90;

// Shared bottom-sheet behavior: scroll lock, focus handoff, Escape, swipe-down to dismiss,
// and an exit animation (the `is-closing` class) before `onClose` runs.
export function useSheet(isOpen: boolean, onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => setIsClosing(true), []);

  useEffect(() => {
    if (!isClosing) return;
    const timer = window.setTimeout(() => {
      setIsClosing(false);
      setDragY(0);
      onCloseRef.current();
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [isClosing]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const scroller = document.querySelector<HTMLElement>('.scroll-container');
    const previousOverflow = [document.documentElement.style.overflow, scroller?.style.overflow ?? ''];
    document.documentElement.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
    sheetRef.current?.focus({ preventScroll: true });

    const token = {};
    openSheets.push(token);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openSheets[openSheets.length - 1] === token) requestClose();
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      openSheets.splice(openSheets.indexOf(token), 1);
      window.removeEventListener('keydown', handleKey);
      document.documentElement.style.overflow = previousOverflow[0];
      if (scroller) scroller.style.overflow = previousOverflow[1];
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [isOpen, requestClose]);

  const endDrag = () => {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    setIsDragging(false);
    if (dragY > DISMISS_DRAG_PX) {
      requestClose();
    } else {
      setDragY(0);
    }
  };

  const dragHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button, a, input')) return;
      dragStartY.current = event.clientY;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (dragStartY.current !== null) setDragY(Math.max(0, event.clientY - dragStartY.current));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  const sheetStyle = {
    '--drag-y': `${dragY}px`,
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
  } as React.CSSProperties;

  return { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle };
}
