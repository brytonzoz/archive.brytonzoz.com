'use client';

// The scene engine shared by the homepage (app/page.tsx) and /shipped: the 961x1758 design frame,
// scroll-linked motion for cards and stickers, the cross-fading backgrounds and the page dots.
import React from 'react';

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
export const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

export type SceneStickerMotion = {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  fadeRate: number;
};

export type SceneStickerIntro = {
  x: number;
  y: number;
  rotate: number;
};

export type SceneStickerConfig = {
  movement: SceneStickerMotion;
  intro: SceneStickerIntro;
  baseRotate?: number;
};

export type SlideBackground = {
  base: string;
  overlay: string;
  topGlow: string;
  bottomGlow: string;
  edgeGlow: string;
};

// `order` is the sticker's place in its scene, so they don't all move as one block.
export function getSceneStickerState(sticker: SceneStickerConfig, distance: number, order = 0) {
  const baseRotate = sticker.baseRotate || 0;

  if (distance < 0) {
    // Arriving mirrors leaving (the return scroll): the card and its buttons lead, the stickers hold
    // back, then fly in quicker over the last stretch and land together as the page settles, each
    // setting off a beat apart. Their float takes over from there.
    const span = 0.36 + (((order * 3) % 5) * 0.025);
    const progress = easeOutCubic(clamp(-distance / span, 0, 1));
    const travel = progress * 1.6;

    return {
      opacity: Math.max(0, 1 - (progress * sticker.movement.fadeRate * 1.25)),
      scale: 1 - Math.min(Math.abs(distance) * sticker.movement.scale, 0.12),
      translateX: sticker.intro.x * travel,
      translateY: sticker.intro.y * travel,
      rotate: baseRotate + (sticker.intro.rotate * travel),
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

// --- Scroll-linked motion ----------------------------------------------------------------------
// Everything that moves with the scroll (cards, stickers, the store grids, the background blend)
// is set straight on its element once per frame from the scroll position: no React render and no
// CSS transition in between, so it tracks the finger exactly at the display's frame rate instead
// of easing after it (which read as lag, and as jitter when transitions restarted every event).
export type MotionStyle = { transform?: string; opacity?: number };
export type MotionFn = (distance: number) => MotionStyle;
export type MotionRegistry = { register: (index: number, apply: (distance: number) => void) => () => void };

export const MotionContext = React.createContext<MotionRegistry | null>(null);
// Which scene a component belongs to, and which scene is on screen.
export const SceneIndexContext = React.createContext(0);
export const ActiveSceneContext = React.createContext(0);
export const EntrySceneContext = React.createContext(0);

export function applyMotion(element: HTMLElement, style: MotionStyle) {
  if (style.transform !== undefined) element.style.transform = style.transform;
  if (style.opacity !== undefined) element.style.opacity = String(style.opacity);
}

// motion.ref(key, fn) is a stable callback ref that keeps the element in step with the scroll;
// motion.initial(fn) matches the entry scene before the scroll loop takes over.
export function useSceneMotion() {
  const index = React.useContext(SceneIndexContext);
  const entryIndex = React.useContext(EntrySceneContext);
  const registry = React.useContext(MotionContext);
  const fns = React.useRef(new Map<string, MotionFn>());
  const refs = React.useRef(new Map<string, (element: HTMLElement | null) => void>());
  return {
    ref(key: string, fn: MotionFn) {
      fns.current.set(key, fn);
      let callback = refs.current.get(key);
      if (!callback) {
        let off: (() => void) | undefined;
        callback = (element) => {
          off?.();
          off = undefined;
          if (element && registry) off = registry.register(index, (distance) => applyMotion(element, fns.current.get(key)!(distance)));
        };
        refs.current.set(key, callback);
      }
      return callback;
    },
    initial: (fn: MotionFn): React.CSSProperties => fn(clamp(entryIndex - index, -1, 1)),
  };
}

export const useIsActiveScene = () => React.useContext(ActiveSceneContext) === React.useContext(SceneIndexContext);

export function stickerMotion(sticker: SceneStickerConfig & { movement: SceneStickerMotion }, distance: number, order: number, alpha = 1): MotionStyle {
  const state = getSceneStickerState(sticker, distance, order);
  return {
    opacity: state.opacity * alpha,
    transform: `translate3d(${scaleValue(state.translateX)}, ${scaleValue(state.translateY)}, 0) rotate(${state.rotate}deg) scale(${state.scale})`,
  };
}

// A release card (or the teaser): eases in slightly larger than it lands, and sinks back as it leaves.
export function cardMotion(distance: number): MotionStyle {
  const outgoing = easeOutCubic(clamp((distance - 0.08) / 0.78, 0, 1));
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  const scale = distance >= 0 ? 1 - (outgoing * 0.26) : 1 - (incoming * 0.18);
  return {
    opacity: 1 - (clamp(Math.abs(distance), 0, 1) * 0.18),
    transform: `translate3d(0, ${scaleValue(outgoing * 58)}, 0) scale(${scale})`,
  };
}

// The Scrapwrk and NonParallel grids: rise into place as their scene arrives.
export function gridMotion(distance: number): MotionStyle {
  const incoming = easeOutCubic(clamp(Math.abs(Math.min(distance, 0)) / 0.9, 0, 1));
  return { opacity: 1 - (clamp(Math.abs(distance), 0, 1) * 0.3), transform: `translate3d(0, ${incoming * 32}px, 0)` };
}

export function BackgroundLayer({
  background,
  layerRef,
  visible,
}: {
  background: SlideBackground;
  layerRef: (element: HTMLDivElement | null) => void;
  visible: boolean;
}) {
  return (
    <div
      ref={layerRef}
      className="pointer-events-none fixed inset-0"
      style={{
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
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

export const SOLENYA_FRAME = {
  width: 961,
  height: 1758,
};

// Scenes are laid out in design units; --scene-unit (globals.css) fits the frame to the viewport
// in pure CSS so the first scene renders from static HTML before any JavaScript runs.
export const scaleValue = (value: number) => `calc(var(--scene-unit) * ${value})`;
export const sceneLeft = (value: number) => `calc(50% + var(--scene-unit) * ${value - (SOLENYA_FRAME.width / 2)})`;
export const sceneTop = (value: number) => `calc(50% + var(--scene-unit) * ${value - (SOLENYA_FRAME.height / 2)})`;
export const SCENE_FRAME_WIDTH = scaleValue(SOLENYA_FRAME.width);
export const SCENE_FRAME_HEIGHT = scaleValue(SOLENYA_FRAME.height);

export const SCENE_FONT = 'var(--font-inter), Inter, system-ui, sans-serif';

export const sceneImageSizes = (designWidth: number) => {
  const byHeight = ((designWidth / SOLENYA_FRAME.height) * 100).toFixed(2);
  const byWidth = ((designWidth / SOLENYA_FRAME.width) * 100).toFixed(2);
  return `(min-aspect-ratio: ${SOLENYA_FRAME.width}/${SOLENYA_FRAME.height}) ${byHeight}vh, ${byWidth}vw`;
};

export const PILL_STYLE: React.CSSProperties = {
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
export const DARK_INK = '#1E1712';
// Scenes are light or dark; text and buttons flip so they always read clearly.
export const SCENE_TONES = {
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

// Page dots, as on iOS: they show there's more below, where you are, and jump anywhere.
// `dark` draws them in ink for a light scene (/shipped's Pocket Factory), where white would vanish.
export function SceneDots({ names, activeIndex, onSelect, hidden, label = 'Projects', dark = false }: { names: string[]; activeIndex: number; onSelect: (index: number) => void; hidden?: boolean; label?: string; dark?: boolean }) {
  return (
    <nav
      aria-label={label}
      className={`scene-dots fixed right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center transition-opacity duration-300 sm:right-5 ${hidden ? 'pointer-events-none opacity-0' : ''}`}
      aria-hidden={hidden || undefined}
    >
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect(index)}
          // Hidden dots (below the last scene) are out of the tab order too, not just invisible.
          tabIndex={hidden ? -1 : undefined}
          aria-label={name}
          aria-current={index === activeIndex ? 'true' : undefined}
          className="group flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          <span
            aria-hidden="true"
            className={`block w-[6px] rounded-full ${dark ? 'bg-[#15170F] shadow-[0_0_0_0.5px_rgba(255,255,255,0.3)]' : 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.3)]'} transition-[height,opacity,background-color] duration-300 ease-out group-hover:opacity-90 ${index === activeIndex ? 'h-[18px] opacity-95' : `h-[6px] ${dark ? 'opacity-30' : 'opacity-40'}`}`}
          />
        </button>
      ))}
    </nav>
  );
}
