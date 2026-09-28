import type { MetadataRoute } from 'next';
import shareImages from '../lib/share-images.json';

// "Add to Home Screen" / install: opens full screen like an app, with the album art as its icon.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bryton Zoz',
    short_name: 'Bryton Zoz',
    description: 'Music by Bryton Zoz.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['music', 'entertainment', 'shopping'],
    // Long-press the home-screen icon for these.
    shortcuts: [
      { name: 'Scrapwrk', short_name: 'Scrapwrk', url: '/scrapwrk/' },
      { name: 'SOLENYA', short_name: 'SOLENYA', url: '/solenya/' },
    ],
    icons: [
      { src: shareImages.icons['192'], sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: shareImages.icons['512'], sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: shareImages.icons['512'], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
