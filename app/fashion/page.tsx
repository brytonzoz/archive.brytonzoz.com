import type { Metadata } from 'next';
import { CatalogPage } from '@/components/CatalogPage';
import { getFashionProjects } from '@/lib/projects';

export const metadata: Metadata = { title: 'Fashion' };

export default function FashionPage() {
  return <CatalogPage title="Fashion" projects={getFashionProjects()} />;
}
