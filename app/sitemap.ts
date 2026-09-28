import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/artist';
import { productPath, products, STORE_PATH } from '../lib/store';
import { releasePath, releases, trackPath } from '../lib/tracks';

// brytonzoz.com/sitemap.xml: the homepage, every release and song page, and the Scrapwrk store.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    ...releases.map((release) => ({ url: `${SITE_URL}${releasePath(release)}`, changeFrequency: 'monthly' as const, priority: 0.9 })),
    ...releases.flatMap((release) =>
      release.tracks.map((track) => ({ url: `${SITE_URL}${trackPath(track)}`, changeFrequency: 'yearly' as const, priority: 0.6 })),
    ),
    { url: `${SITE_URL}${STORE_PATH}`, changeFrequency: 'weekly', priority: 0.8 },
    ...products.map((product) => ({ url: `${SITE_URL}${productPath(product)}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
    { url: `${SITE_URL}/music/`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/fashion/`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/work/`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
