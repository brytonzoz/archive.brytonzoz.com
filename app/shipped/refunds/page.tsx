import React from 'react';
import type { Metadata } from 'next';
import { Line, Rule, Ticket } from '../../../components/shipped/paper';
import { ARTIST } from '../../../lib/artist';
import { money } from '../../../lib/shipped-receipt';
import { SPONSOR_CONFIG, SPONSOR_TIERS } from '../../../lib/shipped-sponsors';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Refund policy: supporter shout-outs | Shipped' },
  description: 'How refunds work for supporter shout-outs on shipped.brytonzoz.com.',
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
          <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SUPPORTER SHOUT-OUTS</p>
          <h1 className="mt-2 text-[20px] font-semibold tracking-[0.2em]">REFUND POLICY</h1>
        </header>
        <div className="mt-3">
          <Rule />
        </div>

        <Section title="WHAT YOU’RE BUYING">
          <p>
            A supporter shout-out: your name or logo in the THIS RECEIPT PAID FOR BY block on the Shipped receipts people print and
            share at shipped.brytonzoz.com (their pages and share images), plus a downloadable image of your supporter receipt. Lines
            rotate, so each receipt shows a few of the running lines at a time. It isn’t on Bryton’s own receipt. It isn’t a donation or
            advertising: no traffic, clicks, views, impressions or search ranking are promised, and links are marked sponsored. There’s
            no goal it funds and there are no prizes. Prices, before tax:
          </p>
          <div className="space-y-1">
            {SPONSOR_TIERS.map((tier) => (
              <Line key={tier} label={`${SPONSOR_CONFIG.tiers[tier].label} · ${SPONSOR_CONFIG.tiers[tier].days} DAYS`} value={money(SPONSOR_CONFIG.tiers[tier].cents)} />
            ))}
          </div>
          <p>
            Each line runs for {SPONSOR_CONFIG.tiers.name.days} days from approval. PRESENTED BY is one sponsor at a time; if it’s taken,
            yours starts when the current one ends.
          </p>
        </Section>

        <Section title="REVIEW FIRST">
          <p>
            Every shout-out is reviewed by hand before it prints. If it isn’t approved, you’re refunded in full (tax included)
            automatically to the way you paid. Nothing shows on the site until it’s approved, and a refunded shout-out comes out of the
            rotation.
          </p>
        </Section>

        <Section title="AFTER IT PRINTS">
          <p>
            Approved lines are final. If a line is taken down because it breaks the rules (hate, adult content, scams, impersonation,
            anything illegal, or a link that changes into one of those), there’s no refund. If it’s taken down for any other reason, or it can’t run its
            full {SPONSOR_CONFIG.tiers.name.days} days, you’re refunded in full.
          </p>
        </Section>

        <Section title="PAYMENTS">
          <p>
            Payments are one-time (no subscription) and handled by Stripe. Sales tax is worked out by Stripe at checkout from your
            billing address and added where it applies. Stripe emails the payment receipt; your supporter receipt image is on the page
            you land on after paying.
          </p>
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
          <a href="/#sponsor" className="shipped-link font-semibold">
            Back to the sponsor desk
          </a>
        </p>
      </article>
    </Ticket>
  );
}
