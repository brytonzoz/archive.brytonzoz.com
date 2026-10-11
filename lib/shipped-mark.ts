// Client-side thermal knockout for item marks. A logo only prints when an ordered dither of the
// actual pixels still looks like a mark — not a solid triangle, tile, or slab. Pure so tests can
// reject the broken favicon cases without a browser.

const SPREAD: [number, number][] = [
  [1, 0],
  [2, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [0, 2],
];

/** Atkinson dither: 1 = ink, 0 = paper. `gray` is 0 (ink) … 255 (paper) and is mutated. */
export function atkinson(gray: Float32Array, width: number, height: number): Uint8Array {
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const on = gray[i] < 128;
      ink[i] = on ? 1 : 0;
      const error = (gray[i] - (on ? 0 : 255)) / 8;
      for (const [dx, dy] of SPREAD) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) gray[ny * width + nx] += error;
      }
    }
  }
  return ink;
}

/**
 * A real dithered mark has mixed 2×2 cells (speckle). A solid triangle/tile is one blob:
 * high fill, almost no mixed cells. Favicon knockouts fail this; wordmarks and detailed icons pass.
 */
export function markSurvives(ink: Uint8Array, width: number, height: number): boolean {
  const n = width * height;
  if (n < 64 || ink.length < n) return false;
  let on = 0;
  for (let i = 0; i < n; i++) if (ink[i]) on += 1;
  const fill = on / n;
  if (fill < 0.06 || fill > 0.78) return false;

  let mixed = 0;
  let cells = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      const sum = ink[i] + ink[i + 1] + ink[i + width] + ink[i + width + 1];
      cells += 1;
      if (sum > 0 && sum < 4) mixed += 1;
    }
  }
  return cells > 0 && mixed / cells >= 0.22;
}

export type LogoItem = { key: string; logo: { src: string } | null };

/** Shared company mark goes on the group header once. A unique src may sit on its own line. */
export function logoPlacement(items: LogoItem[]): { headerSrc: string | null; itemKeys: string[] } {
  const counts = new Map<string, number>();
  for (const item of items) {
    const src = item.logo?.src;
    if (src) counts.set(src, (counts.get(src) ?? 0) + 1);
  }
  let headerSrc: string | null = null;
  let best = 1;
  for (const [src, n] of counts) {
    if (n > best) {
      best = n;
      headerSrc = src;
    }
  }
  const itemKeys: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const src = item.logo?.src;
    if (!src || src === headerSrc || (counts.get(src) ?? 0) !== 1) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    itemKeys.push(item.key);
  }
  return { headerSrc, itemKeys };
}
