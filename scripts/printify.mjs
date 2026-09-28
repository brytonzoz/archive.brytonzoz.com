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
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${API}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'user-agent': 'brytonzoz.com-site',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
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
  throw new Error(`${method} ${route}: rate limited`);
}

async function inspect() {
  const shops = await printify('GET', '/shops.json');
  console.log('## Shops');
  for (const shop of shops) console.log(`- ${shop.id} · ${shop.title} · channel: ${shop.sales_channel}`);
  const uploads = await printify('GET', '/uploads.json?limit=100');
  console.log(`\n## Uploaded images (${uploads.total ?? uploads.data?.length ?? 0})`);
  for (const upload of uploads.data ?? []) {
    console.log(`- ${upload.id} · ${upload.file_name} · ${upload.width}x${upload.height} · ${upload.mime_type} · ${upload.preview_url}`);
  }
  for (const shop of shops) {
    const products = await printify('GET', `/shops/${shop.id}/products.json?limit=50`);
    console.log(`\n## Products in ${shop.title} (${products.total ?? products.data?.length ?? 0})`);
    for (const product of products.data ?? []) {
      const enabled = product.variants?.filter((variant) => variant.is_enabled).length;
      console.log(`- ${product.id} · ${product.title} · blueprint ${product.blueprint_id} · provider ${product.print_provider_id} · ${enabled} variants · visible ${product.visible}`);
      for (const image of (product.images ?? []).slice(0, 3)) console.log(`    mockup: ${image.src} (${image.position}${image.is_default ? ', default' : ''})`);
    }
  }
}

const command = process.argv[2] ?? 'inspect';
if (command === 'inspect') await inspect();
else if (command === 'sync') await (await import('./printify-sync.mjs')).sync(printify, ROOT);
else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
