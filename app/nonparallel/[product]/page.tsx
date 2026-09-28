import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MerchPage } from '../../../components/store/MerchPage';
import { jsonLdScript } from '../../../lib/artist';
import { getMerch, merchProducts } from '../../../lib/merch';
import { merchJsonLd, merchMetadata } from '../../../lib/merch-metadata';

// brytonzoz.com/nonparallel/<tee>/ — the link people share for one tee; opens its sheet.
export const dynamicParams = false;

export function generateStaticParams() {
  return merchProducts.map((product) => ({ product: product.slug }));
}

export function generateMetadata({ params }: { params: { product: string } }): Metadata {
  const product = getMerch(params.product);
  return product ? merchMetadata(product) : {};
}

export default function Page({ params }: { params: { product: string } }) {
  const product = getMerch(params.product);
  if (!product) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(merchJsonLd(product)) }} />
      <MerchPage initialProduct={product.slug} />
    </>
  );
}
