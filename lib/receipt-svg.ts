// Thermal-receipt images as SVG, rendered by resvg with IBM Plex Mono (worker/fonts/): the home page
// card by scripts/build-shipped-og.mjs at build time; Shipped-in-<year> share images by the Worker. Self-contained (no imports) so Node can load it directly.
// Drawn like a photo of the page: hand-torn paper with a soft shadow and curled edges on a dark counter
// under one warm lamp, set like the receipt on the site (double-height store name, one inverse band).

export const OG_FONT = 'IBM Plex Mono';
const INK = '#1d1b19';
const PAPER = '#f2eee6';
const COUNTER = '#121316';
const CREAM = '#f3ead8';
const PAPER_W = 400;
/** IBM Plex Mono advances 0.6em per character. */
const charW = (size: number, spacing = 0) => size * 0.6 + spacing;

export type OgLine = { label: string; value: string };

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

type TextOpts = { weight?: number; anchor?: string; spacing?: number; fill?: string; opacity?: number };

function txt(x: number, y: number, value: string, size: number, opts: TextOpts = {}) {
  const { weight = 500, anchor = 'start', spacing = 0, fill = INK, opacity } = opts;
  return `<text x="${x}" y="${y}" font-family="${OG_FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}" fill="${fill}"${opacity === undefined ? '' : ` opacity="${opacity}"`}>${esc(value)}</text>`;
}

/** ESC/POS double height: the same glyphs stretched to twice the height, baseline at y. */
function tall(x: number, y: number, value: string, size: number, opts: TextOpts = {}) {
  return `<g transform="translate(${x} ${y}) scale(1 1.9)">${txt(0, 0, value, size, { weight: 600, ...opts })}</g>`;
}

/** One inverse-printed band (white on black), centred on c. */
function inverse(c: number, y: number, value: string, size: number) {
  const w = charW(size) * value.length + 22;
  const h = size + 12;
  return `<rect x="${(c - w / 2).toFixed(1)}" y="${(y - size - 3).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" fill="${INK}"/>${txt(c, y, value, size, { weight: 600, anchor: 'middle', fill: PAPER })}`;
}

function leader(y: number, label: string, value: string, size: number, weight = 600, left = 28) {
  const right = PAPER_W - 28;
  const maxLabel = Math.floor((right - left - charW(size) * (value.length + 2)) / charW(size));
  const shown = fit(label, maxLabel);
  const x1 = left + charW(size) * shown.length + 6;
  const x2 = right - charW(size) * value.length - 6;
  return [
    txt(left, y, shown, size, { weight }),
    txt(right, y, value, size, { weight, anchor: 'end' }),
    x2 > x1 ? `<line x1="${x1.toFixed(1)}" y1="${y - 3}" x2="${x2.toFixed(1)}" y2="${y - 3}" stroke="${INK}" stroke-width="1" stroke-dasharray="1 3" opacity="0.45"/>` : '',
  ].join('');
}

function rule(y: number, heavy = false) {
  return `<line x1="28" y1="${y}" x2="${PAPER_W - 28}" y2="${y}" stroke="${INK}" stroke-width="${heavy ? 1.5 : 1}" stroke-dasharray="${heavy ? '5 2' : '3 3'}" opacity="${heavy ? 0.8 : 0.5}"/>`;
}

function barcode(x: number, y: number, width: number, height: number, units: number[]) {
  const total = units.reduce((sum, n) => sum + n, 0);
  const scale = width / total;
  let cursor = x;
  return units
    .map((unit, i) => {
      const w = unit * scale;
      const bar = i % 2 === 0 ? `<rect x="${cursor.toFixed(2)}" y="${y}" width="${Math.max(w - 0.4, 0.8).toFixed(2)}" height="${height}" fill="${INK}"/>` : '';
      cursor += w;
      return bar;
    })
    .join('');
}

// ---- Paper and counter ------------------------------------------------------------------------------

/** mulberry32, the same tear as components/shipped/physics.ts: one seed, one edge. */
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

