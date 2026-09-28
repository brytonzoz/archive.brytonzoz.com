// Creates/updates the NonParallel tees in Printify from printify/products.json, waits for Printify's
// mockups, saves them to assets-src/merch/<slug>/ and writes lib/merch-catalog.json (what the site and
// the checkout Worker read). Run by .github/workflows/printify.yml; idempotent.
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripHtml = (html = '') => html.replace(/<li>/g, '\n• ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

export async function sync(printify, root) {
  const config = JSON.parse(await fs.readFile(path.join(root, 'printify', 'products.json'), 'utf8'));
  const shopId = config.shopId;
  const blueprint = await printify('GET', `/catalog/blueprints/${config.blueprintId}.json`);
  console.log(`Blueprint ${blueprint.id}: ${blueprint.brand} ${blueprint.model} (${blueprint.title})`);

  const existing = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await printify('GET', `/shops/${shopId}/products.json?limit=50&page=${page}`);
    existing.push(...(batch.data ?? []));
    if (!batch.next_page_url) break;
  }

  const catalog = {
    shopId,
    currency: 'usd',
    blueprint: {
      id: blueprint.id,
      name: `${blueprint.brand} ${blueprint.model}`,
      title: blueprint.title,
      // The site's short list from printify/products.json; Printify's own bullets otherwise.
      details: config.details ?? stripHtml(blueprint.description).split('.:').slice(1).map((part) => part.replace(/\s+/g, ' ').trim().replace(/\.$/, '')).filter(Boolean).slice(0, 6),
    },
    products: [],
  };

  // Designs already in Printify's uploads, so a design given by URL is only fetched once.
  const uploads = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await printify('GET', `/uploads.json?limit=50&page=${page}`);
    uploads.push(...(batch.data ?? []));
    if (!batch.next_page_url) break;
  }
  const report = [];

  for (const [index, spec] of config.products.entries()) {
    // Design: an existing upload, a public URL for Printify to fetch, or a file in printify/.
    let uploadId = spec.design.uploadId ?? uploads.find((upload) => upload.file_name === spec.design.fileName)?.id;
    if (!uploadId && spec.design.url) {
      const upload = await printify('POST', '/uploads/images.json', { file_name: spec.design.fileName, url: spec.design.url });
      uploadId = upload.id;
      console.log(`Uploaded ${spec.design.fileName} -> ${uploadId} (${upload.width}x${upload.height})`);
    } else if (!uploadId && spec.design.file) {
      const contents = (await fs.readFile(path.join(root, 'printify', spec.design.file))).toString('base64');
      const upload = await printify('POST', '/uploads/images.json', { file_name: path.basename(spec.design.file), contents });
      uploadId = upload.id;
      console.log(`Uploaded ${spec.design.file} -> ${uploadId}`);
    }
    if (!uploadId) throw new Error(`No design for ${spec.slug}`);

    // First print provider that has every requested color.
    let providerId;
    let variants = [];
    for (const candidate of config.printProviders) {
      const data = await printify('GET', `/catalog/blueprints/${config.blueprintId}/print_providers/${candidate}/variants.json?show-out-of-stock=0`);
      const list = (data.variants ?? []).filter((variant) => spec.colors.includes(variant.options.color) && config.sizes.includes(variant.options.size));
      const colorsFound = new Set(list.map((variant) => variant.options.color));
      if (spec.colors.every((color) => colorsFound.has(color))) {
        providerId = candidate;
        variants = list;
        break;
      }
    }
    if (!providerId) throw new Error(`No print provider has all of ${spec.colors.join(', ')} for ${spec.slug}`);
    const priceOf = (size) => config.sizePrices?.[size] ?? config.price;
    const title = `NonParallel Tee — ${spec.name}`;
    const body = {
      title,
      description: `NonParallel ${spec.name} tee. ${blueprint.brand} ${blueprint.model}, printed to order.`,
      blueprint_id: config.blueprintId,
      print_provider_id: providerId,
      variants: variants.map((variant) => ({ id: variant.id, price: priceOf(variant.options.size), is_enabled: true })),
      print_areas: [{
        variant_ids: variants.map((variant) => variant.id),
        // Small logo on the chest, the full design on the back (or whatever the product overrides).
        placeholders: Object.entries(spec.placements ?? config.placements).map(([position, { x, y, scale }]) => ({
          position,
          images: [{ id: uploadId, x, y, scale, angle: 0 }],
        })),
      }],
      tags: ['nonparallel', 'brytonzoz.com'],
    };

    const found = existing.find((product) => product.title === title);
    let product;
    if (found) {
      // A provider change needs a new product; otherwise update in place.
      if (found.print_provider_id !== providerId) {
        await printify('DELETE', `/shops/${shopId}/products/${found.id}.json`);
        product = await printify('POST', `/shops/${shopId}/products.json`, body);
      } else {
        // Printify keeps every variant of the blueprint on a product (the ones not asked for are
        // disabled), and an update has to list all of them in the print area.
        const current = await printify('GET', `/shops/${shopId}/products/${found.id}.json`);
        const wanted = new Map(body.variants.map((variant) => [variant.id, variant]));
        const all = current.variants ?? [];
        product = await printify('PUT', `/shops/${shopId}/products/${found.id}.json`, {
          ...body,
          variants: all.map((variant) => wanted.get(variant.id) ?? { id: variant.id, price: variant.price, is_enabled: false }),
          print_areas: [{ ...body.print_areas[0], variant_ids: all.map((variant) => variant.id) }],
        });
      }
      console.log(`Updated ${title} (${product.id})`);
    } else {
      product = await printify('POST', `/shops/${shopId}/products.json`, body);
      console.log(`Created ${title} (${product.id})`);
    }

    // Printify renders mockups asynchronously.
    let images = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const fresh = await printify('GET', `/shops/${shopId}/products/${product.id}.json`);
      images = fresh.images ?? [];
      if (images.length >= spec.colors.length) break;
      await sleep(3000);
    }

    const dir = path.join(root, 'assets-src', 'merch', spec.slug);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const colors = [];
    for (const color of spec.colors) {
      const colorVariants = variants.filter((variant) => variant.options.color === color)
        .sort((a, b) => config.sizes.indexOf(a.options.size) - config.sizes.indexOf(b.options.size));
      const ids = new Set(colorVariants.map((variant) => variant.id));
      // The back first (the full design is there), then the front with its chest logo, then the rest.
      const camera = (image) => new URL(image.src).searchParams.get('camera_label') ?? '';
      const rank = (image) => (camera(image) === 'back' ? 0 : camera(image) === 'front' ? 1 : 2 + Number(!image.is_default));
      const shots = images
        .filter((image) => image.variant_ids?.some((id) => ids.has(id)))
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, 4);
      console.log(`  ${color} shots: ${shots.map(camera).join(', ')}`);
      const keys = [];
      for (const [n, shot] of shots.entries()) {
        const response = await fetch(shot.src);
        if (!response.ok) continue;
        const file = `${slug(color)}-${n + 1}.jpg`;
        await fs.writeFile(path.join(dir, file), Buffer.from(await response.arrayBuffer()));
        keys.push(`merch/${spec.slug}/${slug(color)}-${n + 1}`);
      }
      const hex = colorVariants[0]?.options?.hex ?? null;
      colors.push({
        name: color,
        hex,
        images: keys,
        sizes: colorVariants.map((variant) => ({ size: variant.options.size, variantId: variant.id, price: priceOf(variant.options.size) })),
      });
      console.log(`  ${color}: ${keys.length} mockups, ${colorVariants.length} sizes`);
    }

    // What each sale leaves after Printify (tee + both prints + US shipping) and Stripe's fee.
    const fresh = await printify('GET', `/shops/${shopId}/products/${product.id}.json`);
    const shipping = await printify('GET', `/catalog/blueprints/${config.blueprintId}/print_providers/${providerId}/shipping.json`);
    for (const variant of fresh.variants.filter((entry) => entry.is_enabled)) {
      const profile = shipping.profiles?.find((entry) => entry.variant_ids.includes(variant.id) && entry.countries.includes('US'));
      const ship = profile?.first_item?.cost ?? 0;
      const fee = Math.round(variant.price * 0.029) + 30;
      report.push(`${spec.name.padEnd(8)} ${variant.title.padEnd(16)} price ${variant.price}  cost ${variant.cost}  ship ${ship}  stripe ${fee}  left ${variant.price - variant.cost - ship - fee}`);
    }

    catalog.products.push({
      slug: spec.slug,
      number: String(index + 1).padStart(3, '0'),
      name: spec.name,
      title,
      printifyId: product.id,
      printProviderId: providerId,
      price: config.price,
      colors,
    });
  }

  console.log(`\n## Per sale, in cents (US, one tee)\n${report.join('\n')}\n`);
  await fs.writeFile(path.join(root, 'lib', 'merch-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote lib/merch-catalog.json (${catalog.products.length} products)`);
}
