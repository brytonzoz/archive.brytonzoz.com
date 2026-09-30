'use client';

import { useEffect } from 'react';
import { cancelCardFallback, cardMotionActive, transitionCard, type CardSource } from '../lib/card-motion';
import { useSheet } from './useSheet';

// Keep the site's scroll lock, focus and Escape handling. Product and release sheets
// share card morphing and whole-panel gestures; bag and notify sheets keep their behavior.
export function useCardSheet(isOpen: boolean, onClose: () => void, source: CardSource | null) {
  const { sheetRef, requestClose } = useSheet(isOpen, onClose, () => transitionCard(source, onClose, false));

  useEffect(() => {
    const panel = sheetRef.current;
    if (!isOpen || !panel) return;
    const backdrop = panel.parentElement?.querySelector<HTMLElement>('.sheet-backdrop');
    let gesture: { x: number; y: number; lastY: number; time: number; dy: number; velocity: number; claimed: boolean; scroller: HTMLElement | null } | null = null;
    let pointer: number | null = null;
    let suppressClick = false;
    let frame = 0;
    let settle: Animation | null = null;
    let fade: Animation | null = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = (x: number, y: number, target: EventTarget | null) => {
      if (cardMotionActive(panel) || (target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      settle?.cancel();
      fade?.cancel();
      panel.style.transform = '';
      if (backdrop) backdrop.style.opacity = '';
      suppressClick = false;
      let scroller: HTMLElement | null = null;
      const targetElement = target instanceof HTMLElement ? target : target instanceof Element ? target.parentElement : null;
      for (let node = targetElement; node && node !== panel; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) { scroller = node; break; }
      }
      gesture = { x, y, lastY: y, time: performance.now(), dy: 0, velocity: 0, claimed: false, scroller };
    };
    const paint = () => {
      if (!gesture?.claimed) return;
      const progress = Math.min(1, gesture.dy / panel.offsetHeight);
      const pull = gesture.dy * 0.72 / (1 + progress);
      panel.style.transform = `translateY(${pull}px) scale(${1 - progress * 0.08})`;
      if (backdrop) backdrop.style.opacity = `${1 - progress * 0.65}`;
    };
    const move = (x: number, y: number, event: Event) => {
      if (!gesture) return;
      const dx = x - gesture.x;
      const dy = y - gesture.y;
      if (!gesture.claimed) {
        // Upward scrolling and horizontal gallery swipes belong to their existing scrollers.
        if (dy < -8 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { gesture = null; return; }
        if (dy < 8 || dy < Math.abs(dx) * 1.2) return;
        // Reading back toward the photos scrolls the content. At its top, a pull
        // anywhere in the panel can dismiss, including the photo and the footer.
        if (gesture.scroller && gesture.scroller.scrollTop > 0) { gesture = null; return; }
        gesture.claimed = true;
        suppressClick = true;
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      gesture.velocity = (y - gesture.lastY) / Math.max(1, now - gesture.time);
      gesture.lastY = y;
      gesture.time = now;
      gesture.dy = Math.max(0, dy);
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };
    const end = (cancelled = false) => {
      if (!gesture?.claimed) { gesture = null; return; }
      const dismiss = !cancelled && (gesture.dy > 90 || (gesture.dy > 24 && gesture.velocity > 0.65 && performance.now() - gesture.time < 100));
      cancelAnimationFrame(frame);
      frame = 0;
      paint();
      gesture = null;
      if (dismiss) { requestClose(); return; }
      const transform = panel.style.transform || 'none';
      const opacity = backdrop?.style.opacity || '1';
      panel.style.transform = '';
      if (backdrop) backdrop.style.opacity = '';
      // A resisted pull returns with a small elastic overshoot instead of a hard reset.
      settle = panel.animate([{ transform }, { transform: 'none' }], { duration: reduced ? 0 : 420, easing: 'cubic-bezier(0.22, 1.2, 0.36, 1)' });
      fade = backdrop?.animate([{ opacity }, { opacity: 1 }], { duration: reduced ? 0 : 420 }) ?? null;
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { end(true); return; }
      start(event.touches[0].clientX, event.touches[0].clientY, event.target);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { end(true); return; }
      move(event.touches[0].clientX, event.touches[0].clientY, event);
    };
    const touchEnd = () => end();
    const cancel = () => end(true);
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.button === 0) { pointer = event.pointerId; start(event.clientX, event.clientY, event.target); }
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerId !== pointer) return;
      if (!(event.buttons & 1)) { end(true); pointer = null; return; }
      move(event.clientX, event.clientY, event);
      if (gesture?.claimed) panel.setPointerCapture(event.pointerId);
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerId !== pointer) return;
      end();
      pointer = null;
      if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerId !== pointer) return;
      end(true);
      pointer = null;
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    };
    panel.addEventListener('touchstart', touchStart, { passive: true });
    panel.addEventListener('touchmove', touchMove, { passive: false });
    panel.addEventListener('touchend', touchEnd);
    panel.addEventListener('touchcancel', cancel);
    panel.addEventListener('pointerdown', pointerDown);
    panel.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerCancel);
    panel.addEventListener('lostpointercapture', pointerCancel);
    panel.addEventListener('click', click, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelCardFallback(panel);
      settle?.cancel();
      fade?.cancel();
      panel.removeEventListener('touchstart', touchStart);
      panel.removeEventListener('touchmove', touchMove);
      panel.removeEventListener('touchend', touchEnd);
      panel.removeEventListener('touchcancel', cancel);
      panel.removeEventListener('pointerdown', pointerDown);
      panel.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerCancel);
      panel.removeEventListener('lostpointercapture', pointerCancel);
      panel.removeEventListener('click', click, true);
      if (source?.element.isConnected) source.element.style.visibility = source.visibility;
    };
  }, [isOpen, sheetRef, requestClose, source]);

  return { sheetRef, requestClose };
}
