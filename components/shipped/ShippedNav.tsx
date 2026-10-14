'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { WALL_PATH } from '../../lib/shipped-wall';
import { SITE_YEAR } from '../../lib/shipped-year';

const LINKS = [
  { href: '/', label: 'The printer', match: (path: string) => path === '/' || path === '/shipped/' || path === '/shipped' },
  { href: WALL_PATH, label: 'Receipt wall', match: (path: string) => path === WALL_PATH || path === '/shipped/wall/' || path === '/shipped/wall' },
];

export function ShippedNav() {
  const path = usePathname() || '/';
  return (
    <nav className="shipped-nav" aria-label="Shipped">
      <a href="/" className="shipped-wordmark" aria-label="Shipped home" onClick={(event) => {
        if (!LINKS[0].match(path)) return;
        event.preventDefault();
        window.dispatchEvent(new Event('shipped:home'));
      }}>
        <svg width="25" height="29" viewBox="0 0 25 29" fill="none" aria-hidden="true"><path d="M4 2l3 2 3-2 3 2 3-2 3 2 2-2v25l-3-2-3 2-3-2-3 2-3-2-2 2V2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 10h9M8 15h9M8 20h5" stroke="currentColor" strokeWidth="1.6"/></svg>
        shipped<span className="shipped-wordmark-year">{SITE_YEAR}</span><span className="shipped-wordmark-dot">.</span>
      </a>
      <div className="shipped-nav-links">
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={link.match(path) ? 'page' : undefined}
          onClick={(event) => {
            if (link.href !== '/' || !link.match(path)) return;
            event.preventDefault();
            window.dispatchEvent(new Event('shipped:home'));
          }}
        >
          {link.label}
        </a>
      ))}
      </div>
    </nav>
  );
}
