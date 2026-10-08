// The site's receipts as ThermalReceipts: a printed visitor receipt (what /api/shipped/receipts/<id> returns,
// rendered on the page by visitor.tsx) and the paid-for block. Same mapping as VisitorReceipt, so the print,
// the pile and the DOM receipt never disagree.
import { receiptDate } from '../../../lib/shipped';
import { itemDate, itemsShipped, receiptNumber, subjectLabel, type PaidFor, type YearReceipt } from '../../../lib/shipped-year';
import type { ThermalReceipt } from './types';

export type LoadedReceipt = { receipt: YearReceipt; paidFor: PaidFor };

const KICKER: Record<YearReceipt['subject']['kind'], string> = {
  github: 'GITHUB',
  x: 'X / TWITTER',
  domain: 'WEBSITE',
  name: 'NAME',
};

export function paidByLines(paidFor: PaidFor): Pick<ThermalReceipt, 'presented' | 'paidBy'> {
  return { presented: paidFor.presented?.text ?? null, paidBy: paidFor.lines.map((line) => line.text) };
}

export function fromLoaded({ receipt, paidFor }: LoadedReceipt): ThermalReceipt {
  const who = subjectLabel(receipt.subject);
  const kicker = receipt.subject.kind === 'github' && receipt.subject.display !== who ? `@${receipt.subject.id} · GITHUB` : KICKER[receipt.subject.kind];
  return {
    id: `r${receipt.id}`,
    year: receipt.year,
    who: receipt.subject.kind === 'github' ? receipt.subject.display : who,
    kicker,
    date: receiptDate(receipt.printedAt),
    number: receiptNumber(receipt.id),
    items: receipt.items.map((item) => ({
      name: item.name,
      status: item.status,
      date: itemDate(item.date),
      description: item.description,
      logo: item.logo,
    })),
    count: itemsShipped(receipt),
    note: receipt.note,
    ...paidByLines(paidFor),
    barcode: `BZ${receiptNumber(receipt.id)}`,
  };
}
