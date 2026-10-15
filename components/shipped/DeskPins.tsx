'use client';

// A quiet handful of recent slips on the 1440 desk. Hidden on smaller screens — the wall below still holds the rest.
import React from 'react';
import Link from 'next/link';
import { useShippedState } from './state';

export function DeskPins() {
  const state = useShippedState();
  const pins = (state?.recent ?? []).filter((row) => !row.potential).slice(0, 3);
  return (
    <aside className={`shipped-desk-pins${pins.length ? '' : ' is-empty'}`} aria-label="Recently printed">
      {pins.map((row, index) => (
        <Link key={row.id} href={`/r/${row.id}/`} className={`shipped-desk-pin is-${index}`}>
          <span className="shipped-desk-pin-who">{row.who}</span>
          <span className="shipped-desk-pin-meta">{row.count} item{row.count === 1 ? '' : 's'}</span>
        </Link>
      ))}
    </aside>
  );
}
