'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ProjectCard } from '../components/ProjectCard';
import { ListenSheet } from '../components/ListenSheet';
import { usePlayer } from '../components/player/context';
import { ResponsiveImage, placeholderBackground } from '../components/ResponsiveImage';
import { getProjects } from '../lib/projects';
import { cautionSceneAssets, reminderSceneAssets, scrapwrkSceneAssets, solenyaSceneAssets } from '../lib/assets';
import { Project, isProjectReleased } from '../lib/utils';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

type SceneStickerMotion = {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  fadeRate: number;
};

type SceneStickerIntro = {
  x: number;
  y: number;
  rotate: number;
};

type SceneStickerConfig = {
  movement: SceneStickerMotion;
  intro: SceneStickerIntro;
  baseRotate?: number;
};

type SlideBackground = {
  base: string;
  overlay: string;
  topGlow: string;
  bottomGlow: string;
  edgeGlow: string;
};

function getSceneStickerState(sticker: SceneStickerConfig, distance: number) {
  const baseRotate = sticker.baseRotate || 0;

  if (distance < 0) {
    const incomingProgress = clamp(Math.abs(distance) / 0.78, 0, 1);

    return {
      opacity: 1 - incomingProgress,
      scale: 1 - (incomingProgress * 0.18),
      translateX: sticker.intro.x * incomingProgress,
      translateY: sticker.intro.y * incomingProgress,
      rotate: baseRotate + (sticker.intro.rotate * incomingProgress),
    };
  }

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoingProgress = easeOutCubic(clamp(distance / 0.42, 0, 1));
  const departure = outgoingProgress * 2.35;

  return {
    opacity: Math.max(0, 1 - (outgoingProgress * sticker.movement.fadeRate * 1.25)),
    scale: 1 - Math.min(distanceMagnitude * sticker.movement.scale, 0.12),
    translateX: sticker.movement.x * departure,
    translateY: sticker.movement.y * departure,
    rotate: baseRotate + (sticker.movement.rotate * departure),
  };
}

const HOMEPAGE_PROJECT_ORDER = [
  'SOLENYA',
  'CAUTION',
  'Just A Reminder To Live Life',
  'Scrapwrk Store',
  'Loopless Collection (Episodes)',
  'The Archive (Music)',
];

const HIDDEN_HOMEPAGE_PROJECTS = new Set([
  'Loopless Collection (Episodes)',
  'The Archive (Music)',
]);

function getProjectBackground(project: Project): SlideBackground {
  if (project.name === 'SOLENYA') {
    return {
      base: 'linear-gradient(139.07deg, #174E6C 2.05%, #720102 101.73%)',
      overlay: 'radial-gradient(circle at 18% 16%, rgba(121, 211, 243, 0.18), transparent 28%), radial-gradient(circle at 82% 78%, rgba(255, 144, 107, 0.18), transparent 30%)',
      topGlow: 'rgba(80, 181, 217, 0.24)',
      bottomGlow: 'rgba(191, 53, 53, 0.22)',
      edgeGlow: 'rgba(255, 176, 115, 0.08)',
    };
  }

  if (project.name === 'CAUTION') {
    return {
      base: 'linear-gradient(139.07deg, #C59B7F 2.05%, #371D0A 101.73%)',
      overlay: 'radial-gradient(circle at 16% 18%, rgba(255, 229, 188, 0.24), transparent 28%), radial-gradient(circle at 82% 78%, rgba(117, 61, 26, 0.24), transparent 34%)',
      topGlow: 'rgba(255, 225, 176, 0.22)',
      bottomGlow: 'rgba(126, 69, 38, 0.24)',
      edgeGlow: 'rgba(255, 202, 142, 0.08)',
    };
  }

  if (project.name === 'Just A Reminder To Live Life') {
    return {
      base: 'linear-gradient(139.07deg, #EDDDD2 2.05%, #432F21 101.73%)',
      overlay: 'radial-gradient(circle at 16% 18%, rgba(255, 255, 255, 0.34), transparent 26%), radial-gradient(circle at 84% 82%, rgba(109, 77, 58, 0.24), transparent 34%)',
      topGlow: 'rgba(255, 244, 236, 0.24)',
      bottomGlow: 'rgba(96, 67, 49, 0.2)',
      edgeGlow: 'rgba(242, 225, 213, 0.08)',
    };
  }

  if (project.name === 'Scrapwrk Store') {
    return {
      base: 'linear-gradient(339.49deg, #41271B 15.13%, #2A3040 97.51%)',
      overlay: 'radial-gradient(circle at 18% 16%, rgba(84, 92, 122, 0.22), transparent 28%), radial-gradient(circle at 80% 84%, rgba(142, 83, 46, 0.18), transparent 34%)',
      topGlow: 'rgba(102, 111, 145, 0.16)',
      bottomGlow: 'rgba(118, 64, 34, 0.2)',
      edgeGlow: 'rgba(212, 183, 157, 0.06)',
    };
  }

  switch (project.type) {
    case 'mixtape':
      return {
        base: 'linear-gradient(135deg, #F8F6EF 0%, #E4E0EF 42%, #CBC4DD 100%)',
        overlay: 'radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.55), transparent 22%), radial-gradient(circle at 82% 84%, rgba(171, 158, 209, 0.35), transparent 28%)',
        topGlow: 'rgba(255, 255, 255, 0.28)',
        bottomGlow: 'rgba(175, 157, 213, 0.2)',
        edgeGlow: 'rgba(131, 110, 167, 0.08)',
      };
    case 'multi-purpose-stream':
      return {
        base: 'linear-gradient(135deg, #08131A 0%, #102A3A 38%, #17495A 100%)',
        overlay: 'radial-gradient(circle at 20% 18%, rgba(64, 174, 215, 0.24), transparent 28%), radial-gradient(circle at 78% 82%, rgba(31, 117, 109, 0.22), transparent 30%)',
        topGlow: 'rgba(77, 182, 212, 0.2)',
        bottomGlow: 'rgba(35, 141, 128, 0.18)',
        edgeGlow: 'rgba(111, 231, 205, 0.06)',
      };
    case 'video-series':
      return {
        base: 'linear-gradient(135deg, #27110E 0%, #5B1F14 44%, #A0392B 100%)',
        overlay: 'radial-gradient(circle at 18% 20%, rgba(255, 170, 114, 0.24), transparent 28%), radial-gradient(circle at 84% 80%, rgba(231, 83, 116, 0.18), transparent 30%)',
        topGlow: 'rgba(255, 145, 87, 0.2)',
        bottomGlow: 'rgba(210, 76, 97, 0.18)',
        edgeGlow: 'rgba(255, 197, 128, 0.08)',
      };
    default:
      return {
        base: 'linear-gradient(135deg, #071511 0%, #0E2D24 42%, #1B564B 100%)',
        overlay: 'radial-gradient(circle at 18% 20%, rgba(142, 239, 207, 0.2), transparent 28%), radial-gradient(circle at 82% 82%, rgba(53, 117, 101, 0.22), transparent 30%)',
        topGlow: 'rgba(112, 226, 189, 0.18)',
        bottomGlow: 'rgba(52, 127, 108, 0.2)',
        edgeGlow: 'rgba(198, 255, 232, 0.06)',
      };
  }
}

