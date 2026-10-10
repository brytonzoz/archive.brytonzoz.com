// The site's receipts as ThermalReceipts: a printed visitor receipt (what /api/shipped/receipts/<id> returns,
// rendered on the page by visitor.tsx) and its sponsor slots. Same mapping as VisitorReceipt, so the print,
// the pile and the DOM receipt never disagree.
import { receiptDate } from '../../../lib/shipped';
import { isFirstRun, receiptModules } from '../../../lib/shipped-modules';
import { itemDate, itemsShipped, receiptNumber, subjectLabel, type SponsorBlock, type YearReceipt } from '../../../lib/shipped-year';
import type { ThermalReceipt } from './types';

export type LoadedReceipt = { receipt: YearReceipt; sponsors: SponsorBlock | null };

const KICKER: Record<YearReceipt['subject']['kind'], string> = {
  github: 'GITHUB',
  x: 'X / TWITTER',
  domain: 'WEBSITE',
  name: 'NAME',
};

function titleCustomer(raw: string): string {
  const from = raw.match(/^(.+?)\s+(?:from|at|of)\s+.+$/i);
  const name = (from?.[1] || raw).trim();
  if (!name) return raw;
  if (/[a-z]/.test(name) && /[A-Z]/.test(name) && /\s/.test(name)) return name;
  return name.replace(/[A-Za-z][A-Za-z']*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** The hero slot prints as "presented by", the grid as the paid-for lines (names only; QR codes stay on the DOM receipt). */
export function paidByLines(sponsors: SponsorBlock | null): Pick<ThermalReceipt, 'presented' | 'paidBy'> {
  const slots = [...(sponsors?.slots ?? [])].sort((a, b) => a.slot - b.slot);
  const [hero, ...grid] = slots;
  return { presented: hero ? `${hero.name}: ${hero.cta}` : null, paidBy: grid.map((slot) => slot.name) };
}

export function fromLoaded({ receipt, sponsors }: LoadedReceipt): ThermalReceipt {
  const who = titleCustomer(subjectLabel(receipt.subject));
  const kicker = receipt.subject.x
    ? `@${receipt.subject.x} · X`
    : receipt.subject.kind === 'github' && receipt.subject.display !== who
      ? `@${receipt.subject.id} · GITHUB`
      : receipt.subject.kind === 'name'
        ? ''
        : KICKER[receipt.subject.kind];
  const modules = receiptModules({ receipt });
  return {
    id: `r${receipt.id}`,
    year: receipt.year,
    who,
    kicker,
    date: receiptDate(receipt.printedAt),
    number: receiptNumber(receipt.id),
    items: receipt.items.map((item) => ({
      name: item.name,
      status: item.status,
      date: itemDate(item.date),
      description: item.description,
      logo: item.logo,
      via: item.via ?? null,
      confidence: item.confidence,
      significance: item.significance,
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
