// "Print my receipt": a visitor's public GitHub, itemized. Shared by the Worker (worker/shipped.ts),
// which builds and stores receipts, and the pages that render them (components/shipped/).

export type PrintStatus = 'SHIPPED' | 'IN PROGRESS' | 'ABANDONED';
export const PRINT_STATUSES: PrintStatus[] = ['SHIPPED', 'IN PROGRESS', 'ABANDONED'];

export type PrintMode = 'flex' | 'roast';
export const PRINT_MODES: PrintMode[] = ['flex', 'roast'];

/** GitHub's username rules: 1–39 characters, letters, digits and single inner hyphens. */
export const GITHUB_USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export type PrintedItem = {
  /** Real repository name (links are built from it, never taken from the model). */
  repo: string;
  name: string;
  status: PrintStatus;
  note: string;
  language: string | null;
  stars: number;
};

export type PrintedCharge = { label: string; cents: number };

export type PrintedReceipt = {
  id: number;
  login: string;
  mode: PrintMode;
  printedAt: string;
  headline: string;
  verdict: string;
  items: PrintedItem[];
  charges: PrintedCharge[];
  stats: { publicRepos: number; followers: number; since: number | null };
  /** Printed without the AI (no API key on staging): real repos, canned jokes. */
  demo: boolean;
};

/** An approved sponsor line, as shown publicly. */
export type PublicSponsor = {
  id: number;
  tier: 'name' | 'logo' | 'header';
  text: string;
  url: string | null;
  /** Same-origin URL of the 1-bit logo, LOGO LINE only. */
  logo: string | null;
  roll: number;
  lineNo: number;
};

export type SponsorFeed = {
  header: PublicSponsor[];
  footer: PublicSponsor[];
};

export const receiptNumber = (id: number) => String(id).padStart(6, '0');

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function printedCounts(receipt: Pick<PrintedReceipt, 'items'>) {
  const count = (status: PrintStatus) => receipt.items.filter((item) => item.status === status).length;
  return { shipped: count('SHIPPED'), inProgress: count('IN PROGRESS'), abandoned: count('ABANDONED') };
}

export const chargesTotal = (receipt: Pick<PrintedReceipt, 'charges'>) =>
  receipt.charges.reduce((sum, charge) => sum + charge.cents, 0);

export const shareText = (receipt: Pick<PrintedReceipt, 'items' | 'login'>) => {
  const counts = printedCounts(receipt);
  return `My GitHub, itemized: ${counts.shipped} shipped, ${counts.inProgress} in progress, ${counts.abandoned} abandoned.`;
};

export const RECEIPT_PATH = (id: number) => `/shipped/r/${id}/`;
