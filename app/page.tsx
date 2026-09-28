'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ProjectCard } from '../components/ProjectCard';
import { NotifySheet, hasSignedUp } from '../components/NotifySheet';
import { SiteFooter } from '../components/SiteFooter';
import { MerchExperience } from '../components/store/MerchExperience';
import { StoreExperience } from '../components/store/StoreExperience';
import { ReleaseSheet } from '../components/release/ReleaseSheet';
import { usePlayer } from '../components/player/context';
import { ArrowUpRightIcon, ChevronDownIcon, EqualizerBars } from '../components/player/icons';
import { ResponsiveImage, placeholderBackground } from '../components/ResponsiveImage';
import { getProjects } from '../lib/projects';
import { cautionSceneAssets, nonparallelAssets, reminderSceneAssets, scrapwrkSceneAssets, solenyaSceneAssets } from '../lib/assets';
import { merchScene } from '../lib/merch';
import type { MediaAsset } from '../lib/media';
import { nextRelease, nextReleaseProject } from '../lib/next-release';
import { getStreamingServices, getVisitLabel } from '../lib/streaming';
import { getRelease, getReleaseForProject, releasePath, warmTrack } from '../lib/tracks';
import { Project, getProjectTypeLabel, isProjectReleased } from '../lib/utils';

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
  'NonParallel',
];

const HIDDEN_HOMEPAGE_PROJECTS = new Set<string>([]);

