'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { CLOSE_MS, MOTION_EASING } from '../lib/scene-motion';
// Open sheets, most recent last: Escape closes only the top one (e.g. Now Playing over Listen Now).
const openSheets: object[] = [];
const DISMISS_DRAG_PX = 90;

// Shared bottom-sheet behavior: scroll lock, focus handoff, Escape, swipe-down to dismiss,
// and an exit animation (the `is-closing` class) before `onClose` runs.
export function useSheet(isOpen: boolean, onClose: () => void, onRequestClose?: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeTransitionRef = useRef(onRequestClose);
  closeTransitionRef.current = onRequestClose;
  const closeRequested = useRef(false);
  if (!isOpen) closeRequested.current = false;
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closeRequested.current) return;
    closeRequested.current = true;
    if (closeTransitionRef.current) {
      closeTransitionRef.current();
    } else {
      // Exit from the rendered frame, including a quick reversal of the opener
      // or a partially released drag. CSS must not jump back to its resting pose.
      const panel = sheetRef.current;
      const backdrop = panel?.classList.contains('sheet-panel')
        ? panel.parentElement?.querySelector<HTMLElement>('.sheet-backdrop') : null;
      const style = panel ? getComputedStyle(panel) : null;
      const transform = style?.transform ?? 'none';
      const opacity = style?.opacity ?? '1';
      const backdropOpacity = backdrop ? getComputedStyle(backdrop).opacity : '1';
      panel?.style.setProperty('--sheet-from-transform', transform);
      panel?.style.setProperty('--sheet-from-opacity', opacity);
      backdrop?.style.setProperty('--backdrop-from-opacity', backdropOpacity);
      setIsClosing(true);
    }
  }, []);

  useEffect(() => {
    if (!isClosing) return;
    const timer = window.setTimeout(() => {
      setIsClosing(false);
      setDragY(0);
      onCloseRef.current();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : CLOSE_MS);
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
    transition: isDragging ? 'none' : `transform ${CLOSE_MS}ms ${MOTION_EASING}`,
  } as React.CSSProperties;

  return { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle };
}
