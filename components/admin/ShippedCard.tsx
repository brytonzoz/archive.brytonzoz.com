'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { money } from '../../lib/shipped-receipt';
import { slotLabel } from '../../lib/shipped-sponsors';
import { receiptNumber } from '../../lib/shipped-year';

// Shipped in /admin: kill switches, today's budget, sponsor slots (logo review, instant take-down with a full
// refund), mailed prints to send, takedown reports (receipts are already hidden while they wait), printed
// receipts and AI spend. Every action is in worker/shipped.ts adminShipped.

type Switch = 'site' | 'generate' | 'sponsors' | 'prints' | 'sponsor-display';
const SWITCH_LABELS: Record<Switch, string> = {
  site: 'Whole site (shows “out of paper”; webhooks still land)',
  generate: 'Printing new receipts',
  sponsors: 'Selling sponsor slots',
  prints: 'Selling $5 mailed prints',
  'sponsor-display': 'Showing paid sponsors (house ads instead)',
};

type Bid = {
  id: number;
  slot: number;
  name: string;
  cta: string;
  url: string;
  logo_key: string | null;
  logo_ok: number;
  amount_cents: number;
  total_cents: number | null;
  refund_cents: number | null;
  status: string;
  note: string | null;
  scans: number;
  paid_at: number | null;
  ended_at: number | null;
};
type Order = {
  id: number;
  receipt_id: number;
  status: string;
  amount_cents: number;
  total_cents: number | null;
  ship_name: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal: string | null;
  paid_at: number | null;
  shipped_at: number | null;
  note: string | null;
};
type PrintedRow = {
  id: number;
  login: string;
  login_key: string;
  mode: string;
  demo: number;
  hidden: number;
  listed: number;
  shares: number;
  views: number;
  searches: number | null;
  cost_micros: number | null;
  created_at: number;
};
type SpendRow = { day: string; receipts: number; failures: number; input_tokens: number; output_tokens: number; searches?: number; cost_micros: number; reserved_micros?: number };
type Takedown = { id: number; receipt_id: number; subject_key: string; reason: string | null; created_at: number; login: string | null };
type Data = {
  provider: { id: string; live: boolean } | null;
  generator: { enabled: boolean; demo: boolean; reason: string | null };
  switches: Record<Switch, boolean>;
  forced: Switch[];
  model: string;
  maxSearches: number;
  capUsd: number;
  printPostage?: { cents: number | null; fromEnv: boolean };
  budget: { spent: number; reserved: number };
  budgetAlert: 0 | 50 | 80 | 100;
  outOfCreditAt: number | null;
  tinyfish: { enabled: boolean; today: Record<string, number>; daily: { search: number; fetch: number } };
  printed: number;
  shared: number;
  views: number;
  takedowns: Takedown[];
  bids: Bid[];
  orders: Order[];
  receipts: PrintedRow[];
  spend: SpendRow[];
};

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const REASONS: Record<string, string> = {
  'no-ai': 'off: add the claude_key secret',
  'out-of-paper': 'paused: out of paper (switch off, cycle budget used up, or the Anthropic credits ran out)',
  closed: 'off: the event is over',
  'no-database': 'off: no database',
};

const button = 'h-8 shrink-0 rounded-full px-3 text-[12px] font-semibold disabled:opacity-50';
const quiet = `${button} bg-white/[0.08] text-white/75 hover:bg-white/[0.12]`;
const danger = `${button} bg-[#ff453a] text-white`;

function Logo({ id, password }: { id: number; password: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    fetch(`/api/admin/shipped/logo/${id}`, { headers: { authorization: `Bearer ${password}` } })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, password]);
  if (!src) return null;
  return (
    <span className="mt-2 inline-block rounded-[6px] bg-[#f3ead8] p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Submitted logo" className="max-h-16 w-auto [image-rendering:pixelated]" />
    </span>
  );
}

