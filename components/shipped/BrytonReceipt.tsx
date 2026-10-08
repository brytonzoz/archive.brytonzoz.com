// Bryton's own "SHIPPED IN <year>" receipt: what he started this year (data/shipped/businesses.json),
// then everything from earlier years in short, then the PAID FOR BY block (house lines only: sponsors buy
// space on the receipts visitors print and share, not on this one). Rendered at build time.
import React from 'react';
import { RUNNING_STATUSES, receiptDate, yearGroups } from '../../lib/shipped';
import { SHIPPED_ITEMS, SHIPPED_UPDATED } from '../../lib/shipped-data';
import { HOUSE_SPONSORS, houseLine } from '../../lib/shipped-sponsors';
import { SITE_YEAR, type PaidFor } from '../../lib/shipped-year';
import { Line, Ticket } from './paper';
import { YearReceipt } from './YearReceipt';

const THIS_YEAR = SHIPPED_ITEMS.filter((item) => item.start === SITE_YEAR);
const EARLIER = yearGroups(SHIPPED_ITEMS.filter((item) => item.start !== SITE_YEAR));
const RUNNING = THIS_YEAR.filter((item) => RUNNING_STATUSES.has(item.status)).length;
const DECEASED = THIS_YEAR.filter((item) => item.status === 'DECEASED').length;

function note(): string {
  if (!THIS_YEAR.length) return 'The register is open. Go ship something.';
  const parts = [`${THIS_YEAR.length} things started in ${SITE_YEAR}`, `${RUNNING} still running`];
  if (DECEASED) parts.push(`${DECEASED} already deceased`);
  return `${parts.join(', ')}. Proof over hype.`;
}

const house = (entry: { key: string; text: string; url: string }) => ({ ...entry, tier: 'house' as const, logo: null });

export function BrytonReceipt() {
  const day = Math.floor(Date.parse(SHIPPED_UPDATED) / 86_400_000);
  const paidFor: PaidFor = { presented: null, lines: [house(HOUSE_SPONSORS.main), house(houseLine(day))] };
  return (
    <Ticket label={`Bryton Zoz: shipped in ${SITE_YEAR}`}>
      <YearReceipt
        heading="h1"
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
        after={
          EARLIER.length ? (
            <section className="mt-3" aria-label="Shipped in earlier years">
              <p className="text-center text-[10.5px] font-semibold tracking-[0.24em] text-[#1c1917]/60">ALSO SHIPPED, EARLIER</p>
              {EARLIER.map((group) => (
                <div key={group.label} className="mt-2">
                  <p className="text-[10.5px] font-semibold tracking-[0.24em] text-[#1c1917]/55">{group.label}</p>
                  <ul className="mt-0.5 space-y-0.5 text-[11.5px]">
                    {group.items.map((item) => (
                      <li key={item.name}>
                        <Line label={item.name.toUpperCase()} value={item.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="mt-2 text-center text-[11px]">
                <a href="#archive" className="shipped-link">
                  The full archive, with notes ↓
                </a>
              </p>
            </section>
          ) : null
        }
      />
    </Ticket>
  );
}
