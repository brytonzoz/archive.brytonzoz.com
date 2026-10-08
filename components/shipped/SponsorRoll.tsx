'use client';

import React from 'react';
import type { PublicSponsor } from '../../lib/shipped-receipt';
import { SPONSOR_CONFIG } from '../../lib/shipped-sponsors';
import { ExternalLink, Rule } from './paper';
import { useShippedState } from './state';

const pad = (n: number) => String(n).padStart(3, '0');

export function SponsorName({ sponsor }: { sponsor: PublicSponsor }) {
  return sponsor.url ? (
    <ExternalLink href={sponsor.url} sponsored>
      {sponsor.text}
    </ExternalLink>
  ) : (
    <>{sponsor.text}</>
  );
}

function SponsorLine({ sponsor }: { sponsor: PublicSponsor }) {
  return (
    <li className="py-1.5">
      <div className="shipped-lead text-[12.5px]">
        <span className="shrink-0 tabular-nums text-[#1c1917]/55">{pad(sponsor.lineNo)}</span>
        <span className="min-w-0 break-words font-semibold">
          <SponsorName sponsor={sponsor} />
        </span>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <span className="shrink-0 text-[11px] tracking-[0.12em]">{SPONSOR_CONFIG.tiers[sponsor.tier].label}</span>
      </div>
      {sponsor.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sponsor.logo} alt={`${sponsor.text} logo`} loading="lazy" className="shipped-logo mx-auto mt-1.5 max-h-16 w-auto max-w-full" />
      ) : null}
    </li>
  );
}

/** Approved sponsor lines, printed under Bryton's own items. */
export function SponsorRoll() {
  const state = useShippedState();
  if (!state) return null;
  const roll = state.sponsors.roll ?? 1;
  const current = state.lines.filter((line) => line.roll === roll);
  const archived = (state.sponsors.archived ?? []).map((n) => ({ roll: n, lines: state.lines.filter((line) => line.roll === n) }));

  return (
    <section aria-label="Supporter shout-outs" className="mt-1">
      <Rule />
      <p className="shipped-lead mt-2 text-[10px] tracking-[0.16em] text-[#1c1917]/55">
        <span>SUPPORTER SHOUT-OUTS · ROLL {pad(roll)}</span>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <span>
          {state.sponsors.filled ?? current.length}/{state.sponsors.rollSize ?? SPONSOR_CONFIG.rollSize}
        </span>
      </p>
      <ol className="mt-1">
        {current.map((line) => (
          <SponsorLine key={line.id} sponsor={line} />
        ))}
        <li className="py-1.5">
          <a href="#sponsor" className="shipped-lead text-[12.5px] text-[#1c1917]/60 no-underline hover:text-[#1c1917]">
            <span className="shrink-0 tabular-nums">{pad(current.length + 1)}</span>
            <span>YOUR NAME HERE</span>
            <span className="shipped-lead-fill" aria-hidden="true" />
            <span className="shrink-0 text-[11px] tracking-[0.12em]">BUY A LINE</span>
          </a>
        </li>
      </ol>
      {archived.map((past) => (
        <details key={past.roll} className="mt-1 text-[12px]">
          <summary className="cursor-pointer tracking-[0.12em] text-[#1c1917]/70">
            ROLL {pad(past.roll)} · ARCHIVED · {past.lines.length} LINES
          </summary>
          <ol>
            {past.lines.map((line) => (
              <SponsorLine key={line.id} sponsor={line} />
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}
