type Box = { left: number; top: number; width: number; height: number };

// The exact ease-out used by scroll-linked cards and stickers. With x = t,
// this Bezier's y is 1 - (1 - t)^3, so CSS and WAAPI follow the same curve.
export const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
export const MOTION_EASING = 'cubic-bezier(0.333333, 1, 0.666667, 1)';
export const OPEN_MS = 420;
export const CLOSE_MS = 360;
export const CONTROL_MS = 300;
export const motionVariables = {
  '--motion-ease': MOTION_EASING,
  '--motion-open': `${OPEN_MS}ms`,
  '--motion-close': `${CLOSE_MS}ms`,
  '--motion-control': `${CONTROL_MS}ms`,
};

export function stickerFlight(box: Box, viewport: { width: number; height: number }, order: number) {
  const scale = 1.6 + (order % 3) * 0.08;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  let dx = cx - viewport.width / 2;
  let dy = cy - viewport.height / 2;
  if (Math.hypot(dx, dy) < 1) { dx = order % 2 ? 1 : -1; dy = -0.5; }
  // Use the diagonal so even a rotated, enlarged sticker clears the viewport.
  const radius = Math.hypot(box.width, box.height) * scale / 2 + 24;
  const tx = dx ? ((dx > 0 ? viewport.width + radius : -radius) - cx) / dx : Infinity;
  const ty = dy ? ((dy > 0 ? viewport.height + radius : -radius) - cy) / dy : Infinity;
  const travel = Math.max(0, Math.min(tx, ty));
  return { x: dx * travel, y: dy * travel, scale, rotate: Math.sign(dx || dy) * (7 + order % 3 * 3) };
}
