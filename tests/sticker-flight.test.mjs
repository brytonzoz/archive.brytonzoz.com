import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stickerFlight } from '../lib/scene-motion.ts';

// Catch a foreground sticker growing but stopping inside the viewport, including
// rotation, centred artwork, and a source already partly outside the screen.
for (const [name, viewport, box] of [
  ['phone upper left', { width: 390, height: 844 }, { left: -30, top: 100, width: 140, height: 140 }],
  ['phone lower right', { width: 390, height: 844 }, { left: 270, top: 600, width: 170, height: 170 }],
  ['desktop centre', { width: 1363, height: 936 }, { left: 581.5, top: 368, width: 200, height: 200 }],
  ['wide artwork', { width: 390, height: 844 }, { left: 20, top: 390, width: 350, height: 70 }],
]) {
  test(`${name} grows and clears the frame`, () => {
    const flight = stickerFlight(box, viewport, 2);
    assert.ok(flight.scale > 1, 'foreground artwork must grow');
    assert.ok([flight.x, flight.y, flight.scale, flight.rotate].every(Number.isFinite));
    const radius = Math.hypot(box.width, box.height) * flight.scale / 2;
    const x = box.left + box.width / 2 + flight.x;
    const y = box.top + box.height / 2 + flight.y;
    assert.ok(x + radius < 0 || x - radius > viewport.width || y + radius < 0 || y - radius > viewport.height,
      'even the rotated artwork must be outside the frame at the end');
  });
}
