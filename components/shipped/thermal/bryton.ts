// Bryton's own "SHIPPED IN <year>" receipt as a ThermalReceipt: the long sample on /lab/print/.
import { RUNNING_STATUSES, receiptDate } from '../../../lib/shipped';
import { SHIPPED_ITEMS, SHIPPED_UPDATED } from '../../../lib/shipped-data';
import { HOUSE_SLOTS } from '../../../lib/shipped-sponsors';
import { SITE_YEAR } from '../../../lib/shipped-year';
import type { ThermalReceipt } from './types';

export function brytonThermal(compact = false): ThermalReceipt {
  const items = SHIPPED_ITEMS.filter((item) => item.start === SITE_YEAR);
  const running = items.filter((item) => RUNNING_STATUSES.has(item.status)).length;
  const deceased = items.filter((item) => item.status === 'DECEASED').length;
  const parts = [`${items.length} things started in ${SITE_YEAR}`, `${running} still running`];
  if (deceased) parts.push(`${deceased} already deceased`);
  return {
    id: 'house',
    year: SITE_YEAR,
    who: 'Bryton Zoz',
    kicker: 'NEW YORK · ARTIST / BUILDER',
    date: receiptDate(SHIPPED_UPDATED),
    number: 'BZ-SHIPPED',
    items: items.map((item) => ({
      name: item.name.toUpperCase(),
      status: item.status,
      date: null,
      description: item.description,
      logo: item.logo?.src ?? null,
    })),
    count: items.length,
    note: items.length ? `${parts.join(', ')}. Proof over hype.` : 'The register is open. Go ship something.',
    presented: `${HOUSE_SLOTS[0].name}: ${HOUSE_SLOTS[0].cta}`,
    paidBy: HOUSE_SLOTS.slice(1).map((slot) => slot.name),
    barcode: 'BRYTONZOZ/SHIPPED',
    compact,
  };
}
