import type { Metadata } from 'next';
import shareImages from './share-images.json';
import { formatTime, trackPath, releasePath, type Release, type Track } from './tracks';

const SITE = 'https://brytonzoz.com';

// What each release is, for its search title ("SOLENYA (Album) - Bryton Zoz").
const KIND: Record<string, string> = { solenya: 'Album', caution: 'EP', 'just-a-reminder-to-live-life': 'Mixtape' };

// Link previews (iMessage, Instagram, X, WhatsApp, Discord…) for a release or one of its songs.
export function releaseMetadata(release: Release, track?: Track): Metadata {
  const image = (shareImages.releases as Record<string, string>)[release.id];
  const kind = KIND[release.id];
  const title = track ? `${track.title} · ${release.title}` : kind ? `${release.title} (${kind})` : release.title;
  const description = track
    ? `${track.title} by Bryton Zoz, New York artist and producer, from ${release.title}. ${formatTime(track.durationMs / 1000)}. Listen now.`
    : `${release.title} by Bryton Zoz, New York artist and producer. ${release.tracks.length} songs, written and produced by Bryton Zoz. Listen now.`;
  const url = track ? trackPath(track) : releasePath(release);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: track ? 'music.song' : 'music.album',
      url,
      siteName: 'Bryton Zoz',
      title: track ? `${track.title} by Bryton Zoz` : `${release.title} by Bryton Zoz`,
      description,
      images: image ? [{ url: image, width: 1200, height: 630, alt: `${release.title} cover` }] : undefined,
      ...(track
        ? { duration: Math.round(track.durationMs / 1000), albums: [{ url: `${SITE}${releasePath(release)}`, trackNumber: track.number }] }
        : { songs: release.tracks.map((song) => ({ url: `${SITE}${trackPath(song)}`, trackNumber: song.number })) }),
    },
    twitter: {
      card: 'summary_large_image',
      title: track ? `${track.title} by Bryton Zoz` : `${release.title} by Bryton Zoz`,
      description,
      images: image ? [image] : undefined,
    },
    other: track ? { 'og:audio': `${SITE}${track.src}`, 'og:audio:type': 'audio/mpeg' } : {},
  };
}
