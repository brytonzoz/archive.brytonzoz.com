'use client';

// A counter receipt printer (Epson TM-T88 style): the printer sits at the bottom, the paper rises out of its
// top slot line by line, header first, its free end curling back like paper off a roll. Pull the paper and
// it tears tooth by tooth along the serrated bar, drops into your hands below the printer, and can be balled
// up and thrown onto the receipt pile. React renders the parts once; engine.ts moves them.
import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { receiptToDoc } from '../thermal/layout';
import type { ThermalReceipt } from '../thermal/types';
import { click, crumple, motorOff, motorOn, rip, tick, uncrumple, useSound, whoosh } from '../thermal/sfx';
import { useCrumpleToss } from '../thermal/toss';
import { PrintEngine, SLICES, prefersReducedMotion, type EngineElements, type EngineHooks, type PrintPhase, type PrintSounds } from './engine';
import styles from './PrintAndTear.module.css';

export type { PrintPhase, PrintSounds };

export type PrintAndTearProps = {
  receipt: ThermalReceipt;
  /** Print as soon as it mounts, and again whenever receipt.id changes. Default true. */
  autoStart?: boolean;
  /** 1 = a 2.5-6 s job depending on length. */
  speed?: number;
  /** Replace any of the sound hooks, or false for silence. Defaults are thermal/sfx.ts (silent until SND is on). */
  sounds?: Partial<PrintSounds> | false;
  onLine?(index: number): void;
  onPrinted?(): void;
  /** The torn receipt has landed in the hands zone. */
  onTorn?(): void;
  onTossed?(landedOnPile: boolean): void;
  /** Offer CRUMPLE & TOSS and the flick. Default: a pile is mounted on the page (useCrumpleToss().available). */
  tossable?: boolean;
  /** Force reduced motion on or off; default follows prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** Accessible name of the printer. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
};

export type PrintAndTearHandle = {
  /** Print the current receipt (again); a receipt still out is set aside first. */
  print(): void;
  /** Tear the printed receipt off (a quick automatic tear). */
  tear(): void;
  /** Ball up the receipt in hand and throw it at the pile (tears it off first if needed). */
  crumpleAndToss(): void;
};

const SILENT: PrintSounds = {
  feedStart() {},
  line() {},
  feedStop() {},
  tearStart() {},
  tear() {},
  crumple() {},
  toss() {},
};

