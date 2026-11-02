import React from 'react';

// A number that rolls into place like a mechanical counter: each digit is a strip of 0-9 that
// slides (transform only) to its digit once `on` turns true; columns further right spin more
// and settle later. The strip's digits are CSS-generated (globals.css .odo-strip), so the page's
// text holds only the real value (the sr-only twin), never a run of 0-9s. `entry` rolls it in with
// the page's own entrance, in CSS, before any JavaScript runs.
export function Odometer({ value, on, entry = false }: { value: string; on: boolean; entry?: boolean }) {
  let digit = 0;
  return (
    <>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className={`odo${on ? ' is-on' : ''}${entry ? ' is-entry' : ''}`}>
        {Array.from(value).map((char, index) => {
          if (!/[0-9]/.test(char)) {
            return <span key={index} className="odo-char">{char}</span>;
          }
          const order = digit++;
          const stop = (Math.min(order, 2) * 10) + Number(char);
          return (
            <span key={index} className="odo-col" style={{ '--stop': stop, '--i': order } as React.CSSProperties}>
              <span className="odo-strip" />
            </span>
          );
        })}
      </span>
    </>
  );
}
