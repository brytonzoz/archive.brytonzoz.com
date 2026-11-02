'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ResponsiveImage, placeholderBackground } from '../ResponsiveImage';
import { SiteFooter } from '../SiteFooter';
import { ArrowUpRightIcon } from '../player/icons';
import { shippedSceneAssets } from '../../lib/assets';
import type { MediaAsset } from '../../lib/media';
import { SHIPPED_AS_OF, SHIPPED_PROJECTS, formatAsOf, formatStat, shippedTotal, type ShippedProject } from '../../lib/shipped';
import {
  ActiveSceneContext,
  BackgroundLayer,
  EntrySceneContext,
  MotionContext,
  SCENE_FONT,
  SCENE_FRAME_HEIGHT,
  SCENE_FRAME_WIDTH,
  SCENE_TONES,
  SceneDots,
  SceneIndexContext,
  cardMotion,
  clamp,
  scaleValue,
  sceneImageSizes,
  useIsActiveScene,
  useSceneMotion,
  type MotionRegistry,
} from '../scenes/kit';
import { SceneStickers, type SceneSticker } from '../scenes/SceneStickers';
import { Odometer } from './Odometer';

// The card sits at (120, CARD_TOP) in the 961x1758 scene frame, 722 wide; its cover is the first 722.
const CARD_TOP = 214;

// Each product's icon is its cover, and its own art floats around it (the same cut-outs its site
// and App Store page use), placed like the homepage's scenes: around the corners, a few over the
// card's edge.
const pf = shippedSceneAssets.pocketFactory;
const mk = shippedSceneAssets.mopkin;

const COVERS: Record<string, MediaAsset> = {
  'pocket-factory': pf.cover,
  mopkin: mk.cover,
};