function BackgroundLayer({
  background,
  opacity,
}: {
  background: SlideBackground;
  opacity: number;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{
        opacity,
        willChange: 'opacity',
      }}
    >
      <div className="absolute inset-0" style={{ background: background.base }} />
      <div className="absolute inset-0" style={{ background: background.overlay }} />
      <div
        className="absolute left-[18%] top-[15%] h-96 w-96 rounded-full blur-3xl"
        style={{ background: background.topGlow }}
      />
      <div
        className="absolute bottom-[18%] right-[14%] h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: background.bottomGlow }}
      />
      <div
        className="absolute left-1/2 top-[56%] h-[24rem] w-[24rem] -translate-x-1/2 rounded-full blur-[120px]"
        style={{ background: background.edgeGlow }}
      />
    </div>
  );
}

function FooterSocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="rounded-sm text-white/70 transition-colors duration-200 hover:text-white focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
    >
      {children}
    </a>
  );
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="15" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 2h-3.5v13.4a3.1 3.1 0 1 1-2.2-3V8.8a6.6 6.6 0 1 0 5.7 6.6V8.6a8.2 8.2 0 0 0 4.4 1.3V6.4a4.6 4.6 0 0 1-4.4-4.4Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.8 2.5h3.3l-7.2 8.2 8.5 10.8h-6.6l-5.2-6.6-6 6.6H1.3l7.7-8.8L.9 2.5h6.8l4.7 6 5.4-6Zm-1.2 17h1.8L7.5 4.4H5.5l11.1 15.1Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.4 21.9v-7.4h2.5l.4-2.9h-2.9V9.8c0-.8.2-1.4 1.4-1.4h1.5V5.8c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H7.9v2.9h2.5v7.4a10 10 0 1 1 3 0Z" />
    </svg>
  );
}

function SiteFooter() {
  return (
    <footer
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-6 bg-gradient-to-t from-black/75 via-black/50 via-45% to-transparent px-6 pt-24 text-[13px] [text-shadow:0_1px_10px_rgba(0,0,0,0.55)] sm:px-10"
      style={{ paddingBottom: 'calc(max(1.25rem, env(safe-area-inset-bottom)) + var(--player-offset, 0px))' }}
    >
      <p className="text-white/60">
        <span className="font-medium text-white/85">Bryton Zoz</span>
        <span className="ml-2">&copy; 2026</span>
      </p>
      <nav aria-label="Social" className="pointer-events-auto flex items-center gap-5">
        <FooterSocialLink href="https://instagram.com/brytonzoz" label="Instagram">
          <InstagramIcon />
        </FooterSocialLink>
        <FooterSocialLink href="https://tiktok.com/@brytonzoz" label="TikTok">
          <TikTokIcon />
        </FooterSocialLink>
        <FooterSocialLink href="https://x.com/zozbryton" label="X">
          <XIcon />
        </FooterSocialLink>
        <FooterSocialLink href="https://facebook.com/brytonzoz" label="Facebook">
          <FacebookIcon />
        </FooterSocialLink>
      </nav>
    </footer>
  );
}

const SOLENYA_FRAME = {
  width: 961,
  height: 1758,
};

// Scenes are laid out in design units; --scene-unit (globals.css) fits the frame to the viewport
// in pure CSS so the first scene renders from static HTML before any JavaScript runs.
const scaleValue = (value: number) => `calc(var(--scene-unit) * ${value})`;
const sceneLeft = (value: number) => `calc(50% + var(--scene-unit) * ${value - (SOLENYA_FRAME.width / 2)})`;
const sceneTop = (value: number) => `calc(50% + var(--scene-unit) * ${value - (SOLENYA_FRAME.height / 2)})`;
const SCENE_FRAME_WIDTH = scaleValue(SOLENYA_FRAME.width);
const SCENE_FRAME_HEIGHT = scaleValue(SOLENYA_FRAME.height);

const SCENE_FONT = 'var(--font-inter), Inter, system-ui, sans-serif';

const sceneImageSizes = (designWidth: number) => {
  const byHeight = ((designWidth / SOLENYA_FRAME.height) * 100).toFixed(2);
  const byWidth = ((designWidth / SOLENYA_FRAME.width) * 100).toFixed(2);
  return `(min-aspect-ratio: ${SOLENYA_FRAME.width}/${SOLENYA_FRAME.height}) ${byHeight}vh, ${byWidth}vw`;
};

