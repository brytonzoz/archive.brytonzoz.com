// Thermal-receipt images as SVG, rendered by resvg with IBM Plex Mono (worker/fonts/): the master
// /shipped/ card by scripts/build-shipped-og.mjs at build time; Shipped-in-<year> share images and
// supporter receipts by the Worker. Self-contained (no imports) so Node can load it directly.

export const OG_FONT = 'IBM Plex Mono';
const INK = '#1c1917';
const PAPER = '#f3ead8';
const NIGHT = '#0b0b0c';
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

function txt(x: number, y: number, value: string, size: number, opts: { weight?: number; anchor?: string; spacing?: number; fill?: string; opacity?: number } = {}) {
  const { weight = 500, anchor = 'start', spacing = 0, fill = INK, opacity } = opts;
  return `<text x="${x}" y="${y}" font-family="${OG_FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}" fill="${fill}"${opacity === undefined ? '' : ` opacity="${opacity}"`}>${esc(value)}</text>`;
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
    x2 > x1 ? `<line x1="${x1.toFixed(1)}" y1="${y - 3}" x2="${x2.toFixed(1)}" y2="${y - 3}" stroke="${INK}" stroke-width="1" stroke-dasharray="1 3" opacity="0.4"/>` : '',
  ].join('');
}

function rule(y: number, heavy = false) {
  return `<line x1="24" y1="${y}" x2="${PAPER_W - 24}" y2="${y}" stroke="${INK}" stroke-width="${heavy ? 2 : 1}"${heavy ? '' : ' stroke-dasharray="3 3" opacity="0.55"'}/>`;
}

function serration(y: number, flip: boolean) {
  const teeth = 20;
  const points: string[] = [];
  for (let i = 0; i <= teeth; i += 1) {
    const x = (i / teeth) * PAPER_W;
    const yy = i % 2 === 0 ? (flip ? y : y + 10) : flip ? y + 10 : y;
    points.push(`${x},${yy}`);
  }
  const base = flip ? y : y + 10;
  return `<polygon points="0,${base} ${points.join(' ')} ${PAPER_W},${base}" fill="${PAPER}"/>`;
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

function frame(inner: string, height = 630) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="${NIGHT}"/>${inner}</svg>`;
}

function paper(height: number, body: string, transform: string, open = false) {
  // open: the paper runs off the bottom of the card (no bottom tear).
  return `<g transform="${transform}">${serration(0, false)}<rect y="10" width="${PAPER_W}" height="${height - (open ? 10 : 20)}" fill="${PAPER}"/>${body}${open ? '' : serration(height - 10, true)}</g>`;
}

export type MasterOg = {
  date: string;
  items: number;
  /** "2020–2026" */
  span: string | null;
  counts: OgLine[];
  groups: { label: string; items: { name: string; status: string }[] }[];
};

function yearDivider(y: number, label: string) {
  const c = PAPER_W / 2;
  const half = (charW(12, 3.6) * label.length) / 2 + 12;
  return [
    `<line x1="28" y1="${y - 4}" x2="${c - half}" y2="${y - 4}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>`,
    txt(c, y, label, 12, { weight: 600, anchor: 'middle', spacing: 3.6 }),
    `<line x1="${c + half}" y1="${y - 4}" x2="${PAPER_W - 28}" y2="${y - 4}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>`,
  ].join('');
}

/** The /shipped/ card: the totals on the left, Bryton's receipt running off the bottom on the right. */
export function masterReceiptSvg(data: MasterOg): string {
  const left: string[] = [
    txt(72, 112, 'BRYTON ZOZ', 22, { weight: 600, spacing: 5, fill: PAPER, opacity: 0.7 }),
    txt(72, 196, 'SHIPPED.', 76, { weight: 600, spacing: 4, fill: PAPER }),
    txt(72, 246, `${data.items} ITEMS${data.span ? ` · ${data.span}` : ''}`, 26, { weight: 500, spacing: 2, fill: PAPER, opacity: 0.85 }),
  ];
  let y = 318;
  for (const line of data.counts) {
    left.push(txt(72, y, line.value.padStart(2, ' '), 30, { weight: 600, fill: PAPER }), txt(132, y, line.label, 24, { spacing: 2, fill: PAPER, opacity: 0.85 }));
    y += 44;
  }
  left.push(txt(72, 586, 'BRYTONZOZ.COM/SHIPPED', 18, { spacing: 1.5, fill: PAPER, opacity: 0.6 }));

  const c = PAPER_W / 2;
  const body: string[] = [
    txt(c, 40, 'STORE RECEIPT', 11, { weight: 600, anchor: 'middle', spacing: 4.5 }),
    txt(c, 66, 'BRYTON ZOZ', 17, { weight: 600, anchor: 'middle', spacing: 3.2 }),
    txt(c, 100, 'SHIPPED', 26, { weight: 600, anchor: 'middle', spacing: 6 }),
    leader(132, 'DATE', data.date, 12),
    leader(152, 'ITEMS', String(data.items), 12),
    rule(168),
  ];
  let py = 196;
  // Fill the paper and let the rest run off the card, like a receipt still printing.
  for (const group of data.groups) {
    if (py > 660) break;
    body.push(yearDivider(py, group.label));
    py += 24;
    for (const item of group.items) {
      if (py > 660) break;
      body.push(leader(py, item.name.toUpperCase(), item.status, 12));
      py += 20;
    }
    py += 6;
  }
  return frame(`${left.join('')}${paper(680, body.join(''), 'translate(724 22) rotate(1.4 200 330)', true)}`);
}

