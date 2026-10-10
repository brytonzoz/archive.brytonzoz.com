'use client';

import { useEffect } from 'react';
import { artistJsonLd, jsonLdScript } from '../lib/artist';

/** Inserted after paint so Shipped's Worker can debrand the HTML without crashing React hydrate. */
export function ArtistJsonLd() {
  useEffect(() => {
    if (/\bshipped/.test(window.location.hostname)) return;
    if (document.querySelector('script[data-artist-jsonld]')) return;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.dataset.artistJsonld = '1';
    el.textContent = jsonLdScript(artistJsonLd());
    document.head.appendChild(el);
  }, []);
  return null;
}