function getProjectBackground(project: Project): SlideBackground {
  if (project.type === 'coming-soon') {
    return {
      base: 'radial-gradient(120% 90% at 50% 34%, #1c1c1f 0%, #0a0a0b 52%, #000 100%)',
      overlay: 'radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.06), transparent 40%)',
      topGlow: 'rgba(255, 255, 255, 0.04)',
      bottomGlow: 'rgba(160, 160, 176, 0.05)',
      edgeGlow: 'rgba(255, 255, 255, 0.03)',
    };
  }

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

  if (project.name === 'NonParallel') {
    return {
      base: 'linear-gradient(160deg, #1a1030 0%, #0d0a16 55%, #07060b 100%)',
      overlay: 'radial-gradient(circle at 20% 14%, rgba(137, 71, 255, 0.28), transparent 32%), radial-gradient(circle at 82% 86%, rgba(98, 0, 238, 0.22), transparent 36%)',
      topGlow: 'rgba(137, 71, 255, 0.18)',
      bottomGlow: 'rgba(60, 20, 120, 0.22)',
      edgeGlow: 'rgba(200, 180, 255, 0.05)',
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

const PILL_STYLE: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  height: scaleValue(118),
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: scaleValue(14),
  fontFamily: SCENE_FONT,
  fontSize: scaleValue(38),
  fontWeight: 600,
  letterSpacing: '-0.01em',
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
};
const DARK_INK = '#1E1712';
// Scenes are light or dark; text and buttons flip so they always read clearly.
const SCENE_TONES = {
  light: {
    ink: '#FFFFFF',
    muted: 'rgba(255, 255, 255, 0.72)',
    primary: { ...PILL_STYLE, background: '#FFFFFF', color: '#0B0B0C' },
  },
  dark: {
    ink: DARK_INK,
    muted: 'rgba(30, 23, 18, 0.62)',
    primary: { ...PILL_STYLE, background: DARK_INK, color: '#FFFFFF' },
  },
} satisfies Record<string, { ink: string; muted: string; primary: React.CSSProperties }>;

// The release itself, and nothing else: artwork, title, and at most two actions.
// Play starts it right here; the app icons open the other places to listen.
function SceneCard({
  project,
  cover,
  distance,
  loadImages,
  priority = false,
  coverPosition = 'center',
  tone = 'light',
  onModalStateChange,
}: {
  project: Project;
  cover: MediaAsset;
  coverPosition?: string;
  tone?: keyof typeof SCENE_TONES;
  distance: number;
  loadImages: boolean;
  priority?: boolean;
  onModalStateChange?: (isOpen: boolean) => void;
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const player = usePlayer();
  const colors = SCENE_TONES[tone];
  const PRIMARY_PILL = colors.primary;
  const isReleased = isProjectReleased(project);
  const release = isReleased ? getReleaseForProject(project.name) : undefined;
  const services = getStreamingServices(project);
  const isPlayingThis = Boolean(release) && player.current?.release.id === release?.id && player.isPlaying;

  const openSheet = () => {
    setIsSheetOpen(true);
    onModalStateChange?.(true);
  };

  // Once this scene has been on screen for a moment, fetch the start of its first song so Play
  // answers instantly (a finger or cursor reaching the button does the same, sooner).
  const isOnScreen = Math.abs(distance) < 0.5;
  const firstTrack = release?.tracks[0];
  useEffect(() => {
    if (!isOnScreen || !loadImages || !firstTrack) return;
    const timer = window.setTimeout(() => warmTrack(firstTrack), 1200);
    return () => window.clearTimeout(timer);
  }, [isOnScreen, loadImages, firstTrack]);

  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoing = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const scale = distance >= 0 ? 1 - (outgoing * 0.26) : 1 - (incoming * 0.18);

  // One action. Releases open the full sheet (play right here, streaming apps at the bottom);
  // everything else opens its site.
  let primary: React.ReactNode = null;
  if (release) {
    // A real link to the release page (crawlable, works without JavaScript); a plain click opens
    // the sheet right here instead.
    primary = (
      <a
        href={releasePath(release)}
        className="scene-button"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          openSheet();
        }}
        onPointerEnter={() => warmTrack(firstTrack)}
        onPointerDown={() => warmTrack(firstTrack)}
        aria-haspopup="dialog"
        style={PRIMARY_PILL}
      >
        {isPlayingThis ? <EqualizerBars playing className="scene-eq" /> : null}
        Listen Now
      </a>
    );
  } else if (services.length) {
    primary = (
      <button
        type="button"
        className="scene-button"
        onClick={openSheet}
        aria-haspopup="dialog"
        style={PRIMARY_PILL}
      >
        {isReleased ? 'Listen Now' : 'Pre-save'}
      </button>
    );
  } else if (project.url) {
    primary = (
      <a href={project.url} target="_blank" rel="noopener noreferrer" className="scene-button" style={PRIMARY_PILL}>
        {getVisitLabel(project)}
        <ArrowUpRightIcon size={scaleValue(34)} className="shrink-0" />
      </a>
    );
  }

  return (
    <>
      <div
        className="absolute solenya-card-enter"
        style={{ left: scaleValue(120), top: scaleValue(214), width: scaleValue(722), zIndex: 10, animationDelay: '0.14s' }}
      >
        <div
          className="scene-card"
          style={{
            opacity: 1 - (distanceMagnitude * 0.18),
            transform: `translate3d(0, ${scaleValue(outgoing * 58)}, 0) scale(${scale})`,
            transformOrigin: 'center center',
            // Only transform: will-change on opacity would make this a backdrop root for blur effects.
            willChange: 'transform',
            transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
          }}
        >
          <div
            className="scene-cover relative w-full overflow-hidden"
            style={{ aspectRatio: '1 / 1', borderRadius: scaleValue(34), ...placeholderBackground(cover, coverPosition) }}
          >
            {loadImages ? (
              <ResponsiveImage
                asset={cover}
                alt={`${project.name} cover`}
                sizes={sceneImageSizes(722)}
                priority={priority}
                draggable={false}
                className="absolute inset-0 h-full w-full select-none object-cover"
                style={{ objectPosition: coverPosition }}
              />
            ) : null}
          </div>

          <h2
            className={`text-balance ${tone === 'light' ? 'scene-title' : ''}`}
            style={{
              margin: `${scaleValue(52)} 0 0`,
              fontFamily: SCENE_FONT,
              fontSize: scaleValue(62),
              lineHeight: 1.08,
              fontWeight: 650,
              letterSpacing: '-0.035em',
              color: colors.ink,
            }}
          >
            {project.name}
          </h2>
          <p
            className={tone === 'light' ? 'scene-title' : undefined}
            style={{
              margin: `${scaleValue(10)} 0 0`,
              fontFamily: SCENE_FONT,
              fontSize: scaleValue(34),
              lineHeight: 1.2,
              fontWeight: 500,
              color: colors.muted,
            }}
          >
            {getProjectTypeLabel(project)}
          </p>

          {primary ? (
            <div className="flex" style={{ gap: scaleValue(20), marginTop: scaleValue(44) }}>
              {primary}
            </div>
          ) : null}
        </div>
      </div>

      {release || services.length ? (
        <ReleaseSheet
          project={project}
          isOpen={isSheetOpen}
          onClose={() => {
            setIsSheetOpen(false);
            onModalStateChange?.(false);
          }}
        />
      ) : null}
    </>
  );
}

// Quiet on purpose: the only bright thing in this scene is the light inside the cover.
const TEASER_PILL: React.CSSProperties = {
  ...PILL_STYLE,
  background: 'rgba(255, 255, 255, 0.1)',
  color: 'rgba(255, 255, 255, 0.9)',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
};

// "4d 12h 3m" until the date in lib/next-release.ts, "Out now" after it, "Coming soon" without one.
// Starts on "Coming soon" so the static HTML and the first render agree.
function useReleaseStatus(date: string | null): string {
  const target = date ? Date.parse(date) : NaN;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!Number.isFinite(target) || now === null) return 'Coming soon';
  const left = target - now;
  if (left <= 0) return 'Out now';
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${seconds}s`;
}

// Leads the homepage while the next release is being made: the same layout as every release,
// but the cover is still developing, light moving behind frosted glass. Nothing given away.
const ComingSoonScene = React.memo(function ComingSoonScene({ distance, onNext }: { distance: number; onNext: () => void }) {
  const status = useReleaseStatus(nextRelease.date);
  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const outgoing = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const scale = distance >= 0 ? 1 - (outgoing * 0.26) : 1 - (incoming * 0.18);
  const title = nextRelease.title ?? 'New project';
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  useEffect(() => setSignedUp(hasSignedUp()), []);
  // Release day: the teaser becomes the way in, once the songs are actually playable here.
  const outRelease = status === 'Out now' && nextRelease.releaseId ? getRelease(nextRelease.releaseId) : undefined;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div aria-hidden="true" className="teaser-grain pointer-events-none absolute inset-0" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT }}>
          <div
            className="absolute solenya-card-enter"
            style={{ left: scaleValue(120), top: scaleValue(214), width: scaleValue(722), zIndex: 10, animationDelay: '0.1s' }}
          >
            <div
              style={{
                opacity: 1 - (distanceMagnitude * 0.18),
                transform: `translate3d(0, ${scaleValue(outgoing * 58)}, 0) scale(${scale})`,
                transformOrigin: 'center center',
                willChange: 'transform',
                transition: 'transform 760ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease-out',
              }}
            >
              <div
                role="img"
                aria-label="Cover art coming soon"
                className="teaser-cover scene-cover relative w-full overflow-hidden"
                style={{ aspectRatio: '1 / 1', borderRadius: scaleValue(34) }}
              >
                {/* Clipped separately with clip-path: Safari clips the blurred, animated lights (their own
                    layers) to a square, not to the radius, leaving a lighter box behind the corners. */}
                <span aria-hidden="true" className="absolute inset-0" style={{ clipPath: `inset(0 round ${scaleValue(34)})` }}>
                  <span className="teaser-light teaser-light-a" />
                  <span className="teaser-light teaser-light-b" />
                  <span className="teaser-light teaser-light-c" />
                  <span className="teaser-frost" />
                </span>
                <span aria-hidden="true" className="teaser-pulse" style={{ width: scaleValue(22), height: scaleValue(22) }} />
              </div>

              <h2
                className="scene-title text-balance"
                style={{
                  margin: `${scaleValue(52)} 0 0`,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(62),
                  lineHeight: 1.08,
                  fontWeight: 650,
                  letterSpacing: '-0.035em',
                  color: '#FFFFFF',
                }}
              >
                {title}
              </h2>
              <p
                className="scene-title tabular-nums"
                style={{
                  margin: `${scaleValue(10)} 0 0`,
                  fontFamily: SCENE_FONT,
                  fontSize: scaleValue(34),
                  lineHeight: 1.2,
                  fontWeight: 500,
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {status}
              </p>

              <div className="flex" style={{ marginTop: scaleValue(44), gap: scaleValue(20) }}>
                {outRelease ? (
                  <Link href={releasePath(outRelease)} className="scene-button" style={{ ...PILL_STYLE, background: '#FFFFFF', color: '#0B0B0C' }}>
                    Listen Now
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="scene-button"
                    onClick={() => setNotifyOpen(true)}
                    disabled={signedUp}
                    style={signedUp ? TEASER_PILL : { ...PILL_STYLE, background: '#FFFFFF', color: '#0B0B0C' }}
                  >
                    {signedUp ? (
                      <>
                        <svg style={{ width: scaleValue(34), height: scaleValue(34) }} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                          <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        On the list
                      </>
                    ) : 'Notify me'}
                  </button>
                )}
                <button type="button" className="scene-button" onClick={onNext} style={TEASER_PILL}>
                  Past releases
                  <ChevronDownIcon size={scaleValue(34)} className="shrink-0" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <NotifySheet isOpen={notifyOpen} onClose={() => setNotifyOpen(false)} onDone={() => setSignedUp(true)} />
    </div>
  );
});

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
    frame: { left: 450, top: 1300, size: 696 },
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
    frame: { left: -430, top: -260, size: 754.83 },
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
    frame: { left: 520, top: -470, size: 696 },
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
    frame: { left: -150, top: 1290, size: 524.54 },
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
    frame: { left: 540, top: 1110, size: 696 },
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
  onModalStateChange,
}: {
  project: Project;
  distance: number;
  loadImages: boolean;
  onModalStateChange?: (isOpen: boolean) => void;
}) {
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
        <div className="relative" style={{ width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT }}>
          <SceneCard
            project={project}
            cover={solenyaSceneAssets.cover}
            distance={distance}
            loadImages={loadImages}
            priority
            onModalStateChange={onModalStateChange}
          />
        </div>
      </div>
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
        <div className="relative" style={{ width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT }}>
          <SceneCard
            project={project}
            cover={cautionSceneAssets.cover}
            distance={distance}
            loadImages={loadImages}
            coverPosition="center top"
            onModalStateChange={onModalStateChange}
          />
        </div>
      </div>
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
        <div className="relative" style={{ width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT }}>
          <SceneCard
            project={project}
            cover={reminderSceneAssets.cover}
            tone="dark"
            distance={distance}
            loadImages={loadImages}
          />
        </div>
      </div>
    </div>
  );
});

// Scrapwrk: the store itself, right here. Four cards fly in, turn over and float; tapping one opens
// the piece (photos, details, Buy now). The full store also lives at /scrapwrk/.
const ScrapwrkScene = React.memo(function ScrapwrkScene({ distance, loadImages }: { distance: number; loadImages: boolean }) {
  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const active = distanceMagnitude < 0.45;
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));

  // Sized to the screen rather than the portrait scene frame, so the pieces are as large as the
  // screen allows (phone to desktop) while the grid and the footer both fit.
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden pb-[132px] pt-10">
      {/* The pieces as cut-out stickers, drifting around the grid's corners (behind the cards). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
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
      </div>
      <div
        className="store-scene relative z-10"
        style={{
          opacity: 1 - (distanceMagnitude * 0.3),
          transform: `translate3d(0, ${incoming * 32}px, 0)`,
          transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease-out',
        }}
      >
        <StoreExperience
          active={active}
          sizes="(min-width: 640px) 280px, 46vw"
          headerClassName="store-scene-header"
          title={<h2 className="store-scene-title scene-title">Scrapwrk</h2>}
          titleEnd={(
            <Link href="/scrapwrk/" className="store-scene-link scene-title">
              All pieces
              <ChevronDownIcon size={16} className="-rotate-90" />
            </Link>
          )}
        />
      </div>
    </div>
  );
});

// NonParallel: the label behind all of this. Its logo (a sticker) heads the scene, a short note
// says what it is, and the tees follow in the same card system as Scrapwrk.
const NonParallelScene = React.memo(function NonParallelScene({ distance }: { distance: number }) {
  const distanceMagnitude = clamp(Math.abs(distance), 0, 1);
  const active = distanceMagnitude < 0.45;
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden pb-[132px] pt-10">
      <div aria-hidden="true" className="np-bg-logo np-bg-logo-a">
        <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="60vw" loading="lazy" draggable={false} className="h-full w-full object-contain" />
      </div>
      <div aria-hidden="true" className="np-bg-logo np-bg-logo-b">
        <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="50vw" loading="lazy" draggable={false} className="h-full w-full object-contain" />
      </div>
      <div
        className="np-scene relative z-10"
        style={{
          '--rows': merchScene.rows,
          '--row-h': merchScene.rowHeight,
          opacity: 1 - (distanceMagnitude * 0.3),
          transform: `translate3d(0, ${incoming * 32}px, 0)`,
          transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease-out',
        } as React.CSSProperties}
      >
        <MerchExperience
          active={active}
          columns={merchScene.columns}
          sizes={merchScene.columns === 3 ? '(min-width: 640px) 180px, 30vw' : '(min-width: 640px) 270px, 44vw'}
          headerClassName="np-scene-header"
          title={(
            <h2 className="np-scene-logo">
              <span className="sr-only">NonParallel</span>
              <ResponsiveImage asset={nonparallelAssets.logo} alt="" sizes="(min-width: 640px) 260px, 50vw" draggable={false} className="h-full w-full object-contain" />
            </h2>
          )}
          titleEnd={(
            <Link href="/nonparallel/" className="store-scene-link scene-title">
              All tees
              <ChevronDownIcon size={16} className="-rotate-90" />
            </Link>
          )}
          intro={<p className="np-scene-note">The label and company behind all of this. A tee is a way to support it: you get something to wear, and it keeps the work going.</p>}
        />
      </div>
    </div>
  );
});

// Page dots, as on iOS: they show there's more below, where you are, and jump anywhere.
function SceneDots({ names, activeIndex, onSelect }: { names: string[]; activeIndex: number; onSelect: (index: number) => void }) {
  return (
    <nav
      aria-label="Projects"
      className="scene-dots fixed right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center sm:right-5"
    >
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={name}
          aria-current={index === activeIndex ? 'true' : undefined}
          className="group flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <span
            aria-hidden="true"
            className={`block w-[6px] rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.3)] transition-[height,opacity] duration-300 ease-out group-hover:opacity-90 ${index === activeIndex ? 'h-[18px] opacity-95' : 'h-[6px] opacity-40'}`}
          />
        </button>
      ))}
    </nav>
  );
}

export default function HomePage() {
  const { music, fashion } = getProjects();
  const teaser = nextReleaseProject();
  const allProjects = [...(teaser ? [teaser] : []), ...[...music, ...fashion]
    .filter((project) => !HIDDEN_HOMEPAGE_PROJECTS.has(project.name))
    .sort((leftProject, rightProject) => {
      const leftIndex = HOMEPAGE_PROJECT_ORDER.indexOf(leftProject.name);
      const rightIndex = HOMEPAGE_PROJECT_ORDER.indexOf(rightProject.name);
      const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

      return safeLeftIndex - safeRightIndex;
    })];
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadDeferredScenes, setLoadDeferredScenes] = useState(false);
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

  const scrollToScene = useCallback((index: number) => {
    const container = document.querySelector('.scroll-container');
    container?.scrollTo({ top: container.clientHeight * index, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      setContainerSize(calculateContainerSize());
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);

    return () => window.removeEventListener('resize', updateLayout);
  }, [isModalOpen]);

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

      <SceneDots
        names={allProjects.map((project) => project.name)}
        activeIndex={activeIndex}
        onSelect={scrollToScene}
      />

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
            const isNonParallel = project.name === 'NonParallel';
            const distanceFromCenter = Math.abs(scrollProgress - index);
            const continuousDistance = clamp(distanceFromCenter, 0, 1.2);
            // Scene motion saturates at one screen away; clamping lets memoized far-off scenes skip re-rendering.
            const isLast = index === allProjects.length - 1;
            const sceneDistance = clamp(scrollProgress - index, -1, isLast ? 0 : 1);
            const footer = isLast ? <SiteFooter variant="overlay" /> : null;

            if (project.type === 'coming-soon') {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <ComingSoonScene distance={sceneDistance} onNext={() => scrollToScene(index + 1)} />
                  {footer}
                </div>
              );
            }

            if (isSolenya) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <SolenyaScene
                    project={project}
                    distance={sceneDistance}
                    loadImages={index === 0 || loadDeferredScenes}
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

            if (isNonParallel) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <NonParallelScene distance={sceneDistance} />
                  {footer}
                </div>
              );
            }

            if (isScrapwrk) {
              return (
                <div key={project.name} className="relative h-screen snap-center overflow-hidden">
                  <ScrapwrkScene distance={sceneDistance} loadImages={index === 0 || loadDeferredScenes} />
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
