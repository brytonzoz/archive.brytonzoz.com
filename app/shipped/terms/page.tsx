import React from 'react';
import type { Metadata } from 'next';
import { Line, Rule, Ticket } from '../../../components/shipped/paper';
import { ARTIST } from '../../../lib/artist';
import { EVENT_NAME, closingLabel, DEFAULT_CLOSES_AT } from '../../../lib/shipped-event';
import { money } from '../../../lib/shipped-receipt';
import { BID_RULES, SLOT_COUNT, SLOT_LIMITS } from '../../../lib/shipped-sponsors';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: `Terms, refunds & privacy | ${EVENT_NAME}` },
  description: `The rules for ${EVENT_NAME}: free receipts, fixed-price sponsor slots, the $5 mailed print, refunds and what data is kept.`,
};

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4" id={id}>
      <h2 className="text-[12px] font-semibold tracking-[0.18em]">{title}</h2>
      <div className="mt-1.5 space-y-2 text-[12.5px] leading-relaxed text-[#1c1917]/85">{children}</div>
    </section>
  );
}

const Email = () => (
  <a href={`mailto:${ARTIST.email}`} className="shipped-link">
    {ARTIST.email}
  </a>
);

export default function TermsPage() {
  return (
    <Ticket label="Terms, refunds and privacy">
      <article>
        <header className="text-center">
          <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">{EVENT_NAME.toUpperCase()}</p>
          <h1 className="mt-2 text-[20px] font-semibold tracking-[0.2em]">THE FINE PRINT</h1>
          <p className="mt-2 text-[11.5px] text-[#1c1917]/70">Terms, sponsor rules, refunds and privacy, in plain words.</p>
        </header>
        <div className="mt-3">
          <Rule />
        </div>

        <Section title="THE EVENT">
          <p>
            {EVENT_NAME} is a free, two-week public receipt printer. It shuts off on {closingLabel(DEFAULT_CLOSES_AT)} (the countdown on the
            home page is the official clock). After that nothing new prints, the pile and the sponsor block freeze as a permanent archive,
            and the receipts already printed keep working.
          </p>
        </Section>

        <Section title="FREE RECEIPTS">
          <p>
            Printing a receipt is free. A receipt lists public, professional work found on public pages and APIs (GitHub, the App Store,
            Show HN, npm, Product Hunt, the web), itemized by AI. Every item links to the public page it came from. Nothing private is
            looked up or printed. It’s for fun: it isn’t a review, a ranking or a statement about anyone, and it may miss things or get
            them slightly wrong.
          </p>
          <p>
            Don’t use it to harass, mock or target anyone. A name, handle or site is printed at most once a week; printing the same one
            again shows the same receipt.
          </p>
        </Section>

        <Section id="remove" title="REPORT OR REMOVE A RECEIPT">
          <p>
            Every receipt has a “Report or remove this receipt” link. A report takes it down at once (its page, images and cached copies)
            while it’s reviewed. If it’s about you, it stays down and that name, handle or site can’t be printed again. The browser that
            printed a receipt can remove it outright. You can also email <Email />.
          </p>
        </Section>

        <Section id="sponsors" title="SPONSOR SLOTS">
          <p>
            Every receipt, share image and mailed print ends with a sponsor block: {SLOT_COUNT} slots, one hero on top and nine small ones,
            each with a name (or a 1-bit logo), one line of text and a QR code to the sponsor’s https link. Until someone pays for a slot
            it shows a house ad.
          </p>
          <p>
            It’s a fixed price, not an auction or a raffle. Each slot shows one price, set by the site: {money(BID_RULES.minCents)} for a
            house slot, otherwise what the current holder paid plus {money(BID_RULES.incrementCents)}. Paying that price takes the slot
            right away. You keep it until someone pays the next price or the event ends. Whoever holds a slot when the printer shuts off
            keeps it in the archive for good. Slots stop changing hands {BID_RULES.lockMinutes} minutes before close, so nobody can take
            one in the last seconds. No slot goes above {money(BID_RULES.maxCents)}.
          </p>
          <div className="space-y-1">
            <Line label="HERO SLOT" value={`${SLOT_LIMITS.hero.name} + ${SLOT_LIMITS.hero.cta} CHARS`} />
            <Line label="SMALL SLOTS (9)" value={`${SLOT_LIMITS.small.name} + ${SLOT_LIMITS.small.cta} CHARS`} />
          </div>
          <p>
            What you get is the placement, nothing more: no traffic, clicks, scans, views or rankings are promised, and links are marked
            sponsored. Text and links are checked automatically before checkout and can be taken down from the admin at any time. Logos
            are shown only after a person approves them; until then your name prints instead.
          </p>
          <p>
            Not allowed: hate, adult content, gambling, crypto and giveaways, loans, scams or phishing, impersonating another brand or
            person, link shorteners or redirects, anything illegal, and links that later change into any of those. Links must be https
            and go to your own site.
          </p>
        </Section>

        <Section id="refunds" title="SPONSOR REFUNDS">
          <p>All refunds go back automatically to the way you paid, tax included, through Stripe.</p>
          <p>
            <strong>Taken over:</strong> if someone pays the next price for your slot, you’re refunded for the time you lose: what you paid ×
            (time left until close) ÷ (time from your slot going live until close).
          </p>
          <p>
            <strong>Full refund:</strong> if your payment arrives after the price moved, after takeovers lock or after close; if someone else
            paid that price first; if the amount or currency doesn’t match the posted price; or if your slot is taken down in review for any
            reason.
          </p>
          <p>Otherwise payments are final once the event closes.</p>
        </Section>

        <Section id="prints" title="THE $5 MAILED PRINT">
          <p>
            For {money(500)} plus sales tax, your receipt is printed on 80mm thermal paper and mailed. US addresses only; shipping is
            included. Prints go out within about a week of ordering, and orders close when the event does. Thermal paper fades over the years
            in heat and sun; that’s the charm. If it doesn’t arrive or arrives damaged, email <Email /> and it’s reprinted or refunded in
            full. If a print can’t be made (for example the receipt was taken down), you’re refunded in full.
          </p>
        </Section>

        <Section title="PAYMENTS AND TAX">
          <p>
            Payments are one-time (no subscription) and handled by Stripe Checkout; card details never touch this site. Sales tax is
            calculated by Stripe at checkout and added where it applies. Stripe emails the payment receipt.
          </p>
        </Section>

        <Section id="privacy" title="PRIVACY">
          <p>
            No accounts and no ad trackers. Anonymous page counts only (no cookies), plus Cloudflare’s standard security logs. To stop abuse,
            the site keeps short-lived counters keyed by a one-way hash of your IP address that changes every day; the IP itself isn’t
            stored.
          </p>
          <p>
            Receipts store what was printed and who it’s about (the name, handle or site you typed). Sponsors: your slot text, link, logo
            and email (from Stripe) are kept; the email is deleted 120 days after payment. Mailed prints: your name and address are used only
            to mail the print and are deleted 30 days after it ships (60 days if the order is refunded). Ask for anything to be deleted
            sooner at <Email />.
          </p>
        </Section>

        <Section title="THE SMALL PRINT">
          <p>
            Run by {ARTIST.name}, New York. Provided as is, for fun. We can change these terms for future purchases, take down any receipt or
            slot, or switch any part of the site off at any time; if a paid slot or print is affected, the refund rules above apply.
            Questions: <Email />.
          </p>
        </Section>

        <p className="mt-5 text-center text-[12px]">
          <a href="/" className="shipped-link font-semibold">
            Back to the printer
          </a>
        </p>
      </article>
    </Ticket>
  );
}
