'use client';

import React from 'react';
import { ResponsiveImage } from '../ResponsiveImage';
import type { MediaAsset } from '../../lib/media';
import {
  sceneImageSizes,
  sceneLeft,
  sceneTop,
  scaleValue,
  stickerMotion,
  useSceneMotion,
  type SceneStickerMotion,
} from './kit';

export type SceneSticker = {
  key: string;
  src: MediaAsset;
  alt: string;
  // Position and size in the 961x1758 scene frame's design units (the image is contained in a square).
  frame: { left: number; top: number; size: number };
  zIndex: number;
  baseRotate?: number;
  flipX?: boolean;
  alpha?: number;
  movement: SceneStickerMotion;
  float: { x: number; y: number; rotate: number; duration: string; delay: string };
  intro: { x: number; y: number; rotate: number; delay: string };
};

// A scene's cut-out art: each sticker flies in with the page, floats, and leaves with the scroll,
// exactly as on the homepage's scenes.
export function SceneStickers({ stickers, loadImages }: { stickers: SceneSticker[]; loadImages: boolean }) {
  const motion = useSceneMotion();
  return (
    <>
      {stickers.map((sticker, order) => (
        <div
          key={sticker.key}
          className="pointer-events-none absolute solenya-sticker-enter"
          style={{
            left: sceneLeft(sticker.frame.left),
            top: sceneTop(sticker.frame.top),
            width: scaleValue(sticker.frame.size),
            height: scaleValue(sticker.frame.size),
            zIndex: sticker.zIndex,
            '--intro-x': scaleValue(sticker.intro.x),
            '--intro-y': scaleValue(sticker.intro.y),
            '--intro-rotate': `${sticker.intro.rotate}deg`,
            animationDelay: sticker.intro.delay,
          } as React.CSSProperties}
        >
          <div
            ref={motion.ref(sticker.key, (d) => stickerMotion(sticker, d, order, sticker.alpha))}
            style={{ ...motion.initial((d) => stickerMotion(sticker, d, order, sticker.alpha)), willChange: 'transform, opacity' }}
          >
            <div
              className="solenya-sticker-float h-full w-full"
              style={{
                '--float-x': scaleValue(sticker.float.x),
                '--float-y': scaleValue(sticker.float.y),
                '--float-rotate': `${sticker.float.rotate}deg`,
                '--float-duration': sticker.float.duration,
                animationDelay: sticker.float.delay,
              } as React.CSSProperties}
            >
              {loadImages ? (
                <ResponsiveImage
                  asset={sticker.src}
                  alt={sticker.alt}
                  sizes={sceneImageSizes(sticker.frame.size)}
                  draggable={false}
                  className="h-full w-full select-none object-contain"
                  style={sticker.flipX ? { transform: 'scaleX(-1)' } : undefined}
                />
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
