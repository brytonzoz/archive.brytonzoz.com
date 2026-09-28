'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isOptedOut, setOptedOut } from '../../lib/analytics';
import { releases } from '../../lib/tracks';

// /admin: listening metrics for the owner. The password is checked by the Worker on every request
// (ADMIN_PASSWORD secret); this page only remembers it on this device if asked to.

type Row = Record<string, number | string | null>;
type Stats = {
  since: string;
  generatedAt: string;
  totals: Record<string, number | null>;
  live: { listeners: number; tracks: { value: number; track: string }[] };
  daily: Row[];
  dailyPlays: Row[];
  tracks: Row[];
  releases: Row[];
  dropoff: { bucket: number; plays: number }[];
  countries: Row[];
  devices: Row[];
  referrers: Row[];
  outbound: Row[];
  shares: Row[];
  opens: Row[];
};

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All time' },
];
const KEY_STORE = 'bz.admin';
const SERVICE_NAMES: Record<string, string> = { applemusic: 'Apple Music', spotify: 'Spotify', youtubemusic: 'YouTube Music', website: 'Website' };

const trackTitles = new Map(releases.flatMap((release) => release.tracks.map((track) => [track.id, track.title] as const)));
const releaseTitles = new Map(releases.map((release) => [release.id, release.title] as const));
const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const fmt = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 10 && value % 1 ? 1 : 0 }).format(value);
const pct = (value: unknown) => `${Math.round(n(value) * 100)}%`;
function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return hours < 100 ? `${hours.toFixed(1)}h` : `${fmt(Math.round(hours))}h`;
}
function country(code: string): string {
  if (!code || code === '??') return 'Unknown';
  const flag = code.length === 2 ? String.fromCodePoint(0x1f1a5 + code.toUpperCase().charCodeAt(0), 0x1f1a5 + code.toUpperCase().charCodeAt(1)) : '';
  let name = code;
  try {
    name = regionNames?.of(code) ?? code;
  } catch {
    // Not a region code.
  }
  return `${flag} ${name}`;
}

function Tile({ label, value, hint, live = false }: { label: string; value: string; hint?: string; live?: boolean }) {
  return (
    <div className="rounded-[18px] bg-[#1a1a1c] p-4 ring-1 ring-inset ring-white/[0.06]">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/55">
        {live ? <span className="live-dot h-2 w-2 rounded-full bg-[#30d158]" aria-hidden="true" /> : null}
        {label}
      </p>
      <p className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-white/40">{hint}</p> : null}
    </div>
  );
}

