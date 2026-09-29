import type { Metadata } from 'next';
import { SITE_URL } from './artist';
import { MERCH_PATH, merchPath, merchProducts, type MerchProduct } from './merch';
import { formatPrice } from './store';

export const MERCH_DESCRIPTION = 'NonParallel is the independent label and brand behind New York artist Bryton Zoz: tees, hoodies, hats, stickers and more, printed to order with free US shipping.';

export function merchMetadata(product?: MerchProduct): Metadata {
  const title = product ? product.title : 'NonParallel — Label & Merch';
  const description = product
    ? `${product.title}, printed to order. ${product.colors.map((color) => color.name).join(', ')} · from ${formatPrice(product.price)}.`
    : MERCH_DESCRIPTION;
  const url = product ? merchPath(product) : MERCH_PATH;
  const image = product?.shareImage ?? merchProducts[0]?.shareImage;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: 'Bryton Zoz',
      title: product ? product.title : 'NonParallel',
      description,
      images: image ? [{ url: image, width: 1200, height: 630, alt: title }] : undefined,
    },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : undefined },
  };
}

export function merchJsonLd(product: MerchProduct) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    image: product.shareImage ? `${SITE_URL}${product.shareImage}` : undefined,
    url: `${SITE_URL}${merchPath(product)}`,
    brand: { '@type': 'Brand', name: 'NonParallel' },
    color: product.colors.map((color) => color.name).join(', '),
    offers: {
      '@type': 'AggregateOffer',
      url: `${SITE_URL}${merchPath(product)}`,
      priceCurrency: 'USD',
      lowPrice: (Math.min(...product.colors.flatMap((color) => color.sizes.map((size) => size.price))) / 100).toFixed(2),
      highPrice: (Math.max(...product.colors.flatMap((color) => color.sizes.map((size) => size.price))) / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
    },
  };
}
