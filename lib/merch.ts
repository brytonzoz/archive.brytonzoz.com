import catalog from './merch-catalog.json';
import shareImages from './share-images.json';
import { media, type MediaAsset, type MediaKey } from './media';

// NonParallel tees, printed to order by Printify. lib/merch-catalog.json is written by the Printify
// workflow (scripts/printify-sync.mjs) from printify/products.json; the checkout Worker reads it too.

export type MerchSize = { size: string; variantId: number; price: number };
export type MerchColor = { name: string; slug: string; swatch: string; images: MediaAsset[]; sizes: MerchSize[] };
export type MerchProduct = { slug: string; number: string; name: string; title: string; price: number; colors: MerchColor[]; shareImage?: string };

export const MERCH_PATH = '/nonparallel/';
export const MERCH_KEY_PREFIX = 'np:';
const rawDetails = (catalog.blueprint as { details?: string | string[] } | undefined)?.details;
export const merchDetails: string[] = Array.isArray(rawDetails) ? rawDetails : [];
export const merchBlank = `${catalog.blueprint?.name ?? ''}`.trim();

// Swatch colors for the tee colors Printify names.
const SWATCHES: Record<string, string> = {
  Black: '#111111', White: '#f7f7f5', Navy: '#1f2a44', 'Heather Navy': '#3a4660', Red: '#b3202a', Maroon: '#5b1e2a',
  'Athletic Heather': '#b9b9b6', 'Dark Grey Heather': '#4a4a4c', Asphalt: '#3f4043', 'Heather Mauve': '#b08f94',
  Pink: '#f3c6cf', 'Soft Pink': '#f6d4d9', Natural: '#ece4d3', Cream: '#f1e9d6', 'Heather Blue Lagoon': '#6f9aa8',
  Kelly: '#1d8a4b', 'Heather Forest': '#39513f', Mustard: '#d9a53a', Yellow: '#f6dd4c', Purple: '#5a3d8c', 'Team Purple': '#4b2f86',
  Orange: '#e56a2a', 'Heather Orange': '#e88a57', 'True Royal': '#2553a6', 'Heather True Royal': '#4b6fb5', Aqua: '#2ba6c9',
};
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type RawColor = { name: string; hex: string | null; images: string[]; sizes: MerchSize[] };
type RawProduct = { slug: string; number: string; name: string; title: string; price: number; colors: RawColor[] };

export const merchProducts: MerchProduct[] = (catalog.products as RawProduct[])
  .map((product) => ({
    slug: product.slug,
    number: product.number,
    name: product.name,
    title: product.title,
    price: product.price,
    shareImage: (shareImages as { merchCards?: Record<string, string> }).merchCards?.[product.slug],
    colors: product.colors
      .map((color) => ({
        name: color.name,
        slug: slugify(color.name),
        swatch: color.hex ?? SWATCHES[color.name] ?? '#888888',
        images: color.images.map((key) => media[key as MediaKey]).filter(Boolean),
        sizes: color.sizes,
      }))
      .filter((color) => color.images.length && color.sizes.length),
  }))
  .filter((product) => product.colors.length);

export const merchPath = (product: MerchProduct) => `${MERCH_PATH}${product.slug}/`;

// The grid's cards: one per colorway while there are only a couple of designs (so each tee shows),
// one per design (with its color dots) once there are more.
export type MerchCard = { product: MerchProduct; color: MerchColor; perColor: boolean };
export const merchCards: MerchCard[] = merchProducts.length < 3
  ? merchProducts.flatMap((product) => product.colors.map((color) => ({ product, color, perColor: true }))).slice(0, 4)
  : merchProducts.map((product) => ({ product, color: product.colors[0], perColor: false }));
// In two columns, an odd count ends with a "More soon" card in the free spot; two cards get a wide one under them.
export const merchMoreCard: 'none' | 'slot' | 'wide' = merchCards.length % 2 ? 'slot' : merchCards.length === 2 ? 'wide' : 'none';
// The homepage scene has one screen to fit in: six (or nine) tees sit three across instead.
const sceneColumns: 2 | 3 = merchCards.length >= 5 && merchCards.length % 3 === 0 ? 3 : 2;
export const merchScene = {
  columns: sceneColumns,
  rows: sceneColumns === 3 ? merchCards.length / 3 : Math.ceil(merchCards.length / 2) + (merchMoreCard === 'wide' ? 0.62 : 0),
  // A row's height relative to the grid's width (card + gap + room to float).
  rowHeight: sceneColumns === 3 ? 0.44 : 0.66,
};
export const getMerch = (slug: string) => merchProducts.find((product) => product.slug === slug);
// A tee in the bag: "np:<design>:<Printify variant>". Printify's variant ids name a blank's color and
// size (every white M is the same id), so the design has to be part of the key.
export const merchKey = (product: MerchProduct, variantId: number) => `${MERCH_KEY_PREFIX}${product.slug}:${variantId}`;

export type MerchVariant = { product: MerchProduct; color: MerchColor; size: MerchSize };
const variants = new Map<string, MerchVariant>();
for (const product of merchProducts) {
  for (const color of product.colors) for (const size of color.sizes) variants.set(merchKey(product, size.variantId), { product, color, size });
}
export const merchVariant = (key: string): MerchVariant | undefined => variants.get(key);
