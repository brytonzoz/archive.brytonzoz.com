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

export function snapshotElement(element: HTMLElement, bounds: DOMRect) {
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
  clone.classList.add('motion-snapshot');
  Object.assign(clone.style, {
    position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, right: 'auto', bottom: 'auto',
    width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0',
    transform: 'none', translate: 'none', scale: 'none', transformOrigin: 'top left', visibility: 'visible',
    pointerEvents: 'none', zIndex: '101', willChange: 'transform, opacity',
  });
  return clone;
}

