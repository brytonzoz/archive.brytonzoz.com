'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { money, receiptNumber } from '../../lib/shipped-receipt';
import { SPONSOR_CONFIG, type SponsorTier } from '../../lib/shipped-sponsors';

// /shipped in /admin: the sponsor-line moderation queue (nothing prints until approved here; reject
// refunds automatically), printed receipts (hide one to take it and its share page down), and AI spend.

type Line = {
  id: number;
  tier: SponsorTier;
  text: string;
  url: string | null;
  logo_key: string | null;
  status: string;
  roll: number;
  line_no: number | null;
  amount_cents: number;
  total_cents?: number | null;
  provider: string;
  note: string | null;
  paid_at: number | null;
  ends_at: number | null;
};
type PrintedRow = { id: number; login: string; mode: string; demo: number; hidden: number; cost_micros: number | null; created_at: number };
type SpendRow = { day: string; receipts: number; failures: number; input_tokens: number; output_tokens: number; cost_micros: number };
type Data = {
  provider: { id: string; live: boolean } | null;
  generator: { enabled: boolean; demo: boolean; reason: string | null };
  model: string;
  capUsd: number;
  printed: number;
  pending: Line[];
  lines: Line[];
  receipts: PrintedRow[];
  spend: SpendRow[];
};

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const REASONS: Record<string, string> = {
  'no-ai': 'off: add the ANTHROPIC_API_KEY secret',
  'no-turnstile': 'off: add the TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY secrets',
  'out-of-paper': 'paused: today’s AI budget is used up',
  'no-database': 'off: no database',
};

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
    status === 'approved'
      ? 'bg-[#30d158]/15 text-[#30d158]'
      : status === 'refund_failed'
        ? 'bg-[#ff453a]/20 text-[#ff6961]'
        : status === 'paid_pending_review'
          ? 'bg-[#ff9f0a]/20 text-[#ffb340]'
          : 'bg-white/10 text-white/60';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function ShippedCard({ password }: { password: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/shipped', { headers: { authorization: `Bearer ${password}` }, cache: 'no-store' });
    if (response.ok) setData(await response.json());
  }, [password]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, id: number) {
    setBusy(id);
    setMessage(null);
    const response = await fetch('/api/admin/shipped', {
      method: 'POST',
      headers: { authorization: `Bearer ${password}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!result.ok) setMessage(`Couldn’t ${action.replace('-', ' ')}: ${result.error ?? response.status}`);
    await load();
    setBusy(null);
  }

  if (!data) {
    return (
      <section className="rounded-[20px] bg-[#1a1a1c] p-5 ring-1 ring-inset ring-white/[0.06]">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Shipped</h2>
        <p className="mt-2 text-[13px] text-white/45">Loading…</p>
      </section>
    );
  }

  const today = data.spend[0]?.day === new Date().toISOString().slice(0, 10) ? data.spend[0] : null;
  const generator = data.generator.enabled
    ? data.generator.demo
      ? 'demo prints (no AI key)'
      : `on · ${data.model}`
    : REASONS[data.generator.reason ?? ''] ?? `off (${data.generator.reason})`;

  return (
    <section className="rounded-[20px] bg-[#1a1a1c] p-5 ring-1 ring-inset ring-white/[0.06]">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Shipped</h2>
      <p className="mt-0.5 text-[13px] text-white/45">
        Print my receipt: {generator} · {data.printed.toLocaleString()} printed · today {usd(today?.cost_micros ?? 0)} of ${data.capUsd.toFixed(2)}
        <br />
        Sponsor checkout: {data.provider ? `${data.provider.id}${data.provider.live ? '' : ' (test, no real money)'}` : 'closed (no payment provider)'}
      </p>
      {message ? (
        <p className="mt-3 rounded-[10px] bg-[#ff453a]/15 px-3 py-2 text-[13px] text-[#ff6961]" role="alert">
          {message}
        </p>
      ) : null}

      <h3 className="mt-5 text-[14px] font-semibold">Waiting for review ({data.pending.length})</h3>
      {data.pending.length ? (
        <ul className="mt-2 space-y-3">
          {data.pending.map((line) => (
            <li key={line.id} className="rounded-[14px] bg-white/[0.04] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                <span className="font-semibold text-white/90">
                  {SPONSOR_CONFIG.tiers[line.tier].label} · {money(line.amount_cents)}
                </span>
                <span className="text-[12px] text-white/50">
                  #{line.id} · roll {line.roll} · paid {when(line.paid_at)}
                </span>
              </div>
              <p className="mt-1 break-words text-[15px] text-white">{line.text}</p>
              {line.url ? (
                <a href={line.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 block break-all text-[13px] text-[#64d2ff] underline">
                  {line.url}
                </a>
              ) : null}
              {line.note ? <p className="mt-1 text-[12px] text-[#ffb340]">{line.note}</p> : null}
              {line.logo_key ? <Logo id={line.id} password={password} /> : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy === line.id}
                  onClick={() => act('approve', line.id)}
                  className="h-9 rounded-full bg-[#30d158] px-4 text-[13px] font-semibold text-black disabled:opacity-50"
                >
                  Approve and print
                </button>
                <button
                  type="button"
                  disabled={busy === line.id}
                  onClick={() => window.confirm(`Reject “${line.text}” and refund ${money(line.total_cents ?? line.amount_cents)} (in full, tax included)?`) && act('reject', line.id)}
                  className="h-9 rounded-full bg-white/[0.08] px-4 text-[13px] font-semibold text-white/80 hover:bg-white/[0.12] disabled:opacity-50"
                >
                  Reject and refund
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/50">Nothing to review.</p>
      )}

      {data.lines.length ? (
        <>
          <h3 className="mt-5 text-[14px] font-semibold">Sponsor lines</h3>
          <ul className="mt-2 space-y-2">
            {data.lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-white/85">
                  {line.line_no ? `${String(line.line_no).padStart(3, '0')} · ` : ''}
                  {line.text} <span className="text-white/45">· {SPONSOR_CONFIG.tiers[line.tier].label} · roll {line.roll}</span>
                  {line.tier === 'header' && line.ends_at ? <span className="text-white/45"> · until {when(line.ends_at)}</span> : null}
                  {line.note ? <span className="text-[#ffb340]"> · {line.note}</span> : null}
                </span>
                <Chip status={line.status} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="mt-5 text-[14px] font-semibold">Printed receipts</h3>
      {data.receipts.length ? (
        <ul className="mt-2 space-y-2">
          {data.receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-3 text-[13px]">
              <a href={`/shipped/r/${receipt.id}/`} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate ${receipt.hidden ? 'text-white/40 line-through' : 'text-white/85'}`}>
                #{receiptNumber(receipt.id)} @{receipt.login} <span className="text-white/45">· {receipt.mode}{receipt.demo ? ' · demo' : ''} · {usd(receipt.cost_micros ?? 0)} · {when(receipt.created_at)}</span>
              </a>
              <button
                type="button"
                disabled={busy === receipt.id}
                onClick={() =>
                  receipt.hidden
                    ? act('show-receipt', receipt.id)
                    : window.confirm(`Take down @${receipt.login}’s receipt? It also stops new prints for that username.`) && act('hide-receipt', receipt.id)
                }
                className="h-8 shrink-0 rounded-full bg-white/[0.08] px-3 text-[12px] font-semibold text-white/75 hover:bg-white/[0.12] disabled:opacity-50"
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
