'use client';

import { flushSync } from 'react-dom';

export type CardSource = { element: HTMLElement; visibility: string };
const sources = new WeakMap<HTMLElement, CardSource>();
const tiles = new WeakMap<CardSource, { element: HTMLElement; bounds: DOMRect }>();
type Motion = { cancel: () => void; tile: HTMLElement | null; closing: boolean; box: DOMRect; tileBounds?: DOMRect; backdropAnimation?: Animation };
const motions = new WeakMap<HTMLElement, Motion>();
const easing = 'cubic-bezier(0.45, 0, 0.55, 1)';
let sceneLocks = 0;

export function pauseCardScenes() {
  if (++sceneLocks === 1) document.documentElement.classList.add('card-sheet-open');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--sceneLocks === 0) document.documentElement.classList.remove('card-sheet-open');
  };
}

export function cardSource(element: HTMLElement): CardSource {
  return sources.get(element) ?? { element, visibility: element.style.visibility };
}

export function restoreCardSource(source: CardSource | null) {
  if (!source) return;
  source.element.style.visibility = source.visibility;
  sources.delete(source.element);
  tiles.delete(source);
}

export function cardMotionClosing(panel: HTMLElement) { return motions.get(panel)?.closing ?? false; }
export function cancelCardMotion(panel: HTMLElement) { motions.get(panel)?.cancel(); }

export function beginCardDrag(panel: HTMLElement) {
  // Let the finger take over the dimmer while the opening geometry finishes.
  const motion = motions.get(panel);
  motion?.backdropAnimation?.cancel();
}

export function moveCardTile(panel: HTMLElement, x: number, y: number, scale: number) {
  const motion = motions.get(panel);
  if (!motion?.tile || !motion.tileBounds) return;
  // Both appearances use the panel's world-space origin for their gesture scale.
  const dx = (1 - scale) * (motion.box.left - motion.tileBounds.left);
  const dy = (1 - scale) * (motion.box.top - motion.tileBounds.top);
  motion.tile.style.translate = `${x + dx}px ${y + dy}px`;
  motion.tile.style.scale = `${scale}`;
}

export function returnCardTile(panel: HTMLElement, timing: KeyframeAnimationOptions): Animation[] {
  const tile = motions.get(panel)?.tile;
  if (!tile) return [];
  const translate = tile.style.translate;
  const scale = tile.style.scale;
  tile.style.translate = 'none';
  tile.style.scale = 'none';
  return [tile.animate([{ translate, scale }, { translate: '0 0', scale: '1' }], timing)];
}

// Only values that depend on the original container need freezing. Copying every
// computed CSS property (hundreds per node) made the old fallback stall on tap.
const frozenProperties = [
  'display', 'position', 'inset', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'box-sizing', 'margin', 'padding', 'border', 'border-radius', 'background', 'box-shadow',
  'flex', 'flex-direction', 'align-items', 'justify-content', 'gap', 'font', 'color',
  'letter-spacing', 'text-transform', 'text-align', 'white-space', 'overflow',
  'object-fit', 'object-position', 'opacity', 'transform', 'transform-origin',
  'transform-style', 'backface-visibility', 'perspective', 'filter',
];

function freezeCard(element: HTMLElement, bounds: DOMRect) {
  const clone = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    const copy = copies[index];
    for (const property of frozenProperties) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.style.animation = 'none';
    copy.style.transition = 'none';
    copy.style.viewTransitionName = 'none';
    copy.removeAttribute('id');
    copy.removeAttribute('name');
    // Reuse the image already decoded for this card, without another responsive selection.
    if (original instanceof HTMLImageElement && copy instanceof HTMLImageElement) {
      copy.removeAttribute('srcset');
      copy.removeAttribute('sizes');
      copy.src = original.currentSrc || original.src;
      copy.loading = 'eager';
    }
  });
  clone.querySelectorAll('source').forEach(node => node.remove());
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  clone.classList.add('card-motion-tile');
  Object.assign(clone.style, {
    position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, right: 'auto', bottom: 'auto',
    width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0',
    transform: 'none', translate: 'none', scale: 'none', transformOrigin: 'top left', visibility: 'visible',
    pointerEvents: 'none', zIndex: '101', willChange: 'transform, opacity',
  });
  return clone;
}

const transformTo = (from: DOMRect, to: DOMRect) =>
  `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(${to.width / from.width}, ${to.height / from.height})`;