function tear(seed: string, y: number, down: boolean, depth = 6): string[] {
  const random = prng(seed);
  const points: string[] = [];
  let x = 0;
  while (x < PAPER_W) {
    const bite = random() < 0.08 ? 1 : 0.55;
    const d = random() * depth * bite;
    points.push(`${x.toFixed(1)},${(down ? y + d : y - d).toFixed(1)}`);
    x += 4 + random() * 10;
  }
  points.push(`${PAPER_W},${(down ? y + random() * depth * 0.5 : y - random() * depth * 0.5).toFixed(1)}`);
  return points;
}

/** A strip of paper torn at the top, and at the bottom unless it runs off the image. */
function sheetPath(height: number, seed: string, open: boolean): string {
  const top = tear(`${seed}:top`, 0, true);
  const bottom = open ? [`${PAPER_W},${height}`, `0,${height}`] : tear(`${seed}:bottom`, height, false).reverse();
  return `M${top.join(' L')} L${bottom.join(' L')} Z`;
}

const DEFS = `<defs>
<filter id="shadow" x="-30%" y="-10%" width="160%" height="130%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="contact" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
<linearGradient id="curl" x1="0" x2="1" y1="0" y2="0">
<stop offset="0" stop-color="#3a2c1e" stop-opacity="0.13"/><stop offset="0.1" stop-color="#3a2c1e" stop-opacity="0"/>
<stop offset="0.88" stop-color="#3a2c1e" stop-opacity="0"/><stop offset="1" stop-color="#3a2c1e" stop-opacity="0.15"/>
</linearGradient>
<linearGradient id="sheen" x1="0" x2="0" y1="0" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<radialGradient id="lamp" cx="0.64" cy="-0.08" r="0.75"><stop offset="0" stop-color="#ffe4ba" stop-opacity="0.17"/><stop offset="1" stop-color="#ffe4ba" stop-opacity="0"/></radialGradient>
<radialGradient id="vignette" cx="0.5" cy="0.45" r="0.8"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
<linearGradient id="steel" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e3e6ea"/><stop offset="0.45" stop-color="#a9afb7"/><stop offset="1" stop-color="#6e747c"/></linearGradient>
<linearGradient id="chassis" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a2c31"/><stop offset="1" stop-color="#17181b"/></linearGradient>
</defs>`;

/** Counter, lamp and vignette around whatever is on it. The 2× downloads skip the lamp: full-size gradients
 *  and blurs cost seconds of Worker CPU at that size. */
