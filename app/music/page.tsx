import type { Metadata } from 'next';
import { CatalogPage } from '@/components/CatalogPage';
import { getMusicProjects } from '@/lib/projects';

export const metadata: Metadata = { title: 'Music', alternates: { canonical: '/music/' } };

export default function MusicPage() {
  return <CatalogPage title="Music" projects={getMusicProjects()} />;
}
