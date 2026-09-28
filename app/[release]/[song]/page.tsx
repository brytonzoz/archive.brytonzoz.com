import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReleasePage } from '../../../components/release/ReleasePage';
import { releaseMetadata } from '../../../lib/release-metadata';
import { getRelease, releases } from '../../../lib/tracks';

// brytonzoz.com/<release>/<song>/ — the link people share for one song.
export const dynamicParams = false;

export function generateStaticParams() {
  return releases.flatMap((release) => release.tracks.map((track) => ({ release: release.id, song: track.slug })));
}

function find(params: { release: string; song: string }) {
  const release = getRelease(params.release);
  return { release, track: release?.tracks.find((candidate) => candidate.slug === params.song) };
}

export function generateMetadata({ params }: { params: { release: string; song: string } }): Metadata {
  const { release, track } = find(params);
  return release && track ? releaseMetadata(release, track) : {};
}

export default function Page({ params }: { params: { release: string; song: string } }) {
  const { track } = find(params);
  if (!track) notFound();
  return <ReleasePage releaseId={params.release} songSlug={params.song} />;
}
