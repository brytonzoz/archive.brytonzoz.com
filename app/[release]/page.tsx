import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReleasePage } from '../../components/release/ReleasePage';
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
  if (!getRelease(params.release)) notFound();
  return <ReleasePage releaseId={params.release} />;
}
