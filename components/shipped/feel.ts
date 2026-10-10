// Press feedback and a light haptic when the device supports it. Reduced-motion skips the buzz.

import { allowSound } from './sound';

export function tap(ms = 8): void {
  allowSound();
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* some browsers throw if vibration is blocked */
  }
}

/** pointerdown haptic for buttons; pair with CSS :active scale. */
export const press = () => tap(8);
