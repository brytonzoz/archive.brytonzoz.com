import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '../../components/SiteFooter';
import { ARTIST, CLOTHING_LINE, LABEL, LISTEN_LINKS, SITE_URL, jsonLdScript } from '../../lib/artist';
import { releasePath, releases } from '../../lib/tracks';

// brytonzoz.com/about/: who Bryton Zoz is, in plain text. The page search engines and AI answers
// quote; the copy lives in lib/artist.ts so it matches the titles, JSON-LD and public/llms.txt.
export const metadata: Metadata = {
  title: { absolute: `About Bryton Zoz — ${ARTIST.headline}` },
  description: 'About Bryton Zoz, an independent New York artist working across music, fashion and design: the album SOLENYA, Scrapwrk clothing and the NonParallel label.',
  alternates: { canonical: '/about/' },
  openGraph: { type: 'profile', url: '/about/', title: `About Bryton Zoz — ${ARTIST.headline}`, description: ARTIST.description },
};

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': `${SITE_URL}/about/#page`,
  url: `${SITE_URL}/about/`,
  name: `About ${ARTIST.name}`,
  description: ARTIST.description,
  isPartOf: { '@id': `${SITE_URL}/#website` },
  mainEntity: { '@id': `${SITE_URL}/#artist` },
};

const LINK = 'rounded-sm text-white underline decoration-white/25 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(aboutJsonLd) }} />
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-6 sm:px-8 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>

        <h1 className="mt-8 text-[34px] font-bold leading-[1.05] tracking-[-0.03em] sm:mt-12 sm:text-[44px]">Bryton Zoz</h1>
        <p className="mt-3 text-[17px] font-medium text-white/60">{ARTIST.headline}</p>

        <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-white/80">
          {ARTIST.bio.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>

        <section aria-labelledby="work" className="mt-12">
          <h2 id="work" className="text-[13px] font-semibold uppercase tracking-[0.16em] text-white/45">The work</h2>
          <ul className="mt-4 space-y-3 text-[17px] text-white/80">
            {releases.map((release) => (
              <li key={release.id}><Link href={releasePath(release)} className={LINK}>{release.title}</Link> <span className="text-white/45">· music</span></li>
            ))}
            <li><Link href="/scrapwrk/" className={LINK}>{CLOTHING_LINE.name}</Link> <span className="text-white/45">· {CLOTHING_LINE.description.replace(/^One-of-one clothing by Bryton Zoz, /, 'one-of-one clothing, ')}</span></li>
            <li><Link href="/nonparallel/" className={LINK}>{LABEL.name}</Link> <span className="text-white/45">· the independent label and brand</span></li>
          </ul>
        </section>

        <section aria-labelledby="listen" className="mt-12">
          <h2 id="listen" className="text-[13px] font-semibold uppercase tracking-[0.16em] text-white/45">Listen</h2>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[17px]">
            {LISTEN_LINKS.map((link) => <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer me" className={LINK}>{link.name}</a>)}
          </p>
        </section>

        <p className="mt-12 text-[17px] text-white/80">
          Based in {ARTIST.city}. For collaborations, features, production and licensing: <Link href="/work/" className={LINK}>work with Bryton Zoz</Link>.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
