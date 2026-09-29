import type { Metadata } from 'next';
import { CatalogPage } from '@/components/CatalogPage';
import { getFashionProjects } from '@/lib/projects';

export const metadata: Metadata = {
  title: 'Fashion',
  description: 'Fashion by Bryton Zoz, a New York artist and designer: Scrapwrk one-of-one clothing reconstructed from upcycled scraps, and NonParallel apparel.',
  alternates: { canonical: '/fashion/' },
};

export default function FashionPage() {
  return <CatalogPage title="Fashion" projects={getFashionProjects()} />;
}
