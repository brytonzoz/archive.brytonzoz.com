// The "SHIPPED IN <year>" receipt as an ESC/POS print job: the same order and emphasis as YearReceipt.tsx
// (double-height store and customer, one inverse band, dotted leaders, the PAID FOR BY box), set on the
// printer's own grid. Pure: tests and the Worker can call it without a DOM.
import type { Align, PrintDoc, PrintLine, ThermalReceipt } from './types';

/** Font A: 48 columns of 12 x 24 dots. Font B ("small"): 64 columns of 9 x 17 dots. */
export const COLS = 48;
export const COLS_SMALL = 64;

/** Word wrap to `cols`, hard-splitting words that are longer than a line. */
export function wrap(text: string, cols: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let word of words) {
    while (word.length > cols) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Receipt printers only have their code page: keep what IBM Plex Mono and a thermal head can both print. */
export function printable(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e -ÿ·×]/g, '');
}

type Opts = { bold?: boolean; tall?: boolean; small?: boolean; faint?: boolean; boxed?: boolean; invert?: boolean };

function text(lines: PrintLine[], value: string, align: Align, opts: Opts = {}) {
  const cols = (opts.small ? COLS_SMALL : COLS) - (opts.boxed ? 4 : 0);
  for (const part of wrap(printable(value), cols)) lines.push({ kind: 'text', text: part, align, ...opts });
}

/** NAME .......... VALUE; a long name wraps and the leader goes on its last line. */
function lead(lines: PrintLine[], left: string, right: string, opts: Omit<Opts, 'invert'> = {}) {
  const cols = (opts.small ? COLS_SMALL : COLS) - (opts.boxed ? 4 : 0);
  const value = printable(right);
  const room = Math.max(8, cols - value.length - 3);
  const parts = wrap(printable(left), room);
  parts.slice(0, -1).forEach((part) => lines.push({ kind: 'text', text: part, align: 'left', ...opts }));
  lines.push({ kind: 'lead', left: parts[parts.length - 1], right: value, ...opts });
}

export function receiptToDoc(receipt: ThermalReceipt): PrintDoc {
  const lines: PrintLine[] = [];
  const feed = (dots: number, boxed = false) => lines.push({ kind: 'feed', dots, boxed });

  text(lines, `SHIPPED ${receipt.year}`, 'center', { bold: true, tall: true });
  text(lines, 'THE PUBLIC RECEIPT PRINTER', 'center', { small: true, faint: true });
  lines.push({ kind: 'rule' });
  lead(lines, 'DATE', receipt.date);
  lead(lines, 'RECEIPT', `#${receipt.number}`);
  lead(lines, 'CASHIER', 'NIGHT SHIFT');
  if (receipt.firstRun) lead(lines, 'RUN', 'FIRST RUN');
  lines.push({ kind: 'rule' });

  feed(6);
  text(lines, `SHIPPED IN ${receipt.year}`, 'center', { bold: true, invert: true });
  feed(10);
  text(lines, 'CUSTOMER', 'center', { small: true, faint: true });
  text(lines, receipt.who.toUpperCase(), 'center', { bold: true, tall: true });
  if (receipt.kicker) text(lines, receipt.kicker, 'center', { small: true, faint: true });
  if (receipt.badges?.length) text(lines, receipt.badges.join(' · '), 'center', { small: true });
  lines.push({ kind: 'rule' });

  if (receipt.deepCut) {
    feed(6);
    text(lines, 'HOW DID IT KNOW?', 'center', { bold: true, invert: true });
    feed(8);
    text(lines, receipt.deepCut.name, 'center', { bold: true });
    text(lines, receipt.deepCut.why, 'center', { small: true });
    lines.push({ kind: 'rule' });
  }

  lines.push({ kind: 'text', text: `ITEM${' '.repeat(COLS_SMALL - 10)}STATUS`, align: 'left', small: true, faint: true });
  receipt.items.forEach((item, index) => {
    if (index > 0) feed(receipt.compact ? 4 : 12);
    if (item.logo && !receipt.compact) lines.push({ kind: 'logo', src: item.logo, align: 'left' });
    lead(lines, item.name, item.status, { bold: true });
    if (!receipt.compact && (item.description || item.date)) {
      const detail = [item.description, item.date].filter(Boolean).join('  ');
      text(lines, detail, 'left', { small: true });
    }
  });

  lines.push({ kind: 'rule', heavy: true });
  lead(lines, 'ITEMS SHIPPED', String(receipt.count), { bold: true, tall: true });
  lines.push({ kind: 'rule', heavy: true });

  feed(8);
  text(lines, "CASHIER'S NOTE", 'left', { small: true, faint: true });
  text(lines, receipt.note, 'left');
  feed(16);

  lines.push({ kind: 'box-top' });
  text(lines, 'THIS RECEIPT WAS PAID FOR BY', 'center', { small: true, bold: true, boxed: true });
  feed(6, true);
  if (receipt.presented) {
    text(lines, 'PRESENTED BY', 'center', { small: true, boxed: true });
    text(lines, receipt.presented, 'center', { bold: true, tall: true, boxed: true });
    feed(6, true);
  }
  receipt.paidBy.forEach((line, index) => {
    if (index > 0) feed(6, true);
    text(lines, line, 'center', { bold: true, boxed: true });
  });
  lines.push({ kind: 'box-bottom' });

  feed(18);
  lines.push({ kind: 'barcode', value: receipt.barcode, height: 64 });
  text(lines, receipt.barcode, 'center', { small: true, faint: true });
  feed(8);
  text(lines, 'PRINTED AT SHIPPED.BRYTONZOZ.COM', 'center', { small: true });
  text(lines, '*** CUSTOMER COPY ***', 'center', { small: true, faint: true });
  // The paper between the last line and the cutter.
  feed(56);

  return { seed: receipt.id, lines, text: docText(lines) };
}

/** What a screen reader (or a copy) gets: the receipt as plain lines. */
export function docText(lines: PrintLine[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === 'text') out.push(line.text);
    else if (line.kind === 'lead') out.push(`${line.left}: ${line.right}`);
    else if (line.kind === 'barcode') out.push(`[barcode ${line.value}]`);
  }
  return out.join('\n');
}
