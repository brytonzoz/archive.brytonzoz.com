// Link-preview card for /shipped/: a 1200×630 JPEG of the thermal receipt on charcoal.
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'og-shipped.jpg');

const ITEMS = [
  ['Mopkin', 'LIVE'],
  ['Habituize', 'LIVE'],
  ['Pocket Factory', 'LIVE'],
  ['brytonzoz.com', 'LIVE'],
  ['PostBalloon', 'LIVE'],
  ['LiveCaps', 'PROTOTYPE'],
  ['WellnessBuddy', 'PROTOTYPE'],
];

const FONT = 'DejaVu Sans Mono, ui-monospace, monospace';
const INK = '#1c1917';
const PAPER = '#f3ead8';
const WIDTH = 400;

function barcodeUnits(value) {
  const units = [2, 1, 1, 1];
  for (const ch of value) {
    const n = ch.charCodeAt(0);
    units.push((n % 3) + 1, 1, ((n >> 2) % 2) + 1, 1, ((n >> 3) % 3) + 1, 1);
  }
  units.push(1, 1, 2);
  return units;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dottedLine(y, label, value, size, weight = 600) {
  const left = 28;
  const right = WIDTH - 28;
  return `
    <text x="${left}" y="${y}" font-size="${size}" font-weight="${weight}" font-family="${FONT}" fill="${INK}">${escapeXml(label)}</text>
    <text x="${right}" y="${y}" text-anchor="end" font-size="${size}" font-weight="${weight}" font-family="${FONT}" fill="${INK}">${escapeXml(value)}</text>
    <line x1="${left + 7.1 * label.length}" y1="${y - 2}" x2="${right - 7.3 * value.length}" y2="${y - 2}" stroke="${INK}" stroke-width="1" stroke-dasharray="1 3" opacity="0.38"/>
  `;
}

function dashes(y, heavy = false) {
  return `<line x1="24" y1="${y}" x2="${WIDTH - 24}" y2="${y}" stroke="${INK}" stroke-width="${heavy ? 2 : 1}" ${heavy ? '' : 'stroke-dasharray="3 3" opacity="0.55"'}/>`;
}

function serration(y, flip) {
  const teeth = 20;
  const points = [];
  for (let i = 0; i <= teeth; i += 1) {
    const x = (i / teeth) * WIDTH;
    const yy = i % 2 === 0 ? (flip ? y : y + 10) : (flip ? y + 10 : y);
    points.push(`${x},${yy}`);
  }
  const baseline = flip ? y : y + 10;
  return `<polygon points="0,${baseline} ${points.join(' ')} ${WIDTH},${baseline}" fill="${PAPER}"/>`;
}

function barcodeSvg(x, y, width, height) {
  const units = barcodeUnits('BRYTONZOZ/SHIPPED');
  const total = units.reduce((sum, n) => sum + n, 0);
  const scale = width / total;
  let cursor = x;
  return units.map((unit, i) => {
    const w = unit * scale;
    const rect = i % 2 === 0
      ? `<rect x="${cursor.toFixed(2)}" y="${y}" width="${Math.max(w - 0.4, 0.8).toFixed(2)}" height="${height}" fill="${INK}"/>`
      : '';
    cursor += w;
    return rect;
  }).join('');
}

function svg() {
  let y = 36;
  const header = `
    <text x="${WIDTH / 2}" y="${y}" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="4.5" font-family="${FONT}" fill="${INK}">STORE RECEIPT</text>
    <text x="${WIDTH / 2}" y="${y + 26}" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="3.2" font-family="${FONT}" fill="${INK}">BRYTON ZOZ</text>
    <text x="${WIDTH / 2}" y="${y + 46}" text-anchor="middle" font-size="11" letter-spacing="1.8" font-family="${FONT}" fill="${INK}">NEW YORK · ARTIST / BUILDER</text>
    <text x="${WIDTH / 2}" y="${y + 82}" text-anchor="middle" font-size="30" font-weight="700" letter-spacing="7" font-family="${FONT}" fill="${INK}">SHIPPED</text>
  `;
  y = 136;
  const meta = `
    ${dottedLine(y, 'DATE', '08 OCT 2026', 12)}
    ${dottedLine(y + 20, 'ORDER', '#BZ-SHIPPED', 12)}
    ${dashes(y + 36)}
  `;
  y = 188;
  const itemLines = ITEMS.map(([name, status]) => {
    const line = dottedLine(y, name.toUpperCase(), status, 14);
    y += 24;
    return line;
  }).join('');
  const totals = `
    ${dashes(y + 6)}
    ${dottedLine(y + 28, 'ITEMS', '7', 13)}
    ${dottedLine(y + 48, 'LIVE', '5', 13)}
    ${dottedLine(y + 68, 'PROTOTYPE', '2', 13)}
    ${dashes(y + 84, true)}
    ${dottedLine(y + 110, 'TOTAL LIVE', '5', 16, 700)}
    ${dashes(y + 124, true)}
    <text x="${WIDTH / 2}" y="${y + 152}" text-anchor="middle" font-size="12" letter-spacing="3.2" font-family="${FONT}" fill="${INK}">THANK YOU FOR LOOKING</text>
    ${barcodeSvg(64, y + 166, 272, 38)}
    <text x="${WIDTH / 2}" y="${y + 222}" text-anchor="middle" font-size="10" letter-spacing="3.4" font-family="${FONT}" fill="${INK}">BRYTONZOZ/SHIPPED</text>
  `;
  const paperHeight = y + 236;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0b0c"/>
  <g transform="translate(400 18) rotate(-1.15 200 ${paperHeight / 2})">
    ${serration(0, false)}
    <rect y="10" width="${WIDTH}" height="${paperHeight - 20}" fill="${PAPER}"/>
    ${header}
    ${meta}
    ${itemLines}
    ${totals}
    ${serration(paperHeight - 10, true)}
  </g>
</svg>`;
}

async function main() {
  await sharp(Buffer.from(svg())).jpeg({ quality: 88, mozjpeg: true }).toFile(OUT);
  const info = await sharp(OUT).metadata();
  console.log(`shipped og: ${OUT} (${info.width}×${info.height})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
