import shareImages from './share-images.json';
import { getRelease, releasePath } from './tracks';

// One source of truth for who the artist is and where the music lives. Used by the site's
// metadata, the JSON-LD search engines read (app/layout.tsx), the footer and the sitemap.
export const SITE_URL = 'https://brytonzoz.com';

export const ARTIST = {
  name: 'Bryton Zoz',
  jobTitle: 'Musician',
  description: 'Bryton Zoz is a musician, producer and designer. Music includes the album SOLENYA, the EP CAUTION and the mixtape Just A Reminder To Live Life.',
  email: 'bryton.p.zoz@gmail.com',
};

// Artist profiles on the streaming services (the footer's "Listen" row).
export const LISTEN_LINKS = [
  { name: 'Spotify', url: 'https://open.spotify.com/artist/2XP6WdGTizwwiIFjuAbGVc' },
  { name: 'Apple Music', url: 'https://music.apple.com/us/artist/bryton-zoz/1822928357' },
  { name: 'YouTube Music', url: 'https://music.youtube.com/channel/UCUj0eTHlcpfBcOLPg4PFBjQ' },
] as const;

// Every verified profile, for schema.org sameAs.
export const ARTIST_PROFILES = [
  ...LISTEN_LINKS.map((link) => link.url),
  'https://www.instagram.com/brytonzoz/',
  'https://www.instagram.com/bryton.archive/',
  'https://www.tiktok.com/@brytonzoz',
  'https://x.com/brytonzoz',
  'https://www.facebook.com/bryton.zoz/',
];

type DiscographyEntry = {
  releaseId: string;
  name: string;
  productionType: 'StudioAlbum' | 'MixtapeAlbum';
  releaseType: 'AlbumRelease' | 'EPRelease';
  datePublished?: string;
  links: string[];
};

const DISCOGRAPHY: DiscographyEntry[] = [
  {
    releaseId: 'solenya',
    name: 'SOLENYA',
    productionType: 'StudioAlbum',
    releaseType: 'AlbumRelease',
    datePublished: '2025-09-01',
    links: [
      'https://open.spotify.com/album/4IGIjZH0MbncPO4zxoZKmZ',
      'https://music.apple.com/us/album/solenya/1833829863',
      'https://music.youtube.com/playlist?list=OLAK5uy_maQeci50syKnfqkO1YRqVtcHyRX2TkoLI',
    ],
  },
  {
    releaseId: 'caution',
    name: 'CAUTION',
    productionType: 'StudioAlbum',
    releaseType: 'EPRelease',
    datePublished: '2025-07-03',
    links: [
      'https://open.spotify.com/album/0tdB9n4bTY3rYYv5AmZU9r',
      'https://music.apple.com/us/album/caution-ep/1824528138',
      'https://music.youtube.com/playlist?list=OLAK5uy_n3mF8_7iuzdI5hN7B_Itc0XERH-F7e2Vg',
    ],
  },
  {
    releaseId: 'just-a-reminder-to-live-life',
    name: 'Just A Reminder To Live Life',
    productionType: 'MixtapeAlbum',
    releaseType: 'AlbumRelease',
    links: ['https://justaremindertolivelife.com'],
  },
];

const ARTIST_ID = `${SITE_URL}/#artist`;

// schema.org graph: the site, the artist, and each release with its streaming pages.
export function artistJsonLd() {
  const releaseImages = shareImages.releases as Record<string, string>;
  const albums = DISCOGRAPHY.map((entry) => {
    const release = getRelease(entry.releaseId);
    const image = releaseImages[entry.releaseId];
    return {
      '@type': 'MusicAlbum',
      '@id': `${SITE_URL}/${entry.releaseId}/#album`,
      name: entry.name,
      url: `${SITE_URL}${release ? releasePath(release) : `/${entry.releaseId}/`}`,
      byArtist: { '@id': ARTIST_ID },
      albumProductionType: `https://schema.org/${entry.productionType}`,
      albumReleaseType: `https://schema.org/${entry.releaseType}`,
      ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
      ...(release ? { numTracks: release.tracks.length } : {}),
      ...(image ? { image: `${SITE_URL}${image}` } : {}),
      sameAs: entry.links,
    };
  });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: ARTIST.name,
        about: { '@id': ARTIST_ID },
      },
      {
        '@type': 'Person',
        '@id': ARTIST_ID,
        name: ARTIST.name,
        jobTitle: ARTIST.jobTitle,
        description: ARTIST.description,
        url: `${SITE_URL}/`,
        sameAs: ARTIST_PROFILES,
      },
      ...albums,
    ],
  };
}
