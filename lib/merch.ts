import catalog from './merch-catalog.json';
import mockupRules from '../printify/mockups.json';
import merchMedia from './merch-media.json';
import shareImages from './share-images.json';
import { unpackMedia, type MediaAsset, type PackedMedia } from './media';
import { merchKey, type MerchCard, type MerchColor, type MerchProduct, type MerchSize, type MerchVariant, type MerchView } from './merch-shared';

// NonParallel merch (tees, hoodies, stickers, mugs…), printed to order by Printify. lib/merch-catalog.json
// is written by the Printify workflow (scripts/printify-sync.mjs) from printify/products.json; the
// checkout Worker reads it too.

export * from './merch-shared';

// Swatch colors for the tee colors Printify names.
const SWATCHES: Record<string, string> = {
  Black: '#111111', White: '#f7f7f5', Navy: '#1f2a44', 'Heather Navy': '#3a4660', Red: '#b3202a', Maroon: '#5b1e2a',
  'Athletic Heather': '#b9b9b6', 'Dark Grey Heather': '#4a4a4c', Asphalt: '#3f4043', 'Heather Mauve': '#b08f94',
  Pink: '#f3c6cf', 'Soft Pink': '#f6d4d9', Natural: '#ece4d3', Cream: '#f1e9d6', 'Heather Blue Lagoon': '#6f9aa8',
  Kelly: '#1d8a4b', 'Heather Forest': '#39513f', Mustard: '#d9a53a', Yellow: '#f6dd4c', Purple: '#5a3d8c', 'Team Purple': '#4b2f86',
  Orange: '#e56a2a', 'Heather Orange': '#e88a57', 'True Royal': '#2553a6', 'Heather True Royal': '#4b6fb5', Aqua: '#2ba6c9',
};
const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The mockups and studio shots (scripts/build-media.mjs), expanded as products use them.
const PACKED = merchMedia as Record<string, PackedMedia>;
const photo = (key: string): MediaAsset | undefined => (PACKED[key] ? unpackMedia(PACKED[key]) : undefined);
const STUDIO_KEYS = Object.keys(PACKED).filter((key) => key.startsWith('merch-studio/')).sort();
const studioKeys = (design: string, color: string) => STUDIO_KEYS.filter((key) => key.startsWith(`merch-studio/${design}/${color}-`));
// Only photographic mockups: printify/mockups.json lists the lines that show studio shots only
// (Printify's are flat drawings) and single mockups to hide (models, blank or cropped frames).
const STUDIO_ONLY = new Set<string>(mockupRules.studioOnly);
const HIDDEN = mockupRules.hide.map((pattern) => new RegExp(pattern));
const showMockup = (line: string | undefined, key: string) => !STUDIO_ONLY.has(line ?? 'tee') && !HIDDEN.some((rule) => rule.test(key));
// Studio shots show the back (the big logo) unless the file says otherwise: black-5-front.jpg.
const studioView = (key: string): MerchView => (key.endsWith('-front') ? 'front' : 'back');
// Size labels as the sheet shows them: only the part that differs between a color's options
// ("11″ x 14″", not "11″ x 14″ · Matte" on every poster; a candle's scent, not "One size · …"),
// and never two buttons with the same label.
function tidySizes(sizes: MerchSize[]): MerchSize[] {
  const parts = sizes.map((size) => size.size.split(' · '));
  const shared = parts.length > 1 ? parts[0].filter((part) => parts.every((other) => other.includes(part))) : [];
  const labelled = sizes.map((size, i) => {
    const kept = parts[i].filter((part) => !shared.includes(part) && !(part === 'One size' && parts[i].length > 1));
    return { ...size, size: kept.join(' · ') || size.size.split(' · ')[0] };
  });
  return labelled.filter((size, i) => labelled.findIndex((other) => other.size === size.size) === i);
}
// Tees synced before views were recorded: Printify's back, front, front, back.
const LEGACY_TEE_VIEWS: MerchView[] = ['back', 'front', 'front', 'back'];

type RawColor = { name: string; hex: string | null; images: string[]; views?: MerchView[]; sizes: MerchSize[] };
type RawProduct = {
  slug: string; number: string; name: string; title: string; price: number; colors: RawColor[];
  line?: string; lineName?: string; category?: string; blank?: string; details?: string[];
};
// Catalogs written before products had lines were all tees.
const legacy = catalog as { blueprint?: { name?: string; details?: string[] } };

export const merchProducts: MerchProduct[] = (catalog.products as RawProduct[])
  .map((product) => ({
    slug: product.slug,
    number: product.number,
    name: product.name,
    displayName: `${product.name} ${product.lineName ?? 'Tee'}`,
    lineName: product.lineName ?? 'Tee',
    line: product.line ?? 'tee',
    category: product.category ?? 'Tees',
    title: product.title,
    price: product.price,
    priceVaries: new Set(product.colors.flatMap((color) => color.sizes.map((size) => size.price))).size > 1,
    blank: product.blank ?? legacy.blueprint?.name ?? '',
    details: product.details ?? legacy.blueprint?.details ?? [],
    shareImage: (shareImages as { merchCards?: Record<string, string> }).merchCards?.[product.slug],
    colors: product.colors
      .map((color) => {
        // Printify's mockups first, then any studio shots in assets-src/merch-studio/<design>/<color>-N.
        const studio = studioKeys(product.slug, slugify(color.name));
        const mockupViews = color.views ?? (product.line ? undefined : LEGACY_TEE_VIEWS.slice(0, color.images.length));
        const pairs = [
          ...color.images.map((key, i) => ({ key, view: mockupViews?.[i] ?? null })).filter(({ key }) => showMockup(product.line, key)),
          ...studio.map((key) => ({ key, view: studioView(key) })),
        ].map((pair) => ({ ...pair, image: photo(pair.key) })).filter((pair): pair is typeof pair & { image: MediaAsset } => Boolean(pair.image));
        return {
          name: color.name,
          slug: slugify(color.name),
          swatch: color.hex ?? SWATCHES[color.name] ?? '#888888',
          images: pairs.map(({ image }) => image),
          views: mockupViews ? pairs.map(({ view }) => view) : undefined,
          sizes: tidySizes(color.sizes),
        };
      })
      .filter((color) => color.images.length && color.sizes.length),
  }))
  .filter((product) => product.colors.length);

// Shop categories in catalog order (the order products.json lists its lines).
export const merchCategories = merchProducts.map((product) => product.category).filter((category, index, all) => all.indexOf(category) === index);
// The homepage scene's best sellers: a 2x2 grid like Scrapwrk's, the rest of the range in the shop
// below it. Listed by product slug (lib/merch-catalog.json); ones that aren't in the catalog are skipped.
const BEST_SELLERS = ['rainbow', 'hoodie-rainbow', 'purple', 'trucker-rainbow'];
export const merchCards: MerchCard[] = [
  ...BEST_SELLERS.map((slug) => merchProducts.find((product) => product.slug === slug)),
  ...merchProducts,
]
  .filter((product, index, all): product is MerchProduct => Boolean(product) && all.indexOf(product) === index)
  .slice(0, 4)
  .map((product) => ({ product, color: product.colors[0], perColor: false }));
export const getMerch = (slug: string) => merchProducts.find((product) => product.slug === slug);

const variants = new Map<string, MerchVariant>();
for (const product of merchProducts) {
  for (const color of product.colors) for (const size of color.sizes) variants.set(merchKey(product, size.variantId), { product, color, size });
}
export const merchVariant = (key: string): MerchVariant | undefined => variants.get(key);
