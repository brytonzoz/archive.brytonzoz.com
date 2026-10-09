// How Shipped names itself: its own title, home-screen name and description. The Bryton Zoz credit
// is only the small "made by" line on the page, never in metadata, JSON-LD or the manifest.
import { EVENT_NAME } from './shipped-event';
import { shippedYear, SITE_YEAR } from './shipped-year';

export const SHIPPED_APP_TITLE = EVENT_NAME;
export const SHIPPED_TITLE = `${EVENT_NAME}: the public receipt printer`;
/** Year is passed at request time on the Worker so isolate-start Date (1970) cannot leak. */
export const shippedDescription = (year?: string | number | null) =>
  `Print a free receipt of everything you publicly shipped in ${shippedYear(year ?? SITE_YEAR)}: apps, launches, repos, releases, sites. Two weeks only.`;
export const SHIPPED_DESCRIPTION = shippedDescription();
export const SHIPPED_MANIFEST_NAME = EVENT_NAME;
export const SHIPPED_MANIFEST_SHORT = 'Shipped';