export type SupporterOg = {
  number: string;
  date: string;
  text: string;
  link: string | null;
  details: OgLine[];
  charges: OgLine[];
  total: string;
  status: string;
  barcode: number[];
};

/** The supporter's own receipt (portrait, 2× for a sharp download): their shout-out, what they paid. */
export function supporterReceiptSvg(data: SupporterOg): string {
  const c = PAPER_W / 2;
  const body: string[] = [
    txt(c, 40, 'SUPPORTER RECEIPT', 11, { weight: 600, anchor: 'middle', spacing: 4.5 }),
    txt(c, 66, 'BRYTON ZOZ', 17, { weight: 600, anchor: 'middle', spacing: 3.2 }),
    txt(c, 100, 'SHIPPED', 26, { weight: 600, anchor: 'middle', spacing: 6 }),
    leader(132, 'DATE', data.date, 12),
    leader(152, 'RECEIPT', `#${data.number}`, 12),
    rule(168),
    txt(c, 196, 'YOUR SHOUT-OUT', 11, { anchor: 'middle', spacing: 3, opacity: 0.7 }),
    txt(c, 226, fit(data.text, 32), 17, { weight: 600, anchor: 'middle' }),
  ];
  let y = 248;
  if (data.link) {
    body.push(txt(c, y, fit(data.link, 44), 11, { anchor: 'middle', opacity: 0.75 }));
    y += 8;
  }
  y += 20;
  for (const line of data.details) {
    body.push(leader(y, line.label, line.value, 12));
    y += 20;
  }
  body.push(rule(y - 4));
  y += 22;
  for (const line of data.charges) {
    body.push(leader(y, line.label, line.value, 12));
    y += 20;
  }
  body.push(rule(y - 4, true), leader(y + 20, 'TOTAL', data.total, 16), rule(y + 34, true));
  y += 64;
  body.push(txt(c, y, data.status, 11, { weight: 600, anchor: 'middle', spacing: 2 }));
  body.push(txt(c, y + 20, 'THANK YOU FOR SUPPORTING.', 11, { anchor: 'middle', spacing: 2, opacity: 0.75 }));
  body.push(barcode(64, y + 40, 272, 34, data.barcode));
  body.push(txt(c, y + 96, 'BRYTONZOZ.COM/SHIPPED', 10, { anchor: 'middle', spacing: 2, opacity: 0.6 }));
  const height = y + 126;
  const w = PAPER_W + 80;
  const h = height + 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${NIGHT}"/>${paper(height, body.join(''), 'translate(40 40)')}</svg>`;
}

// ---- Shipped in <year> ---------------------------------------------------------------------------

export type YearOgItem = { name: string; status: string; date: string | null; description: string; logo: string | null };
export type YearOgPaidFor = { presented: string | null; lines: { text: string; logo: string | null }[] };
export type YearOg = {
  number: string;
  year: number;
  who: string;
  date: string;
  items: YearOgItem[];
  count: number;
  note: string;
  paidFor: YearOgPaidFor;
  url: string;
  barcode: number[];
};

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

const paidForText = (paid: YearOgPaidFor) => paid.lines.map((line) => line.text).join(' · ');

