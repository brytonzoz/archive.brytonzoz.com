import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atkinson, logoPlacement, markSurvives } from '../lib/shipped-mark.ts';

const W = 48;
const H = 20;

function blank() {
  return new Uint8Array(W * H);
}

function fill(x0, y0, x1, y1) {
  const ink = blank();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) ink[y * W + x] = 1;
  }
  return ink;
}

function checker() {
  const ink = blank();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) ink[y * W + x] = (x + y) % 2;
  }
  return ink;
}

function triangle() {
  const ink = blank();
  for (let y = 1; y < H - 1; y++) {
    const t = (y - 1) / (H - 3);
    const half = Math.floor(t * (W / 2 - 2));
    const mid = Math.floor(W / 2);
    for (let x = mid - half; x <= mid + half; x++) {
      if (x >= 0 && x < W) ink[y * W + x] = 1;
    }
  }
  return ink;
}

test('a dithered mark survives; a solid tile or empty canvas does not', () => {
  assert.equal(markSurvives(checker(), W, H), true);
  assert.equal(markSurvives(blank(), W, H), false);
  assert.equal(markSurvives(fill(0, 0, W, H), W, H), false);
  assert.equal(markSurvives(triangle(), W, H), false);

  const gray = new Float32Array(W * H);
  for (let i = 0; i < gray.length; i++) gray[i] = ((i * 37) % 251);
  assert.equal(markSurvives(atkinson(gray, W, H), W, H), true);
});

test('a shared company mark sits on the group header once; only a unique src may sit on its line', () => {
  const vercel = { src: 'https://vercel.com/favicon.ico' };
  assert.deepEqual(
    logoPlacement([
      { key: 'a', logo: vercel },
      { key: 'b', logo: vercel },
      { key: 'c', logo: { src: 'https://unique.dev/icon.png' } },
      { key: 'd', logo: null },
    ]),
    { headerSrc: vercel.src, itemKeys: ['c'] },
  );
  assert.deepEqual(
    logoPlacement([
      { key: 'a', logo: vercel },
      { key: 'b', logo: vercel },
    ]),
    { headerSrc: vercel.src, itemKeys: [] },
  );
  assert.deepEqual(
    logoPlacement([
      { key: 'a', logo: { src: 'a.png' } },
      { key: 'b', logo: { src: 'b.png' } },
    ]),
    { headerSrc: null, itemKeys: ['a', 'b'] },
  );
});
