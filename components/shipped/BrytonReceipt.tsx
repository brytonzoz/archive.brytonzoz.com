// Bryton's own "SHIPPED IN <year>" receipt, the example /shipped/ opens with: what he started this year
// (data/shipped/businesses.json), then the PAID FOR BY block (house lines only: sponsors buy space on the
// receipts visitors print and share, not on this one). Rendered at build time.
import React from 'react';
import { RUNNING_STATUSES, receiptDate } from '../../lib/shipped';
import { SHIPPED_ITEMS, SHIPPED_UPDATED } from '../../lib/shipped-data';
import { HOUSE_SPONSORS, houseLine } from '../../lib/shipped-sponsors';
import { SITE_YEAR, type PaidFor } from '../../lib/shipped-year';
import { YearReceipt } from './YearReceipt';

const THIS_YEAR = SHIPPED_ITEMS.filter((item) => item.start === SITE_YEAR);
export const BRYTON_COUNT = THIS_YEAR.length;
const RUNNING = THIS_YEAR.filter((item) => RUNNING_STATUSES.has(item.status)).length;
const DECEASED = THIS_YEAR.filter((item) => item.status === 'DECEASED').length;

function note(): string {
  if (!THIS_YEAR.length) return 'The register is open. Go ship something.';
  const parts = [`${THIS_YEAR.length} things started in ${SITE_YEAR}`, `${RUNNING} still running`];
  if (DECEASED) parts.push(`${DECEASED} already deceased`);
  return `${parts.join(', ')}. Proof over hype.`;
}

const house = (entry: { key: string; text: string; url: string }) => ({
  ...entry,
  tier: 'house' as const,
  logo: null,
});

export function BrytonReceipt({ compact = false }: { compact?: boolean }) {
  const day = Math.floor(Date.parse(SHIPPED_UPDATED) / 86_400_000);
  const paidFor: PaidFor = {
    presented: null,
    lines: [house(HOUSE_SPONSORS.main), house(houseLine(day))],
  };
  return (
    <YearReceipt
      year={SITE_YEAR}
      who="Bryton Zoz"
      kicker="NEW YORK · ARTIST / BUILDER"
      date={receiptDate(SHIPPED_UPDATED)}
      number="BZ-SHIPPED"
      items={THIS_YEAR.map((item) => ({
        key: item.name,
        name: item.name.toUpperCase(),
        status: item.status,
        date: null,
        description: item.description,
        href: item.link?.href ?? null,
        internal: item.link?.internal,
        logo: item.logo,
      }))}
      count={THIS_YEAR.length}
      note={note()}
      paidFor={paidFor}
      barcode="BRYTONZOZ/SHIPPED"
      compact={compact}
    />
  );
}