export const DEFAULT_SOUNDS: PrintSounds = {
  feedStart: motorOn,
  line: (_index, band) => {
    if (band.kind !== 'feed') tick();
  },
  feedStop: motorOff,
  // Fibres stretching over the teeth before they give.
  tearStart: () => uncrumple(0.12),
  tear: rip,
  crumple: () => crumple(0.38),
  toss: whoosh,
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const STATUS: Record<PrintPhase, string> = {
  idle: '',
  loading: '',
  printing: 'Printing',
  hanging: 'Printed. Pull the paper or press Tear.',
  falling: 'Torn off.',
  inhand: 'Torn off.',
  tossing: '',
  tossed: 'Tossed.',
};

type ListKeys = 'slices' | 'fronts' | 'backs' | 'frontShades' | 'backShades' | 'frontRamps' | 'backRamps';
type Refs = Partial<Omit<EngineElements, ListKeys>> & Pick<EngineElements, ListKeys>;

/** One slice of the curl; the next slice hangs off its top edge, so the rotations add up. */
function Slice({ k, refs }: { k: number; refs: Refs }) {
  return (
    <div
      className={styles.slice}
      ref={(node) => {
        if (node) refs.slices[k] = node;
      }}
    >
      <div
        className={`${styles.face} ${styles.sliceFace}`}
        ref={(node) => {
          if (node) refs.fronts[k] = node;
        }}
      >
        <span
          className={styles.shade}
          ref={(node) => {
            if (node) refs.frontShades[k] = node;
          }}
        />
        <span
          className={styles.ramp}
          ref={(node) => {
            if (node) refs.frontRamps[k] = node;
          }}
        />
      </div>
      <div
        className={`${styles.face} ${styles.sliceFace} ${styles.sliceBack}`}
        ref={(node) => {
          if (node) refs.backs[k] = node;
        }}
      >
        <span
          className={styles.shade}
          ref={(node) => {
            if (node) refs.backShades[k] = node;
          }}
        />
        <span
          className={`${styles.ramp} ${styles.rampDown}`}
          ref={(node) => {
            if (node) refs.backRamps[k] = node;
          }}
        />
      </div>
      {k + 1 < SLICES ? <Slice k={k + 1} refs={refs} /> : null}
    </div>
  );
}

export const PrintAndTear = forwardRef<PrintAndTearHandle, PrintAndTearProps>(function PrintAndTear(props, ref) {
  const { receipt, autoStart = true, speed = 1, sounds, tossable, reducedMotion, label, className, style } = props;
  const doc = useMemo(() => receiptToDoc(receipt), [receipt]);
  const [phase, setPhase] = useState<PrintPhase>('idle');
  const [landed, setLanded] = useState<boolean | null>(null);
  const [sound, toggleSound] = useSound();
  const [mediaReduced, setMediaReduced] = useState(false);
  const textId = useId();
  const pile = useCrumpleToss();
  const canToss = tossable ?? pile.available;
  const reduced = reducedMotion ?? mediaReduced;

  const engine = useRef<PrintEngine | null>(null);
  const refs = useRef<Refs>({
    slices: [],
    fronts: [],
    backs: [],
    frontShades: [],
    backShades: [],
    frontRamps: [],
    backRamps: [],
  }).current;

  // The engine always reads the latest props through these.
  const latest = useRef({ props, sounds: SILENT, reduced, canToss, speed, pile });
  latest.current = {
    props,
    sounds: sounds === false ? SILENT : { ...DEFAULT_SOUNDS, ...(sounds ?? {}) },
    reduced,
    canToss,
    speed,
    pile,
  };

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMediaReduced(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  useIsoLayoutEffect(() => {
    const r = refs;
    if (!r.root || !r.frame || !r.guide || !r.back || !r.front || !r.bar || !r.blade || !r.slot || !r.hands || !r.stubLayer || !r.stub || !r.paperLayer || !r.sheet || !r.shadow || !r.body || !r.foot || !r.ink || !r.tint || !r.grip || !r.ring || !r.curl) return;
    const hooks: EngineHooks = {
      sounds: () => latest.current.sounds,
      reduced: () => latest.current.reduced || (latest.current.props.reducedMotion === undefined && prefersReducedMotion()),
      tossable: () => latest.current.canToss,
      speed: () => latest.current.speed,
      target: () => latest.current.pile.target(),
      bounds: () => latest.current.pile.bounds(),
      reveal: () => latest.current.pile.reveal(),
      toss: (payload) => latest.current.pile.toss(payload),
      phase: (next, didLand) => {
        setPhase(next);
        if (next === 'tossed') setLanded(Boolean(didLand));
        else setLanded(null);
      },
      line: (index) => latest.current.props.onLine?.(index),
      printed: () => latest.current.props.onPrinted?.(),
      torn: () => latest.current.props.onTorn?.(),
      tossed: (didLand) => latest.current.props.onTossed?.(didLand),
    };
    const created = new PrintEngine(r as EngineElements, hooks);
    engine.current = created;
    return () => {
      created.destroy();
      engine.current = null;
    };
    // The engine lives as long as the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new receipt: load it, and print it unless the page will ask.
  const latestDoc = useRef(doc);
  latestDoc.current = doc;
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.load(latest.current.props.receipt, latestDoc.current);
    if (latest.current.props.autoStart ?? true) e.print();
  }, [receipt.id]);

  useEffect(() => {
    engine.current?.load(receipt, doc);
  }, [receipt, doc]);

  useImperativeHandle(
    ref,
    () => ({
      print: () => engine.current?.print(),
      tear: () => engine.current?.tear(),
      crumpleAndToss: () => engine.current?.crumpleAndToss(),
    }),
    [],
  );

  const hanging = phase === 'hanging';
  const inHand = phase === 'inhand';
  const feedable = phase === 'hanging' || phase === 'idle' || phase === 'tossed';
  const tone = phase === 'printing' || phase === 'loading' ? 'busy' : 'ready';
  const status = phase === 'tossed' ? (landed ? 'Tossed onto the pile.' : 'Tossed.') : STATUS[phase];
  const paperLabel =
    phase === 'printing'
      ? 'Receipt, printing'
      : hanging
        ? 'Receipt, printed. Press Enter to tear it off.'
        : phase === 'inhand' || phase === 'falling'
          ? 'Torn receipt, in hand'
          : 'Receipt';

  return (
    <div
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      style={style}
      role="group"
      aria-label={label ?? 'Receipt printer'}
      data-phase={phase}
      data-tone={tone}
      ref={(node) => {
        if (node) refs.root = node;
      }}
    >
      <div
        className={styles.frame}
        ref={(node) => {
          if (node) refs.frame = node;
        }}
      >
        <span
          className={styles.guide}
          aria-hidden="true"
          ref={(node) => {
            if (node) refs.guide = node;
          }}
        />
        <div className={styles.stage} aria-hidden="true" />

        <div className={styles.printer}>
          <div
            className={styles.back}
            aria-hidden="true"
            ref={(node) => {
              if (node) refs.back = node;
            }}
          >
            <span
              className={styles.slot}
              ref={(node) => {
                if (node) refs.slot = node;
              }}
            />
          </div>
          <div
            className={styles.front}
            ref={(node) => {
              if (node) refs.front = node;
            }}
          >
            <span
              className={styles.bar}
              aria-hidden="true"
              ref={(node) => {
                if (node) refs.bar = node;
              }}
            >
              <span className={styles.mouth} />
              <span
                className={styles.blade}
                ref={(node) => {
                  if (node) refs.blade = node;
                }}
              />
            </span>
            <div className={styles.lip} aria-hidden="true" />
            <div className={styles.fascia}>
              <div className={styles.panel} aria-hidden="true">
                <span className={styles.led} />
                <span className={styles.ledLabel}>{tone === 'busy' ? 'PRINTING' : 'READY'}</span>
                <span className={styles.plate}>BZ-80</span>
              </div>
              <div className={styles.keys}>
                <button
                  type="button"
                  className={styles.key}
                  aria-disabled={!feedable}
                  aria-label="Feed paper"
                  onClick={() => {
                    if (!feedable) return;
                    click();
                    engine.current?.feed();
                  }}
                >
                  FEED
                </button>
                <button
                  type="button"
                  className={styles.key}
                  aria-pressed={sound}
                  aria-label={sound ? 'Sound on. Turn printer sound off' : 'Sound off. Turn printer sound on'}
                  onClick={toggleSound}
                >
                  <span aria-hidden="true">{sound ? 'SND ON' : 'SND OFF'}</span>
                </button>
                {inHand && canToss ? (
                  <button
                    type="button"
                    className={`${styles.key} ${styles.action}`}
                    onClick={() => {
                      click();
                      engine.current?.crumpleAndToss();
                    }}
                  >
                    CRUMPLE &amp; TOSS
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${styles.key} ${styles.action}`}
                    aria-disabled={!hanging}
                    onClick={() => {
                      if (!hanging) return;
                      click();
                      engine.current?.tear();
                    }}
                  >
                    TEAR
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          className={styles.hands}
          aria-hidden="true"
          ref={(node) => {
            if (node) refs.hands = node;
          }}
        />

        <div
          className={styles.stubLayer}
          aria-hidden="true"
          ref={(node) => {
            if (node) refs.stubLayer = node;
          }}
        >
          <div
            className={styles.stub}
            ref={(node) => {
              if (node) refs.stub = node;
            }}
          />
        </div>

        <div
          className={styles.paperLayer}
          ref={(node) => {
            if (node) refs.paperLayer = node;
          }}
        >
          <div
            className={styles.sheet}
            tabIndex={hanging || inHand ? 0 : -1}
            role={hanging ? 'button' : 'img'}
            aria-label={paperLabel}
            aria-describedby={textId}
            ref={(node) => {
              if (node) refs.sheet = node;
            }}
          >
            <span
              className={styles.shadow}
              aria-hidden="true"
              ref={(node) => {
                if (node) refs.shadow = node;
              }}
            />
            <div
              className={`${styles.face} ${styles.body}`}
              ref={(node) => {
                if (node) refs.body = node;
              }}
            >
              <div
                className={styles.ink}
                ref={(node) => {
                  if (node) refs.ink = node;
                }}
              />
              <span
                className={styles.shade}
                ref={(node) => {
                  if (node) refs.tint = node;
                }}
              />
            </div>
            <div
              className={`${styles.face} ${styles.foot}`}
              ref={(node) => {
                if (node) refs.foot = node;
              }}
            />
            <span
              className={styles.grip}
              aria-hidden="true"
              ref={(node) => {
                if (node) refs.grip = node;
              }}
            />
            <span
              className={styles.ring}
              aria-hidden="true"
              ref={(node) => {
                if (node) refs.ring = node;
              }}
            />
            <div
              className={styles.curl}
              ref={(node) => {
                if (node) refs.curl = node;
              }}
            >
              <Slice k={0} refs={refs} />
            </div>
          </div>
        </div>
      </div>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {status}
      </p>
      <p className={styles.srOnly} id={textId}>
        {doc.text}
      </p>
    </div>
  );
});
