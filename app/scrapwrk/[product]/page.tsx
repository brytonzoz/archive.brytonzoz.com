import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StorePage } from '../../../components/store/StorePage';
import { jsonLdScript } from '../../../lib/artist';
import { getProduct, products } from '../../../lib/store';
import { productJsonLd, storeMetadata } from '../../../lib/store-metadata';

// brytonzoz.com/scrapwrk/<piece>/ — the link people share for one piece; opens its sheet.
export const dynamicParams = false;

export function generateStaticParams() {
  return products.map((product) => ({ product: product.slug }));
}

export function generateMetadata({ params }: { params: { product: string } }): Metadata {
  const product = getProduct(params.product);
  return product ? storeMetadata(product) : {};
}

export default function Page({ params }: { params: { product: string } }) {
  const product = getProduct(params.product);
  if (!product) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product)) }} />
      <StorePage initialProduct={product.slug} />
    </>
  );
}
