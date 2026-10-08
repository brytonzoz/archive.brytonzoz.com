import data from '../data/shipped/businesses.json';
import logos from './shipped-logos.json';
import { toItems, type ShippedData } from './shipped';

export const SHIPPED_DATA: ShippedData = data;
export const SHIPPED_ITEMS = toItems(SHIPPED_DATA, logos);
/** Day the master receipt was last checked (printed as its DATE). */
export const SHIPPED_UPDATED = SHIPPED_DATA.meta.updated;
