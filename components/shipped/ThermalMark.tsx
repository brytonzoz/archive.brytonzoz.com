'use client';

// Draw a logo as 1-bit thermal ink. Hide it when the knockout is a solid slab (the black-triangle
// favicon case). CORS or a broken file also hides — never leave an empty tile.
import React, { useEffect, useRef, useState } from 'react';
import { atkinson, markSurvives } from '../../lib/shipped-mark';

const W = 48;
const H = 20;

function tone(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    const light = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = 255 - (255 - light) * a;
  }
  return gray;
}

export function ThermalMark({ src, className = '' }: { src: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    let cancel = false;
    const img = new Image();
    img.decoding = 'async';
    try {
      img.crossOrigin = 'anonymous';
    } catch {
      /* some hosts reject the property */
    }
    img.onload = () => {
      if (cancel) return;
      const node = canvas.current;
      if (!node) return;
      const ctx = node.getContext('2d', { willReadFrequently: true });
      if (!ctx) return setShow(false);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const scale = Math.min(W / Math.max(1, img.width), H / Math.max(1, img.height));
      const dw = Math.max(1, Math.round(img.width * scale));
      const dh = Math.max(1, Math.round(img.height * scale));
      ctx.drawImage(img, Math.floor((W - dw) / 2), Math.floor((H - dh) / 2), dw, dh);
      let pixels: ImageData;
      try {
        pixels = ctx.getImageData(0, 0, W, H);
      } catch {
        setShow(false);
        return;
      }
      const ink = atkinson(tone(pixels.data, W, H), W, H);
      if (!markSurvives(ink, W, H)) {
        setShow(false);
        return;
      }
      const out = pixels.data;
      for (let i = 0; i < ink.length; i++) {
        const on = ink[i];
        out[i * 4] = on ? 26 : 255;
        out[i * 4 + 1] = on ? 22 : 255;
        out[i * 4 + 2] = on ? 18 : 255;
        out[i * 4 + 3] = on ? 255 : 0;
      }
      ctx.putImageData(pixels, 0, 0);
      setShow(true);
    };
    img.onerror = () => {
      if (!cancel) setShow(false);
    };
    img.src = src;
    return () => {
      cancel = true;
    };
  }, [src]);

  return (
    <canvas
      ref={canvas}
      className={`shipped-thermal ${className}`}
      width={W}
      height={H}
      hidden={!show}
      aria-hidden="true"
    />
  );
}
