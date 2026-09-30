'use client';

import { MOTION_EASING, stickerFlight } from './scene-motion';

type Sticker = {
  element: HTMLElement;
  home: { translate: string; scale: string; rotate: string; opacity: string };
  away: { translate: string; scale: string; rotate: string; opacity: string };
  animation?: Animation;
};
const depths = new WeakMap<HTMLElement, Sticker[]>();

// Animate the original decorations in place. Their design coordinates, scroll
// transforms, float, clipping and intentional stacking order are never replaced.
export function animateCardDepth(source: HTMLElement, opening: boolean, duration: number) {
  let stickers = depths.get(source);
  if (!stickers && opening) {
    const scene = source.closest<HTMLElement>('.scene-wrap');
    if (!scene) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    stickers = Array.from(scene.querySelectorAll<HTMLElement>('.solenya-sticker-enter')).map((element, order) => {
      const style = getComputedStyle(element);
      const home = { translate: style.translate, scale: style.scale, rotate: style.rotate, opacity: style.opacity };
      const flight = stickerFlight(element.getBoundingClientRect(), viewport, order);
      return {
        element, home,
        away: { translate: `${flight.x}px ${flight.y}px`, scale: `${flight.scale}`, rotate: `${flight.rotate}deg`, opacity: '0' },
      };
    });
    depths.set(source, stickers);
  }
  if (!stickers) return;

  // Read before cancelling for a continuous reversal; start every decoration
  // with the card, without delays, copies, DOM reparenting or per-frame JS.
  const frames = stickers.map(({ element }) => {
    const style = getComputedStyle(element);
    return { translate: style.translate, scale: style.scale, rotate: style.rotate, opacity: style.opacity };
  });
  stickers.forEach((sticker, index) => {
    sticker.animation?.cancel();
    sticker.animation = sticker.element.animate([frames[index], opening ? sticker.away : sticker.home], {
      duration, easing: MOTION_EASING, fill: 'both',
    });
  });
}

export function restoreCardDepth(source: HTMLElement) {
  depths.get(source)?.forEach(sticker => sticker.animation?.cancel());
  depths.delete(source);
}
