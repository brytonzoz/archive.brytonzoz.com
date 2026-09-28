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
    blueprint: { id: blueprint.id, name: `${blueprint.brand} ${blueprint.model}`, title: blueprint.title, details: stripHtml(blueprint.description).slice(0, 900) },
    products: [],
  };

  for (const [index, spec] of config.products.entries()) {
    // Design: an existing upload, or a file in printify/ to upload once.
    let uploadId = spec.design.uploadId;
    if (!uploadId && spec.design.file) {
      const contents = (await fs.readFile(path.join(root, 'printify', spec.design.file))).toString('base64');
      const upload = await printify('POST', '/uploads/images.json', { file_name: path.basename(spec.design.file), contents });
      uploadId = upload.id;
      console.log(`Uploaded ${spec.design.file} -> ${uploadId}`);
    }

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
    const priceOf = (size) => (/^(2XL|3XL|4XL|5XL)$/.test(size) ? config.bigSizePrice : config.price);
    const title = `NonParallel Tee — ${spec.name}`;
    const body = {
      title,
      description: `NonParallel ${spec.name} tee. ${blueprint.brand} ${blueprint.model}, printed to order.`,
      blueprint_id: config.blueprintId,
      print_provider_id: providerId,
      variants: variants.map((variant) => ({ id: variant.id, price: priceOf(variant.options.size), is_enabled: true })),
      print_areas: [{
        variant_ids: variants.map((variant) => variant.id),
        placeholders: [{ position: 'front', images: [{ id: uploadId, x: spec.placement.x, y: spec.placement.y, scale: spec.placement.scale, angle: 0 }] }],
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
        product = await printify('PUT', `/shops/${shopId}/products/${found.id}.json`, body);
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
      // Front-facing shots first (the design is on the front), then the rest, no back views.
      const isBack = (image) => image.position === 'back' || /camera_label=back/.test(image.src ?? '');
      const shots = images
        .filter((image) => image.variant_ids?.some((id) => ids.has(id)) && !isBack(image))
        .sort((a, b) => Number(b.position === 'front') - Number(a.position === 'front') || Number(b.is_default) - Number(a.is_default))
        .slice(0, 4);
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

  await fs.writeFile(path.join(root, 'lib', 'merch-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote lib/merch-catalog.json (${catalog.products.length} products)`);
}
