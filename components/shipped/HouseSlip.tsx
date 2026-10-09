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
      <h2 className="shipped-inverse">HOW IT WORKS</h2>
      <div className="space-y-1 text-[12px]">
        <Line label="1. TYPE A NAME OR @HANDLE" value="FREE" />
        <Line label={`2. IT PRINTS YOUR ${SITE_YEAR}`} value="AUTO" />
        <Line label="3. POST IT, PIN IT ON THE WALL" value="FREE" />
        <Line label="MAILED THERMAL PRINT (US)" value="$5" />
      </div>
      <Rule heavy />
      <p className="text-center text-[11.5px] leading-relaxed opacity-80">
        Public, professional work only. Every item links to its source. Two weeks, then the printer shuts off for good.
      </p>
      <footer className="mt-3 text-center text-[11px]">
        <Barcode value={`SHIPPED${SITE_YEAR}`} />
        <p className="mt-1 opacity-60">*** TEAR HERE ***</p>
      </footer>
    </article>
  );
}
