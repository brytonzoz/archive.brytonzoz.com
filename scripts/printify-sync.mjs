// Creates/updates the NonParallel products in Printify from printify/products.json, waits for Printify's
// mockups, saves them to assets-src/merch/<slug>/ and writes lib/merch-catalog.json (what the site and
// the checkout Worker read). Run by .github/workflows/printify.yml; idempotent.
//
// products.json has `designs` (the artwork) and `lines` (a blank: tee, hoodie, sticker, mug…). Every
// line is made in each of its designs. A line's price is either fixed (`price`, `sizePrices`) or, with
// `margin`, worked out from what Printify charges: cost + US shipping + Stripe's fee + the margin.
// A line names its blank by `blueprintId`, or by `find` (regexes tried in order against Printify's
// "brand model title"); without `printProviders`, any US provider that has the colors will do.
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripHtml = (html = '') => html.replace(/<li>/g, '\n• ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

// A variant's color and size (or whatever single option it has), as the site shows them.
const colorOf = (variant, line) => variant.options?.color ?? line.color ?? 'Standard';
const sizeOf = (variant) => variant.options?.size ?? Object.values(variant.options ?? {}).find((value) => value !== variant.options?.color) ?? 'One size';
// Printify mixes ″ and " in sizes: compare them loosely.
const loose = (text) => String(text).replace(/[″”]/g, '"').replace(/[′’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

// Stripe's fee is 2.9% + 30¢: the smallest whole-dollar price that leaves `margin` after cost,
// shipping and the fee.
const autoPrice = (cost, shipping, margin) => Math.ceil((cost + shipping + margin + 30) / 0.971 / 100) * 100;

export async function sync(printify, root) {
  const config = JSON.parse(await fs.readFile(path.join(root, 'printify', 'products.json'), 'utf8'));
  const shopId = config.shopId;

  const existing = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await printify('GET', `/shops/${shopId}/products.json?limit=50&page=${page}`);
    existing.push(...(batch.data ?? []));
    if (!batch.next_page_url) break;
  }

  // Designs already in Printify's uploads, so a design given by URL is only fetched once.
  const uploads = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await printify('GET', `/uploads.json?limit=50&page=${page}`);
    uploads.push(...(batch.data ?? []));
    if (!batch.next_page_url) break;
  }
  const uploadIds = {};
  for (const [key, design] of Object.entries(config.designs)) {
    let uploadId = design.uploadId ?? uploads.find((upload) => upload.file_name === design.fileName)?.id;
    if (!uploadId && design.url) {
      const upload = await printify('POST', '/uploads/images.json', { file_name: design.fileName, url: design.url });
      uploadId = upload.id;
      console.log(`Uploaded ${design.fileName} -> ${uploadId} (${upload.width}x${upload.height})`);
    }
    if (!uploadId) throw new Error(`No upload for design ${key}`);
    uploadIds[key] = uploadId;
  }

  const catalog = { shopId, currency: 'usd', products: [] };
  const report = [];
  const only = process.env.PRINTIFY_ONLY ? new Set(process.env.PRINTIFY_ONLY.split(',')) : null;
  const previous = JSON.parse(await fs.readFile(path.join(root, 'lib', 'merch-catalog.json'), 'utf8').catch(() => '{"products":[]}'));

  let blueprints = null;
  const providerCountry = new Map();
  for (const line of config.lines) {
    try {
      await syncLine(line);
    } catch (error) {
      console.log(`! ${line.name}: ${String(error).slice(0, 300)}; skipped`);
    }
  }

  // US printers for a blueprint. The blueprint's provider list doesn't say where each one prints;
  // the provider itself does. A UK printer charges $25-45 to ship here, so only US ones.
  async function usProviders(blueprintId) {
    const providers = await printify('GET', `/catalog/blueprints/${blueprintId}/print_providers.json`).catch(() => []);
    const ids = [];
    for (const entry of providers) {
      if (!providerCountry.has(entry.id)) {
        const detail = await printify('GET', `/catalog/print_providers/${entry.id}.json`).catch(() => null);
        providerCountry.set(entry.id, detail?.location?.country ?? null);
      }
      if (providerCountry.get(entry.id) === 'US') ids.push(entry.id);
    }
    return ids;
  }

  async function syncLine(line) {
    let providerIds = line.printProviders;
    if (line.blueprintId && !providerIds) providerIds = await usProviders(line.blueprintId);
    // By name: the first matching blank that a US printer makes (also the fallback when the
    // blueprint given has none).
    if ((!line.blueprintId || !providerIds?.length) && line.find) {
      blueprints ??= await printify('GET', '/catalog/blueprints.json');
      const label = (b) => `${b.brand} ${b.model} ${b.title}`;
      const skip = line.exclude ? new RegExp(line.exclude, 'i') : /\(AOP\)|\bEU\b|\(EU\)|UK/;
      search: for (const pattern of [].concat(line.find)) {
        for (const b of blueprints.filter((entry) => new RegExp(pattern, 'i').test(label(entry)) && !skip.test(label(entry))).slice(0, 8)) {
          const ids = await usProviders(b.id);
          if (ids.length) { line.blueprintId = b.id; providerIds = ids; break search; }
        }
      }
    }
    if (!line.blueprintId || !providerIds?.length) {
      console.log(`! ${line.name}: no blank with a US printer${line.find ? ` for ${[].concat(line.find).join(' | ')}` : ''}; skipped`);
      return;
    }
    const blueprint = await printify('GET', `/catalog/blueprints/${line.blueprintId}.json`);
    console.log(`\n# ${line.name}: blueprint ${line.blueprintId} · ${blueprint.brand} ${blueprint.model} · ${blueprint.title}`);
    console.log(`  US printers: ${providerIds.join(', ')}`);
    const details = line.details ?? stripHtml(blueprint.description).split('.:').slice(1).map((part) => part.replace(/\s+/g, ' ').trim().replace(/\.$/, '')).filter(Boolean).slice(0, 5);
    const shippingCache = new Map();
    const variantCache = new Map();

    for (const designKey of line.designs) {
      const design = config.designs[designKey];
      const productSlug = line.slugIsDesign ? designKey : `${line.key}-${designKey}`;
      const title = `NonParallel ${line.name} — ${design.name}`;
      // Skip lines not asked for this run (PRINTIFY_ONLY=hoodie,mug); keep what the catalog had.
      if (only && !only.has(line.key)) {
        const kept = previous.products.find((product) => product.slug === productSlug);
        if (kept) catalog.products.push(kept);
        continue;
      }
      const wantedColors = line.designColors?.[designKey] ?? line.colors ?? null;

      // The first print provider that has every requested color, else the one with the most of them.
      let providerId;
      let variants = [];
      let best = 0;
      const sizes = line.sizes?.map(loose);
      for (const candidate of providerIds.slice(0, 6)) {
        let data;
        try {
          data = variantCache.get(candidate) ?? await printify('GET', `/catalog/blueprints/${line.blueprintId}/print_providers/${candidate}/variants.json?show-out-of-stock=0`);
        } catch {
          continue;
        }
        variantCache.set(candidate, data);
        const list = (data.variants ?? []).filter((variant) =>
          (!wantedColors || wantedColors.includes(colorOf(variant, line))) && (!sizes || sizes.some((wanted) => loose(sizeOf(variant)).startsWith(wanted))));
        const found = new Set(list.map((variant) => colorOf(variant, line))).size;
        if (list.length && found > best) {
          providerId = candidate;
          variants = list.slice(0, 100);
          best = found;
        }
        if (list.length && (!wantedColors || found === wantedColors.length)) break;
      }
      if (!providerId) {
        console.log(`! ${title}: no US provider has ${wantedColors?.join(', ') ?? 'it'}${line.sizes ? ` in ${line.sizes.join(', ')}` : ''}; skipped`);
        continue;
      }
      const positions = new Set(variants.flatMap((variant) => (variant.placeholders ?? []).map((placeholder) => placeholder.position)));
      // Some blanks name their print areas by method (front_dtg, back_dtf): take the first that exists.
      const placements = Object.entries(line.placements)
        .map(([position, spec]) => [[position, `${position}_dtg`, `${position}_dtf`].find((name) => positions.has(name)), spec])
        .filter(([position]) => position);
      if (!placements.length) {
        console.log(`! ${title}: none of ${Object.keys(line.placements).join(', ')} in ${[...positions].join(', ')}; skipped`);
        continue;
      }

      const fixedPrice = (variant) => line.sizePrices?.[sizeOf(variant)] ?? line.price ?? 9900;
      const body = {
        title,
        description: `${title}. ${blueprint.brand} ${blueprint.model}, printed to order.`,
        blueprint_id: line.blueprintId,
        print_provider_id: providerId,
        variants: variants.map((variant) => ({ id: variant.id, price: fixedPrice(variant), is_enabled: true })),
        print_areas: [{
          variant_ids: variants.map((variant) => variant.id),
          placeholders: placements.map(([position, { x, y, scale, angle = 0 }]) => ({
            position,
            images: [{ id: uploadIds[designKey], x, y, scale, angle }],
          })),
        }],
        tags: ['nonparallel', 'brytonzoz.com', line.category],
      };

      const found = existing.find((product) => product.title === title);
      let product;
      try {
        if (found && found.print_provider_id === providerId && found.blueprint_id === line.blueprintId) {
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
          console.log(`Updated ${title} (${product.id})`);
        } else {
          if (found) await printify('DELETE', `/shops/${shopId}/products/${found.id}.json`);
          product = await printify('POST', `/shops/${shopId}/products.json`, body);
          console.log(`Created ${title} (${product.id})`);
        }
      } catch (error) {
        console.log(`! ${title}: ${String(error).slice(0, 300)}; skipped`);
        continue;
      }

      // Prices: fixed, or cost + US shipping + Stripe + margin (Printify's costs are known now).
      if (!shippingCache.has(providerId)) {
        shippingCache.set(providerId, await printify('GET', `/catalog/blueprints/${line.blueprintId}/print_providers/${providerId}/shipping.json`));
      }
      const shipping = shippingCache.get(providerId);
      let fresh = await printify('GET', `/shops/${shopId}/products/${product.id}.json`);
      const shipOf = (id) => shipping.profiles?.find((entry) => entry.variant_ids.includes(id) && entry.countries.includes('US'))?.first_item?.cost ?? 0;
      const costOf = new Map(fresh.variants.map((variant) => [variant.id, variant.cost]));
      const priceOf = new Map(variants.map((variant) => [variant.id, line.margin
        ? autoPrice(costOf.get(variant.id) ?? 0, shipOf(variant.id), line.margin)
        : fixedPrice(variant)]));
      if (line.margin) {
        await printify('PUT', `/shops/${shopId}/products/${product.id}.json`, {
          variants: fresh.variants.map((variant) => ({ id: variant.id, price: priceOf.get(variant.id) ?? variant.price, is_enabled: priceOf.has(variant.id) })),
        });
      }
      for (const variant of variants) {
        const price = priceOf.get(variant.id);
        const fee = Math.round(price * 0.029) + 30;
        report.push(`${productSlug.padEnd(22)} ${`${colorOf(variant, line)} / ${sizeOf(variant)}`.padEnd(26)} price ${price}  cost ${costOf.get(variant.id)}  ship ${shipOf(variant.id)}  stripe ${fee}  left ${price - costOf.get(variant.id) - shipOf(variant.id) - fee}`);
      }

      // Printify renders mockups asynchronously.
      const colorNames = [...new Set(variants.map((variant) => colorOf(variant, line)))];
      let images = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        fresh = await printify('GET', `/shops/${shopId}/products/${product.id}.json`);
        images = fresh.images ?? [];
        if (images.length >= colorNames.length) break;
        await sleep(3000);
      }

      const dir = path.join(root, 'assets-src', 'merch', productSlug);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      const colors = [];
      const sizeOrder = (variant) => {
        const index = (line.sizes ?? []).indexOf(sizeOf(variant));
        return index < 0 ? variants.indexOf(variant) : index;
      };
      for (const color of colorNames.slice(0, line.maxColors ?? 12)) {
        const colorVariants = variants.filter((variant) => colorOf(variant, line) === color).sort((a, b) => sizeOrder(a) - sizeOrder(b));
        const ids = new Set(colorVariants.map((variant) => variant.id));
        // The side with the full design first (the back on apparel), then the front, then the rest.
        const camera = (image) => new URL(image.src).searchParams.get('camera_label') ?? '';
        const lead = line.lead ?? ('back' in line.placements ? 'back' : 'front');
        const rank = (image) => (camera(image).startsWith(lead) ? 0 : camera(image).startsWith('front') ? 1 : 2 + Number(!image.is_default));
        const shots = images
          .filter((image) => image.variant_ids?.some((id) => ids.has(id)))
          .sort((a, b) => rank(a) - rank(b))
          .slice(0, line.shots ?? 4);
        const keys = [];
        const views = [];
        // Which side each photo shows, for the Front / Back switch on apparel (big logo on the back).
        const twoSided = 'front' in line.placements && 'back' in line.placements;
        const sideOf = (shot) => (/^(front|back)(-|$)/.exec(camera(shot)) ?? [])[1] ?? null;
        for (const [n, shot] of shots.entries()) {
          const response = await fetch(shot.src);
          if (!response.ok) continue;
          const file = `${slug(color)}-${n + 1}.jpg`;
          await fs.writeFile(path.join(dir, file), Buffer.from(await response.arrayBuffer()));
          keys.push(`merch/${productSlug}/${slug(color)}-${n + 1}`);
          views.push(sideOf(shot));
        }
        if (!keys.length) continue;
        colors.push({
          name: color,
          hex: colorVariants[0]?.options?.hex ?? null,
          images: keys,
          ...(twoSided ? { views } : {}),
          sizes: colorVariants.map((variant) => ({ size: sizeOf(variant), variantId: variant.id, price: priceOf.get(variant.id) })),
        });
      }
      console.log(`  ${colors.length} colors, ${variants.length} variants`);
      if (!colors.length) continue;

      catalog.products.push({
        slug: productSlug,
        line: line.key,
        lineName: line.name,
        category: line.category,
        name: design.name,
        title,
        printifyId: product.id,
        printProviderId: providerId,
        price: Math.min(...colors.flatMap((color) => color.sizes.map((size) => size.price))),
        blank: `${blueprint.brand} ${blueprint.model}`.trim(),
        details,
        colors,
      });
    }
  }

  catalog.products.forEach((product, index) => { product.number = String(index + 1).padStart(3, '0'); });
  console.log(`\n## Per sale, in cents (US, one item)\n${report.join('\n')}\n`);
  await fs.writeFile(path.join(root, 'lib', 'merch-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote lib/merch-catalog.json (${catalog.products.length} products)`);
}
