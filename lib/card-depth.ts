'use client';

type Sticker = {
  element: HTMLElement;
  away: string;
  opacity: string;
  translate: string;
  scale: string;
  animation?: Animation;
};
type Depth = { stickers: Sticker[] };
const depths = new WeakMap<HTMLElement, Depth>();

// The scroll and float transforms keep their own coordinates. These independent
// translate/scale channels move only the decorations away from the scene centre.
export function animateCardDepth(source: HTMLElement, opening: boolean, duration: number) {
  let depth = depths.get(source);
  if (!depth && opening) {
    const scene = source.closest<HTMLElement>('.scene-wrap');
    if (!scene) return;
    const centre = scene.getBoundingClientRect();
    const stickers = Array.from(scene.querySelectorAll<HTMLElement>('.solenya-sticker-enter')).map(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const x = (box.left + box.width / 2 - centre.left - centre.width / 2) * 0.3;
      const y = (box.top + box.height / 2 - centre.top - centre.height / 2) * 0.24;
      return {
        element, away: `${Math.max(-180, Math.min(180, x))}px ${Math.max(-150, Math.min(150, y))}px`,
        opacity: style.opacity, translate: style.translate, scale: style.scale,
      };
    });
    depth = { stickers };
    depths.set(source, depth);
  }
  if (!depth) return;

  // Read every current frame before cancelling/writing, including a quick close
  // halfway through opening. No layout reads or JS work happen during playback.
  const frames = depth.stickers.map(sticker => {
    const style = getComputedStyle(sticker.element);
    return { translate: style.translate, scale: style.scale, opacity: style.opacity };
  });
  depth.stickers.forEach((sticker, index) => {
    sticker.animation?.cancel();
    sticker.animation = sticker.element.animate([
      frames[index],
      opening
        ? { translate: sticker.away, scale: '0.84', opacity: '0' }
        : { translate: sticker.translate, scale: sticker.scale, opacity: sticker.opacity },
    ], {
      duration,
      // Clear the card's path early; return gently behind it on the way out.
      easing: opening ? 'cubic-bezier(0.2, 0.65, 0.3, 1)' : 'cubic-bezier(0.45, 0, 0.55, 1)',
      fill: 'both',
    });
  });
}

export function restoreCardDepth(source: HTMLElement) {
  const depth = depths.get(source);
  if (!depth) return;
  depth.stickers.forEach(sticker => sticker.animation?.cancel());
  depths.delete(source);
}