const handoff = (from: string, to: string) => [
  { opacity: from, offset: 0 }, { opacity: from, offset: 0.36 },
  { opacity: to, offset: 0.64 }, { opacity: to, offset: 1 },
];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One local compositor path in every browser. Both appearances keep fixed layout
// dimensions and follow the same transform; only their opacity changes at midpoint.
export function transitionCard(source: CardSource | null, update: () => void, opening: boolean) {
  const origin = source?.element.isConnected ? source : null;
  const commit = () => {
    if (origin) {
      origin.element.style.visibility = opening ? 'hidden' : origin.visibility;
      if (opening) sources.set(origin.element, origin);
      else { sources.delete(origin.element); tiles.delete(origin); }
    }
    flushSync(update);
    if (!opening) origin?.element.focus({ preventScroll: true });
  };
  if (reducedMotion()) { commit(); return; }

  const resumeScenes = pauseCardScenes();
  const originBounds = origin?.element.getBoundingClientRect();
  let cached = origin ? tiles.get(origin) : undefined;
  if (origin && originBounds && (!cached || Math.abs(cached.bounds.width - originBounds.width) > 1 || Math.abs(cached.bounds.height - originBounds.height) > 1)) {
    cached = { element: freezeCard(origin.element, originBounds), bounds: originBounds };
    tiles.set(origin, cached);
  }
  if (opening) commit();
  const panel = document.querySelector<HTMLElement>('.card-sheet .sheet-panel');
  if (!panel) { resumeScenes(); if (!opening) commit(); return; }
  const backdrop = panel.parentElement?.querySelector<HTMLElement>('.sheet-backdrop');
  const previous = motions.get(panel);
  // Read the rendered state before cancelling: close can reverse an unfinished open.
  cancelControlMotion(panel);
  const currentBox = panel.getBoundingClientRect();
  const currentOpacity = getComputedStyle(panel).opacity;
  const tileOpacity = previous?.tile ? getComputedStyle(previous.tile).opacity : '0';
  const tileBox = previous?.tile?.getBoundingClientRect() ?? currentBox;
  const backdropOpacity = backdrop ? getComputedStyle(backdrop).opacity : '1';
  previous?.cancel();
  cached?.element.getAnimations().forEach(animation => animation.cancel());
  panel.getAnimations().forEach(animation => animation.cancel());
  backdrop?.getAnimations().forEach(animation => animation.cancel());
  panel.style.transform = '';
  panel.style.translate = '';
  panel.style.scale = '';
  const box = panel.getBoundingClientRect();
  const compact = originBounds ? transformTo(box, originBounds) : 'translate3d(0, 100%, 0) scale(0.96)';
  const tile = cached?.element ?? null;
  const duration = opening ? 260 : 220;
  const timing = { duration, easing, fill: 'both' as const };
  panel.classList.add('card-is-moving');
  const motion = panel.animate([
    { transform: opening ? compact : transformTo(box, currentBox) },
    { transform: opening ? 'none' : compact },
  ], timing);
  const animations = [motion, panel.animate(tile ? handoff(opening ? '0' : currentOpacity, opening ? '1' : '0') : [
    { opacity: opening ? '0' : currentOpacity }, { opacity: opening ? '1' : '0' },
  ], { duration, fill: 'both' })];
  const backdropAnimation = backdrop?.animate([
    { opacity: opening ? '0' : backdropOpacity }, { opacity: opening ? '1' : '0' },
  ], { duration, fill: 'both' });
  if (backdropAnimation) animations.push(backdropAnimation);
  if (tile && cached && originBounds) {
    tile.style.translate = 'none';
    tile.style.scale = 'none';
    document.body.appendChild(tile);
    animations.push(tile.animate([
      { transform: transformTo(cached.bounds, opening ? originBounds : tileBox) },
      { transform: transformTo(cached.bounds, opening ? box : originBounds) },
    ], timing), tile.animate(handoff(opening ? '1' : tileOpacity, opening ? '0' : '1'), { duration, fill: 'both' }));
  }
  const cancel = () => {
    if (motions.get(panel)?.cancel !== cancel) return;
    motions.delete(panel);
    animations.forEach(animation => animation.cancel());
    tile?.getAnimations().forEach(animation => animation.cancel());
    tile?.remove();
    panel.classList.remove('card-is-moving');
    resumeScenes();
  };
  motions.set(panel, { cancel, tile, closing: !opening, box, tileBounds: cached?.bounds, backdropAnimation });
  void motion.finished.then(() => {
    if (motions.get(panel)?.cancel !== cancel) return;
    // Unmount while the final frame still covers the source; no full-size flash.
    if (!opening) commit();
    cancel();
  }, () => {});
}

const controlMotions = new WeakMap<HTMLElement, { tile: HTMLElement; cancel: () => void }>();

export function cancelControlMotion(root: HTMLElement) {
  for (const target of [root, ...Array.from(root.querySelectorAll<HTMLElement>('.platform-bar, .platform-panel'))]) {
    controlMotions.get(target)?.cancel();
  }
}

// The streaming-app bar also morphs locally; it must not snapshot the whole page.
export function transitionControls(before: HTMLElement | null, update: () => void, after: () => HTMLElement | null) {
  if (!before || reducedMotion()) { flushSync(update); return; }
  const previous = controlMotions.get(before);
  const visible = previous && parseFloat(getComputedStyle(before).opacity) < 0.5 ? previous.tile : before;
  const from = visible.getBoundingClientRect();
  // A reversal can start at an intermediate scale. Keep natural layout sizes in
  // the clone and carry the rendered scale in its transform, including the text.
  const tileBounds = new DOMRect(from.left, from.top, visible.offsetWidth, visible.offsetHeight);
  const tile = freezeCard(visible, tileBounds);
  tile.style.opacity = '1';
  previous?.cancel();
  tile.style.zIndex = '104';
  flushSync(update);
  const target = after();
  if (!target) return;
  const to = target.getBoundingClientRect();
  document.body.appendChild(tile);
  target.classList.add('card-is-moving');
  const timing = { duration: 220, easing, fill: 'both' as const };
  const animations = [
    tile.animate([{ transform: transformTo(tileBounds, from) }, { transform: transformTo(tileBounds, to) }], timing),
    tile.animate(handoff('1', '0'), { duration: 220, fill: 'both' }),
    target.animate([{ transform: transformTo(to, from) }, { transform: 'none' }], timing),
    target.animate(handoff('0', '1'), { duration: 220, fill: 'both' }),
  ];
  const cancel = () => {
    if (controlMotions.get(target)?.cancel !== cancel) return;
    controlMotions.delete(target);
    animations.forEach(animation => animation.cancel());
    tile.remove();
    target.classList.remove('card-is-moving');
  };
  controlMotions.set(target, { tile, cancel });
  void animations[2].finished.then(cancel, cancel);
}
