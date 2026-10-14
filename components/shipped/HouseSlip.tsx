// What's hanging out of the printer before anyone prints: how it works, in receipt form.
import React from 'react';
import { EVENT_NAME } from '../../lib/shipped-event';
import { SITE_YEAR } from '../../lib/shipped-year';
import { Barcode, Line, Rule, Tall } from './paper';

export function HouseSlip() {
  return (
    <article className="shipped-receipt">
      <header className="text-center">
        <p>
          <Tall className="text-[15px] font-semibold">{EVENT_NAME.toUpperCase()}</Tall>
        </p>
        <p className="mt-1 text-[11px] opacity-75">THE PUBLIC RECEIPT PRINTER</p>
      </header>
      <h2 className="shipped-inverse">YOUR YEAR, ITEMIZED</h2>
      <div className="space-y-1 text-[12px]">
        <Line label="APPS YOU LAUNCHED" value="✓" />
        <Line label="PROJECTS YOU RELEASED" value="✓" />
        <Line label="IDEAS YOU MADE REAL" value="✓" />
        <Line label="CREDIT WHERE IT’S DUE" value="✓" />
      </div>
      <Rule heavy />
      <p className="text-center text-[11.5px] leading-relaxed opacity-80">
        A receipt for the things you actually shipped. Enter a name to see what’s on yours.
      </p>
      <footer className="mt-3 text-center text-[11px]">
        <Barcode value={`SHIPPED${SITE_YEAR}`} />
        <p className="mt-1 opacity-60">YOUR WORK ADDS UP.</p>
      </footer>
    </article>
  );
}
