'use client';

import { useEffect } from 'react';
import { beginCardDrag, cancelCardMotion, cancelControlMotion, moveCardTile, restoreCardSource, returnCardTile, cardMotionClosing, pauseCardScenes, transitionCard, type CardSource } from '../lib/card-motion';
import { MOTION_EASING, CLOSE_MS } from '../lib/scene-motion';
import { useSheet } from './useSheet';

// Keep the site's scroll lock, focus and Escape handling. Product and release sheets
// share card morphing and whole-panel gestures; bag and notify sheets keep their behavior.
export function useCardSheet(isOpen: boolean, onClose: () => void, source: CardSource | null) {
  const { sheetRef, requestClose } = useSheet(isOpen, onClose, () => transitionCard(source, onClose, false));

  useEffect(() => {
    const panel = sheetRef.current;
    if (!isOpen || !panel) return;
    const resumeScenes = pauseCardScenes();
    const backdrop = panel.parentElement?.querySelector<HTMLElement>('.sheet-backdrop');
    let gesture: { x: number; y: number; lastY: number; time: number; dy: number; velocity: number; claimed: boolean; height: number; width: number; baseX: number; baseY: number; baseScale: number; baseOpacity: number; scroller: HTMLElement | null } | null = null;
    let pointer: number | null = null;
    let suppressClick = false;
    let frame = 0;
    let settle: Animation | null = null;
    let fade: Animation | null = null;
    let tileReturns: Animation[] = [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = (x: number, y: number, target: EventTarget | null) => {
      const targetElement = target instanceof Element ? target : null;
      if (cardMotionClosing(panel) || targetElement?.closest('input, textarea, select, [contenteditable="true"]')) return;
      suppressClick = false;
      let scroller: HTMLElement | null = null;
      for (let node = targetElement instanceof HTMLElement ? targetElement : targetElement?.parentElement; node && node !== panel; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) { scroller = node; break; }
      }
      gesture = { x, y, lastY: y, time: performance.now(), dy: 0, velocity: 0, claimed: false, height: panel.offsetHeight, width: panel.offsetWidth, baseX: 0, baseY: 0, baseScale: 1, baseOpacity: 1, scroller };
    };
    const paint = () => {
      if (!gesture?.claimed) return;
      const progress = Math.min(1, gesture.dy / gesture.height);
      const pull = gesture.dy * 0.72 / (1 + progress);
      const scale = gesture.baseScale * (1 - progress * 0.06);
      const x = gesture.baseX + (gesture.baseScale - scale) * gesture.width / 2;
      const y = gesture.baseY + pull;
      panel.style.translate = `${x}px ${y}px`;
      moveCardTile(panel, x, y, scale);
      panel.style.scale = `${scale}`;
      if (backdrop) backdrop.style.opacity = `${gesture.baseOpacity * (1 - progress * 0.65)}`;
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
        // Independent translate/scale let a pull track the finger while an opener
        // finishes. Re-grabbing a spring starts at its rendered position.
        cancelControlMotion(panel);
        const style = getComputedStyle(panel);
        gesture.baseX = parseFloat(style.translate) || 0;
        gesture.baseY = parseFloat(style.translate.split(' ')[1] ?? '0') || 0;
        gesture.baseScale = parseFloat(style.scale) || 1;
        gesture.baseOpacity = backdrop ? parseFloat(getComputedStyle(backdrop).opacity) : 1;
        beginCardDrag(panel);
        settle?.cancel();
        fade?.cancel();
        tileReturns.forEach(animation => animation.cancel());
        panel.classList.add('card-is-dragging');
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
      const translate = panel.style.translate || 'none';
      const scale = panel.style.scale || '1';
      const opacity = backdrop?.style.opacity || '1';
      panel.style.translate = '';
      panel.style.scale = '';
      if (backdrop) backdrop.style.opacity = '';
      // The same soft settling curve as the scene scroll; all frames stay on the compositor.
      const timing = { duration: reduced ? 0 : CLOSE_MS, easing: MOTION_EASING };
      settle = panel.animate([{ translate, scale }, { translate: '0 0', scale: '1' }], timing);
      tileReturns = returnCardTile(panel, timing);
      fade = backdrop?.animate([{ opacity }, { opacity: 1 }], timing) ?? null;
      const current = settle;
      void settle.finished.then(() => {
        if (settle === current) panel.classList.remove('card-is-dragging');
      }, () => {});
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
      cancelCardMotion(panel);
      resumeScenes();
      settle?.cancel();
      fade?.cancel();
      tileReturns.forEach(animation => animation.cancel());
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
      restoreCardSource(source);
    };
  }, [isOpen, sheetRef, requestClose, source]);

  return { sheetRef, requestClose };
}