const solenyaStickers = [
  {
    key: 'light-cloud',
    src: solenyaSceneAssets.lightCloud,
    alt: 'Light cloud',
    fadeX: 'linear-gradient(to right, transparent 0%, #000 26%)',
    fadeY: 'linear-gradient(to bottom, #000 58%, transparent 84%)',
    frame: { left: -215, top: -284, size: 696 },
    zIndex: 2,
    movement: { x: -18, y: -70, rotate: -4, scale: 0.05, fadeRate: 0.7 },
    float: { x: -8, y: -12, rotate: -2, duration: '8.5s', delay: '0s' },
    intro: { x: -130, y: -70, rotate: -8, delay: '0.12s' },
  },
  {
    key: 'dark-cloud',
    src: solenyaSceneAssets.darkCloud,
    alt: 'Dark cloud',
    fadeX: 'linear-gradient(to left, transparent 0%, #000 26%)',
    frame: { left: 575, top: -268, size: 696 },
    zIndex: 2,
    movement: { x: 26, y: -96, rotate: 6, scale: 0.06, fadeRate: 0.8 },
    float: { x: 10, y: -10, rotate: 2, duration: '9.4s', delay: '0.6s' },
    intro: { x: 140, y: -90, rotate: 9, delay: '0.18s' },
  },
  {
    key: 'birds',
    src: solenyaSceneAssets.birds,
    alt: 'Birds',
    frame: { left: 613, top: 439, size: 696 },
    zIndex: 25,
    movement: { x: 52, y: -116, rotate: 10, scale: 0.08, fadeRate: 1.2 },
    float: { x: 12, y: -8, rotate: 4, duration: '6.6s', delay: '1s' },
    intro: { x: 150, y: -24, rotate: 12, delay: '0.34s' },
  },
  {
    key: 'flowers',
    src: solenyaSceneAssets.flowers,
    alt: 'Flowers',
    frame: { left: -348, top: 543, size: 696 },
    zIndex: 12,
    movement: { x: -36, y: -128, rotate: -8, scale: 0.08, fadeRate: 1.1 },
    float: { x: -9, y: -18, rotate: -3, duration: '7.8s', delay: '0.2s' },
    intro: { x: -160, y: 110, rotate: -12, delay: '0.28s' },
  },
  {
    key: 'grass',
    src: solenyaSceneAssets.grass,
    alt: 'Grass',
    frame: { left: -554, top: 1002, size: 946.6 },
    zIndex: 4,
    baseRotate: 20.99,
    movement: { x: -24, y: -92, rotate: -5, scale: 0.07, fadeRate: 0.9 },
    float: { x: -6, y: -10, rotate: -2, duration: '8.2s', delay: '0.3s' },
    intro: { x: -120, y: 140, rotate: -6, delay: '0.4s' },
  },
  {
    key: 'waterfall',
    src: solenyaSceneAssets.waterfall,
    alt: 'Waterfall',
    frame: { left: 398, top: 1135, size: 888 },
    zIndex: 4,
    movement: { x: 34, y: -110, rotate: 4, scale: 0.06, fadeRate: 1 },
    float: { x: 8, y: -14, rotate: 1.5, duration: '9.8s', delay: '0.9s' },
    intro: { x: 130, y: 150, rotate: 8, delay: '0.48s' },
  },
];

const cautionStickers = [
  {
    key: 'christler',
    src: cautionSceneAssets.christler,
    alt: 'Chrysler Building',
    frame: { left: -370, top: 890, size: 1025 },
    zIndex: 4,
    movement: { x: -22, y: 108, rotate: -2, scale: 0.05, fadeRate: 0.7 },
    float: { x: -7, y: -10, rotate: -1.2, duration: '9.1s', delay: '0.3s' },
    intro: { x: -120, y: 180, rotate: -8, delay: '0.2s' },
  },
  {
    key: 'empire',
    src: cautionSceneAssets.empire,
    alt: 'Empire State Building',
    frame: { left: 143, top: 428, size: 1555 },
    zIndex: 2,
    movement: { x: 22, y: 138, rotate: 3, scale: 0.05, fadeRate: 0.7 },
    float: { x: 8, y: -12, rotate: 1.6, duration: '10.4s', delay: '0.1s' },
    intro: { x: 150, y: 160, rotate: 6, delay: '0.14s' },
  },
  {
    key: 'owt',
    src: cautionSceneAssets.owt,
    alt: 'One World Trade',
    frame: { left: -41, top: 1287, size: 696 },
    zIndex: 5,
    movement: { x: -14, y: 120, rotate: -2, scale: 0.06, fadeRate: 0.9 },
    float: { x: -4, y: -12, rotate: -1, duration: '8.6s', delay: '0.5s' },
    intro: { x: 0, y: 170, rotate: -4, delay: '0.28s' },
  },
  {
    key: 'pigeon-top',
    src: cautionSceneAssets.pigeon,
    alt: 'Flying pigeon',
    frame: { left: 449, top: -209, size: 696 },
    zIndex: 18,
    movement: { x: 56, y: -122, rotate: 11, scale: 0.08, fadeRate: 1.15 },
    float: { x: 12, y: -8, rotate: 4, duration: '6.8s', delay: '0.9s' },
    intro: { x: 130, y: -120, rotate: 12, delay: '0.34s' },
  },
  {
    key: 'pigeon-left',
    src: cautionSceneAssets.pigeon,
    alt: 'Flying pigeon',
    frame: { left: -218, top: 208, size: 412.54 },
    zIndex: 18,
    baseRotate: 14,
    flipX: true,
    movement: { x: -54, y: -92, rotate: -9, scale: 0.08, fadeRate: 1.15 },
    float: { x: -12, y: -8, rotate: -3.5, duration: '6.1s', delay: '0.4s' },
    intro: { x: -140, y: -24, rotate: -14, delay: '0.24s' },
  },
];

const reminderStickers = [
  {
    key: 'pencil',
    src: reminderSceneAssets.pencil,
    alt: 'Pencil',
    frame: { left: -359, top: -393, size: 696 },
    zIndex: 18,
    baseRotate: -69.49,
    movement: { x: -82, y: -116, rotate: -8, scale: 0.06, fadeRate: 0.95 },
    float: { x: -9, y: -8, rotate: -2.6, duration: '8.5s', delay: '0.1s' },
    intro: { x: -180, y: -130, rotate: -12, delay: '0.12s' },
  },
  {
    key: 'pen',
    src: reminderSceneAssets.pen,
    alt: 'Pen',
    frame: { left: 458, top: -248, size: 696 },
    zIndex: 18,
    baseRotate: -14.01,
    movement: { x: 70, y: -108, rotate: 4, scale: 0.06, fadeRate: 0.92 },
    float: { x: 8, y: -10, rotate: 1.8, duration: '8.8s', delay: '0.55s' },
    intro: { x: 170, y: -120, rotate: 10, delay: '0.18s' },
  },
  {
    key: 'paper',
    src: reminderSceneAssets.paper,
    alt: 'Paper',
    frame: { left: 567, top: 651, size: 544 },
    zIndex: 8,
    baseRotate: -30.36,
    movement: { x: 92, y: 28, rotate: -6, scale: 0.07, fadeRate: 1.02 },
    float: { x: 10, y: -6, rotate: 1.8, duration: '7.1s', delay: '0.72s' },
    intro: { x: 142, y: 22, rotate: -8, delay: '0.28s' },
  },
  {
    key: 'notepad',
    src: reminderSceneAssets.notepad,
    alt: 'Notepad',
    frame: { left: -264, top: 1218, size: 696 },
    zIndex: 4,
    baseRotate: 15.59,
    movement: { x: -70, y: 122, rotate: 5, scale: 0.08, fadeRate: 1.04 },
    float: { x: -8, y: -10, rotate: -1.7, duration: '8.9s', delay: '0.26s' },
    intro: { x: -180, y: 168, rotate: 10, delay: '0.36s' },
  },
  {
    key: 'microphone',
    src: reminderSceneAssets.microphone,
    alt: 'Microphone',
    frame: { left: 426, top: 1188, size: 696 },
    zIndex: 5,
    baseRotate: -22.25,
    movement: { x: 78, y: 132, rotate: -4, scale: 0.08, fadeRate: 1.08 },
    float: { x: 9, y: -9, rotate: 1.8, duration: '8.2s', delay: '0.62s' },
    intro: { x: 160, y: 176, rotate: -10, delay: '0.44s' },
  },
];

