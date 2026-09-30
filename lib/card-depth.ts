'use client';

import { snapshotElement } from './motion-snapshot';
import { MOTION_EASING, stickerFlight } from './scene-motion';

type Sticker = {
  element: HTMLElement;
  copy: HTMLElement;
  visibility: string;
  opacity: string;
  away: string;
  animation?: Animation;
};
type Depth = { layer: HTMLElement; stickers: Sticker[] };
const depths = new WeakMap<HTMLElement, Depth>();

// Keep the foreground above the card for the entire flight. A frozen copy lets
// it leave the scene's clipping/stacking context without moving React's nodes.
export function animateCardDepth(source: HTMLElement, opening: boolean, duration: number) {
  let depth = depths.get(source);
  if (!depth && opening) {
    const scene = source.closest<HTMLElement>('.scene-wrap');
    if (!scene) return;
    const layer = document.createElement('div');
    layer.className = 'card-sticker-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // All reads/snapshots precede hiding the originals or attaching the layer.
    const stickers = Array.from(scene.querySelectorAll<HTMLElement>('.solenya-sticker-enter')).map((element, order) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const opacity = style.opacity;
      const zIndex = style.zIndex;
      const copy = snapshotElement(element, bounds);
      copy.classList.add('card-sticker-copy');
      copy.style.transformOrigin = 'center';
      copy.style.zIndex = zIndex === 'auto' ? `${order}` : zIndex;
      const flight = stickerFlight(bounds, viewport, order);
      return {
        element, copy, visibility: element.style.visibility, opacity,
        away: `translate3d(${flight.x}px, ${flight.y}px, 0) rotate(${flight.rotate}deg) scale(${flight.scale})`,
      };
    });
    stickers.forEach(sticker => {
      sticker.element.style.visibility = 'hidden';
      layer.appendChild(sticker.copy);
    });
    document.body.appendChild(layer);
    depth = { layer, stickers };
    depths.set(source, depth);
  }
  if (!depth) return;

  const frames = depth.stickers.map(sticker => {
    const style = getComputedStyle(sticker.copy);
    return { transform: style.transform, opacity: style.opacity };
  });
  depth.stickers.forEach((sticker, order) => {
    sticker.animation?.cancel();
    // The scroll's 0.36–0.46 arrival spans become a small shuffle. Each flight
    // ends with the card, so nothing is cut short when the sheet unmounts.
    const delay = opening ? ((order * 3) % 5) * 8 : 36 + ((order * 3) % 5) * 8;
    sticker.animation = sticker.copy.animate([
      { ...frames[order], offset: 0 },
      { opacity: opening ? frames[order].opacity : sticker.opacity, offset: opening ? 0.65 : 0.35 },
      opening
        ? { transform: sticker.away, opacity: '0', offset: 1 }
        : { transform: 'none', opacity: sticker.opacity, offset: 1 },
    ], { duration: duration - delay, delay, easing: MOTION_EASING, fill: 'both' });
  });
}

export function restoreCardDepth(source: HTMLElement) {
  const depth = depths.get(source);
  if (!depth) return;
  depth.stickers.forEach(sticker => {
    sticker.animation?.cancel();
    sticker.element.style.visibility = sticker.visibility;
  });
  depth.layer.remove();
  depths.delete(source);
}
