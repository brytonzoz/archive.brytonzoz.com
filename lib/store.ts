import catalog from './store-catalog.json';
import shareImages from './share-images.json';
import { media, type MediaAsset, type MediaKey } from './media';

// Scrapwrk: one-of-a-kind pieces, sold through Stripe Checkout (worker/store.ts). Products and
// prices live in lib/store-catalog.json, which the checkout reads too, so the price charged is
// always the one in that file. Photos: assets-src/store/<slug>/NN.jpg -> `npm run media`.

export type Product = {
  id: string;
  slug: string;
  number: string;
  name: string;
  /** In cents. */
  price: number;
  description: string;
  features: string[];
  material: string;
  size: string;
  images: MediaAsset[];
  shareImage?: string;
};

export type Availability = 'available' | 'held' | 'sold';

export const products: Product[] = catalog.products.map((entry) => ({
  ...entry,
  images: entry.images.map((key) => media[key as MediaKey]),
  shareImage: (shareImages.store as Record<string, { card: string }>)[entry.slug]?.card,
}));

export const STORE_PATH = '/scrapwrk/';
export const productPath = (product: Product) => `${STORE_PATH}${product.slug}/`;
export const getProduct = (slug: string) => products.find((product) => product.slug === slug);
export const productById = (id: string) => products.find((product) => product.id === id);
export const shippingLabel = catalog.shipping.label;

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: catalog.currency.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
