'use client';

// "PRINT YOURS": one field (a name, an X handle, a GitHub username or a website). If it could be more
// than one person, the visitor picks; then the machine feeds while the sources are searched, and prints
// their receipt on the same template as Bryton's, with sharing right under it.
import React, { useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { RECEIPT_PATH, readQuery, receiptNumber, type Candidate } from '../../lib/shipped-year';
import { Machine, printDuration } from './Machine';
import { Line, Rule, Ticket } from './paper';
import { refreshShippedState, useShippedState } from './state';
import { Turnstile, type TurnstileHandle } from './Turnstile';
import { ShareBar, VisitorReceipt, type Loaded } from './visitor';

const ERRORS: Record<string, string> = {
  'invalid-query': 'Type a name, an @handle, a GitHub username or a website.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'The printer is hot. Try again in an hour.',
  'taken-down': 'That receipt was taken down at its owner’s request.',
  'out-of-paper': 'Out of paper for today. Back tomorrow.',
  'ai-busy': 'The printer is busy. Try again in a minute.',
  'ai-error': 'The printer jammed. Try again.',
  offline: 'The printer is offline. Check back soon.',
};
const OFFLINE: Record<string, string> = {
  'out-of-paper': 'OUT OF PAPER FOR TODAY. BACK TOMORROW.',
};

const TICKER: Record<string, string> = {
  github: 'SEARCHING GITHUB…',
  appstore: 'CHECKING THE APP STORE…',
  hn: 'READING SHOW HN…',
  npm: 'LOOKING ON NPM…',
  producthunt: 'CHECKING PRODUCT HUNT…',
  tinyfish: 'CRAWLING THE WEB…',
  tavily: 'CRAWLING THE WEB…',
  exa: 'CRAWLING THE WEB…',
  brave: 'CRAWLING THE WEB…',
  web: 'SEARCHING THE WEB…',
};

type Phase = { name: 'idle' } | { name: 'looking' } | { name: 'pick'; candidates: Candidate[] } | { name: 'feeding'; who: string } | { name: 'done'; loaded: Loaded };

export function PrintYours({ ready = true }: { ready?: boolean }) {
  const state = useShippedState();
  const [query, setQuery] = useState('');
  const [listed, setListed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [torn, setTorn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const machine = useRef<HTMLDivElement>(null);

  const generator = state?.generator;
  const year = generator?.year;
  const busy = phase.name === 'looking' || phase.name === 'feeding';

  async function print(candidate: Candidate) {
    if (!token) return setError('One second, checking you’re human…');
    setError(null);
    setTorn(false);
    setPhase({ name: 'feeding', who: candidate.display });
    requestAnimationFrame(() => machine.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try {
      const response = await fetch('/api/shipped/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: { kind: candidate.kind, id: candidate.id, display: candidate.display }, token, listed }),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      turnstile.current?.reset();
      setToken(null);
      if (!response.ok || !result.id) throw new Error(result.error ?? 'jammed');
      const loaded = await fetch(`/api/shipped/receipts/${result.id}`).then((r) => (r.ok ? (r.json() as Promise<Loaded>) : null));
      if (!loaded) throw new Error('jammed');
      track({ type: 'open', release: 'shipped', detail: `print-${candidate.kind}` });
      setPhase({ name: 'done', loaded });
      refreshShippedState();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'jammed';
      setError(ERRORS[code] ?? 'The printer jammed. Try again.');
      setPhase({ name: 'idle' });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!readQuery(query)) return setError(ERRORS['invalid-query']);
    setError(null);
    setPhase({ name: 'looking' });
    try {
      const response = await fetch('/api/shipped/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      const result = (await response.json().catch(() => ({}))) as { candidates?: Candidate[]; auto?: boolean; error?: string };
      if (!response.ok || !result.candidates?.length) throw new Error(result.error ?? 'invalid-query');
      if (result.auto) return print(result.candidates[0]);
      setPhase({ name: 'pick', candidates: result.candidates });
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(ERRORS[code] ?? 'Couldn’t look that up. Try again.');
      setPhase({ name: 'idle' });
    }
  }

  const ticker = ['WARMING THE PRINT HEAD…', ...Array.from(new Set((generator?.sources ?? ['github', 'appstore', 'hn', 'npm']).map((s) => TICKER[s]).filter(Boolean))), 'ITEMIZING…'];

  return (
    <div className={`shipped-cta ${ready ? 'is-ready' : ''}`} id="print">
      <Ticket label="Print your Shipped receipt">
        <header className="text-center">
          <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SELF-SERVE KIOSK</p>
          <h2 className="mt-2 text-[24px] font-semibold leading-none tracking-[0.2em]">PRINT YOURS</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">
            Everything you shipped in {year ?? 'this year'}, itemized on one receipt. Apps, launches, repos, releases, sites.
          </p>
        </header>
        <div className="mt-3 space-y-1 text-[12px]">
          <Line label="RECEIPTS PRINTED" value={state ? receiptNumber(state.printed) : '······'} />
          <Line label="RECEIPTS SHARED" value={state ? receiptNumber(state.shared) : '······'} />
        </div>
        <div className="mt-2">
          <Rule />
        </div>

        {generator && !generator.enabled ? (
          <p className="mt-3 text-center text-[12.5px] font-semibold tracking-[0.12em]" role="status">
            {OFFLINE[generator.reason ?? ''] ?? 'PRINTER OFFLINE. CHECK BACK SOON.'}
          </p>
        ) : (
          <form className="mt-3 space-y-3" onSubmit={submit} noValidate>
            <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="shipped-query">
              NAME, @HANDLE, GITHUB OR WEBSITE
            </label>
            <div className="shipped-field flex items-center">
              <input
                id="shipped-query"
                className="w-full bg-transparent px-2.5 py-2.5 text-[16px] outline-none"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (phase.name === 'pick') setPhase({ name: 'idle' });
                }}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                placeholder="levelsio · rauchg · yoursite.com"
                aria-describedby={error ? 'shipped-print-error' : undefined}
              />
            </div>

            {phase.name === 'pick' ? (
              <fieldset>
                <legend className="text-[11px] font-semibold tracking-[0.16em]">WHICH ONE IS YOU?</legend>
                <ul className="mt-1.5 space-y-2">
                  {phase.candidates.map((candidate) => (
                    <li key={`${candidate.kind}:${candidate.id}`}>
                      <button type="button" className="shipped-choice w-full text-left" onClick={() => print(candidate)} disabled={!token}>
                        <span className="block text-[13px] font-semibold tracking-[0.1em]">{candidate.kind === 'github' && candidate.display.startsWith('@') ? candidate.display : candidate.display.toUpperCase()}</span>
                        <span className="block text-[11.5px] opacity-75">{candidate.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ) : null}

            <label className="flex items-start gap-2 text-[11.5px] leading-snug">
              <input type="checkbox" checked={listed} onChange={(event) => setListed(event.target.checked)} className="mt-0.5" />
              <span>Show my receipt in “Recently printed” on this page.</span>
            </label>

            {generator?.turnstileSiteKey ? <Turnstile ref={turnstile} siteKey={generator.turnstileSiteKey} onToken={setToken} /> : null}

            {phase.name !== 'pick' ? (
              <button type="submit" className="shipped-button w-full" disabled={busy || !generator}>
                {phase.name === 'looking' ? 'LOOKING…' : phase.name === 'feeding' ? 'PRINTING…' : 'PRINT MY RECEIPT'}
              </button>
            ) : null}
            {error ? (
              <p id="shipped-print-error" className="text-center text-[12px] font-semibold" role="alert">
                {error}
              </p>
            ) : null}
            {generator?.demo ? (
              <p className="text-center text-[11px] text-[#1c1917]/65">Staging: no AI key here, so receipts print from the free sources only.</p>
            ) : null}
          </form>
        )}

        <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[#1c1917]/60">
          Only public, professional work: launches, repos, apps, sites. The same name within 7 days reprints the same receipt.
        </p>
      </Ticket>

      <div ref={machine} className="shipped-stack w-full scroll-mt-4">
        {phase.name === 'feeding' ? <Machine mode="feed" label={`Printing ${phase.who}’s receipt`} ticker={ticker} /> : null}
        {phase.name === 'done' ? (
          <>
            <Machine mode="print" label="Your receipt" duration={printDuration(phase.loaded.receipt.items.length)} onTorn={() => setTorn(true)}>
              <VisitorReceipt {...phase.loaded} />
            </Machine>
            <div className={`shipped-after ${torn ? 'is-ready' : ''}`}>
              <ShareBar receipt={phase.loaded.receipt} />
              <p className="mt-3 text-center text-[11px] text-[#f3ead8]/60">
                Its own page:{' '}
                <a href={RECEIPT_PATH(phase.loaded.receipt.id)} className="underline">
                  brytonzoz.com{RECEIPT_PATH(phase.loaded.receipt.id)}
                </a>
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
