import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Line, Rule, Ticket } from '../../../components/shipped/paper';
import { ARTIST } from '../../../lib/artist';
import { money } from '../../../lib/shipped-receipt';
import { SPONSOR_CONFIG, SPONSOR_TIERS } from '../../../lib/shipped-sponsors';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Refund policy: sponsor lines | Shipped' },
  description: 'How refunds work for sponsor lines on brytonzoz.com/shipped.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="text-[12px] font-semibold tracking-[0.18em]">{title}</h2>
      <div className="mt-1.5 space-y-2 text-[12.5px] leading-relaxed text-[#1c1917]/85">{children}</div>
    </section>
  );
}

export default function RefundsPage() {
  return (
    <Ticket label="Refund policy">
      <article>
        <header className="text-center">
          <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SPONSOR LINES</p>
          <h1 className="mt-2 text-[20px] font-semibold tracking-[0.2em]">REFUND POLICY</h1>
        </header>
        <div className="mt-3">
          <Rule />
        </div>

        <Section title="WHAT YOU’RE BUYING">
          <p>
            A printed line or placement on brytonzoz.com/shipped. It isn’t a donation, there’s no goal it funds, and there are no
            prizes. Roll 1 prices:
          </p>
          <div className="space-y-1">
            {SPONSOR_TIERS.map((tier) => (
              <Line key={tier} label={SPONSOR_CONFIG.tiers[tier].label} value={money(SPONSOR_CONFIG.tiers[tier].baseCents)} />
            ))}
          </div>
          <p>
            Each roll holds {SPONSOR_CONFIG.rollSize} lines. When one fills up it’s archived and the next roll’s prices step up. A HEADER
            runs for {SPONSOR_CONFIG.headerDays} days from approval, with up to {SPONSOR_CONFIG.headerSlots} at a time.
          </p>
        </Section>

        <Section title="REVIEW FIRST">
          <p>
            Every line is reviewed by hand before it prints. If it isn’t approved, you’re refunded in full automatically to the way you
            paid. Nothing shows on the site until it’s approved.
          </p>
        </Section>

        <Section title="AFTER IT PRINTS">
          <p>
            Approved lines are final. If a line is taken down because it breaks the rules (hate, adult content, scams, impersonation,
            anything illegal, or a link that changes into one of those), there’s no refund. If it’s taken down for any other reason, or a
            HEADER can’t run its full {SPONSOR_CONFIG.headerDays} days, you’re refunded in full.
          </p>
        </Section>

        <Section title="PAYMENTS">
          <p>Payments, sales tax and receipts are handled by the payment provider shown at checkout.</p>
        </Section>

        <Section title="QUESTIONS">
          <p>
            Email{' '}
            <a href={`mailto:${ARTIST.email}`} className="shipped-link">
              {ARTIST.email}
            </a>
            .
          </p>
        </Section>

        <p className="mt-5 text-center text-[12px]">
          <Link href="/shipped/#sponsor" className="shipped-link font-semibold">
            Back to the sponsor desk
          </Link>
        </p>
      </article>
    </Ticket>
  );
}
