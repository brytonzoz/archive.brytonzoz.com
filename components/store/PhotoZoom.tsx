'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaAsset } from '../../lib/media';
import { ResponsiveImage } from '../ResponsiveImage';
import { ChevronDownIcon, CloseIcon } from '../player/icons';

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
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = images.length;
  const go = (i: number) => {
    setZoomed(false);
    onIndex((i + count) % count);
  };

  useEffect(() => {
    closeRef.current?.focus();
    // Capture phase, so Escape closes this and not the sheet under it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
      if (event.key === 'ArrowRight') { event.stopPropagation(); go(index + 1); }
      if (event.key === 'ArrowLeft') { event.stopPropagation(); go(index - 1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toggleZoom = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = frame.current;
    if (!box) return;
    if (zoomed) {
      setZoomed(false);
      return;
    }
    // Zoom toward where you tapped: after the image grows, scroll so that spot stays under your finger.
    const rect = box.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    setZoomed(true);
    requestAnimationFrame(() => {
      box.scrollLeft = fx * box.scrollWidth - (event.clientX - rect.left);
      box.scrollTop = fy * box.scrollHeight - (event.clientY - rect.top);
    });
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Photo" className="photo-zoom">
      <div
        ref={frame}
        className={`photo-zoom-frame ${zoomed ? 'is-zoomed' : ''}`}
        onClick={toggleZoom}
      >
        <div className="photo-zoom-canvas" style={{ width: zoomed ? `${ZOOM * 100}%` : '100%' }}>
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
      <button ref={closeRef} type="button" onClick={onClose} aria-label="Close photo" className="photo-zoom-button photo-zoom-close">
        <CloseIcon size={20} />
      </button>
      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous photo" className="photo-zoom-button photo-zoom-prev">
            <ChevronDownIcon size={20} className="rotate-90" />
          </button>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next photo" className="photo-zoom-button photo-zoom-next">
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