const scrapwrkStickers = [
  {
    key: 'hat',
    src: scrapwrkSceneAssets.hat,
    alt: 'Hat',
    frame: { left: -385, top: -200, size: 754.83 },
    zIndex: 18,
    baseRotate: -33.34,
    movement: { x: -76, y: -118, rotate: -7, scale: 0.07, fadeRate: 0.96 },
    float: { x: -8, y: -8, rotate: -2.2, duration: '8.4s', delay: '0.12s' },
    intro: { x: -184, y: -128, rotate: -10, delay: '0.12s' },
  },
  {
    key: 'hoodie-top',
    src: scrapwrkSceneAssets.hoodieTop,
    alt: 'Folded hoodie',
    frame: { left: 444, top: -340, size: 696 },
    zIndex: 18,
    baseRotate: -27.03,
    movement: { x: 82, y: -124, rotate: 5, scale: 0.07, fadeRate: 0.96 },
    float: { x: 8, y: -8, rotate: 2, duration: '8.9s', delay: '0.48s' },
    intro: { x: 168, y: -140, rotate: 10, delay: '0.18s' },
  },
  {
    key: 'hoodie-bottom',
    src: scrapwrkSceneAssets.hoodieBottom,
    alt: 'Patchwork hoodie',
    fadeY: 'linear-gradient(to bottom, #000 74%, transparent 99%)',
    frame: { left: -43, top: 1250, size: 524.54 },
    zIndex: 5,
    baseRotate: 1.82,
    movement: { x: -64, y: 110, rotate: 4, scale: 0.08, fadeRate: 1.02 },
    float: { x: -7, y: -8, rotate: -1.4, duration: '8.2s', delay: '0.28s' },
    intro: { x: -152, y: 160, rotate: 8, delay: '0.34s' },
  },
  {
    key: 'pants',
    src: scrapwrkSceneAssets.pants,
    alt: 'Patchwork pants',
    frame: { left: 444, top: 1060, size: 696 },
    zIndex: 5,
    baseRotate: -25.85,
    movement: { x: 78, y: 126, rotate: -5, scale: 0.08, fadeRate: 1.04 },
    float: { x: 9, y: -10, rotate: 1.6, duration: '8.6s', delay: '0.56s' },
    intro: { x: 170, y: 164, rotate: -8, delay: '0.42s' },
  },
];