const STICKERS: Record<string, SceneSticker[]> = {
  'pocket-factory': [
    {
      key: 'card-lime',
      src: pf.cardLime,
      alt: 'Lime Pocket Factory card',
      frame: { left: -372, top: -236, size: 700 },
      zIndex: 4,
      baseRotate: -17,
      movement: { x: -70, y: -112, rotate: -7, scale: 0.06, fadeRate: 0.95 },
      float: { x: -8, y: -10, rotate: -2.2, duration: '8.6s', delay: '0.1s' },
      intro: { x: -170, y: -130, rotate: -12, delay: '0.12s' },
    },
    {
      key: 'card-black',
      src: pf.cardBlack,
      alt: 'Black Pocket Factory card',
      frame: { left: 548, top: -300, size: 700 },
      zIndex: 4,
      baseRotate: 19,
      movement: { x: 76, y: -120, rotate: 6, scale: 0.06, fadeRate: 0.95 },
      float: { x: 9, y: -9, rotate: 2, duration: '9.2s', delay: '0.5s' },
      intro: { x: 170, y: -140, rotate: 12, delay: '0.18s' },
    },
    {
      key: 'tap-badge',
      src: pf.tapBadge,
      alt: 'Tap + QR sticker',
      frame: { left: 642, top: 452, size: 290 },
      zIndex: 25,
      baseRotate: 12,
      movement: { x: 60, y: -96, rotate: 12, scale: 0.08, fadeRate: 1.15 },
      float: { x: 8, y: -8, rotate: 5, duration: '6.4s', delay: '0.8s' },
      intro: { x: 150, y: -30, rotate: 18, delay: '0.34s' },
    },
    {
      key: 'card-back',
      src: pf.cardBack,
      alt: 'Back of a card: tap phone, or scan the QR code',
      frame: { left: -430, top: 1330, size: 800 },
      zIndex: 5,
      baseRotate: -13,
      movement: { x: -72, y: 118, rotate: 5, scale: 0.08, fadeRate: 1.04 },
      float: { x: -8, y: -10, rotate: -1.8, duration: '8.9s', delay: '0.26s' },
      intro: { x: -180, y: 168, rotate: 10, delay: '0.36s' },
    },
    {
      key: 'card-front',
      src: pf.cardFront,
      alt: 'Front of a card with your logo',
      frame: { left: 486, top: 1350, size: 800 },
      zIndex: 5,
      baseRotate: 9,
      movement: { x: 78, y: 130, rotate: -4, scale: 0.08, fadeRate: 1.08 },
      float: { x: 9, y: -9, rotate: 1.8, duration: '8.2s', delay: '0.62s' },
      intro: { x: 160, y: 176, rotate: -10, delay: '0.44s' },
    },
  ],
  mopkin: [
    {
      key: 'magnify',
      src: mk.magnify,
      alt: 'Mopkin with a magnifying glass',
      frame: { left: -282, top: -10, size: 470 },
      zIndex: 18,
      baseRotate: -8,
      movement: { x: -82, y: -116, rotate: -8, scale: 0.06, fadeRate: 0.95 },
      float: { x: -8, y: -9, rotate: -2.4, duration: '7.8s', delay: '0.1s' },
      intro: { x: -180, y: -120, rotate: -12, delay: '0.12s' },
    },
    {
      // Peeks over the top of the cover, hands on its edge (the art's ledge is 80% down).
      key: 'peek',
      src: mk.peek,
      alt: 'Mopkin peeking over the card',
      frame: { left: 470, top: CARD_TOP - 240, size: 300 },
      zIndex: 12,
      movement: { x: 30, y: -120, rotate: 6, scale: 0.05, fadeRate: 1.1 },
      float: { x: 0, y: 0, rotate: 0, duration: '8s', delay: '0s' },
      intro: { x: 0, y: -160, rotate: 0, delay: '0.5s' },
    },
    {
      key: 'phone',
      src: mk.phone,
      alt: 'Mopkin on an iPhone: pick up the clothes on the floor',
      frame: { left: 640, top: 380, size: 780 },
      zIndex: 4,
      baseRotate: 11,
      movement: { x: 84, y: -60, rotate: 6, scale: 0.06, fadeRate: 0.95 },
      float: { x: 8, y: -12, rotate: 1.6, duration: '9.4s', delay: '0.4s' },
      intro: { x: 190, y: -40, rotate: 12, delay: '0.2s' },
    },
    {
      key: 'wave',
      src: mk.wave,
      alt: 'Mopkin waving',
      frame: { left: -236, top: 1380, size: 600 },
      zIndex: 5,
      baseRotate: 6,
      movement: { x: -70, y: 122, rotate: -5, scale: 0.08, fadeRate: 1.04 },
      float: { x: -7, y: -12, rotate: -2, duration: '7.2s', delay: '0.3s' },
      intro: { x: -170, y: 170, rotate: -10, delay: '0.38s' },
    },
    {
      key: 'happy',
      src: mk.happy,
      alt: 'Happy Mopkin',
      frame: { left: 668, top: 1476, size: 300 },
      zIndex: 5,
      baseRotate: -6,
      movement: { x: 78, y: 130, rotate: 5, scale: 0.08, fadeRate: 1.08 },
      float: { x: 8, y: -10, rotate: 2.4, duration: '6.6s', delay: '0.7s' },
      intro: { x: 160, y: 176, rotate: 10, delay: '0.46s' },
    },
  ],
};

function AppleIcon({ size }: { size: string }) {
  return (
    <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M16.37 12.68c-.02-2.26 1.85-3.35 1.93-3.4-1.05-1.54-2.69-1.75-3.27-1.77-1.39-.14-2.72.82-3.42.82-.71 0-1.8-.8-2.96-.78-1.52.02-2.92.89-3.71 2.25-1.58 2.74-.4 6.8 1.14 9.02.75 1.09 1.65 2.31 2.82 2.27 1.13-.05 1.56-.73 2.93-.73 1.36 0 1.75.73 2.95.71 1.22-.02 1.99-1.11 2.73-2.2.86-1.26 1.22-2.49 1.24-2.55-.03-.01-2.37-.91-2.38-3.64ZM14.13 6.04c.62-.76 1.04-1.8.93-2.84-.9.04-1.98.6-2.62 1.35-.58.66-1.08 1.73-.95 2.75 1 .08 2.02-.51 2.64-1.26Z" />
    </svg>
  );
}