function scene(width: number, height: number, inner: string, scale = 1) {
  const light = scale === 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">${DEFS}<rect width="${width}" height="${height}" fill="${COUNTER}"/>${light ? `<rect width="${width}" height="${height}" fill="url(#lamp)"/>` : ''}${inner}${light ? `<rect width="${width}" height="${height}" fill="url(#vignette)"/>` : ''}</svg>`;
}

/** The paper itself: shadow on the counter, the sheet and its curled edges, then the print. */
function sheet(height: number, body: string, transform: string, seed: string, opts: { open?: boolean; soft?: boolean } = {}) {
  const d = sheetPath(height, seed, Boolean(opts.open));
  const shadow = opts.soft
    ? `<path d="${d}" transform="translate(10 22)" fill="#000" opacity="0.6" filter="url(#shadow)"/><path d="${d}" transform="translate(0 1.5)" fill="#000" opacity="0.5" filter="url(#contact)"/><path d="${d}" fill="${PAPER}"/><path d="${d}" fill="url(#curl)"/><path d="${d}" fill="url(#sheen)"/>`
    : [[9, 16, 0.12], [6, 10, 0.16], [3, 5, 0.2], [0.5, 1.5, 0.35]].map(([x, y, o]) => `<path d="${d}" transform="translate(${x} ${y})" fill="#000" opacity="${o}"/>`).join('') +
      `<path d="${d}" fill="${PAPER}"/><path d="${d}" fill="url(#curl)"/>`;
  return `<g transform="${transform}">${shadow}${body}</g>`;
}

/** The front of the BZ-80 with its tear bar, so the receipt in a card hangs from the printer. */
function printerLip(x: number, y: number, width: number) {
  const teeth: string[] = [];
  for (let tx = x + 14; tx < x + width - 14; tx += 6) teeth.push(`${tx},${y + 6} ${tx + 3},${y + 11} ${tx + 6},${y + 6}`);
  return [
    `<rect x="${x}" y="${y - 70}" width="${width}" height="76" rx="14" fill="url(#chassis)"/>`,
    `<rect x="${x}" y="${y - 70}" width="${width}" height="76" rx="14" fill="none" stroke="#fff" stroke-opacity="0.08"/>`,
    `<rect x="${x + 22}" y="${y - 12}" width="${width - 44}" height="5" rx="2.5" fill="#000"/>`,
    `<rect x="${x + 14}" y="${y}" width="${width - 28}" height="6" fill="url(#steel)"/>`,
    `<polygon points="${teeth.join(' ')}" fill="#8b9199"/>`,
  ].join('');
}

/** Header every receipt shares: the store in double height, then date and number. */
function header(c: number, date: string, number: string) {
  return [
    tall(c, 46, 'SHIPPED 2026', 15, { anchor: 'middle' }),
    txt(c, 74, 'THE PUBLIC RECEIPT PRINTER', 10.5, { anchor: 'middle', opacity: 0.7 }),
    rule(90),
    leader(112, 'DATE', date, 12, 500),
    leader(130, 'RECEIPT', `#${number}`, 12, 500),
    rule(146),
  ];
}

// ---- The home page card -----------------------------------------------------------------------------

export type MasterOg = {
  year: number;
  date: string;
  /** "OCT 26, 12:00 PM ET" */
  closes: string;
  url: string;
  barcode: number[];
};

/** The home page link preview: the pitch on the left, the "how it works" slip hanging from the printer on the right. */
export function masterReceiptSvg(data: MasterOg): string {
  const left: string[] = [
    txt(72, 104, `SHIPPED ${data.year} · THE PUBLIC RECEIPT PRINTER`, 16, { spacing: 2, fill: CREAM, opacity: 0.5 }),
    txt(68, 206, 'Shipped.', 96, { spacing: -4, fill: CREAM }),
    txt(72, 264, `What did you ship in ${data.year}?`, 28, { fill: CREAM, opacity: 0.85 }),
    txt(72, 306, 'Print the receipt. Free.', 28, { fill: CREAM, opacity: 0.85 }),
    txt(72, 392, 'TWO WEEKS ONLY', 20, { weight: 600, spacing: 2, fill: CREAM }),
    txt(72, 424, `The printer shuts off ${data.closes}.`, 20, { fill: CREAM, opacity: 0.7 }),
    txt(72, 586, data.url, 18, { fill: CREAM, opacity: 0.5 }),
  ];

  const c = PAPER_W / 2;
  const body: string[] = [...header(c, data.date, '000000'), inverse(c, 182, 'HOW IT WORKS', 15)];
  let y = 216;
  for (const [label, value] of [
    ['1. TYPE A NAME OR @HANDLE', 'FREE'],
    [`2. IT PRINTS YOUR ${data.year}`, 'AUTO'],
    ['3. POST IT, TOSS IT ON THE PILE', 'FREE'],
    ['MAILED THERMAL PRINT (US)', '$5'],
  ]) {
    body.push(leader(y, label, value, 12, 500));
    y += 22;
  }
  body.push(rule(y, true));
  y += 26;
  body.push(txt(c, y, 'PUBLIC, PROFESSIONAL WORK ONLY.', 11, { anchor: 'middle', opacity: 0.75 }));
  body.push(txt(c, y + 18, 'EVERY ITEM LINKS TO ITS SOURCE.', 11, { anchor: 'middle', opacity: 0.75 }));
  body.push(barcode(64, y + 44, 272, 40, data.barcode));
  body.push(txt(c, y + 108, '*** TEAR HERE ***', 10.5, { anchor: 'middle', opacity: 0.6 }));
  return scene(1200, 630, `${sheet(640, body.join(''), 'translate(736 40) rotate(0.6 200 0)', 'master', { open: true, soft: true })}${printerLip(706, 40, 460)}${left.join('')}`);
}

// ---- Shipped in <year> ---------------------------------------------------------------------------

export type YearOgItem = { name: string; status: string; date: string | null; description: string; logo: string | null };
/** One sponsor slot as drawn: its QR is a path in module units (lib/shipped-qr.ts), passed in so this file stays import-free. */
export type YearOgSlot = { name: string; cta: string; logo: string | null; qr: { size: number; path: string } };
export type YearOg = {
  number: string;
  year: number;
  who: string;
  date: string;
  items: YearOgItem[];
  count: number;
  note: string;
  /** Hero first, then the nine small slots. */
  sponsors: YearOgSlot[];
  url: string;
  barcode: number[];
};

function qrMark(x: number, y: number, width: number, code: { size: number; path: string }) {
  const scale = width / (code.size + 4);
  return `<rect x="${x}" y="${y}" width="${width}" height="${width}" fill="${PAPER}"/><g transform="translate(${(x + 2 * scale).toFixed(2)} ${(y + 2 * scale).toFixed(2)}) scale(${scale.toFixed(4)})"><path d="${code.path}" fill="${INK}" shape-rendering="crispEdges"/></g>`;
}

/** The sponsor block: the hero slot across the top, then a 3×3 grid, each with its QR code. Returns the new y. */
function sponsorBlock(body: string[], c: number, top: number, slots: YearOgSlot[]): number {
  let y = top + 20;
  body.push(txt(c, y, 'THIS RECEIPT IS SPONSORED BY', 10.5, { weight: 600, anchor: 'middle' }));
  y += 14;
  const [hero, ...grid] = slots;
  if (hero) {
    const qrSize = 74;
    body.push(qrMark(PAPER_W - 28 - qrSize - 6, y + 2, qrSize, hero.qr));
    let ty = y + 26;
    if (hero.logo) {
      body.push(`<image x="40" y="${y + 6}" width="150" height="40" preserveAspectRatio="xMinYMid meet" image-rendering="optimizeSpeed" href="${hero.logo}"/>`);
      ty = y + 64;
    } else body.push(tall(40, ty, fit(hero.name.toUpperCase(), 20), 13));
    wrap(hero.cta, 30, 2).forEach((line, i) => body.push(txt(40, ty + 20 + i * 14, line, 10.5, { opacity: 0.8 })));
    y += qrSize + 14;
    body.push(rule(y));
    y += 12;
  }
  const cellW = (PAPER_W - 56) / 3;
  for (let row = 0; row < Math.ceil(grid.length / 3); row++) {
    for (let col = 0; col < 3; col++) {
      const slot = grid[row * 3 + col];
      if (!slot) continue;
      const cx = 28 + cellW * col + cellW / 2;
      body.push(qrMark(cx - 26, y, 52, slot.qr));
      if (slot.logo) body.push(`<image x="${(cx - 50).toFixed(1)}" y="${y + 56}" width="100" height="18" preserveAspectRatio="xMidYMid meet" image-rendering="optimizeSpeed" href="${slot.logo}"/>`);
      else body.push(txt(cx, y + 68, fit(slot.name.toUpperCase(), 16), 9, { weight: 600, anchor: 'middle' }));
      wrap(slot.cta, 20, 2).forEach((line, i) => body.push(txt(cx, y + 81 + i * 10, line, 7.5, { anchor: 'middle', opacity: 0.75 })));
    }
    y += 104;
  }
  body.push(`<rect x="28" y="${top}" width="${PAPER_W - 56}" height="${y - top}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
  return y;
}

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line ? line.length + 1 : 0) + word.length > max) {
      if (line) out.push(line);
      line = word.slice(0, max);
      if (out.length === lines) break;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line && out.length < lines) out.push(line);
  if (out.length === lines && text.length > out.join(' ').length + 1) out[lines - 1] = fit(`${out[lines - 1]}…`, max);
  return out;
}

const logoImage = (x: number, y: number, size: number, href: string) =>
  `<image x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" image-rendering="optimizeSpeed" href="${href}"/>`;

function customer(c: number, y: number, year: number, who: string) {
  return [inverse(c, y, `SHIPPED IN ${year}`, 14), txt(c, y + 30, 'CUSTOMER', 10.5, { anchor: 'middle', opacity: 0.6 }), tall(c, y + 56, fit(who.toUpperCase(), 26), 15, { anchor: 'middle' })];
}

/** The X card (1200×675): who and the tally on the left, their receipt hanging from the printer on the right. */
export function yearCardSvg(data: YearOg): string {
  const name = fit(data.who, 22);
  const left: string[] = [
    txt(72, 92, `RECEIPT #${data.number}`, 17, { spacing: 2.5, fill: CREAM, opacity: 0.5 }),
    txt(68, 176, 'Shipped', 80, { spacing: -4, fill: CREAM }),
    txt(68, 256, `in ${data.year}.`, 80, { spacing: -4, fill: CREAM }),
    txt(72, 322, name, name.length > 16 ? 28 : 34, { weight: 600, spacing: -0.5, fill: CREAM }),
    txt(72, 372, `${data.count} ${data.count === 1 ? 'thing' : 'things'} shipped`, 26, { fill: CREAM, opacity: 0.8 }),
  ];
  wrap(`“${data.note}”`, 44, 2).forEach((line, i) => left.push(txt(72, 424 + i * 26, line, 18, { fill: CREAM, opacity: 0.6 })));
  const hero = data.sponsors[0];
  if (hero) {
    left.push(txt(72, 540, 'Sponsored by', 14, { fill: CREAM, opacity: 0.45 }));
    left.push(txt(72, 568, fit(hero.name.toUpperCase(), 32), 18, { weight: 600, fill: CREAM }));
    left.push(txt(72, 594, fit(`and ${data.sponsors.length - 1} more on the receipt`, 46), 15, { fill: CREAM, opacity: 0.6 }));
  }
  left.push(txt(72, 636, 'Print yours: shipped.brytonzoz.com', 15, { fill: CREAM, opacity: 0.5 }));

  const c = PAPER_W / 2;
  const body: string[] = [...header(c, data.date, data.number), ...customer(c, 180, data.year, data.who), rule(258)];
  let y = 290;
  for (const item of data.items) {
    if (y > 700) break;
    if (item.logo) body.push(logoImage(28, y - 15, 20, item.logo));
    body.push(leader(y, item.name.toUpperCase(), item.status, 12.5, 600, item.logo ? 56 : 28));
    y += 26;
  }
  return scene(1200, 675, `${sheet(680, body.join(''), 'translate(736 40) rotate(0.6 200 0)', `card:${data.number}`, { open: true, soft: true })}${printerLip(706, 40, 460)}${left.join('')}`);
}

/** The whole receipt as one tall image (2×), PAID FOR BY block and all. */
export function yearTallSvg(data: YearOg): string {
  const c = PAPER_W / 2;
  const body: string[] = [...header(c, data.date, data.number), ...customer(c, 180, data.year, data.who), rule(258)];
  let y = 288;
  for (const item of data.items) {
    const indent = item.logo ? 64 : 28;
    if (item.logo) body.push(logoImage(28, y - 16, 28, item.logo));
    body.push(leader(y, item.name.toUpperCase(), item.status, 13, 600, indent));
    const sub = [item.description, item.date].filter(Boolean).join('  ');
    const lines = wrap(sub, item.logo ? 50 : 56, 2);
    lines.forEach((line, i) => body.push(txt(indent, y + 17 + i * 14, line, 10.5, { opacity: 0.72 })));
    y += 22 + Math.max(lines.length, item.logo ? 1 : 0) * 14 + 10;
  }
  body.push(rule(y - 4, true), txt(28, y + 22, 'ITEMS SHIPPED', 13, { weight: 600 }), tall(PAPER_W - 28, y + 24, String(data.count), 16, { anchor: 'end' }), rule(y + 38, true));
  y += 66;
  body.push(txt(28, y, 'CASHIER’S NOTE', 10.5, { opacity: 0.6 }));
  y += 18;
  for (const line of wrap(data.note, 52, 3)) {
    body.push(txt(28, y, line, 12));
    y += 17;
  }
  y += 14;
  y = sponsorBlock(body, c, y, data.sponsors);
  y += 24;
  body.push(barcode(64, y, 272, 34, data.barcode));
  y += 56;
  body.push(txt(c, y, 'PRINTED AT SHIPPED.BRYTONZOZ.COM', 10.5, { weight: 600, anchor: 'middle' }));
  body.push(txt(c, y + 16, '*** CUSTOMER COPY ***', 10, { anchor: 'middle', opacity: 0.6 }));
  body.push(txt(c, y + 32, fit(data.url, 52), 9.5, { anchor: 'middle', opacity: 0.55 }));
  const height = y + 56;
  return scene(PAPER_W + 120, height + 120, sheet(height, body.join(''), 'translate(60 50) rotate(-0.6 200 0)', `tall:${data.number}`), 2);
}
