'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { WALL_PATH } from '../../lib/shipped-wall';

const LINKS = [
  { href: '/', label: 'Print', match: (path: string) => path === '/' || path === '/shipped/' || path === '/shipped' },
  { href: WALL_PATH, label: 'The wall', match: (path: string) => path === WALL_PATH || path === '/shipped/wall/' || path === '/shipped/wall' },
];

export function ShippedNav() {
  const path = usePathname() || '/';
  return (
    <nav className="shipped-nav" aria-label="Shipped">
      {LINKS.map((link) => (
        <a key={link.href} href={link.href} aria-current={link.match(path) ? 'page' : undefined}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
