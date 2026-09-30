'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaAsset } from '../../lib/media';
import { ResponsiveImage } from '../ResponsiveImage';
import { ChevronDownIcon, CloseIcon } from '../player/icons';
import { useSheet } from '../useSheet';
import { MOTION_EASING, OPEN_MS } from '../../lib/scene-motion';

// A product photo full screen, to look at the print up close: tap the photo to zoom in on that spot
// (then drag around), tap again to zoom back out. Arrows or ← → move between photos; × or Escape
// closes it and goes back to the sheet underneath.
const ZOOM = 2.4;

export function PhotoZoom({
  images,
  index,
  alt,
  onIndex,
  onClose,
}: {
  images: MediaAsset[];
  index: number;
  alt: (i: number) => string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const zoomMotion = useRef<Animation | null>(null);
  const zoomFrom = useRef<{ bounds: DOMRect; x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { sheetRef, isClosing, requestClose } = useSheet(true, onClose);
  const count = images.length;
  const go = (i: number) => {
    if (isClosing) return;
    zoomMotion.current?.cancel();
    zoomFrom.current = null;
    setZoomed(false);
    onIndex((i + count) % count);
  };

  useEffect(() => {
    closeRef.current?.focus();
    // Capture phase, so Escape closes this and not the sheet under it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); requestClose(); }
      if (event.key === 'ArrowRight') { event.stopPropagation(); go(index + 1); }
      if (event.key === 'ArrowLeft') { event.stopPropagation(); go(index - 1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useLayoutEffect(() => {
    const from = zoomFrom.current;
    const box = frame.current;
    const image = canvas.current;
    if (!from || !box || !image) return;
    zoomFrom.current = null;
    zoomMotion.current?.cancel();
    if (zoomed) {
      const rect = box.getBoundingClientRect();
      box.scrollLeft = (from.x - from.bounds.left) / from.bounds.width * image.offsetWidth - (from.x - rect.left);
      box.scrollTop = (from.y - from.bounds.top) / from.bounds.height * image.offsetHeight - (from.y - rect.top);
    } else {
      box.scrollLeft = 0;
      box.scrollTop = 0;
    }
    const to = image.getBoundingClientRect();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !to.width) return;
    zoomMotion.current = image.animate([
      { transform: `translate3d(${from.bounds.left - to.left}px, ${from.bounds.top - to.top}px, 0) scale(${from.bounds.width / to.width})` },
      { transform: 'none' },
    ], { duration: OPEN_MS, easing: MOTION_EASING });
  }, [zoomed]);

  useEffect(() => () => zoomMotion.current?.cancel(), []);

  const toggleZoom = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canvas.current || isClosing) return;
    zoomFrom.current = { bounds: canvas.current.getBoundingClientRect(), x: event.clientX, y: event.clientY };
    setZoomed(value => !value);
  };

  return createPortal(
    <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Photo" className={`photo-zoom${isClosing ? ' is-closing' : ''}`}>
      <div
        ref={frame}
        className={`photo-zoom-frame ${zoomed ? 'is-zoomed' : ''}`}
        onClick={toggleZoom}
      >
        <div ref={canvas} className="photo-zoom-canvas" style={{ width: zoomed ? `${ZOOM * 100}%` : '100%', transformOrigin: 'top left' }}>
          <ResponsiveImage
            key={images[index].src}
            asset={images[index]}
            alt={alt(index)}
            sizes={zoomed ? '300vw' : '100vw'}
            draggable={false}
            className="photo-zoom-img"
          />
        </div>
      </div>
      <button ref={closeRef} type="button" onClick={requestClose} disabled={isClosing} aria-label="Close photo" className="photo-zoom-button photo-zoom-close">
        <CloseIcon size={20} />
      </button>
      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(index - 1)} disabled={isClosing} aria-label="Previous photo" className="photo-zoom-button photo-zoom-prev">
            <ChevronDownIcon size={20} className="rotate-90" />
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={isClosing} aria-label="Next photo" className="photo-zoom-button photo-zoom-next">
            <ChevronDownIcon size={20} className="-rotate-90" />
          </button>
          <p className="photo-zoom-count" aria-live="polite">{index + 1} / {count}</p>
        </>
      ) : null}
      <p className="photo-zoom-hint">{zoomed ? 'Tap to zoom out' : 'Tap to zoom in'}</p>
    </div>,
    document.body,
  );
}