// The product itself: its art, its name, the numbers, and the one way in.
function ShippedCard({ project, cover, loadImages, priority }: { project: ShippedProject; cover: MediaAsset; loadImages: boolean; priority: boolean }) {
  const motion = useSceneMotion();
  const active = useIsActiveScene();
  const index = React.useContext(SceneIndexContext);
  const entry = React.useContext(EntrySceneContext) === index;
  // The numbers roll in the first time their scene comes on screen, then stay put.
  const [revealed, setRevealed] = useState(entry);
  useEffect(() => {
    if (active) setRevealed(true);
  }, [active]);

  const colors = SCENE_TONES[project.tone];
  const hairline = project.tone === 'light' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(18, 18, 14, 0.14)';
  const titleShadow = project.tone === 'light' ? 'scene-title' : undefined;

  return (
    <div
      className="absolute solenya-card-enter"
      style={{ left: scaleValue(120), top: scaleValue(CARD_TOP), width: scaleValue(722), zIndex: 10, animationDelay: '0.14s' }}
    >
      <div
        className="scene-card"
        ref={motion.ref('card', cardMotion)}
        style={{ ...motion.initial(cardMotion), transformOrigin: 'center center', willChange: 'transform' }}
      >
        {/* Tapping the art does what the button does (as the homepage's album art opens its player);
            the button is the one link for keyboards and screen readers. */}
        <a
          href={project.action.href}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden="true"
          className="scene-cover relative block w-full overflow-hidden"
          style={{ aspectRatio: '1 / 1', borderRadius: scaleValue(34), ...placeholderBackground(cover) }}
        >
          {loadImages ? (
            <ResponsiveImage
              asset={cover}
              alt=""
              sizes={sceneImageSizes(722)}
              priority={priority}
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
            />
          ) : null}
        </a>

        <div className="flex items-center justify-between" style={{ marginTop: scaleValue(52), gap: scaleValue(24) }}>
          <h2
            className={`text-balance ${titleShadow ?? ''}`}
            style={{ margin: 0, fontFamily: SCENE_FONT, fontSize: scaleValue(62), lineHeight: 1.08, fontWeight: 650, letterSpacing: '-0.035em', color: colors.ink }}
          >
            {project.name}
          </h2>
          <span
            className="inline-flex shrink-0 items-center"
            style={{
              gap: scaleValue(12),
              height: scaleValue(54),
              padding: `0 ${scaleValue(22)}`,
              borderRadius: 999,
              background: project.tone === 'light' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(18, 18, 14, 0.07)',
              boxShadow: `inset 0 0 0 1px ${hairline}`,
              fontFamily: SCENE_FONT,
              fontSize: scaleValue(27),
              fontWeight: 600,
              color: colors.ink,
            }}
          >
            <span aria-hidden="true" className="live-dot rounded-full" style={{ width: scaleValue(15), height: scaleValue(15), background: '#30D158' }} />
            Live
          </span>
        </div>
        <p
          className={titleShadow}
          style={{ margin: `${scaleValue(10)} 0 0`, fontFamily: SCENE_FONT, fontSize: scaleValue(34), lineHeight: 1.2, fontWeight: 500, color: colors.muted }}
        >
          {project.kind} · {project.year}
        </p>

        <dl
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${project.stats.length}, minmax(0, 1fr))`,
            marginTop: scaleValue(40),
            paddingTop: scaleValue(34),
            borderTop: `1px solid ${hairline}`,
          }}
        >
          {project.stats.map((stat, statIndex) => (
            <div
              key={stat.label}
              className="flex min-w-0 flex-col-reverse"
              style={{ paddingLeft: statIndex ? scaleValue(28) : 0, borderLeft: statIndex ? `1px solid ${hairline}` : undefined }}
            >
              <dt
                className={`truncate ${titleShadow ?? ''}`}
                style={{ marginTop: scaleValue(12), fontFamily: SCENE_FONT, fontSize: scaleValue(29), lineHeight: 1.2, fontWeight: 500, color: colors.muted }}
              >
                {stat.label}
              </dt>
              <dd
                className={`tabular-nums ${titleShadow ?? ''}`}
                style={{ margin: 0, fontFamily: SCENE_FONT, fontSize: scaleValue(64), lineHeight: 1, fontWeight: 650, letterSpacing: '-0.03em', color: colors.ink }}
              >
                <Odometer value={formatStat(stat)} on={revealed} entry={entry} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex" style={{ gap: scaleValue(20), marginTop: scaleValue(48) }}>
          <a href={project.action.href} target="_blank" rel="noopener noreferrer" className="scene-button" style={colors.primary}>
            {project.action.icon === 'apple' ? <AppleIcon size={scaleValue(40)} /> : null}
            {project.action.label}
            {project.action.icon === 'arrow' ? <ArrowUpRightIcon size={scaleValue(34)} className="shrink-0" /> : null}
          </a>
        </div>
      </div>
    </div>
  );
}

const ShippedScene = React.memo(function ShippedScene({ project, loadImages, priority }: { project: ShippedProject; loadImages: boolean; priority: boolean }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <SceneStickers stickers={STICKERS[project.slug] ?? []} loadImages={loadImages} />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: SCENE_FRAME_WIDTH, height: SCENE_FRAME_HEIGHT }}>
          <ShippedCard project={project} cover={COVERS[project.slug]} loadImages={loadImages} priority={priority} />
        </div>
      </div>
    </div>
  );
});

// Below the scenes the page scrolls freely: everything added up, each product on one line, the footer.
function ShippedTotals({ revealed, loadImages }: { revealed: boolean; loadImages: boolean }) {
  const revenue = shippedTotal('revenue');
  const people = shippedTotal('people');
  const tiles = [
    { label: 'Revenue', value: formatStat({ value: revenue, format: 'usd' }) },
    { label: 'Customers & users', value: formatStat({ value: people, format: 'count' }) },
    { label: 'Products live', value: formatStat({ value: SHIPPED_PROJECTS.length, format: 'count' }) },
  ];

  return (
    <div className="mx-auto max-w-[1120px] px-5 pt-24 sm:px-8 sm:pt-28">
      <h2 className="text-[40px] font-bold leading-none tracking-[-0.035em] text-white sm:text-[56px]">Shipped</h2>
      <p className="mt-3 text-[15px] text-white/50">As of {formatAsOf(SHIPPED_AS_OF)}</p>
      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {tiles.map((tile, index) => (
          <div
            key={tile.label}
            className={`shipped-tile flex flex-col-reverse rounded-[22px] p-5 sm:p-6${index === 0 ? ' col-span-2 sm:col-span-1' : ''}`}
          >
            <dt className="mt-2 text-[13px] font-medium text-white/55 sm:text-[14px]">{tile.label}</dt>
            <dd className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-white tabular-nums sm:text-[48px]">
              <Odometer value={tile.value} on={revealed} />
            </dd>
          </div>
        ))}
      </dl>

      <ul className="mt-10 border-t border-white/[0.08]">
        {SHIPPED_PROJECTS.map((project) => (
          <li key={project.slug} className="border-b border-white/[0.08]">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 sm:gap-5 sm:py-5"
            >
              <span
                className="tile-cover relative block h-12 w-12 shrink-0 overflow-hidden rounded-[12px] sm:h-14 sm:w-14 sm:rounded-[14px]"
                style={placeholderBackground(COVERS[project.slug])}
              >
                {/* Two screens down is inside the browser's lazy-load distance, so wait for the scenes' own art. */}
                {loadImages ? (
                  <ResponsiveImage asset={COVERS[project.slug]} alt="" sizes="56px" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold text-white sm:text-[17px]">{project.name}</span>
                <span className="block truncate text-[13px] text-white/50 sm:text-[14px]">
                  {project.kind} · {project.year}
                </span>
              </span>
              <ArrowUpRightIcon size={18} className="shrink-0 text-white/40 transition-colors group-hover:text-white" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShippedScenes() {
  const projects = SHIPPED_PROJECTS;
  const sceneCount = projects.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadDeferredScenes, setLoadDeferredScenes] = useState(false);
  const [totalsRevealed, setTotalsRevealed] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const motionUpdaters = useRef(new Map<number, Set<(distance: number) => void>>());
  const lastDistances = useRef(new Map<number, number>());
  const progressRef = useRef(0);
  const backgroundLayers = useRef<(HTMLDivElement | null)[]>([]);
  const motionRegistry = useMemo<MotionRegistry>(() => ({
    register(index, apply) {
      const set = motionUpdaters.current.get(index) ?? new Set();
      motionUpdaters.current.set(index, set);
      set.add(apply);
      apply(clamp(progressRef.current - index, -1, 1));
      return () => { set.delete(apply); };
    },
  }), []);

  const scrollToScene = useCallback((index: number) => {
    const container = scrollContainerRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container?.scrollTo({ top: container.clientHeight * index, behavior: reducedMotion ? 'instant' : 'smooth' });
  }, []);

  // Only the first scene's art is in the initial HTML; the rest loads once that has finished.
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
    if (activeIndex >= sceneCount) setTotalsRevealed(true);
  }, [activeIndex, sceneCount]);

  // One pass per display frame, as on the homepage: read the scroll position once, then move every
  // registered card and sticker and cross-fade the backgrounds.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight || 1;
      const progress = Math.min(scrollTop / containerHeight, sceneCount);
      progressRef.current = progress;

      motionUpdaters.current.forEach((updaters, index) => {
        const distance = clamp(progress - index, -1, 1);
        if (lastDistances.current.get(index) === distance) return;
        lastDistances.current.set(index, distance);
        updaters.forEach((apply) => apply(distance));
      });

      const backgroundProgress = clamp(progress, 0, sceneCount - 1);
      backgroundLayers.current.forEach((layer, index) => {
        if (!layer) return;
        const opacity = index === 0 ? 1 : clamp(backgroundProgress - index + 1, 0, 1);
        const covered = index + 1 < backgroundLayers.current.length && backgroundProgress >= index + 1;
        layer.style.opacity = String(opacity);
        layer.style.visibility = opacity > 0 && !covered ? 'visible' : 'hidden';
      });

      // The totals below the last scene scroll freely (no snapping), like the homepage's shop.
      const totals = document.getElementById('totals');
      container.classList.toggle('is-free', Boolean(totals) && scrollTop >= (totals?.offsetTop ?? Infinity) - 2);
      if (progress > 0.01) setLoadDeferredScenes(true);

      const newIndex = Math.min(Math.round(scrollTop / containerHeight), sceneCount);
      setActiveIndex((current) => (newIndex !== current && newIndex >= 0 ? newIndex : current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [sceneCount]);

  const sceneClass = (index: number) =>
    `scene-wrap relative h-screen snap-center overflow-hidden${Math.abs(index - activeIndex) > 1 ? ' scene-still' : ''}`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <h1 className="sr-only">Shipped: products built by Bryton Zoz</h1>
      <div className="fixed inset-0 bg-black" />
      {projects.map((project, index) => (
        <BackgroundLayer
          key={project.slug}
          background={project.background}
          visible={index === 0}
          layerRef={(element) => { backgroundLayers.current[index] = element; }}
        />
      ))}
      <div className="solenya-gradient-reveal pointer-events-none fixed inset-0 z-[1] bg-black" />

      <Link href="/" className="shipped-home glass-capsule fixed z-40 inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold text-white">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Bryton Zoz
      </Link>

      <SceneDots
        label="Shipped"
        names={[...projects.map((project) => project.name), 'Totals']}
        activeIndex={activeIndex}
        onSelect={scrollToScene}
        hidden={activeIndex >= sceneCount}
        dark={projects[activeIndex]?.tone === 'dark'}
      />

      <EntrySceneContext.Provider value={0}>
        <MotionContext.Provider value={motionRegistry}>
          <ActiveSceneContext.Provider value={activeIndex}>
            <div ref={scrollContainerRef} className="scroll-container relative z-10 h-screen snap-y snap-mandatory overflow-y-auto scroll-smooth">
              {projects.map((project, index) => (
                <SceneIndexContext.Provider key={project.slug} value={index}>
                  <section aria-label={project.name} className={sceneClass(index)}>
                    <ShippedScene project={project} loadImages={index === 0 || loadDeferredScenes} priority={index === 0} />
                  </section>
                </SceneIndexContext.Provider>
              ))}

              <section
                id="totals"
                aria-label="Totals"
                className={`shop-section shop-section-home relative min-h-screen snap-start${activeIndex < sceneCount - 1 ? ' scene-still' : ''}`}
              >
                <ShippedTotals revealed={totalsRevealed} loadImages={loadDeferredScenes} />
                <SiteFooter />
              </section>
            </div>
          </ActiveSceneContext.Provider>
        </MotionContext.Provider>
      </EntrySceneContext.Provider>
    </div>
  );
}