function Card({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[20px] bg-[#1a1a1c] p-5 ring-1 ring-inset ring-white/[0.06] ${className}`}>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-[13px] text-white/45">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Vertical bars with a hover/focus tooltip per bar (single series, so no legend).
function Columns({ data, format, label }: { data: { key: string; label: string; value: number; detail?: string }[]; format: (v: number) => string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-8 text-center text-[14px] text-white/40">No data yet</p>;
  const shown = active ?? data.length - 1;

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2" aria-live="polite">
        <span className="text-[22px] font-semibold tabular-nums">{format(data[shown].value)}</span>
        <span className="text-[13px] text-white/50">{data[shown].label}{data[shown].detail ? ` · ${data[shown].detail}` : ''}</span>
      </div>
      <div className="relative h-40" role="img" aria-label={label} onPointerLeave={() => setActive(null)}>
        <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-dashed border-white/[0.08]" />
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.08]" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <button
              key={d.key}
              type="button"
              aria-label={`${d.label}: ${format(d.value)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-opacity ${active === null || active === i ? 'opacity-100' : 'opacity-45'} group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-white/70`}
                style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%`, background: 'var(--series-1)' }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-white/40" aria-hidden="true">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

// Ranked list with a thin magnitude bar (text stays in text colors; the bar carries the value).
function RankedList({ rows, format = fmt, empty = 'No data yet' }: { rows: { label: string; value: number; extra?: string }[]; format?: (v: number) => string; empty?: string }) {
  if (!rows.length) return <p className="py-4 text-[14px] text-white/40">{empty}</p>;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ol className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate text-white/85">{row.label}</span>
            <span className="shrink-0 tabular-nums text-white/60">
              {format(row.value)}
              {row.extra ? <span className="ml-2 text-white/35">{row.extra}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-[4px] rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Login({ onSubmit, error, busy }: { onSubmit: (password: string, remember: boolean) => void; error: string | null; busy: boolean }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <form
        className="w-full max-w-[340px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onSubmit(password, remember);
        }}
      >
        <h1 className="text-[28px] font-bold tracking-[-0.03em]">Listening</h1>
        <p className="mt-1 text-[15px] text-white/50">Bryton Zoz · Admin</p>
        <label htmlFor="admin-password" className="mt-8 block text-[13px] font-medium text-white/60">Password</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 h-12 w-full rounded-[12px] bg-white/[0.08] px-4 text-[16px] text-white outline-none ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-white/40"
        />
        <label className="mt-3 flex items-center gap-2 text-[14px] text-white/60">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 accent-white" />
          Remember on this device
        </label>
        {error ? <p role="alert" className="mt-3 text-[14px] text-[#ff6961]">{error}</p> : null}
        <button type="submit" disabled={busy || !password} className="mt-6 h-12 w-full rounded-[12px] bg-white text-[16px] font-semibold text-black transition-opacity disabled:opacity-40">
          {busy ? 'Checking…' : 'Open dashboard'}
        </button>
      </form>
    </div>
  );
}

export function Dashboard() {
  const [password, setPassword] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState(false);

  useEffect(() => {
    setExcluded(isOptedOut());
    try {
      setPassword(window.localStorage.getItem(KEY_STORE) ?? window.sessionStorage.getItem(KEY_STORE));
    } catch {
      // Storage blocked: ask each time.
    }
  }, []);

  const load = useCallback(async (key: string, range: number, remember?: boolean) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/stats?days=${range}`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store' });
      if (response.status === 401) {
        setError('That password isn’t right.');
        setPassword(null);
        try { window.localStorage.removeItem(KEY_STORE); window.sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
        return;
      }
      if (response.status === 503) {
        const body = await response.json().catch(() => ({}));
        setError(body.error === 'not-configured'
          ? 'The admin password hasn’t been set up yet. Add ADMIN_PASSWORD as a repository secret on GitHub, then redeploy.'
          : 'The metrics database isn’t connected yet.');
        setPassword(null);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setStats(await response.json());
      setError(null);
      setPassword(key);
      if (remember !== undefined) {
        try {
          (remember ? window.localStorage : window.sessionStorage).setItem(KEY_STORE, key);
        } catch { /* ignore */ }
      }
    } catch {
      setError('Couldn’t load the numbers. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (password) load(password, days);
  }, [password, days, load]);

  // Keep "listening now" fresh.
  useEffect(() => {
    if (!password) return;
    const timer = window.setInterval(() => load(password, days), 30_000);
    return () => window.clearInterval(timer);
  }, [password, days, load]);

  const daily = useMemo(() => {
    if (!stats) return [];
    const plays = new Map(stats.dailyPlays.map((row) => [row.day as string, row]));
    const views = new Map(stats.daily.map((row) => [row.day as string, row]));
    const start = new Date(`${stats.since === '0000-00-00' ? (stats.daily[0]?.day ?? new Date().toISOString().slice(0, 10)) : stats.since}T00:00:00Z`);
    const out: { key: string; label: string; value: number; detail: string }[] = [];
    for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const dayViews = views.get(key);
      out.push({
        key,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        value: n(plays.get(key)?.streams),
        detail: `${fmt(n(dayViews?.listeners))} listeners · ${duration(n(dayViews?.seconds))} listened`,
      });
    }
    return out;
  }, [stats]);

  if (!password || !stats) {
    return <Login onSubmit={(key, remember) => load(key, days, remember)} error={error} busy={busy} />;
  }

  const t = stats.totals;
  const listeners = n(t.listeners);
  const totalPlays = stats.dropoff.reduce((sum, row) => sum + n(row.plays), 0);
  const reachedAtLeast = Array.from({ length: 10 }, (_, b) => ({
    key: String(b),
    label: `${b * 10}%`,
    value: totalPlays ? stats.dropoff.filter((row) => n(row.bucket) >= b).reduce((sum, row) => sum + n(row.plays), 0) / totalPlays : 0,
    detail: `of plays got at least ${b * 10}% in`,
  }));
  const onSite = n(t.plays);
  const outbound = n(t.outbound);

  const exportCsv = async () => {
    const response = await fetch(`/api/admin/export.csv?days=${days}`, { headers: { authorization: `Bearer ${password}` } });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `brytonzoz-listening-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-root mx-auto max-w-[1100px] px-4 pb-24 pt-6 sm:px-8 sm:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold leading-none tracking-[-0.03em]">Listening</h1>
          <p className="mt-2 text-[14px] text-white/45">Updated {new Date(stats.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 30 seconds</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportCsv} className="h-9 rounded-full bg-white/[0.08] px-4 text-[14px] font-semibold text-white/85 hover:bg-white/[0.12]">Export CSV</button>
          <button
            type="button"
            onClick={() => {
              try { window.localStorage.removeItem(KEY_STORE); window.sessionStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
              setPassword(null);
              setStats(null);
            }}
            className="h-9 rounded-full px-3 text-[14px] font-semibold text-white/50 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            aria-pressed={days === range.days}
            onClick={() => setDays(range.days)}
            className={`h-9 rounded-full px-4 text-[14px] font-semibold transition-colors ${days === range.days ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.12]'}`}
          >
            {range.label}
          </button>
        ))}
        {busy ? <span className="ml-2 text-[13px] text-white/40">Loading…</span> : null}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Listening now" value={fmt(stats.live.listeners)} hint={stats.live.tracks[0] ? `${trackTitles.get(stats.live.tracks[0].track) ?? ''}` : 'Nobody right now'} live />
        <Tile label="Streams" value={fmt(n(t.streams))} hint={`${fmt(onSite)} plays · 30s+ counts as a stream`} />
        <Tile label="Listeners" value={fmt(listeners)} hint={`${fmt(n(t.returningListeners))} came back another day`} />
        <Tile label="Time listened" value={duration(n(t.seconds))} hint={listeners ? `${duration(n(t.seconds) / listeners)} per listener` : undefined} />
        <Tile label="Finished songs" value={pct(t.completionRate)} hint="of plays reached the end" />
        <Tile label="Skipped" value={pct(t.skipRate)} hint="of plays skipped early" />
        <Tile label="Visitors" value={fmt(n(t.visitors))} hint={n(t.visitors) ? `${pct(listeners / n(t.visitors))} pressed play` : undefined} />
        <Tile label="To streaming apps" value={fmt(outbound)} hint={`${fmt(n(t.shares))} shares`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Streams per day" subtitle="Tap or hover a day for listeners and time">
          <Columns data={daily} format={fmt} label="Streams per day" />
        </Card>
        <Card title="How far people listen" subtitle="Share of plays that reached each point of a song">
          <Columns data={reachedAtLeast} format={(v) => `${Math.round(v * 100)}%`} label="Share of plays reaching each point" />
        </Card>
      </div>

      <Card title="Songs" subtitle="Ranked by streams" className="mt-3">
        {stats.tracks.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead>
                <tr className="text-[12px] font-medium text-white/45">
                  <th className="px-2 pb-2 font-medium">Song</th>
                  <th className="px-2 pb-2 text-right font-medium">Streams</th>
                  <th className="px-2 pb-2 text-right font-medium">Listeners</th>
                  <th className="px-2 pb-2 text-right font-medium">Time</th>
                  <th className="px-2 pb-2 text-right font-medium">Finished</th>
                  <th className="px-2 pb-2 text-right font-medium">Skipped</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {stats.tracks.map((row) => (
                  <tr key={String(row.track)} className="border-t border-white/[0.06]">
                    <td className="px-2 py-2.5">
                      <span className="block text-white/90">{trackTitles.get(String(row.track)) ?? row.track}</span>
                      <span className="block text-[12px] text-white/40">{releaseTitles.get(String(row.release)) ?? row.release}</span>
                    </td>
                    <td className="px-2 text-right text-white/90">{fmt(n(row.streams))}</td>
                    <td className="px-2 text-right text-white/70">{fmt(n(row.listeners))}</td>
                    <td className="px-2 text-right text-white/70">{duration(n(row.seconds))}</td>
                    <td className="px-2 text-right text-white/70">{pct(row.completionRate)}</td>
                    <td className="px-2 text-right text-white/70">{pct(row.skipRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[14px] text-white/40">No plays in this range yet.</p>}
      </Card>

      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Releases" subtitle="Full listens = every song heard to the end">
          <RankedList rows={stats.releases.map((row) => ({ label: releaseTitles.get(String(row.release)) ?? String(row.release), value: n(row.streams), extra: `${fmt(n(row.fullListens))} full` }))} />
        </Card>
        <Card title="Streaming apps" subtitle={`${fmt(outbound)} taps out · ${fmt(onSite)} plays here`}>
          <RankedList rows={stats.outbound.map((row) => ({ label: SERVICE_NAMES[String(row.label)] ?? String(row.label), value: n(row.value) }))} empty="Nobody has tapped out yet" />
        </Card>
        <Card title="Shared" subtitle="Songs and releases people sent">
          <RankedList rows={stats.shares.map((row) => ({ label: trackTitles.get(String(row.label)) ?? releaseTitles.get(String(row.label)) ?? String(row.label), value: n(row.value) }))} empty="No shares yet" />
        </Card>
        <Card title="Countries" subtitle="Visitors">
          <RankedList rows={stats.countries.map((row) => ({ label: country(String(row.label)), value: n(row.value) }))} />
        </Card>
        <Card title="Where they came from" subtitle="Visitors by referring site">
          <RankedList rows={stats.referrers.map((row) => ({ label: String(row.label), value: n(row.value) }))} />
        </Card>
        <Card title="Devices" subtitle="Visitors">
          <RankedList rows={stats.devices.map((row) => ({ label: String(row.label).replace(/^./, (c) => c.toUpperCase()), value: n(row.value) }))} />
        </Card>
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[13px] text-white/40">
        <p>Anonymous: a random id per browser. No names, emails or IP addresses are stored.</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(event) => {
              setOptedOut(event.target.checked);
              setExcluded(event.target.checked);
            }}
            className="h-4 w-4 accent-white"
          />
          Don’t count my own listening on this device
        </label>
      </footer>
    </div>
  );
}