const SolenyaScene = React.memo(function SolenyaScene({
  project,
  distance,
  loadImages,
  showScrollPrompt,
  onScrollPromptClick,
  onModalStateChange,
}: {
  project: Project;
  distance: number;
  loadImages: boolean;
  showScrollPrompt: boolean;
  onScrollPromptClick: () => void;
  onModalStateChange?: (isOpen: boolean) => void;
}) {
  const [isStreamingModalOpen, setIsStreamingModalOpen] = useState(false);
  const isReleased = isProjectReleased(project);
  const currentDescription = isReleased
    ? (project.postReleaseDescription || project.description)
    : (project.preReleaseDescription || project.description);
  const currentStreamingLinks = isReleased
    ? (project.postReleaseStreamingLinks || project.streamingLinks)
    : project.streamingLinks;
  const primaryActionUrl =
    currentStreamingLinks?.applemusic ||
    currentStreamingLinks?.spotify ||
    currentStreamingLinks?.youtubemusic ||
    project.url;

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoingCardProgress = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incomingCardProgress = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const cardScale = distance >= 0
    ? 1 - (outgoingCardProgress * 0.26)
    : 1 - (incomingCardProgress * 0.18);
  const cardOpacity = 1 - (distanceMagnitude * 0.18);
  const cardTranslateY = outgoingCardProgress * 58;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {solenyaStickers.map((sticker) => {
        const stickerState = getSceneStickerState(sticker, distance);

        return (
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
              style={{
                opacity: stickerState.opacity,
                transform: `translate3d(${scaleValue(stickerState.translateX)}, ${scaleValue(stickerState.translateY)}, 0) rotate(${stickerState.rotate}deg) scale(${stickerState.scale})`,
                willChange: 'transform, opacity',
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out',
              }}
            >
              <div
                className="solenya-sticker-float h-full w-full"
                style={
                  {
                    '--float-x': scaleValue(sticker.float.x),
                    '--float-y': scaleValue(sticker.float.y),
                    '--float-rotate': `${sticker.float.rotate}deg`,
                    '--float-duration': sticker.float.duration,
                    animationDelay: sticker.float.delay,
                    maskImage: sticker.fadeX,
                    WebkitMaskImage: sticker.fadeX,
                  } as React.CSSProperties
                }
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={sticker.src}
                    alt={sticker.alt}
                    sizes={sceneImageSizes(sticker.frame.size)}
                    draggable={false}
                    className="h-full w-full object-contain select-none"
                    style={sticker.fadeY ? { maskImage: sticker.fadeY, WebkitMaskImage: sticker.fadeY } : undefined}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: SCENE_FRAME_WIDTH,
            height: SCENE_FRAME_HEIGHT,
          }}
        >
          <div
            className="absolute solenya-card-enter"
            style={{
              left: scaleValue(120),
              top: scaleValue(208),
              width: scaleValue(722),
              height: scaleValue(1086),
              zIndex: 10,
              animationDelay: '0.14s',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#1F0E08',
                borderRadius: scaleValue(100),
                boxShadow: '0px 4px 4px rgba(0, 0, 0, 0.25)',
                opacity: cardOpacity,
                transform: `translate3d(0, ${scaleValue(cardTranslateY)}, 0) scale(${cardScale})`,
                transformOrigin: 'center center',
                willChange: 'transform, opacity',
                transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
              }}
            >
            <div
              style={{
                position: 'absolute',
                left: scaleValue(45),
                top: scaleValue(51),
                width: scaleValue(632),
                height: scaleValue(632),
                overflow: 'hidden',
                borderRadius: scaleValue(53),
                ...placeholderBackground(solenyaSceneAssets.cover, 'center'),
              }}
            >
              {loadImages ? (
                <ResponsiveImage
                  asset={solenyaSceneAssets.cover}
                  alt={project.name}
                  sizes={sceneImageSizes(632)}
                  priority
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />
              ) : null}
            </div>

            <h2

              className="text-balance"

              style={{
                position: 'absolute',
                left: scaleValue(45),
                top: scaleValue(718),
                margin: 0,
                fontFamily: SCENE_FONT,
                fontSize: scaleValue(64),
                lineHeight: scaleValue(77),
                fontWeight: 700,
                letterSpacing: '-0.04em',
                color: '#FFFFFF',
              }}
            >
              {project.name}
            </h2>

            <p
              style={{
                position: 'absolute',
                left: scaleValue(45),
                top: scaleValue(807),
                width: scaleValue(632),
                margin: 0,
                fontFamily: SCENE_FONT,
                fontSize: scaleValue(36),
                lineHeight: scaleValue(44),
                fontWeight: 300,
                color: '#FFFFFF',
              }}
            >
              {currentDescription}
            </p>

            {primaryActionUrl ? (
              <button
                type="button"
                className="scene-button"
                onClick={() => {
                  setIsStreamingModalOpen(true);
                  onModalStateChange?.(true);
                }}
                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(902),
                  width: scaleValue(632),
                  height: scaleValue(146),
                  background: '#AF7D6B',
                  borderRadius: scaleValue(51),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingLeft: scaleValue(49),
                  paddingRight: scaleValue(37),
                  textDecoration: 'none',
                  color: '#FFFFFF',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: SCENE_FONT,
                    fontSize: scaleValue(40),
                    lineHeight: scaleValue(48),
                    fontWeight: 700,
                }}
              >
                Listen Now
              </span>
                <svg
                  style={{ width: scaleValue(81), height: scaleValue(40) }}
                  viewBox="0 0 81 40"
                  fill="none"
                >
                  <path d="M0 20H63" stroke="white" strokeWidth={6} strokeLinecap="round" />
                  <path d="M58 6L75 20L58 34" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            </div>
          </div>

          {showScrollPrompt ? (
            <button
              onClick={onScrollPromptClick}
              className="scene-button absolute"
              style={{
                left: scaleValue(277),
                top: scaleValue(1552),
                width: scaleValue(407),
                height: scaleValue(121),
                background: 'rgba(47, 47, 47, 0.68)',
                borderRadius: scaleValue(100),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingLeft: scaleValue(38),
                paddingRight: scaleValue(34),
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                color: '#FFFFFF',
                zIndex: 14,
                opacity: 1 - clamp(distance / 0.16, 0, 1),
                transform: `translate3d(0, ${scaleValue(clamp(distance, 0, 1) * 38)}, 0)`,
                transition: 'transform 300ms ease-out, opacity 220ms ease-out',
              }}
            >
              <span
                style={{
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(32),
                  lineHeight: scaleValue(39),
                  fontWeight: 700,
                }}
              >
                Scroll for more
              </span>
              <svg
                style={{ width: scaleValue(55), height: scaleValue(55) }}
                viewBox="0 0 55 55"
                fill="none"
              >
                <path d="M27.5 4V43" stroke="white" strokeWidth={6} strokeLinecap="round" />
                <path d="M10 27.5L27.5 45L45 27.5" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <ListenSheet
        project={project}
        isOpen={isStreamingModalOpen}
        onClose={() => {
          setIsStreamingModalOpen(false);
          onModalStateChange?.(false);
        }}
      />
    </div>
  );
});

const CautionScene = React.memo(function CautionScene({
  project,
  distance,
  loadImages,
  onModalStateChange,
}: {
  project: Project;
  distance: number;
  loadImages: boolean;
  onModalStateChange?: (isOpen: boolean) => void;
}) {
  const [isStreamingModalOpen, setIsStreamingModalOpen] = useState(false);
  const currentDescription = project.description;
  const currentStreamingLinks = project.streamingLinks;
  const primaryActionUrl =
    currentStreamingLinks?.applemusic ||
    currentStreamingLinks?.spotify ||
    currentStreamingLinks?.youtubemusic ||
    project.url;

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoingCardProgress = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incomingCardProgress = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const cardScale = distance >= 0
    ? 1 - (outgoingCardProgress * 0.26)
    : 1 - (incomingCardProgress * 0.18);
  const cardOpacity = 1 - (distanceMagnitude * 0.18);
  const cardTranslateY = outgoingCardProgress * 58;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {cautionStickers.map((sticker) => {
        const stickerState = getSceneStickerState(sticker, distance);

        return (
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
              style={{
                opacity: stickerState.opacity,
                transform: `translate3d(${scaleValue(stickerState.translateX)}, ${scaleValue(stickerState.translateY)}, 0) rotate(${stickerState.rotate}deg) scale(${stickerState.scale})`,
                willChange: 'transform, opacity',
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out',
              }}
            >
              <div
                className="solenya-sticker-float h-full w-full"
                style={
                  {
                    '--float-x': scaleValue(sticker.float.x),
                    '--float-y': scaleValue(sticker.float.y),
                    '--float-rotate': `${sticker.float.rotate}deg`,
                    '--float-duration': sticker.float.duration,
                    animationDelay: sticker.float.delay,
                  } as React.CSSProperties
                }
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={sticker.src}
                    alt={sticker.alt}
                    sizes={sceneImageSizes(sticker.frame.size)}
                    draggable={false}
                    className="h-full w-full object-contain select-none"
                    style={sticker.flipX ? { transform: 'scaleX(-1)' } : undefined}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: SCENE_FRAME_WIDTH,
            height: SCENE_FRAME_HEIGHT,
          }}
        >
          <div
            className="absolute solenya-card-enter"
            style={{
              left: scaleValue(120),
              top: scaleValue(208),
              width: scaleValue(722),
              height: scaleValue(1086),
              zIndex: 10,
              animationDelay: '0.14s',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#241804',
                borderRadius: scaleValue(100),
                boxShadow: '0px 4px 4px rgba(0, 0, 0, 0.25)',
                opacity: cardOpacity,
                transform: `translate3d(0, ${scaleValue(cardTranslateY)}, 0) scale(${cardScale})`,
                transformOrigin: 'center center',
                willChange: 'transform, opacity',
                transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: scaleValue(47),
                  top: scaleValue(52),
                  width: scaleValue(630),
                  height: scaleValue(630),
                  overflow: 'hidden',
                  borderRadius: scaleValue(48),
                  ...placeholderBackground(cautionSceneAssets.cover, 'center top'),
                }}
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={cautionSceneAssets.cover}
                    alt={project.name}
                    sizes={sceneImageSizes(630)}
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ objectPosition: 'center top' }}
                  />
                ) : null}
              </div>

              <h2

                className="text-balance"

                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(718),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(64),
                  lineHeight: scaleValue(77),
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  color: '#FFFFFF',
                }}
              >
                {project.name}
              </h2>

              <p
                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(807),
                  width: scaleValue(632),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(36),
                  lineHeight: scaleValue(44),
                  fontWeight: 300,
                  color: '#FFFFFF',
                }}
              >
                {currentDescription}
              </p>

              {primaryActionUrl ? (
                <button
                  type="button"
                  className="scene-button"
                  onClick={() => {
                    setIsStreamingModalOpen(true);
                    onModalStateChange?.(true);
                  }}
                  style={{
                    position: 'absolute',
                    left: scaleValue(45),
                    top: scaleValue(902),
                    width: scaleValue(632),
                    height: scaleValue(146),
                    background: '#B4907B',
                    borderRadius: scaleValue(51),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingLeft: scaleValue(49),
                    paddingRight: scaleValue(37),
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontFamily: SCENE_FONT,
                      fontSize: scaleValue(40),
                      lineHeight: scaleValue(48),
                      fontWeight: 700,
                    }}
                  >
                    Listen Now
                  </span>
                  <svg
                    style={{ width: scaleValue(81), height: scaleValue(40) }}
                    viewBox="0 0 81 40"
                    fill="none"
                  >
                    <path d="M0 20H63" stroke="white" strokeWidth={6} strokeLinecap="round" />
                    <path d="M58 6L75 20L58 34" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <ListenSheet
        project={project}
        isOpen={isStreamingModalOpen}
        onClose={() => {
          setIsStreamingModalOpen(false);
          onModalStateChange?.(false);
        }}
      />
    </div>
  );
});

