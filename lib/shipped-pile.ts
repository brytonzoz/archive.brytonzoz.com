// The pile: every receipt whose printer tossed it on. Integration contract for components/shipped/ReceiptPile
// (built separately): GET /api/shipped/pile?before=<id>&limit=<n> returns PileResponse, newest first; page
// with `next` until it's null. After the printer shuts off `frozen` is true and the pile never changes again.
// POST /api/shipped/pile { id, token } tosses a receipt on (token comes back from /api/shipped/print).

export type PileReceipt = {
  id: number;
  /** Who it's made out to, as printed. */
  who: string;
  /** ITEMS SHIPPED (1 for a "potential" receipt). */
  count: number;
  potential: boolean;
  /** First few lines, enough to print a crumpled receipt's face. */
  items: { name: string; status: string }[];
  printedAt: string;
};

export type PileResponse = { receipts: PileReceipt[]; total: number; frozen: boolean; next: number | null };

/** Props the pile slot hands to ReceiptPile. */
export type ReceiptPileProps = {
  /** Fetch more with GET /api/shipped/pile. */
  initial: PileResponse | null;
  /** The visitor's own receipt, to drop on top with a flourish once they toss it. */
  mine: PileReceipt | null;
  /** Grabbing a receipt opens its page. */
  onOpen: (id: number) => void;
  frozen: boolean;
};
