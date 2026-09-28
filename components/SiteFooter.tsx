import React from 'react';
import Link from 'next/link';
import { LISTEN_LINKS, SOCIAL_LINKS } from '../lib/artist';

// The same quiet footer on every page: where to listen (plain links, so search engines can follow
// them), socials, and the one understated way to the business page.

const ICONS: Record<(typeof SOCIAL_LINKS)[number]['name'], React.ReactNode> = {
  Instagram: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" />
    </svg>
  ),
  TikTok: (
    <svg width="15" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 2h-3.5v13.4a3.1 3.1 0 1 1-2.2-3V8.8a6.6 6.6 0 1 0 5.7 6.6V8.6a8.2 8.2 0 0 0 4.4 1.3V6.4a4.6 4.6 0 0 1-4.4-4.4Z" />
    </svg>
  ),
  X: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.8 2.5h3.3l-7.2 8.2 8.5 10.8h-6.6l-5.2-6.6-6 6.6H1.3l7.7-8.8L.9 2.5h6.8l4.7 6 5.4-6Zm-1.2 17h1.8L7.5 4.4H5.5l11.1 15.1Z" />
    </svg>
  ),
  Facebook: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.4 21.9v-7.4h2.5l.4-2.9h-2.9V9.8c0-.8.2-1.4 1.4-1.4h1.5V5.8c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H7.9v2.9h2.5v7.4a10 10 0 1 1 3 0Z" />
    </svg>
  ),
};

const LINK =
  'pointer-events-auto rounded-sm text-white/70 transition-colors duration-200 hover:text-white focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60';

export function SiteFooter({ variant = 'page' }: { variant?: 'overlay' | 'page' }) {
  const overlay = variant === 'overlay';
  return (
    <footer
      className={
        overlay
          ? 'pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 via-black/50 via-45% to-transparent px-6 pt-24 text-[13px] [text-shadow:0_1px_10px_rgba(0,0,0,0.55)] sm:px-10'
          : 'mx-auto mt-16 max-w-4xl border-t border-white/[0.08] px-5 pt-6 text-[13px] sm:px-8'
      }
      style={{ paddingBottom: `calc(max(1.25rem, env(safe-area-inset-bottom)) + var(--player-offset, 0px)${overlay ? '' : ' + 1rem'})` }}
    >
      <nav aria-label="Listen" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-white/40">Listen</span>
        {LISTEN_LINKS.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {link.name}
          </a>
        ))}
      </nav>
      <div className="mt-3 flex items-center justify-between gap-6">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/55">
          <span className="whitespace-nowrap">
            <span className="font-medium text-white/85">Bryton Zoz</span>
            <span className="ml-2">&copy; 2026</span>
          </span>
          <span className="text-white/25" aria-hidden="true">·</span>
          <Link href="/work/" className={`${LINK} whitespace-nowrap !text-white/55 hover:!text-white`}>
            Work with me
          </Link>
        </p>
        <nav aria-label="Social" className="pointer-events-auto flex items-center gap-5">
          {SOCIAL_LINKS.map((link) => (
            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.name} className={LINK}>
              {ICONS[link.name]}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
