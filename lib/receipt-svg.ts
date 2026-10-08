// 1200×630 link-preview cards in the thermal-receipt style, as SVG. Rendered to an image by resvg with
// IBM Plex Mono (worker/fonts/): the master card by scripts/build-shipped-og.mjs at build time, printed
// receipts by the Worker on first share. Self-contained (no imports) so Node can load it directly.

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

function leader(y: number, label: string, value: string, size: number, weight = 600) {
  const left = 28;
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

function frame(inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${NIGHT}"/>${inner}</svg>`;
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

export type PrintedOg = {
  number: string;
  login: string;
  mode: string;
  date: string;
  headline: string;
  items: { name: string; status: string }[];
  counts: OgLine[];
  total: string;
  barcode: number[];
};

/** A printed receipt's card: who and the tally on the left, the paper running off the bottom on the right. */
export function printedReceiptSvg(data: PrintedOg): string {
  const left: string[] = [
    txt(72, 118, `RECEIPT #${data.number}`, 22, { weight: 600, spacing: 4, fill: PAPER, opacity: 0.7 }),
    txt(72, 196, fit(`@${data.login}`, 18), data.login.length > 12 ? 46 : 60, { weight: 600, fill: PAPER }),
    txt(72, 246, 'GITHUB, ITEMIZED.', 26, { weight: 500, spacing: 2, fill: PAPER, opacity: 0.85 }),
  ];
  let y = 330;
  for (const line of data.counts) {
    left.push(txt(72, y, line.value.padStart(2, ' '), 30, { weight: 600, fill: PAPER }), txt(132, y, line.label, 24, { spacing: 2, fill: PAPER, opacity: 0.85 }));
    y += 46;
  }
  left.push(txt(72, 560, 'PRINT YOURS AT BRYTONZOZ.COM/SHIPPED', 18, { spacing: 1.5, fill: PAPER, opacity: 0.6 }));

  const c = PAPER_W / 2;
  const body: string[] = [
    txt(c, 40, 'STORE RECEIPT', 11, { weight: 600, anchor: 'middle', spacing: 4.5 }),
    txt(c, 68, fit(`@${data.login}`.toUpperCase(), 22), 18, { weight: 600, anchor: 'middle', spacing: 2.4 }),
    txt(c, 90, `${data.mode.toUpperCase()} EDITION`, 11, { anchor: 'middle', spacing: 2.4 }),
    leader(122, 'DATE', data.date, 12),
    leader(142, 'RECEIPT', `#${data.number}`, 12),
    rule(158),
    txt(c, 182, fit(data.headline.toUpperCase(), 30), 13, { weight: 600, anchor: 'middle', spacing: 1 }),
  ];
  let py = 214;
  for (const item of data.items.slice(0, 9)) {
    body.push(leader(py, item.name.toUpperCase(), item.status, 13));
    py += 24;
  }
  if (data.items.length > 9) {
    body.push(txt(28, py, `+ ${data.items.length - 9} MORE`, 12, { opacity: 0.7 }));
    py += 22;
  }
  body.push(rule(py), leader(py + 26, 'TOTAL', data.total, 16), rule(py + 40, true), barcode(64, py + 58, 272, 34, data.barcode));
  return frame(`${left.join('')}${paper(660, body.join(''), 'translate(724 22) rotate(1.4 200 330)', true)}`);
}
