'use client';

import { flushSync } from 'react-dom';

export type CardSource = { element: HTMLElement; visibility: string; transitionName: string };

export function cardSource(element: HTMLElement): CardSource {
  const previous = transitionOwners.get(element)?.source;
  return {
    element,
    visibility: previous?.visibility ?? element.style.visibility,
    transitionName: previous?.transitionName ?? element.style.viewTransitionName,
  };
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition };
let activeTransition: ViewTransition | null = null;
const transitionOwners = new WeakMap<HTMLElement, { transition: ViewTransition; source: CardSource }>();
const fallbackMotions = new WeakMap<HTMLElement, () => void>();
const duration = 360;
const easing = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function cardMotionActive(panel: HTMLElement) {
  return activeTransition !== null || fallbackMotions.has(panel);
}

export function cancelCardFallback(panel: HTMLElement) {
  fallbackMotions.get(panel)?.();
}

// Freeze only the selected tile in older browsers. Resolve container units before
// lifting its copy out of the grid, and never load any additional product photos.
function freezeCard(element: HTMLElement, bounds: DOMRect) {
  const clone = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    const copy = copies[index];
    for (const property of Array.from(style)) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.style.animation = 'none';
    copy.style.transition = 'none';
    copy.style.viewTransitionName = 'none';
    copy.removeAttribute('id');
    copy.removeAttribute('name');
  });
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  Object.assign(clone.style, {
    position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, right: 'auto', bottom: 'auto',
    width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0',
    transform: 'none', transformOrigin: 'top left', visibility: 'visible',
    pointerEvents: 'none', zIndex: '101',
  });
  return clone;
}

// Both appearances share one continuous path; the handoff happens at peak speed.
export function transitionCard(source: CardSource | null, update: () => void, opening: boolean) {
  const origin = source?.element.isConnected ? source : null;
  const doc = document as TransitionDocument;
  const commit = () => {
    if (origin) origin.element.style.visibility = opening ? 'hidden' : origin.visibility;
    flushSync(update);
    if (!opening) origin?.element.focus({ preventScroll: true });
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { commit(); return; }

  if (doc.startViewTransition && origin) {
    activeTransition?.skipTransition();
    const root = document.documentElement;
    root.classList.add('card-transition');
    if (opening) origin.element.style.viewTransitionName = 'expanded-card';
    const transition = doc.startViewTransition(() => {
      origin.element.style.viewTransitionName = opening ? origin.transitionName : 'expanded-card';
      commit();
    });
    activeTransition = transition;
    transitionOwners.set(origin.element, { transition, source: origin });
    // Interrupted transitions still commit, but cannot clear a newer motion's styles.
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {}).then(() => {
      if (transitionOwners.get(origin.element)?.transition === transition) {
        origin.element.style.viewTransitionName = origin.transitionName;
        transitionOwners.delete(origin.element);
      }
      if (activeTransition === transition) {
        activeTransition = null;
        root.classList.remove('card-transition');
      }
    });
    return;
  }

  // Match the same geometry and midpoint crossfade without a motion library.
  const originBounds = origin?.element.getBoundingClientRect();
  const hiddenVisibility = origin?.element.style.visibility;
  if (origin) origin.element.style.visibility = origin.visibility;
  const tile = origin && originBounds ? freezeCard(origin.element, originBounds) : null;
  if (origin && hiddenVisibility !== undefined) origin.element.style.visibility = hiddenVisibility;
  if (opening) commit();
  const panel = document.querySelector<HTMLElement>('.card-sheet .sheet-panel');
  if (!panel) { if (!opening) commit(); return; }
  const currentBox = panel.getBoundingClientRect();
  const currentOpacity = getComputedStyle(panel).opacity;
  const backdrop = panel.parentElement?.querySelector<HTMLElement>('.sheet-backdrop');
  const backdropOpacity = backdrop ? getComputedStyle(backdrop).opacity : '1';
  cancelCardFallback(panel);
  panel.style.transform = 'none';
  const box = panel.getBoundingClientRect();
  const transformTo = (from: DOMRect, to: DOMRect) =>
    `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  const compact = originBounds ? transformTo(box, originBounds) : 'translateY(100%) scale(0.96)';
  panel.style.transformOrigin = 'top left';
  const handoff = (appearing: boolean, opacity = '1') => [
    { opacity: appearing ? '0' : opacity, offset: 0 },
    { opacity: appearing ? '0' : opacity, offset: 0.42 },
    { opacity: appearing ? opacity : '0', offset: 0.58 },
    { opacity: appearing ? opacity : '0', offset: 1 },
  ];
  const timing = { duration, easing, fill: 'both' as const };
  const motion = panel.animate([
    { transform: opening ? compact : transformTo(box, currentBox) },
    { transform: opening ? 'none' : compact },
  ], timing);
  const animations = [motion, panel.animate(tile ? handoff(opening, opening ? '1' : currentOpacity) : [
    { opacity: opening ? '0' : currentOpacity }, { opacity: opening ? '1' : '0' },
  ], { duration, fill: 'both' })];
  if (backdrop) animations.push(backdrop.animate([
    { opacity: opening ? '0' : backdropOpacity }, { opacity: opening ? '1' : '0' },
  ], { duration, fill: 'both' }));
  if (tile && originBounds) {
    document.body.appendChild(tile);
    animations.push(tile.animate([
      { transform: opening ? 'none' : transformTo(originBounds, currentBox) },
      { transform: opening ? transformTo(originBounds, box) : 'none' },
    ], timing), tile.animate(handoff(!opening), { duration, fill: 'both' }));
  }
  const cleanup = () => {
    if (fallbackMotions.get(panel) !== cleanup) return;
    fallbackMotions.delete(panel);
    animations.forEach((animation) => animation.cancel());
    tile?.remove();
    panel.style.transformOrigin = '';
    panel.style.transform = '';
  };
  fallbackMotions.set(panel, cleanup);
  void motion.finished.then(() => {
    if (fallbackMotions.get(panel) !== cleanup) return;
    cleanup();
    if (!opening) commit();
  }, () => {});
}