/** The X card (1200×675): who and the tally on the left, the receipt running off the bottom on the right. */
export function yearCardSvg(data: YearOg): string {
  const left: string[] = [
    txt(72, 96, `RECEIPT #${data.number}`, 18, { weight: 600, spacing: 4, fill: PAPER, opacity: 0.6 }),
    txt(72, 178, 'SHIPPED', 72, { weight: 600, spacing: 4, fill: PAPER }),
    txt(72, 256, `IN ${data.year}.`, 72, { weight: 600, spacing: 4, fill: PAPER }),
    txt(72, 322, fit(data.who.toUpperCase(), 24), data.who.length > 18 ? 26 : 32, { weight: 600, spacing: 1.5, fill: PAPER, opacity: 0.92 }),
    txt(72, 380, `ITEMS SHIPPED: ${data.count}`, 30, { weight: 600, spacing: 1.5, fill: PAPER }),
  ];
  wrap(`“${data.note}”`, 44, 2).forEach((line, i) => left.push(txt(72, 428 + i * 26, line, 18, { fill: PAPER, opacity: 0.75 })));
  left.push(txt(72, 540, 'THIS RECEIPT PAID FOR BY:', 14, { weight: 600, spacing: 3, fill: PAPER, opacity: 0.55 }));
  if (data.paidFor.presented) left.push(txt(72, 568, fit(`PRESENTED BY ${data.paidFor.presented.toUpperCase()}`, 40), 18, { weight: 600, spacing: 1.5, fill: PAPER }));
  left.push(txt(72, data.paidFor.presented ? 594 : 572, fit(paidForText(data.paidFor).toUpperCase(), 46), 18, { weight: 600, spacing: 1.2, fill: PAPER, opacity: 0.9 }));
  left.push(txt(72, 636, 'PRINT YOURS AT BRYTONZOZ.COM/SHIPPED', 15, { spacing: 1.5, fill: PAPER, opacity: 0.55 }));

  const c = PAPER_W / 2;
  const body: string[] = [
    txt(c, 40, 'STORE RECEIPT', 11, { weight: 600, anchor: 'middle', spacing: 4.5 }),
    txt(c, 70, `SHIPPED IN ${data.year}`, 20, { weight: 600, anchor: 'middle', spacing: 3 }),
    txt(c, 94, fit(data.who.toUpperCase(), 30), 13, { weight: 600, anchor: 'middle', spacing: 1.6 }),
    leader(124, 'DATE', data.date, 12),
    leader(144, 'RECEIPT', `#${data.number}`, 12),
    rule(160),
  ];
  let y = 190;
  for (const item of data.items) {
    if (y > 700) break;
    if (item.logo) body.push(logoImage(28, y - 15, 20, item.logo));
    body.push(leader(y, item.name.toUpperCase(), item.status, 12.5, 600, item.logo ? 56 : 28));
    y += 26;
  }
  return frame(`${left.join('')}${paper(720, body.join(''), 'translate(724 22) rotate(1.4 200 330)', true)}`, 675);
}

/** The whole receipt as one tall image (2×), PAID FOR BY block and all. */
export function yearTallSvg(data: YearOg): string {
  const c = PAPER_W / 2;
  const body: string[] = [
    txt(c, 40, 'STORE RECEIPT', 11, { weight: 600, anchor: 'middle', spacing: 4.5 }),
    txt(c, 74, `SHIPPED IN ${data.year}`, 24, { weight: 600, anchor: 'middle', spacing: 3.5 }),
    txt(c, 100, fit(data.who.toUpperCase(), 30), 14, { weight: 600, anchor: 'middle', spacing: 1.8 }),
    leader(132, 'DATE', data.date, 12),
    leader(152, 'RECEIPT', `#${data.number}`, 12),
    rule(168),
  ];
  let y = 196;
  for (const item of data.items) {
    const indent = item.logo ? 64 : 28;
    if (item.logo) body.push(logoImage(28, y - 16, 28, item.logo));
    body.push(leader(y, item.name.toUpperCase(), item.status, 13, 600, indent));
    const sub = [item.date, item.description].filter(Boolean).join(' · ');
    const lines = wrap(sub, item.logo ? 50 : 56, 2);
    lines.forEach((line, i) => body.push(txt(indent, y + 17 + i * 14, line, 10.5, { opacity: 0.72 })));
    y += 22 + Math.max(lines.length, item.logo ? 1 : 0) * 14 + 10;
  }
  body.push(rule(y - 4), leader(y + 22, 'ITEMS SHIPPED', String(data.count), 16), rule(y + 36, true));
  y += 66;
  for (const line of wrap(`“${data.note}”`, 46, 3)) {
    body.push(txt(c, y, line, 12, { anchor: 'middle', opacity: 0.85 }));
    y += 17;
  }
  y += 16;
  body.push(txt(c, y, 'THIS RECEIPT PAID FOR BY:', 10.5, { weight: 600, anchor: 'middle', spacing: 2.4, opacity: 0.6 }));
  y += 22;
  if (data.paidFor.presented) {
    body.push(txt(c, y, fit(`PRESENTED BY ${data.paidFor.presented.toUpperCase()}`, 36), 13, { weight: 600, anchor: 'middle', spacing: 1.4 }));
    y += 22;
  }
  for (const line of data.paidFor.lines) {
    if (line.logo) {
      body.push(logoImage(c - 20, y - 12, 40, line.logo));
      y += 38;
    }
    body.push(txt(c, y, fit(line.text.toUpperCase(), 36), 12.5, { weight: 600, anchor: 'middle', spacing: 1 }));
    y += 20;
  }
  y += 8;
  body.push(barcode(64, y, 272, 34, data.barcode));
  y += 56;
  body.push(txt(c, y, 'PRINT YOURS AT BRYTONZOZ.COM/SHIPPED', 10.5, { weight: 600, anchor: 'middle', spacing: 1.6 }));
  body.push(txt(c, y + 16, fit(data.url, 52), 9.5, { anchor: 'middle', opacity: 0.6 }));
  const height = y + 46;
  const w = PAPER_W + 80;
  const h = height + 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${NIGHT}"/>${paper(height, body.join(''), 'translate(40 40)')}</svg>`;
}