function Chip({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'to_print'
      ? 'bg-[#30d158]/15 text-[#30d158]'
      : status === 'removed' || status === 'lost'
        ? 'bg-[#ff453a]/20 text-[#ff6961]'
        : 'bg-white/10 text-white/60';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function ShippedCard({ password }: { password: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blockKey, setBlockKey] = useState('');
  const [postageDraft, setPostageDraft] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/shipped', { headers: { authorization: `Bearer ${password}` }, cache: 'no-store' });
    if (response.ok) {
      const next = (await response.json()) as Data;
      setData(next);
      setPostageDraft(next.printPostage?.cents == null ? '' : String(next.printPostage.cents));
    }
  }, [password]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, body: Record<string, unknown> = {}) {
    const key = `${action}:${JSON.stringify(body)}`;
    setBusy(key);
    setMessage(null);
    const response = await fetch('/api/admin/shipped', {
      method: 'POST',
      headers: { authorization: `Bearer ${password}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!result.ok) setMessage(`Couldn’t ${action.replace(/-/g, ' ')}: ${result.error ?? response.status}`);
    await load();
    setBusy(null);
  }
  const isBusy = (action: string, body: Record<string, unknown> = {}) => busy === `${action}:${JSON.stringify(body)}`;

  if (!data) {
    return (
      <section className="rounded-[20px] bg-[#1a1a1c] p-5 ring-1 ring-inset ring-white/[0.06]">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Shipped</h2>
        <p className="mt-2 text-[13px] text-white/45">Loading…</p>
      </section>
    );
  }

  const generator = data.generator.enabled ? (data.generator.demo ? 'demo prints (no AI key)' : `on · ${data.model}`) : (REASONS[data.generator.reason ?? ''] ?? `off (${data.generator.reason})`);
  const cap = data.capUsd * 1_000_000;
  const live = data.bids.filter((bid) => bid.status === 'live');
  const reviewLogos = data.bids.filter((bid) => bid.status === 'live' && bid.logo_key && !bid.logo_ok);
  const toPrint = data.orders.filter((order) => order.status === 'to_print');

  return (
    <section className="rounded-[20px] bg-[#1a1a1c] p-5 ring-1 ring-inset ring-white/[0.06]">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Shipped</h2>
      <p className="mt-0.5 text-[13px] text-white/45">
        Printer: {generator} · {data.printed.toLocaleString()} printed · {data.shared.toLocaleString()} shared · {data.views.toLocaleString()} page views
        <br />
        Budget this cycle (resets on the 8th UTC): {usd(data.budget.spent)} spent + {usd(data.budget.reserved)} held for prints in
        progress, of {usd(cap)} ($180 base + 80% of this cycle&apos;s settled sales after Stripe fees; holds don&apos;t count, refunds
        subtract
        {data.printPostage?.cents == null ? '' : `, and ${data.printPostage.cents}¢ print/postage per mailed print`}
        ). Paid web search at most {data.maxSearches} per receipt.
        <br />
        TinyFish:{' '}
        {data.tinyfish.enabled
          ? `${data.tinyfish.today.search ?? 0}/${data.tinyfish.daily.search} searches, ${data.tinyfish.today.fetch ?? 0}/${data.tinyfish.daily.fetch} pages today`
          : 'off (no tinyfish secret)'}
        <br />
        Checkout: {data.provider ? `${data.provider.id}${data.provider.live ? '' : ' (test, no real money)'}` : 'closed (no payment provider)'}
      </p>

      {data.budgetAlert ? (
        <p
          className={`mt-3 rounded-[10px] px-3 py-2 text-[13px] ${data.budgetAlert >= 100 ? 'bg-[#ff453a]/15 text-[#ff6961]' : 'bg-[#ffd60a]/15 text-[#ffd60a]'}`}
          role="alert"
        >
          {data.budgetAlert >= 100
            ? 'AI budget empty this cycle (100%). The printer is out of paper until the 8th, or until settled sales raise the cap.'
            : `AI budget at ${data.budgetAlert}% of this cycle's cap.`}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-[10px] bg-[#ff453a]/15 px-3 py-2 text-[13px] text-[#ff6961]" role="alert">
          {message}
        </p>
      ) : null}

      <h3 className="mt-5 text-[14px] font-semibold">Kill switches</h3>
      <p className="text-[12px] text-white/45">Take effect within a few seconds. A switch forced by the SHIPPED_OFF var can only be turned back on there.</p>
      <ul className="mt-2 space-y-1.5">
        {(Object.keys(SWITCH_LABELS) as Switch[]).map((name) => {
          const off = data.switches[name];
          const forced = data.forced.includes(name);
          return (
            <li key={name} className="flex items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1 text-white/85">
                {SWITCH_LABELS[name]} <span className="text-white/45">· {name}</span>
              </span>
              <span className={off ? 'font-semibold text-[#ff6961]' : 'text-[#30d158]'}>{off ? 'OFF' : 'on'}</span>
              <button
                type="button"
                disabled={forced || isBusy('switch', { name, off: !off })}
                className={off ? quiet : danger}
                onClick={() => (off || window.confirm(`Switch off: ${SWITCH_LABELS[name]}?`)) && act('switch', { name, off: !off })}
              >
                {forced ? 'forced' : off ? 'Turn on' : 'Switch off'}
              </button>
            </li>
          );
        })}
      </ul>
      <h3 className="mt-5 text-[14px] font-semibold">Print / postage cost</h3>
      <p className="text-[12px] text-white/45">
        Optional cents subtracted from each settled $5 mailed print before the 80% budget carry. Leave blank to leave it
        unset — nothing is invented. The SHIPPED_PRINT_COST_CENTS var wins when set.
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = postageDraft.trim();
          void act('print-cost', { cents: trimmed === '' ? null : Number(trimmed) });
        }}
      >
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="h-8 w-28 rounded-[8px] bg-white/[0.08] px-2.5 text-[13px] text-white outline-none ring-1 ring-inset ring-white/10"
          value={postageDraft}
          placeholder="unset"
          disabled={Boolean(data.printPostage?.fromEnv)}
          onChange={(event) => setPostageDraft(event.target.value)}
        />
        <span className="text-[12px] text-white/45">cents per mailed print</span>
        <button type="submit" className={quiet} disabled={Boolean(data.printPostage?.fromEnv)}>
          {data.printPostage?.fromEnv ? 'set by env' : 'Save'}
        </button>
      </form>

      {data.outOfCreditAt || data.budget.spent + data.budget.reserved >= cap ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[#ff9f0a]/15 px-3 py-2 text-[13px] text-[#ffb340]">
          <span>
            {data.outOfCreditAt ? `Out of paper since ${when(data.outOfCreditAt)}: Anthropic said the credits ran out. Top up, then restock.` : 'Today’s budget is used up; printing resumes at midnight UTC.'}
          </span>
          <button type="button" className={quiet} onClick={() => act('restock')} disabled={isBusy('restock')}>
            Paper restocked
          </button>
        </div>
      ) : null}

      <h3 className="mt-5 text-[14px] font-semibold">Logos to review ({reviewLogos.length})</h3>
      <p className="text-[12px] text-white/45">A paid slot shows its name until its logo is approved.</p>
      {reviewLogos.length ? (
        <ul className="mt-2 space-y-3">
          {reviewLogos.map((bid) => (
            <li key={bid.id} className="rounded-[14px] bg-white/[0.04] p-3 text-[13px]">
              <p className="font-semibold text-white/90">
                {slotLabel(bid.slot)} · {bid.name} · {money(bid.amount_cents)}
              </p>
              <Logo id={bid.id} password={password} />
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${button} bg-[#30d158] text-black`} disabled={isBusy('logo-approve', { id: bid.id })} onClick={() => act('logo-approve', { id: bid.id })}>
                  Approve logo
                </button>
                <button type="button" className={quiet} disabled={isBusy('logo-reject', { id: bid.id })} onClick={() => act('logo-reject', { id: bid.id })}>
                  Reject logo (name stays)
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">Nothing to review.</p>
      )}

      <h3 className="mt-5 text-[14px] font-semibold">Sponsor slots ({live.length} paid)</h3>
      <p className="text-[12px] text-white/45">“Take down” puts the house ad back at once and refunds the sponsor in full.</p>
      {data.bids.length ? (
        <ul className="mt-2 space-y-2">
          {data.bids.map((bid) => (
            <li key={bid.id} className="rounded-[12px] bg-white/[0.03] p-2.5 text-[13px]">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-white/85">
                  <span className="font-semibold">
                    {slotLabel(bid.slot)} · {bid.name}
                  </span>{' '}
                  <span className="text-white/45">
                    · {money(bid.amount_cents)} · {bid.scans} scans · paid {when(bid.paid_at)}
                    {bid.refund_cents ? ` · refunded ${money(bid.refund_cents)}` : ''}
                  </span>
                </span>
                <Chip status={bid.status} />
                {bid.status === 'live' ? (
                  <button
                    type="button"
                    className={danger}
                    disabled={isBusy('remove-bid', { id: bid.id })}
                    onClick={() => window.confirm(`Take down “${bid.name}” and refund ${money(bid.total_cents ?? bid.amount_cents)} in full?`) && act('remove-bid', { id: bid.id })}
                  >
                    Take down
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 break-words text-white/70">{bid.cta}</p>
              <a href={bid.url} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-[12px] text-[#64d2ff] underline">
                {bid.url}
              </a>
              {bid.note ? <p className="mt-0.5 text-[12px] text-[#ffb340]">{bid.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">No paid slots yet.</p>
      )}

      <h3 className="mt-5 text-[14px] font-semibold">Mailed prints to send ({toPrint.length})</h3>
      <p className="text-[12px] text-white/45">Addresses are deleted automatically 30 days after you mark an order shipped.</p>
      {data.orders.length ? (
        <ul className="mt-2 space-y-2">
          {data.orders.map((order) => (
            <li key={order.id} className="rounded-[12px] bg-white/[0.03] p-2.5 text-[13px]">
              <div className="flex items-center gap-3">
                <a href={`/shipped/r/${order.receipt_id}/`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 font-semibold text-white/90 underline">
                  Order {order.id} · receipt #{receiptNumber(order.receipt_id)}
                </a>
                <Chip status={order.status} />
                {order.status === 'to_print' ? (
                  <>
                    <button type="button" className={`${button} bg-[#30d158] text-black`} disabled={isBusy('order-shipped', { id: order.id })} onClick={() => act('order-shipped', { id: order.id })}>
                      Mark shipped
                    </button>
                    <button
                      type="button"
                      className={quiet}
                      disabled={isBusy('order-refund', { id: order.id })}
                      onClick={() => window.confirm(`Refund order ${order.id} in full?`) && act('order-refund', { id: order.id })}
                    >
                      Refund
                    </button>
                  </>
                ) : null}
              </div>
              {order.ship_line1 ? (
                <p className="mt-1 whitespace-pre-line text-white/75">
                  {[order.ship_name, order.ship_line1, order.ship_line2, `${order.ship_city ?? ''}, ${order.ship_state ?? ''} ${order.ship_postal ?? ''}`].filter(Boolean).join('\n')}
                </p>
              ) : null}
              <p className="mt-0.5 text-[12px] text-white/45">
                Paid {when(order.paid_at)} · {money(order.total_cents ?? order.amount_cents)}
                {order.shipped_at ? ` · shipped ${when(order.shipped_at)}` : ''}
                {order.note ? ` · ${order.note}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">None yet.</p>
      )}

      <h3 className="mt-5 text-[14px] font-semibold">Reports ({data.takedowns.length})</h3>
      <p className="text-[12px] text-white/45">Reported receipts are already down. Remove keeps them down and blocks that subject for good; dismiss puts the receipt back.</p>
      {data.takedowns.length ? (
        <ul className="mt-2 space-y-3">
          {data.takedowns.map((request) => (
            <li key={request.id} className="rounded-[14px] bg-white/[0.04] p-3 text-[13px]">
              <a href={`/shipped/r/${request.receipt_id}/`} target="_blank" rel="noopener noreferrer" className="font-semibold text-white/90 underline">
                #{receiptNumber(request.receipt_id)} {request.login ?? request.subject_key}
              </a>
              <span className="text-white/45">
                {' '}
                · {request.subject_key} · {when(request.created_at)}
              </span>
              {request.reason ? <p className="mt-1 break-words text-white/80">“{request.reason}”</p> : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isBusy('remove-takedown', { id: request.id })}
                  onClick={() => window.confirm(`Remove every receipt for ${request.subject_key} and stop it printing again?`) && act('remove-takedown', { id: request.id })}
                  className={danger}
                >
                  Remove and block
                </button>
                <button type="button" disabled={isBusy('dismiss-takedown', { id: request.id })} onClick={() => act('dismiss-takedown', { id: request.id })} className={quiet}>
                  Dismiss (restore)
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">None.</p>
      )}

      <h3 className="mt-5 text-[14px] font-semibold">Opt-out list</h3>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const key = blockKey.trim().toLowerCase();
          if (key && window.confirm(`Take down every receipt for ${key} and stop it printing?`)) act('block-subject', { key }).then(() => setBlockKey(''));
        }}
      >
        <input
          value={blockKey}
          onChange={(event) => setBlockKey(event.target.value)}
          placeholder="x:handle · github:login · domain:site.com · name:full name"
          className="h-9 min-w-0 flex-1 rounded-full bg-white/[0.06] px-3 text-[13px] text-white outline-none"
        />
        <button type="submit" className={danger}>
          Block
        </button>
      </form>

      <h3 className="mt-5 text-[14px] font-semibold">Printed receipts</h3>
      <p className="mt-1 text-[12px] text-white/45">Off the wall hides a pin without deleting. Reprint re-runs the pipeline on that same receipt.</p>
      {data.receipts.length ? (
        <ul className="mt-2 space-y-2">
          {data.receipts.map((receipt) => (
            <li key={receipt.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <a href={`/shipped/r/${receipt.id}/`} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate ${receipt.hidden ? 'text-white/40 line-through' : 'text-white/85'}`}>
                #{receiptNumber(receipt.id)} {receipt.login}{' '}
                <span className="text-white/45">
                  · {receipt.mode}
                  {receipt.demo ? ' · demo' : ''}
                  {receipt.listed ? ' · on the wall' : ' · off the wall'} · {usd(receipt.cost_micros ?? 0)}
                  {receipt.searches ? ` · ${receipt.searches} searches` : ''} · {receipt.shares} shares · {receipt.views} views · {when(receipt.created_at)}
                </span>
              </a>
              <button
                type="button"
                disabled={isBusy(receipt.listed ? 'unlist-receipt' : 'list-receipt', { id: receipt.id })}
                onClick={() => act(receipt.listed ? 'unlist-receipt' : 'list-receipt', { id: receipt.id })}
                className={quiet}
              >
                {receipt.listed ? 'Off the wall' : 'On the wall'}
              </button>
              <button
                type="button"
                disabled={isBusy('reprint-receipt', { id: receipt.id })}
                onClick={() => window.confirm(`Reprint #${receiptNumber(receipt.id)} ${receipt.login} in place?`) && act('reprint-receipt', { id: receipt.id })}
                className={quiet}
              >
                {isBusy('reprint-receipt', { id: receipt.id }) ? 'Reprinting…' : 'Reprint'}
              </button>
              <button
                type="button"
                disabled={isBusy(receipt.hidden ? 'show-receipt' : 'hide-receipt', { id: receipt.id })}
                onClick={() =>
                  receipt.hidden ? act('show-receipt', { id: receipt.id }) : window.confirm(`Take down ${receipt.login}’s receipt (page, images, caches)?`) && act('hide-receipt', { id: receipt.id })
                }
                className={quiet}
              >
                {receipt.hidden ? 'Restore' : 'Take down'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">None yet.</p>
      )}

      {data.spend.length ? (
        <>
          <h3 className="mt-5 text-[14px] font-semibold">AI spend</h3>
          <table className="mt-2 w-full text-left text-[13px] tabular-nums">
            <thead className="text-white/45">
              <tr>
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 font-normal">Printed</th>
                <th className="py-1 font-normal">Failed</th>
                <th className="py-1 font-normal">Tokens in / out</th>
                <th className="py-1 font-normal">Searches</th>
                <th className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {data.spend.map((row) => (
                <tr key={row.day} className="border-t border-white/[0.06]">
                  <td className="py-1">{row.day}</td>
                  <td className="py-1">{row.receipts}</td>
                  <td className="py-1">{row.failures}</td>
                  <td className="py-1">
                    {row.input_tokens.toLocaleString()} / {row.output_tokens.toLocaleString()}
                  </td>
                  <td className="py-1">{row.searches ?? 0}</td>
                  <td className="py-1 text-right">{usd(row.cost_micros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
