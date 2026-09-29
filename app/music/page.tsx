import type { Metadata } from 'next';
import { CatalogPage } from '@/components/CatalogPage';
import { getMusicProjects } from '@/lib/projects';

export const metadata: Metadata = {
  title: 'Music',
  description: 'Music by Bryton Zoz, New York artist and producer: the album SOLENYA, the EP CAUTION and the mixtape Just A Reminder To Live Life. Listen here or on Spotify.',
  alternates: { canonical: '/music/' },
};

export default function MusicPage() {
  return <CatalogPage title="Music" projects={getMusicProjects()} />;
}
