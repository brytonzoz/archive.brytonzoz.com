'use client';

// The top of /shipped/: the printer prints Bryton's receipt and tears it off, then PRINT YOURS.
import React, { useState } from 'react';
import { Machine } from './Machine';
import { PrintYours } from './PrintYours';

export function ShippedHero({ children, duration }: { children: React.ReactNode; duration: number }) {
  const [torn, setTorn] = useState(false);
  return (
    <>
      <Machine mode="print" label="Bryton Zoz's Shipped receipt" duration={duration} onTorn={() => setTorn(true)}>
        {children}
      </Machine>
      <PrintYours ready={torn} />
    </>
  );
}
