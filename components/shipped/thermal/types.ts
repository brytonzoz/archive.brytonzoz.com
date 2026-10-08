// Shared shapes for the thermal-print pieces (components/shipped/print/, components/shipped/pile/).
// A ThermalReceipt is the "SHIPPED IN <year>" receipt as plain data (what YearReceipt.tsx renders as DOM);
// layout.ts turns it into ESC/POS-style print lines, raster.ts burns those lines into dots on a canvas.

export type ThermalItem = {
  name: string;
  status: string;
  /** "MAR 14", "MAR 2026", or null. */
  date: string | null;
  description: string;
  /** Same-origin URL of a 1-bit logo (already dithered), or null. */
  logo?: string | null;
};

export type ThermalReceipt = {
  /** Stable seed: the same receipt always prints, tears and crumples the same way. */
  id: string;
  year: number;
  /** Customer line, printed double height. */
  who: string;
  kicker?: string | null;
  /** "08 OCT 2026". */
  date: string;
  /** "000123" or "BZ-SHIPPED" (printed as #number). */
  number: string;
  items: ThermalItem[];
  /** ITEMS SHIPPED total (a "potential" receipt counts 1 with no items). */
  count: number;
  note: string;
  /** THIS RECEIPT WAS PAID FOR BY: the presenting sponsor (optional) and the lines. */
  presented?: string | null;
  paidBy: string[];
  barcode: string;
  /** Item names and statuses only (the opening example). */
  compact?: boolean;
};

export type Align = 'left' | 'center' | 'right';

/**
 * One line as the printer sees it. Everything is set on a 48-column grid (ESC/POS Font A on 80 mm paper:
 * 12 x 24 dots per character, 576 printable dots). `tall` is ESC ! double height; `invert` is GS B.
 */
export type PrintLine =
  | { kind: 'text'; text: string; align: Align; bold?: boolean; tall?: boolean; invert?: boolean; small?: boolean; faint?: boolean; boxed?: boolean }
  | { kind: 'lead'; left: string; right: string; bold?: boolean; tall?: boolean; small?: boolean; faint?: boolean; boxed?: boolean }
  | { kind: 'rule'; heavy?: boolean; boxed?: boolean }
  | { kind: 'feed'; dots: number; boxed?: boolean }
  | { kind: 'box-top' }
  | { kind: 'box-bottom' }
  | { kind: 'barcode'; value: string; height: number }
  | { kind: 'logo'; src: string; align: Align; boxed?: boolean };

export type PrintDoc = {
  seed: string;
  lines: PrintLine[];
  /** Plain-text version for screen readers and copy. */
  text: string;
};

/** Where each printed line landed on the raster, in dots from the top of the paper. */
export type Band = { y: number; height: number; /** share of the band's dots that are inked, 0..1 */ ink: number; kind: PrintLine['kind'] };
