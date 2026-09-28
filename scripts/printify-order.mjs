// One-off Printify orders at cost (samples for Bryton), run by .github/workflows/printify-order.yml.
// The address comes from the workflow's inputs (environment), never from the repo. It always asks
// Printify for the real price first; it only buys when ORDER_MODE=place and cost + shipping is within
// ORDER_MAX_CENTS, the total Bryton approved.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function order(printify, root) {
  const env = process.env;
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'lib', 'merch-catalog.json'), 'utf8'));
  const product = catalog.products.find((entry) => entry.slug === env.ORDER_DESIGN);
  const color = product?.colors.find((entry) => entry.name.toLowerCase() === (env.ORDER_COLOR ?? '').toLowerCase());
  const size = color?.sizes.find((entry) => entry.size === env.ORDER_SIZE);
  if (!product || !color || !size) throw new Error(`No ${env.ORDER_DESIGN} tee in ${env.ORDER_COLOR} / ${env.ORDER_SIZE}`);

  const [first, ...rest] = (env.ORDER_NAME ?? '').trim().split(/\s+/);
  const address_to = {
    first_name: first,
    last_name: rest.join(' ') || first,
    country: env.ORDER_COUNTRY || 'US',
    region: env.ORDER_STATE,
    address1: env.ORDER_ADDRESS1,
    address2: env.ORDER_ADDRESS2 || '',
    city: env.ORDER_CITY,
    zip: env.ORDER_ZIP,
    ...(env.ORDER_PHONE ? { phone: env.ORDER_PHONE } : {}),
  };
  const line_items = [{ product_id: product.printifyId, variant_id: size.variantId, quantity: 1 }];

  const current = await printify('GET', `/shops/${catalog.shopId}/products/${product.printifyId}.json`);
  const cost = current.variants.find((variant) => variant.id === size.variantId)?.cost;
  const quote = await printify('POST', `/shops/${catalog.shopId}/orders/shipping.json`, { line_items, address_to });
  const shipping = quote.standard;
  const total = cost + shipping;
  console.log(`${product.title} · ${color.name} / ${size.size}: tee ${cost} + standard shipping ${shipping} = ${total} cents (before any tax)`);

  const max = Number(env.ORDER_MAX_CENTS);
  if (env.ORDER_MODE !== 'place') return console.log('Quote only: nothing ordered.');
  if (!Number.isFinite(max) || total > max) throw new Error(`Not ordering: ${total} cents is over the approved ${max}.`);

  const created = await printify('POST', `/shops/${catalog.shopId}/orders.json`, {
    external_id: `sample-${Date.now()}`,
    label: 'Sample for Bryton',
    line_items,
    shipping_method: 1,
    send_shipping_notification: false,
    address_to,
  });
  await printify('POST', `/shops/${catalog.shopId}/orders/${created.id}/send_to_production.json`);
  const placed = await printify('GET', `/shops/${catalog.shopId}/orders/${created.id}.json`);
  console.log(`Ordered: Printify order ${created.id} · status ${placed.status} · total ${placed.total_price} + shipping ${placed.total_shipping} + tax ${placed.total_tax} cents`);
}
