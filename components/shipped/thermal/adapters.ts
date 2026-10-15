// The site's receipts as ThermalReceipts: a printed visitor receipt (what /api/shipped/receipts/<id> returns,
// rendered on the page by visitor.tsx) and its sponsor slots. Same mapping as VisitorReceipt, so the print,
// the pile and the DOM receipt never disagree.
import { receiptDate } from '../../../lib/shipped';
import { isFirstRun, receiptModules } from '../../../lib/shipped-modules';
import { HERO_SLOT } from '../../../lib/shipped-sponsors';
import { itemDate, itemsShipped, realReceiptItems, receiptNumber, subjectKicker, subjectLabel, type SponsorBlock, type YearReceipt } from '../../../lib/shipped-year';
import type { ThermalReceipt } from './types';

export type LoadedReceipt = { receipt: YearReceipt; sponsors: SponsorBlock | null };

function titleCustomer(raw: string): string {
  const from = raw.match(/^(.+?)\s+(?:from|at|of)\s+.+$/i);
  const name = (from?.[1] || raw).trim();
  if (!name) return raw;
  if (/[a-z]/.test(name) && /[A-Z]/.test(name) && /\s/.test(name)) return name;
  return name.replace(/[A-Za-z][A-Za-z']*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** Only paid ads print attribution; a vacant hero never promotes a small ad into its place. */
export function paidByLines(sponsors: SponsorBlock | null): Pick<ThermalReceipt, 'presented' | 'paidBy'> {
  const slots = (sponsors?.slots ?? []).filter((slot) => !slot.house && slot.name.trim()).sort((a, b) => a.slot - b.slot);
  const hero = slots.find((slot) => slot.slot === HERO_SLOT);
  return {
    presented: hero ? [hero.name.trim(), hero.cta.trim()].filter(Boolean).join(': ') : null,
    paidBy: slots.filter((slot) => slot.slot !== HERO_SLOT).map((slot) => slot.name.trim()),
  };
}

export function fromLoaded({ receipt, sponsors }: LoadedReceipt): ThermalReceipt {
  const who = titleCustomer(subjectLabel(receipt.subject));
  const kicker = subjectKicker(receipt.subject)?.text ?? '';
  const modules = receiptModules({ receipt });
  return {
    id: `r${receipt.id}`,
    year: receipt.year,
    who,
    kicker,
    date: receiptDate(receipt.printedAt),
    number: receiptNumber(receipt.id),
    items: realReceiptItems(receipt.items).map((item) => ({
      name: item.name,
      status: item.status,
      date: itemDate(item.date),
      description: item.description,
      logo: item.logo,
      via: item.via ?? null,
      confidence: item.confidence,
      significance: item.significance,
      source: item.source,
    })),
    count: itemsShipped(receipt),
    note: receipt.note,
    ...paidByLines(sponsors),
    barcode: `SH${receiptNumber(receipt.id)}`,
    deepCut: null,
    badges: receipt.full ? ['FULL'] : [],
    firstRun: isFirstRun(receipt.id),
    full: receipt.full,
    teaser: receipt.full ? null : receipt.upgrade?.teaser ?? null,
    modules: modules.map((band) => ({ id: band.id, title: band.title, lines: band.lines })),
    shipScore: receipt.shipScore,
    printedAt: receipt.printedAt,
  };
}
