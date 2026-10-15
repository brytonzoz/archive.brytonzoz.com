#!/usr/bin/env node
// Creates / updates the SHIPPED $3 full receipt and $7 bundle Stripe products
// (same account as the $5 print). Uses price_data at checkout too; this catalog
// entry is for the dashboard and test-mode verification.
// Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/ensure-shipped-stripe-products.mjs
const FULL_PRICE_CENTS = 300;
const BUNDLE_PRICE_CENTS = 700;
const PRINT_PRICE_CENTS = 500;
const FULL_KIND = 'shipped_full';
const BUNDLE_KIND = 'shipped_bundle';

const KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY || '';
if (!KEY) {
  console.log('skip: no STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY');
  process.exit(0);
}
if (!/^(sk|rk)_test_/.test(KEY) && process.env.ALLOW_LIVE_STRIPE !== '1') {
  console.log('skip: refusing to write catalog on a live key (set ALLOW_LIVE_STRIPE=1 to override)');
  process.exit(0);
}

const PRODUCTS = [
  { kind: FULL_KIND, name: 'SHIPPED 2026 Full Receipt', description: 'Deep-pass reprint: X search, company harvest, extra web.', amount: FULL_PRICE_CENTS, tax: 'txcd_10000000' },
  { kind: BUNDLE_KIND, name: 'SHIPPED 2026 Full Receipt + mailed print', description: 'Deep-pass reprint plus 80mm thermal paper mailed in the US.', amount: BUNDLE_PRICE_CENTS, tax: 'txcd_99999999' },
  { kind: 'shipped_print', name: 'SHIPPED 2026 mailed thermal print', description: '80mm thermal paper, mailed in the US.', amount: PRINT_PRICE_CENTS, tax: 'txcd_99999999' },
];

async function stripe(path, body, method = 'GET') {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `Stripe ${response.status}`);
  return data;
}

const listed = await stripe('products?limit=100&active=true');
for (const product of PRODUCTS) {
  const existing = (listed.data ?? []).find((row) => row.metadata?.kind === product.kind);
  const payload = {
    name: product.name,
    description: product.description,
    'metadata[kind]': product.kind,
    'metadata[source]': 'shipped',
    'metadata[amount_cents]': String(product.amount),
    'tax_code': product.tax,
  };
  const saved = existing
    ? await stripe(`products/${existing.id}`, payload, 'POST')
    : await stripe('products', payload, 'POST');
  console.log(JSON.stringify({ kind: product.kind, id: saved.id, amount: product.amount, name: saved.name }));
}
