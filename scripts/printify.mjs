// Printify, driven from GitHub Actions (the token is the PRINTIFY_ACCESS repository secret and never
// leaves CI). Usage: node scripts/printify.mjs inspect | sync
// - inspect: prints the shops, uploaded images and products on the account (no secrets).
// - sync:    creates/updates the NonParallel products described in printify/products.json and
//            writes lib/merch-catalog.json (ids, variants, prices) plus the mockups Printify renders.
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.PRINTIFY_ACCESS;
const API = 'https://api.printify.com/v1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

if (!TOKEN) {
  console.error('PRINTIFY_ACCESS is not set.');
  process.exit(1);
}

export async function printify(method, route, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${API}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'user-agent': 'brytonzoz.com-site',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Rate limits, and Printify's occasional 5xx on requests that are safe to repeat: wait and retry.
    const retry = response.status === 429 || (response.status >= 500 && (method === 'GET' || method === 'PUT'));
    if (retry && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, (response.status === 429 ? 20000 : 3000) * (attempt + 1)));
      continue;
    }
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 300) };
    }
    if (!response.ok) throw new Error(`${method} ${route} -> ${response.status}: ${JSON.stringify(data).slice(0, 600)}`);
    return data;
  }
  throw new Error(`${method} ${route}: no response after retries`);
}

async function inspect() {
  const shops = await printify('GET', '/shops.json');
  console.log('## Shops');
  for (const shop of shops) console.log(`- ${shop.id} · ${shop.title} · channel: ${shop.sales_channel}`);
  const uploads = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await printify('GET', `/uploads.json?limit=50&page=${page}`);
    uploads.push(...(batch.data ?? []));
    if (!batch.next_page_url) break;
  }
  console.log(`\n## Uploaded images (${uploads.length})`);
  for (const upload of uploads) {
    console.log(`- ${upload.id} · ${upload.file_name} · ${upload.width}x${upload.height} · ${upload.mime_type} · ${upload.upload_time ?? ''} · ${upload.preview_url}`);
  }
  for (const shop of shops) {
    // Recent orders: ids, status and references only (no addresses in the public log).
    const orders = await printify('GET', `/shops/${shop.id}/orders.json?limit=10`);
    console.log(`\n## Recent orders in ${shop.title}`);
    for (const order of orders.data ?? []) {
      console.log(`- ${order.id} · ${order.status} · external_id ${order.external_id ?? '-'} · shop_order_id ${order.metadata?.shop_order_id ?? '-'} · label ${order.metadata?.shop_order_label ?? order.label ?? '-'} · total ${order.total_price}+${order.total_shipping} · ${order.created_at}`);
    }
    const products = await printify('GET', `/shops/${shop.id}/products.json?limit=50`);
    console.log(`\n## Products in ${shop.title} (${products.total ?? products.data?.length ?? 0})`);
    for (const product of products.data ?? []) {
      const enabled = product.variants?.filter((variant) => variant.is_enabled).length;
      console.log(`- ${product.id} · ${product.title} · blueprint ${product.blueprint_id} · provider ${product.print_provider_id} · ${enabled} variants · visible ${product.visible}`);
      for (const image of (product.images ?? []).slice(0, 3)) console.log(`    mockup: ${image.src} (${image.position}${image.is_default ? ', default' : ''})`);
    }
  }
}

// Blanks worth selling, by category, with who prints them in the US and what each offers (to plan
// new products: blueprint + provider, colors, sizes, print areas).
const CATEGORIES = {
  stickers: /kiss-cut sticker|die-cut sticker|sticker sheet/i,
  pins: /pin\b|pins\b|enamel|button/i,
  patches: /patch/i,
  keychains: /keychain|key ring/i,
  mugs: /\bmug\b|ceramic mug/i,
  bottles: /water bottle|tumbler|stainless steel bottle/i,
  'phone cases': /phone case|tough case|iphone/i,
  posters: /poster|matte vertical|art print/i,
  canvas: /canvas gallery|framed poster/i,
  'heavyweight tees': /comfort colors 1717|heavyweight.*tee|max heavyweight|garment-dyed heavyweight/i,
  'long sleeves': /long sleeve tee|long sleeve t-shirt/i,
  tanks: /tank top/i,
  hoodies: /hoodie|hooded sweatshirt/i,
  crewnecks: /crewneck sweatshirt/i,
  jackets: /windbreaker|bomber|jacket/i,
  shorts: /shorts/i,
  pants: /sweatpants|joggers/i,
  socks: /socks/i,
  hats: /dad hat|snapback|trucker|bucket hat|corduroy cap/i,
  beanies: /beanie/i,
  totes: /tote bag/i,
  backpacks: /backpack|drawstring bag|duffel/i,
  blankets: /blanket|throw/i,
  pillows: /pillow/i,
  towels: /towel/i,
  'mouse pads': /mouse pad|desk mat/i,
  notebooks: /notebook|journal/i,
  flags: /flag|tapestry/i,
  puzzles: /puzzle/i,
  slides: /slides|sneakers|flip flops/i,
  kids: /toddler|baby|youth/i,
  pets: /pet |dog |cat /i,
};
async function catalog() {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 900)); // Printify's catalog allows ~100 calls/min
  const blueprints = await printify('GET', '/catalog/blueprints.json');
  const out = ['# Printify blanks by category', '', 'Written by `node scripts/printify.mjs catalog` (Printify workflow). One US provider per blank.', ''];
  for (const [category, pattern] of Object.entries(CATEGORIES)) {
    const matches = blueprints.filter((b) => pattern.test(`${b.title} ${b.model} ${b.brand}`)).slice(0, 5);
    out.push(`## ${category}`);
    for (const b of matches) {
      await pause();
      const providers = await printify('GET', `/catalog/blueprints/${b.id}/print_providers.json`);
      const p = providers.find((entry) => (entry.location?.country ?? 'US') === 'US');
      out.push(`- ${b.id} · ${b.brand} ${b.model} · ${b.title}`);
      if (!p) continue;
      await pause();
      const data = await printify('GET', `/catalog/blueprints/${b.id}/print_providers/${p.id}/variants.json?show-out-of-stock=0`);
      const variants = data.variants ?? [];
      const colors = [...new Set(variants.map((v) => v.options.color).filter(Boolean))];
      const sizes = [...new Set(variants.map((v) => v.options.size).filter(Boolean))];
      const areas = [...new Set(variants.flatMap((v) => (v.placeholders ?? []).map((ph) => `${ph.position} ${ph.width}x${ph.height}`)))];
      out.push(`  - provider ${p.id} ${p.title}: ${variants.length} variants · colors ${colors.slice(0, 10).join('/')}${colors.length > 10 ? ` (+${colors.length - 10})` : ''} · sizes ${sizes.join('/')} · areas ${areas.slice(0, 4).join(', ')}`);
    }
    out.push('');
  }
  await fs.writeFile(path.join(ROOT, 'printify', 'catalog.md'), `${out.join('\n')}\n`);
  console.log(`Wrote printify/catalog.md`);
}

const command = process.argv[2] ?? 'inspect';
if (command === 'inspect') await inspect();
else if (command === 'catalog') await catalog();
else if (command === 'sync') await (await import('./printify-sync.mjs')).sync(printify, ROOT);
else if (command === 'order') await (await import('./printify-order.mjs')).order(printify, ROOT);
else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
