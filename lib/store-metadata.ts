import type { Metadata } from 'next';
import { SITE_URL } from './artist';
import { formatPrice, productPath, products, STORE_PATH, type Product } from './store';

export const STORE_DESCRIPTION = 'Scrapwrk by Bryton Zoz: one-of-a-kind clothing made from upcycled textile scraps. Every piece is 1 of 1.';

export function storeMetadata(product?: Product): Metadata {
  const title = product ? `Scrapwrk ${product.number}: ${product.name}` : 'Scrapwrk';
  const description = product
    ? `${product.description} 1 of 1 · Size ${product.size} · ${formatPrice(product.price)}.`
    : STORE_DESCRIPTION;
  const url = product ? productPath(product) : STORE_PATH;
  const image = product?.shareImage ?? products[0]?.shareImage;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: 'Bryton Zoz',
      title: product ? `${title} by Bryton Zoz` : 'Scrapwrk by Bryton Zoz',
      description,
      images: image ? [{ url: image, width: 1200, height: 630, alt: product ? `Scrapwrk ${product.name}` : 'Scrapwrk' }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: product ? `${title} by Bryton Zoz` : 'Scrapwrk by Bryton Zoz',
      description,
      images: image ? [image] : undefined,
    },
  };
}

// schema.org Product for a piece's page. Availability is left out: it changes when a piece sells
// and these pages are static.
export function productJsonLd(product: Product) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `Scrapwrk ${product.number}: ${product.name}`,
    description: product.description,
    image: product.shareImage ? `${SITE_URL}${product.shareImage}` : undefined,
    url: `${SITE_URL}${productPath(product)}`,
    brand: { '@type': 'Brand', name: 'Scrapwrk' },
    material: product.material,
    size: product.size,
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}${productPath(product)}`,
      price: (product.price / 100).toFixed(2),
      priceCurrency: 'USD',
    },
  };
}