const ReminderScene = React.memo(function ReminderScene({
  project,
  distance,
  loadImages,
}: {
  project: Project;
  distance: number;
  loadImages: boolean;
}) {
  const displayTitle = 'Just a reminder to live life';
  const displayDescription = 'thoughts, moments, and in-between';
  const primaryActionUrl = project.url;

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoingCardProgress = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incomingCardProgress = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const cardScale = distance >= 0
    ? 1 - (outgoingCardProgress * 0.26)
    : 1 - (incomingCardProgress * 0.18);
  const cardOpacity = 1 - (distanceMagnitude * 0.18);
  const cardTranslateY = outgoingCardProgress * 58;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {reminderStickers.map((sticker) => {
        const stickerState = getSceneStickerState(sticker, distance);

        return (
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
              style={{
                opacity: stickerState.opacity,
                transform: `translate3d(${scaleValue(stickerState.translateX)}, ${scaleValue(stickerState.translateY)}, 0) rotate(${stickerState.rotate}deg) scale(${stickerState.scale})`,
                willChange: 'transform, opacity',
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out',
              }}
            >
              <div
                className="solenya-sticker-float h-full w-full"
                style={
                  {
                    '--float-x': scaleValue(sticker.float.x),
                    '--float-y': scaleValue(sticker.float.y),
                    '--float-rotate': `${sticker.float.rotate}deg`,
                    '--float-duration': sticker.float.duration,
                    animationDelay: sticker.float.delay,
                  } as React.CSSProperties
                }
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={sticker.src}
                    alt={sticker.alt}
                    sizes={sceneImageSizes(sticker.frame.size)}
                    draggable={false}
                    className="h-full w-full object-contain select-none"
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: SCENE_FRAME_WIDTH,
            height: SCENE_FRAME_HEIGHT,
          }}
        >
          <div
            className="absolute solenya-card-enter"
            style={{
              left: scaleValue(120),
              top: scaleValue(208),
              width: scaleValue(722),
              height: scaleValue(1176),
              zIndex: 10,
              animationDelay: '0.14s',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#1F1F1F',
                borderRadius: scaleValue(100),
                boxShadow: '0px 4px 4px rgba(0, 0, 0, 0.25)',
                opacity: cardOpacity,
                transform: `translate3d(0, ${scaleValue(cardTranslateY)}, 0) scale(${cardScale})`,
                transformOrigin: 'center center',
                willChange: 'transform, opacity',
                transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: scaleValue(46),
                  top: scaleValue(51),
                  width: scaleValue(631),
                  height: scaleValue(631),
                  overflow: 'hidden',
                  borderRadius: scaleValue(49),
                  ...placeholderBackground(reminderSceneAssets.cover, 'center'),
                }}
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={reminderSceneAssets.cover}
                    alt={displayTitle}
                    sizes={sceneImageSizes(631)}
                    className="absolute inset-0 h-full w-full object-cover object-center"
                  />
                ) : null}
              </div>

              <h2

                className="text-balance"

                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(718),
                  width: scaleValue(632),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(64),
                  lineHeight: scaleValue(77),
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  color: '#FFFFFF',
                }}
              >
                {displayTitle}
              </h2>

              <p
                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(885),
                  width: scaleValue(632),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(36),
                  lineHeight: scaleValue(44),
                  fontWeight: 300,
                  color: '#FFFFFF',
                }}
              >
                {displayDescription}
              </p>

              {primaryActionUrl ? (
                <button
                  type="button"
                  className="scene-button"
                  onClick={() => window.open(primaryActionUrl, '_blank', 'noopener,noreferrer')}
                  style={{
                    position: 'absolute',
                    left: scaleValue(45),
                    top: scaleValue(980),
                    width: scaleValue(632),
                    height: scaleValue(146),
                    background: '#525252',
                    borderRadius: scaleValue(51),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingLeft: scaleValue(49),
                    paddingRight: scaleValue(37),
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontFamily: SCENE_FONT,
                      fontSize: scaleValue(40),
                      lineHeight: scaleValue(48),
                      fontWeight: 700,
                    }}
                  >
                    Listen Now
                  </span>
                  <svg
                    style={{ width: scaleValue(81), height: scaleValue(40) }}
                    viewBox="0 0 81 40"
                    fill="none"
                  >
                    <path d="M0 20H63" stroke="white" strokeWidth={6} strokeLinecap="round" />
                    <path d="M58 6L75 20L58 34" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const ScrapwrkScene = React.memo(function ScrapwrkScene({
  project,
  distance,
  loadImages,
}: {
  project: Project;
  distance: number;
  loadImages: boolean;
}) {
  const displayTitle = 'SCRAPWRK';
  const displayDescription = 'reconstructed pieces and identity';
  const primaryActionUrl = project.url;

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoingCardProgress = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incomingCardProgress = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const cardScale = distance >= 0
    ? 1 - (outgoingCardProgress * 0.26)
    : 1 - (incomingCardProgress * 0.18);
  const cardOpacity = 1 - (distanceMagnitude * 0.18);
  const cardTranslateY = outgoingCardProgress * 58;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {scrapwrkStickers.map((sticker) => {
        const stickerState = getSceneStickerState(sticker, distance);

        return (
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
              style={{
                opacity: stickerState.opacity,
                transform: `translate3d(${scaleValue(stickerState.translateX)}, ${scaleValue(stickerState.translateY)}, 0) rotate(${stickerState.rotate}deg) scale(${stickerState.scale})`,
                willChange: 'transform, opacity',
                transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out',
              }}
            >
              <div
                className="solenya-sticker-float h-full w-full"
                style={
                  {
                    '--float-x': scaleValue(sticker.float.x),
                    '--float-y': scaleValue(sticker.float.y),
                    '--float-rotate': `${sticker.float.rotate}deg`,
                    '--float-duration': sticker.float.duration,
                    animationDelay: sticker.float.delay,
                  } as React.CSSProperties
                }
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={sticker.src}
                    alt={sticker.alt}
                    sizes={sceneImageSizes(sticker.frame.size)}
                    draggable={false}
                    className="h-full w-full object-contain select-none"
                    style={sticker.fadeY ? { maskImage: sticker.fadeY, WebkitMaskImage: sticker.fadeY } : undefined}
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: SCENE_FRAME_WIDTH,
            height: SCENE_FRAME_HEIGHT,
          }}
        >
          <div
            className="absolute solenya-card-enter"
            style={{
              left: scaleValue(120),
              top: scaleValue(208),
              width: scaleValue(722),
              height: scaleValue(1094),
              zIndex: 10,
              animationDelay: '0.14s',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#1F1F1F',
                borderRadius: scaleValue(100),
                boxShadow: '0px 4px 4px rgba(0, 0, 0, 0.25)',
                opacity: cardOpacity,
                transform: `translate3d(0, ${scaleValue(cardTranslateY)}, 0) scale(${cardScale})`,
                transformOrigin: 'center center',
                willChange: 'transform, opacity',
                transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: scaleValue(46),
                  top: scaleValue(51),
                  width: scaleValue(631),
                  height: scaleValue(632),
                  overflow: 'hidden',
                  borderRadius: scaleValue(50),
                  ...placeholderBackground(scrapwrkSceneAssets.cover, 'center'),
                }}
              >
                {loadImages ? (
                  <ResponsiveImage
                    asset={scrapwrkSceneAssets.cover}
                    alt={displayTitle}
                    sizes={sceneImageSizes(631)}
                    className="absolute inset-0 h-full w-full object-cover object-center"
                  />
                ) : null}
              </div>

              <h2

                className="text-balance"

                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(718),
                  width: scaleValue(632),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(64),
                  lineHeight: scaleValue(77),
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  color: '#FFFFFF',
                }}
              >
                {displayTitle}
              </h2>

              <p
                style={{
                  position: 'absolute',
                  left: scaleValue(45),
                  top: scaleValue(807),
                  width: scaleValue(632),
                  margin: 0,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(36),
                  lineHeight: scaleValue(44),
                  fontWeight: 300,
                  color: '#FFFFFF',
                }}
              >
                {displayDescription}
              </p>

              {primaryActionUrl ? (
                <button
                  type="button"
                  className="scene-button"
                  onClick={() => window.open(primaryActionUrl, '_blank', 'noopener,noreferrer')}
                  style={{
                    position: 'absolute',
                    left: scaleValue(45),
                    top: scaleValue(896),
                    width: scaleValue(632),
                    height: scaleValue(146),
                    background: '#525252',
                    borderRadius: scaleValue(51),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingLeft: scaleValue(49),
                    paddingRight: scaleValue(37),
                    color: '#FFFFFF',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontFamily: SCENE_FONT,
                      fontSize: scaleValue(40),
                      lineHeight: scaleValue(48),
                      fontWeight: 700,
                    }}
                  >
                    Visit
                  </span>
                  <svg
                    style={{ width: scaleValue(81), height: scaleValue(40) }}
                    viewBox="0 0 81 40"
                    fill="none"
                  >
                    <path d="M0 20H63" stroke="white" strokeWidth={6} strokeLinecap="round" />
                    <path d="M58 6L75 20L58 34" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function HomePage() {
  const { music, fashion } = getProjects();
  const allProjects = [...music, ...fashion]
    .filter((project) => !HIDDEN_HOMEPAGE_PROJECTS.has(project.name))
    .sort((leftProject, rightProject) => {
      const leftIndex = HOMEPAGE_PROJECT_ORDER.indexOf(leftProject.name);
      const rightIndex = HOMEPAGE_PROJECT_ORDER.indexOf(rightProject.name);
      const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

      return safeLeftIndex - safeRightIndex;
    });
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showScrollPrompt, setShowScrollPrompt] = useState(true);
  const [loadDeferredScenes, setLoadDeferredScenes] = useState(false);
  const { current: currentTrack } = usePlayer();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0, imageAspectRatio: 16 / 9 });
  const clampedBackgroundProgress = clamp(scrollProgress, 0, allProjects.length - 1);
  const currentBackgroundIndex = Math.floor(clampedBackgroundProgress);
  const nextBackgroundIndex = Math.min(currentBackgroundIndex + 1, allProjects.length - 1);
  const backgroundBlend = clampedBackgroundProgress - currentBackgroundIndex;
  const currentBackground = getProjectBackground(allProjects[currentBackgroundIndex]);
  const nextBackground = getProjectBackground(allProjects[nextBackgroundIndex]);

  const handleModalStateChange = useCallback((isOpen: boolean) => {
    setIsModalOpen(isOpen);
  }, []);

  const calculateContainerSize = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const horizontalPadding = Math.max(24, vw * 0.05);
    const topPadding = 48;
    const bottomSpacing = isModalOpen ? 10 : 40;
    const availableWidth = vw - (horizontalPadding * 2);
    const availableHeight = vh - topPadding - bottomSpacing;

    const containerWidth = Math.min(availableWidth, Math.max(320, vw * 0.45));
    const containerHeight = Math.min(availableHeight, Math.max(380, vh * 0.4));
    const maxImageWidth = containerWidth - 48;
    const maxImageHeight = containerHeight * 0.55;
    const naturalImageRatio = maxImageWidth / maxImageHeight;
    let imageAspectRatio = Math.min(1, naturalImageRatio);

    imageAspectRatio = Math.max(0.6, Math.min(1, imageAspectRatio));

    return {
      width: Math.max(320, containerWidth),
      height: Math.max(400, containerHeight),
      imageAspectRatio,
    };
  };

  const handleScrollToNext = useCallback(() => {
    const container = document.querySelector('.scroll-container');
    if (container) {
      container.scrollTo({
        top: container.clientHeight,
        behavior: 'smooth',
      });
    }
    setShowScrollPrompt(false);
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      setContainerSize(calculateContainerSize());
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);

    return () => window.removeEventListener('resize', updateLayout);
  }, [isModalOpen]);

  useEffect(() => {
    if (activeIndex > 0) {
      setShowScrollPrompt(false);
    }
  }, [activeIndex]);

  // Only the first scene's art is in the initial HTML; the rest starts downloading once that
  // has finished (window load) or as soon as the visitor starts scrolling.
  useEffect(() => {
    if (document.readyState === 'complete') {
      setLoadDeferredScenes(true);
      return;
    }

    const handleLoad = () => setLoadDeferredScenes(true);
    window.addEventListener('load', handleLoad, { once: true });
    return () => window.removeEventListener('load', handleLoad);
  }, []);

  useEffect(() => {
    const initializeScroll = () => {
      const container = document.querySelector('.scroll-container');
      if (container) {
        container.scrollTop = 0;
        setActiveIndex(0);
        setScrollProgress(0);
      }
    };

    const timer = setTimeout(initializeScroll, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const container = document.querySelector('.scroll-container');
      if (!container) return;

      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const newIndex = Math.round(scrollTop / containerHeight);

      setScrollProgress(scrollTop / containerHeight);
      if (scrollTop > 0) {
        setLoadDeferredScenes(true);
      }

      setActiveIndex((currentIndex) => {
        if (newIndex !== currentIndex && newIndex >= 0 && newIndex <= allProjects.length) {
          setIsTransitioning(true);
          setTimeout(() => setIsTransitioning(false), 400);
          return newIndex;
        }
        return currentIndex;
      });
    };

    const container = document.querySelector('.scroll-container');
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [allProjects.length]);

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      <div className="fixed inset-0 bg-black" />
      <BackgroundLayer background={currentBackground} opacity={1} />
      {nextBackgroundIndex !== currentBackgroundIndex ? (
        <BackgroundLayer background={nextBackground} opacity={backgroundBlend} />
      ) : null}
      <div className="solenya-gradient-reveal pointer-events-none fixed inset-0 z-[1] bg-black" />

      <div className="scroll-container relative z-10 h-screen overflow-y-auto snap-y snap-mandatory scroll-smooth">
        <div className="w-full max-w-none">
          {allProjects.map((project, index) => {
            const isActive = index === activeIndex;
            const isPrevious = index === activeIndex - 1;
            const isNext = index === activeIndex + 1;
            const isSolenya = project.name === 'SOLENYA';
            const isCaution = project.name === 'CAUTION';
            const isReminder = project.name === 'Just A Reminder To Live Life';
            const isScrapwrk = project.name === 'Scrapwrk Store';
            const distanceFromCenter = Math.abs(scrollProgress - index);
            const continuousDistance = clamp(distanceFromCenter, 0, 1.2);
            // Scene motion saturates at one screen away; clamping lets memoized far-off scenes skip re-rendering.
            const isLast = index === allProjects.length - 1;
            const sceneDistance = clamp(scrollProgress - index, -1, isLast ? 0 : 1);
            const footer = isLast ? <SiteFooter /> : null;

            if (isSolenya) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <SolenyaScene
                    project={project}
                    distance={sceneDistance}
                    loadImages={index === 0 || loadDeferredScenes}
                    showScrollPrompt={showScrollPrompt && activeIndex === 0 && !isModalOpen && !currentTrack}
                    onScrollPromptClick={handleScrollToNext}
                    onModalStateChange={handleModalStateChange}
                  />
                  {footer}
                </div>
              );
            }

            if (isCaution) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <CautionScene
                    project={project}
                    distance={sceneDistance}
                    loadImages={index === 0 || loadDeferredScenes}
                    onModalStateChange={handleModalStateChange}
                  />
                  {footer}
                </div>
              );
            }

            if (isReminder) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <ReminderScene
                    project={project}
                    distance={sceneDistance}
                    loadImages={index === 0 || loadDeferredScenes}
                  />
                  {footer}
                </div>
              );
            }

            if (isScrapwrk) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <ScrapwrkScene
                    project={project}
                    distance={sceneDistance}
                    loadImages={index === 0 || loadDeferredScenes}
                  />
                  {footer}
                </div>
              );
            }

            const projectCard = (
              <div
                className={`
                  relative z-0 origin-center transform-gpu hover:scale-105 hover:duration-200 hover:ease-out
                  ${isActive ?
                    'scale-100 opacity-100' :
                    isPrevious ?
                      'scale-75 opacity-30' :
                      isNext ?
                        'scale-75 opacity-30' :
                        'scale-50 opacity-0'
                  }
                `}
                style={{
                  width: `${containerSize.width || 360}px`,
                  maxWidth: `${containerSize.width || 360}px`,
                  transform: `scale(${1 - (continuousDistance * 0.25)})`,
                  opacity: Math.max(0, 1 - (continuousDistance * 0.72)),
                  filter: `blur(${Math.min(continuousDistance * 1.1, 1.2)}px)`,
                  transition: isTransitioning
                    ? 'all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94), filter 0.25s ease-out'
                    : 'all 0.4s cubic-bezier(0.23, 1, 0.32, 1), filter 0.3s ease-out',
                }}
              >
                <ProjectCard
                  project={project}
                  onModalStateChange={handleModalStateChange}
                />
              </div>
            );

            return (
              <div key={project.name} className="relative h-screen snap-center">
                <div className="flex h-full w-full items-start justify-center px-6 pt-20 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24">
                  {projectCard}
                </div>
                {footer}
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
