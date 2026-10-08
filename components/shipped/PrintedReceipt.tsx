'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { track } from '../../lib/analytics';
import { receiptDate } from '../../lib/shipped';
import {
  RECEIPT_PATH,
  chargesTotal,
  money,
  printedCounts,
  receiptNumber,
  shareText,
  type PrintedReceipt,
  type SponsorFeed,
} from '../../lib/shipped-receipt';
import { Barcode, ExternalLink, Line, Rule, Ticket } from './paper';
import { SponsorName } from './SponsorRoll';

type Loaded = { receipt: PrintedReceipt; sponsors: SponsorFeed };

function readInjected(): Loaded | null {
  const el = document.getElementById('shipped-receipt-data');
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as Loaded;
  } catch {
    return null;
  }
}

function idFromPath(): number | null {
  const match = window.location.pathname.match(/^\/shipped\/r\/(\d{1,9})\/?$/);
  return match ? Number(match[1]) : null;
}

function Body({ receipt, sponsors }: Loaded) {
  const counts = printedCounts(receipt);
  return (
    <article>
      {sponsors.header.length ? (
        <div className="mb-3 text-center text-[11px] leading-relaxed tracking-[0.14em]">
          <p className="text-[#1c1917]/60">SUPPORTED BY</p>
          <p className="font-semibold">
            {sponsors.header.map((sponsor, i) => (
              <React.Fragment key={sponsor.id}>
                {i ? ' · ' : ''}
                <SponsorName sponsor={sponsor} />
              </React.Fragment>
            ))}
          </p>
          <div className="mt-2">
            <Rule />
          </div>
        </div>
      ) : null}

      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">STORE RECEIPT</p>
        <p className="mt-2 break-all text-[15px] font-semibold tracking-[0.18em]">@{receipt.login.toUpperCase()}</p>
        <p className="mt-0.5 text-[11px] tracking-[0.18em] text-[#1c1917]/75">{receipt.mode.toUpperCase()} EDITION</p>
        <h1 className="mt-3 text-[19px] font-semibold leading-tight tracking-[0.16em]">{receipt.headline}</h1>
      </header>

      <div className="mt-4 space-y-1 text-[12px] tracking-[0.04em]">
        <Line label="DATE" value={receiptDate(receipt.printedAt)} />
        <Line label="RECEIPT" value={`#${receiptNumber(receipt.id)}`} />
        {receipt.stats.since ? <Line label="ON GITHUB SINCE" value={String(receipt.stats.since)} /> : null}
        <Line label="PUBLIC REPOS" value={String(receipt.stats.publicRepos)} />
      </div>
      <div className="mt-3">
        <Rule />
      </div>

      <p className="shipped-lead mt-2 text-[10px] tracking-[0.16em] text-[#1c1917]/55">
        <span>ITEM</span>
        <span className="shipped-lead-fill" aria-hidden="true" />
        <span>STATUS</span>
      </p>
      {receipt.items.length ? (
        <ol className="mt-1">
          {receipt.items.map((item) => (
            <li key={item.repo} className="border-b border-dashed border-[#1c1917]/20 py-2 last:border-b-0">
              <div className="shipped-lead">
                <h2 className="min-w-0 break-words text-[13.5px] font-semibold leading-snug">
                  <ExternalLink href={`https://github.com/${receipt.login}/${item.repo}`}>{item.name}</ExternalLink>
                </h2>
                <span className="shipped-lead-fill" aria-hidden="true" />
                <p className="shrink-0 text-[12px] font-semibold tracking-[0.12em]">
                  <span className="sr-only">Status: </span>
                  {item.status}
                </p>
              </div>
              {item.note ? <p className="mt-0.5 text-[12px] leading-relaxed text-[#1c1917]/80">{item.note}</p> : null}
              <p className="mt-0.5 text-[11px] text-[#1c1917]/60">
                {[item.repo, item.language, item.stars ? `★ ${item.stars}` : null].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-center text-[12.5px]">NOTHING ON THE SHELF YET.</p>
      )}

      <div className="mt-1">
        <Rule />
      </div>
      <div className="mt-2 space-y-1 text-[12.5px]">
        <Line label="SHIPPED" value={String(counts.shipped)} />
        <Line label="IN PROGRESS" value={String(counts.inProgress)} />
        <Line label="ABANDONED" value={String(counts.abandoned)} />
      </div>
      <div className="mt-2">
        <Rule />
      </div>
      <div className="mt-2 space-y-1 text-[12.5px]">
        {receipt.charges.map((charge) => (
          <Line key={charge.label} label={charge.label} value={money(charge.cents)} />
        ))}
      </div>
      <div className="mt-2">
        <Rule heavy />
      </div>
      <div className="mt-2 text-[14px] font-semibold">
        <Line label="TOTAL" value={money(chargesTotal(receipt))} />
      </div>
      <div className="mt-2">
        <Rule heavy />
      </div>

      <footer className="mt-4 text-center text-[12px] leading-relaxed">
        <p className="italic text-[#1c1917]/85">“{receipt.verdict}”</p>
        <p className="mt-4 text-[10.5px] tracking-[0.2em] text-[#1c1917]/60">THIS RECEIPT PAID FOR BY:</p>
        {sponsors.footer.length ? (
          <ul className="mt-1.5 space-y-2">
            {sponsors.footer.map((sponsor) => (
              <li key={sponsor.id} className="text-[12px] font-semibold">
                {sponsor.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sponsor.logo} alt="" loading="lazy" className="shipped-logo mx-auto mb-1 max-h-12 w-auto max-w-[70%]" />
                ) : null}
                <SponsorName sponsor={sponsor} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12px]">
            <Link href="/shipped/#sponsor" className="shipped-link font-semibold">
              YOUR LOGO HERE
            </Link>
          </p>
        )}
        <p className="mt-3 text-[11px] tracking-[0.18em]">
          PRINTED AT{' '}
          <Link href="/shipped/" className="shipped-link font-semibold">
            BRYTONZOZ.COM/SHIPPED
          </Link>
        </p>
        <Barcode value={`BZ${receiptNumber(receipt.id)}`} />
        <p className="mt-3 text-[10.5px] leading-relaxed text-[#1c1917]/60">
          Made from public GitHub data. Not affiliated with GitHub.
          {receipt.demo ? ' Demo print: written without the AI.' : ' Jokes written by AI.'}
        </p>
      </footer>
    </article>
  );
}

function Actions({ receipt }: { receipt: PrintedReceipt }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? '' : new URL(RECEIPT_PATH(receipt.id), window.location.origin).toString();
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(shareText(receipt))}&url=${encodeURIComponent(url)}`;
  return (
    <div className="shipped-actions">
      <a
        href={intent}
        target="_blank"
        rel="noopener noreferrer"
        className="shipped-button"
        onClick={() => track({ type: 'share', release: 'shipped', detail: 'x' })}
      >
        SHARE ON X
      </a>
      <button
        type="button"
        className="shipped-button is-ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            track({ type: 'share', release: 'shipped', detail: 'copy' });
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt('Copy this link', url);
          }
        }}
      >
        {copied ? 'COPIED' : 'COPY LINK'}
      </button>
      <Link href="/shipped/#print" className="shipped-button is-ghost">
        PRINT YOURS
      </Link>
    </div>
  );
}

/** /shipped/r/<id>/: the Worker injects the receipt into the page; fetched if it isn't there. */
export function PrintedReceiptView() {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    const injected = readInjected();
    if (injected) return setLoaded(injected);
    const id = idFromPath();
    if (!id) return setLoaded(null);
    fetch(`/api/shipped/receipts/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Loaded>) : null))
      .then(setLoaded)
      .catch(() => setLoaded(null));
  }, []);

  if (loaded === undefined) {
    return (
      <Ticket label="Loading receipt">
        <p className="py-16 text-center text-[12px] tracking-[0.2em] text-[#1c1917]/60" role="status">
          PRINTING…
        </p>
      </Ticket>
    );
  }
  if (!loaded) {
    return (
      <Ticket label="Receipt not found">
        <div className="py-10 text-center">
          <h1 className="text-[18px] font-semibold tracking-[0.2em]">NO SUCH RECEIPT</h1>
          <p className="mt-2 text-[12px] text-[#1c1917]/70">It may have been taken down.</p>
          <p className="mt-4 text-[12px]">
            <Link href="/shipped/#print" className="shipped-link font-semibold">
              Print your own
            </Link>
          </p>
        </div>
      </Ticket>
    );
  }
  return (
    <>
      <Ticket label={`Receipt for @${loaded.receipt.login}`}>
        <Body {...loaded} />
      </Ticket>
      <Actions receipt={loaded.receipt} />
    </>
  );
}
