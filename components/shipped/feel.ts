// Press feedback and a light haptic when the device supports it. Reduced-motion skips the buzz.
// PRINT/TEAR are the two mechanical actions — they get a heavier pulse than a key tap.

import { allowSound } from './sound';

export function tap(ms: number | number[] = 8): void {
  allowSound();
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* some browsers throw if vibration is blocked */
  }
}

/** pointerdown haptic for buttons; pair with CSS :active depth. */
export const press = () => tap(8);
/** PRINT: one firm thump on the same frame as the key depresses. */
export const pressPrint = () => tap(14);
/** TEAR: two pulses, like fibres giving way. */
export const pressTear = () => tap([10, 18, 22]);
/** One printed line: a near-imperceptible tick, same frame as the head. */
export const pressTick = () => tap(4);
