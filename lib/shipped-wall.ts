// The wall: listed receipts pinned on a board. Crumple is local to this browser (never written back).

export const WALL_CRUMPLE_KEY = 'shipped:wall:crumpled';
export const WALL_PATH = '/wall/';

/** mulberry32 — same family as the printer tear, kept here so this file stays import-free. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function readCrumpled(): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(WALL_CRUMPLE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

export function isCrumpled(id: number, ids: Iterable<number> = readCrumpled()): boolean {
  return new Set(ids).has(id);
}

export function writeCrumpled(ids: number[]): number[] {
  const unique = Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)));
  try {
    localStorage.setItem(WALL_CRUMPLE_KEY, JSON.stringify(unique));
  } catch {
    // Private mode: the crumple lasts for this page only.
  }
  return unique;
}

export function setCrumpled(id: number, crumpled: boolean): number[] {
  const next = new Set(readCrumpled());
  if (crumpled) next.add(id);
  else next.delete(id);
  return writeCrumpled(Array.from(next));
}

export type WallPinKind = 'pin' | 'tape';
export type WallPinColor = 'red' | 'brass' | 'steel' | 'jade';

export type WallPinStyle = {
  rotate: number;
  kind: WallPinKind;
  pinX: number;
  pinColor: WallPinColor;
};

/** One seed per receipt: the same id always hangs at the same angle with the same fastener. */
export function wallPinStyle(id: number): WallPinStyle {
  const random = prng(`wall-pin:${id}`);
  const a = random();
  const b = random();
  const c = random();
  const colors: WallPinColor[] = ['red', 'brass', 'steel', 'jade'];
  return {
    rotate: Math.round((a * 6.4 - 3.2) * 10) / 10,
    kind: b > 0.42 ? 'pin' : 'tape',
    pinX: 0.28 + random() * 0.44,
    pinColor: colors[Math.floor(c * colors.length)],
  };
}

export type WallCard = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  kind: WallPinKind;
  pinX: number;
  pinColor: WallPinColor;
};

export function estimateWallCardHeight(itemCount: number, crumpled: boolean, width: number): number {
  if (crumpled) return Math.round(width * 0.72);
  // Reserve a plausible full tape until its actual print image dimensions are known.
  return Math.round(Math.max(1, width - 12) * (2.7 + Math.min(8, Math.max(0, itemCount)) * 0.12) + 62);
}

/** Even gutter around and between columns. Wide enough that a slight tilt stays on the board. */
export function wallGutter(boardWidth: number): number {
  return boardWidth < 520 ? 22 : 18;
}

/** Masonry: shortest-column placement. Cards stay inside the board (even gutters, room for tilt). */
export function layoutWall<T extends { id: number; items: { name: string }[] }>(
  receipts: T[],
  crumpled: ReadonlySet<number>,
  boardWidth: number,
  cols: number,
  gap = wallGutter(boardWidth),
  imageRatios?: ReadonlyMap<number, number>,
): { cards: WallCard[]; height: number } {
  const columns = Math.max(1, cols);
  const inner = Math.max(0, boardWidth - gap * (columns + 1));
  const w = inner / columns;
  const tops = Array.from({ length: columns }, () => gap);
  const cards: WallCard[] = receipts.map((receipt) => {
    const col = tops.indexOf(Math.min(...tops));
    const style = wallPinStyle(receipt.id);
    const ratio = imageRatios?.get(receipt.id);
    const h = !crumpled.has(receipt.id) && ratio && Number.isFinite(ratio) && ratio > 0
      ? Math.round(Math.max(1, w - 12) * ratio + 62)
      : estimateWallCardHeight(receipt.items?.length ?? 0, crumpled.has(receipt.id), w);
    const x = gap + col * (w + gap);
    const y = tops[col];
    tops[col] = y + h + gap;
    // Long print images need a smaller lean: their bottom edge must stay inside the same gutter.
    const maxTilt = Math.atan((gap * 0.4) / Math.max(1, h)) * 180 / Math.PI;
    const rotate = Math.sign(style.rotate) * Math.min(Math.abs(style.rotate), maxTilt);
    return { id: receipt.id, x, y, w, h, rotate, kind: style.kind, pinX: style.pinX, pinColor: style.pinColor };
  });
  return { cards, height: Math.max(gap, ...tops) };
}

export function wallColumns(width: number): number {
  if (width < 520) return 2;
  if (width < 860) return 3;
  return 4;
}
