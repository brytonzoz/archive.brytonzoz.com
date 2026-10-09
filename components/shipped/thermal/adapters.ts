// The site's receipts as ThermalReceipts: a printed visitor receipt (what /api/shipped/receipts/<id> returns,
// rendered on the page by visitor.tsx) and its sponsor slots. Same mapping as VisitorReceipt, so the print,
// the pile and the DOM receipt never disagree.
import { receiptDate } from '../../../lib/shipped';
import { isFirstRun, itemsForPrint, pickDeepCut, receiptBadges, receiptModules } from '../../../lib/shipped-modules';
import { itemDate, itemsShipped, receiptNumber, subjectLabel, type SponsorBlock, type YearReceipt } from '../../../lib/shipped-year';
import type { ThermalReceipt } from './types';

export type LoadedReceipt = { receipt: YearReceipt; sponsors: SponsorBlock | null };

const KICKER: Record<YearReceipt['subject']['kind'], string> = {
  github: 'GITHUB',
  x: 'X / TWITTER',
  domain: 'WEBSITE',
  name: 'NAME',
};

/** The hero slot prints as "presented by", the grid as the paid-for lines (names only; QR codes stay on the DOM receipt). */
export function paidByLines(sponsors: SponsorBlock | null): Pick<ThermalReceipt, 'presented' | 'paidBy'> {
  const slots = [...(sponsors?.slots ?? [])].sort((a, b) => a.slot - b.slot);
  const [hero, ...grid] = slots;
  return { presented: hero ? `${hero.name}: ${hero.cta}` : null, paidBy: grid.map((slot) => slot.name) };
}

export function fromLoaded({ receipt, sponsors }: LoadedReceipt): ThermalReceipt {
  const who = subjectLabel(receipt.subject);
  const kicker = receipt.subject.kind === 'github' && receipt.subject.display !== who ? `@${receipt.subject.id} · GITHUB` : KICKER[receipt.subject.kind];
  const ordered = itemsForPrint(receipt.potential ? [] : receipt.items);
  const cut = pickDeepCut(ordered);
  const modules = receiptModules({ receipt });
  return {
    id: `r${receipt.id}`,
    year: receipt.year,
    who: receipt.subject.kind === 'github' ? receipt.subject.display : who,
    kicker,
    date: receiptDate(receipt.printedAt),
    number: receiptNumber(receipt.id),
    items: (receipt.potential ? receipt.items : ordered).map((item) => ({
      name: item.name,
      status: item.status,
      date: itemDate(item.date),
      description: item.description,
      logo: item.logo,
    })),
    count: itemsShipped(receipt),
    note: receipt.note,
    ...paidByLines(sponsors),
    barcode: `SH${receiptNumber(receipt.id)}`,
    deepCut: cut ? { name: cut.name, why: `Sourced · ${cut.source}` } : null,
    badges: receiptBadges(modules),
    firstRun: isFirstRun(receipt.id),
  };
}
