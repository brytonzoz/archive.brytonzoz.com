// NonParallel's types and the helpers that need no catalog data, so the homepage can use them
// without downloading the whole shop (lib/merch.ts has the data; lib/merch-client.ts loads it).
import type { MediaAsset } from './media';

export type MerchSize = { size: string; variantId: number; price: number };
export type MerchView = 'front' | 'back' | null;
/** `views` (apparel only) says which side each photo shows. */
export type MerchColor = { name: string; slug: string; swatch: string; images: MediaAsset[]; views?: MerchView[]; sizes: MerchSize[] };
export type MerchProduct = {
  slug: string;
  number: string;
  /** The design ("Rainbow"). */
  name: string;
  /** The design and the item together ("Rainbow Hoodie"). */
  displayName: string;
  /** What the item is ("Hoodie"), and its shop category ("Hoodies"). */
  lineName: string;
  line: string;
  category: string;
  title: string;
  price: number;
  /** Starting price differs by size or color. */
  priceVaries: boolean;
  blank: string;
  details: string[];
  colors: MerchColor[];
  shareImage?: string;
};

export const MERCH_PATH = '/nonparallel/';
export const MERCH_KEY_PREFIX = 'np:';

export type MerchCard = { product: MerchProduct; color: MerchColor; perColor: boolean };
export type MerchVariant = { product: MerchProduct; color: MerchColor; size: MerchSize };

export const merchPath = (product: MerchProduct) => `${MERCH_PATH}${product.slug}/`;
// "Black tee", or just "Mug" for things that come one way (Printify calls that color "Standard").
export const colorName = (color: MerchColor) => (color.name === 'Standard' ? '' : color.name);
export const variantLabel = (product: MerchProduct, color: MerchColor) => {
  const text = [colorName(color), product.lineName.toLowerCase()].filter(Boolean).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
// A tee in the bag: "np:<design>:<Printify variant>". Printify's variant ids name a blank's color and
// size (every white M is the same id), so the design has to be part of the key.
export const merchKey = (product: MerchProduct, variantId: number) => `${MERCH_KEY_PREFIX}${product.slug}:${variantId}`;
export const isMerchKey = (key: string) => key.startsWith(MERCH_KEY_PREFIX);
