// QR codes for the sponsor block: one per slot, drawn as a single SVG path so the same code prints in the
// page, the share images and the mailed thermal print. Medium error correction and a short /q/<key> URL
// keep it at 29×29 modules, which scans from a phone screen and from 80mm thermal paper (~0.6mm modules).
import qrcode from 'qrcode-generator';

export type Qr = { size: number; path: string };

const cache = new Map<string, Qr>();

/** The code as a path in module units (0..size), quiet zone excluded. */
export function qr(text: string): Qr {
  const hit = cache.get(text);
  if (hit) return hit;
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const runs: string[] = [];
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!code.isDark(row, col)) {
        col++;
        continue;
      }
      let end = col;
      while (end < size && code.isDark(row, end)) end++;
      runs.push(`M${col} ${row}h${end - col}v1h${col - end}z`);
      col = end;
    }
  }
  const out = { size, path: runs.join('') };
  if (cache.size > 200) cache.clear();
  cache.set(text, out);
  return out;
}

/** The QR as an <svg> fragment placed at x,y with the given width (quiet zone included in the width). */
export function qrSvg(text: string, x: number, y: number, width: number, ink: string): string {
  const { size, path } = qr(text);
  const quiet = 2;
  const scale = width / (size + quiet * 2);
  return `<g transform="translate(${x + quiet * scale} ${y + quiet * scale}) scale(${scale})"><path d="${path}" fill="${ink}" shape-rendering="crispEdges"/></g>`;
}
