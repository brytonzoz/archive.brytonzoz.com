import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReleasePage } from '../../components/release/ReleasePage';
import { jsonLdScript, releaseJsonLd } from '../../lib/artist';
import { releaseMetadata } from '../../lib/release-metadata';
import { getRelease, releases } from '../../lib/tracks';

// brytonzoz.com/<release>/ — one static page per available release.
export const dynamicParams = false;

export function generateStaticParams() {
  return releases.map((release) => ({ release: release.id }));
}

export function generateMetadata({ params }: { params: { release: string } }): Metadata {
  const release = getRelease(params.release);
  return release ? releaseMetadata(release) : {};
}

export default function Page({ params }: { params: { release: string } }) {
  const release = getRelease(params.release);
  if (!release) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(releaseJsonLd(release)) }} />
      <ReleasePage releaseId={params.release} />
    </>
  );
}
