'use client';

// The top of / and /r/<id>/: one receipt printer on the counter and the self-serve panel next to it. The
// printer opens with a slip (or the receipt the link points at). PRINT YOURS looks the
// name up, lets the visitor pick if it could be more than one person, tears off whatever is hanging, feeds
// while the sources are searched, and prints theirs. Jams and an empty roll print a slip instead.
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { track } from '../../lib/analytics';
import { closingLabel, countdown } from '../../lib/shipped-event';
import { RECEIPT_PATH, SHIPPED_HOST, readQuery, receiptNumber, type Candidate } from '../../lib/shipped-year';
import { HumanCheck, type HumanCheckHandle } from './HumanCheck';
import { Machine, type Job, type Tone } from './Machine';
import { Line, Rule, Tall } from './paper';
import { refreshShippedState, useShippedState } from './state';
import { ShareBar, VisitorReceipt, rememberPile, type Loaded } from './visitor';

const ERRORS: Record<string, string> = {
  'invalid-query': 'Type a name, an @handle, a GitHub username or a website.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'The print head is hot. Try again in an hour.',
  busy: 'Lots of people printing. Try again in a few seconds.',
  printing: 'That receipt is printing right now. Try again in a few seconds.',
  jammed: 'Paper jam on that one. Try again in a few minutes.',
  closed: 'The printer is off for good. Receipts already printed still open and share.',
  'cross-origin': 'Print from shipped.brytonzoz.com.',
  'browser-only': 'Print from a browser.',
  'bad-request': 'Something went wrong. Reload and try again.',
  'taken-down': 'That receipt was taken down at its owner’s request.',
  'ai-busy': 'Busy. Try again in a minute.',
  'ai-error': 'Paper jam. Try again.',
  'ai-setup': 'Not plugged in yet. Check back soon.',
  offline: 'Offline. Check back soon.',
};

const SEARCHING: Record<string, string> = {
  github: 'SEARCHING GITHUB',
  appstore: 'SEARCHING APP STORE',
  hn: 'READING SHOW HN',
  npm: 'SEARCHING NPM',
  producthunt: 'PRODUCT HUNT',
  tinyfish: 'CRAWLING THE WEB',
  tavily: 'CRAWLING THE WEB',
  exa: 'CRAWLING THE WEB',
  brave: 'CRAWLING THE WEB',
  web: 'SEARCHING THE WEB',
};

export type Opening = { kind: 'house'; content: React.ReactNode } | { kind: 'loaded'; loaded: Loaded } | { kind: 'loading' } | { kind: 'missing' };

type Step = { name: 'idle' } | { name: 'looking' } | { name: 'pick'; candidates: Candidate[] } | { name: 'feeding' } | { name: 'jammed' };

function Slip({ title, lines, note }: { title: string; lines: [string, string][]; note: string }) {
  return (
    <div className="text-center text-[12px]" role="status">
      <p>
        <Tall className="text-[15px] font-semibold">{title}</Tall>
      </p>
      <Rule />
      <div className="space-y-0.5 text-left">
        {lines.map(([label, value]) => (
          <Line key={label} label={label} value={value} />
        ))}
      </div>
      <Rule />
      <p className="leading-snug opacity-75">{note}</p>
    </div>
  );
}

const outOfPaper = (
  <Slip
    title="OUT OF PAPER"
    lines={[
      ['ROLLS LEFT', '0'],
      ['RECEIPTS ALREADY OUT', 'STILL GOOD'],
      ['SHARING', 'STILL WORKS'],
    ]}
    note="The cashier went to find another roll. Check back later."
  />
);

function openingJob(opening: Opening): Job {
  if (opening.kind === 'house') return { key: 'house', kind: 'print', slip: true, label: 'How it works', content: opening.content };
  if (opening.kind === 'loaded') {
    return { key: `r${opening.loaded.receipt.id}`, kind: 'print', label: `Shipped receipt #${receiptNumber(opening.loaded.receipt.id)}`, content: <VisitorReceipt {...opening.loaded} /> };
  }
  if (opening.kind === 'missing') {
    return {
      key: 'missing',
      kind: 'print',
      slip: true,
      label: 'Receipt not found',
      content: <Slip title="NO SUCH RECEIPT" lines={[['STATUS', 'VOID']]} note="It may have been taken down by its owner." />,
    };
  }
  return { key: 'loading', kind: 'feed', label: 'Loading receipt' };
}

/** "PRINTER SHUTS OFF IN 13d 4h": ticks against the server's clock, not the visitor's. */
function Countdown() {
  const state = useShippedState();
  const [now, setNow] = useState<number | null>(null);
  const skew = useRef(0);
  useEffect(() => {
    if (!state) return;
    skew.current = state.event.now - Date.now();
    setNow(Date.now() + skew.current);
    const timer = window.setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  if (!state || now === null) return null;
  const left = state.event.closesAt - now;
  if (state.event.phase === 'closed' || left <= 0) {
    return (
      <p className="shipped-kiosk-status" role="status">
        THE PRINTER IS OFF. {state.event.name.toUpperCase()} IS ARCHIVED.
      </p>
    );
  }
  return (
    <p className="shipped-kiosk-hint" aria-live="off">
      <span className="font-semibold tabular-nums">PRINTER SHUTS OFF IN {countdown(left)}</span> · {closingLabel(state.event.closesAt)}. Then the pile and
      the sponsors freeze for good.
    </p>
  );
}

export function ShippedStage({ opening, title }: { opening: Opening; title: React.ReactNode }) {
  const state = useShippedState();
  const generator = state?.generator;
  const [query, setQuery] = useState('');
  const [listed, setListed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job>(() => openingJob(opening));
  const [current, setCurrent] = useState<Loaded | null>(opening.kind === 'loaded' ? opening.loaded : null);
  const [paper, setPaper] = useState<'printing' | 'hanging' | 'torn'>('printing');
  const [tearSignal, setTearSignal] = useState(0);
  const [tick, setTick] = useState(0);
  const touched = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const human = useRef<HumanCheckHandle>(null);
  const prints = useRef(0);
  const after = useRef<HTMLDivElement>(null);

  // /shipped/r/<id>/ finds out which receipt it is after the first render.
  useEffect(() => {
    if (touched.current) return;
    setJob(openingJob(opening));
    setCurrent(opening.kind === 'loaded' ? opening.loaded : null);
  }, [opening]);

  useEffect(() => {
    if (step.name !== 'feeding') return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1500);
    return () => window.clearInterval(timer);
  }, [step.name]);

  const closed = state?.event.phase === 'closed' || generator?.reason === 'closed';
  const empty = generator && !generator.enabled && (generator.reason === 'out-of-paper' || closed);
  const offline = generator && !generator.enabled && !empty;
  const searching = ['WARMING UP', ...Array.from(new Set((generator?.sources ?? ['github', 'appstore', 'hn', 'npm']).map((s) => SEARCHING[s]).filter(Boolean))), 'ITEMIZING'];

  let display: string;
  let tone: Tone;
  if (empty) [display, tone] = ['OUT OF PAPER', 'empty'];
  else if (step.name === 'jammed') [display, tone] = ['PAPER JAM', 'error'];
  else if (step.name === 'looking') [display, tone] = ['LOOKING UP', 'busy'];
  else if (step.name === 'feeding') [display, tone] = [searching[Math.min(tick, searching.length - 1)], 'busy'];
  else if (job.kind === 'feed') [display, tone] = ['LOADING', 'busy'];
  else if (paper === 'printing') [display, tone] = ['PRINTING', 'busy'];
  else if (paper === 'hanging') [display, tone] = ['TEAR HERE', 'ready'];
  else if (offline) [display, tone] = ['OFFLINE', 'error'];
  else [display, tone] = ['READY', 'ready'];

  function load(next: Job, loaded: Loaded | null) {
    touched.current = true;
    prints.current += 1;
    setPaper('printing');
    setCurrent(loaded);
    setJob(next);
  }

  /** Tear off whatever is hanging first, so the next job never yanks a receipt out mid-air. */
  function clear(then: () => void) {
    if (paper === 'hanging' && job.kind === 'print') {
      setTearSignal((n) => n + 1);
      window.setTimeout(then, 420);
    } else then();
  }

  function slip(key: string, label: string, content: React.ReactNode, end = false) {
    load({ key: `${key}-${prints.current}`, kind: 'print', slip: true, end, label, content }, null);
  }

  async function print(candidate: Candidate) {
    if (!token) return setError('One second, checking you’re human…');
    setError(null);
    setTick(0);
    setStep({ name: 'feeding' });
    clear(() => load({ key: `feed-${prints.current}`, kind: 'feed', label: `Printing ${candidate.display}’s receipt` }, null));
    try {
      const response = await fetch('/api/shipped/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: { kind: candidate.kind, id: candidate.id, display: candidate.display }, token, listed }),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: number; pile?: string; error?: string };
      human.current?.reset();
      if (!response.ok || !result.id) throw new Error(result.error ?? 'ai-error');
      rememberPile(result.id, result.pile);
      const loaded = await fetch(`/api/shipped/receipts/${result.id}`).then((r) => (r.ok ? (r.json() as Promise<Loaded>) : null));
      if (!loaded) throw new Error('ai-error');
      track({ type: 'open', release: 'shipped', detail: `print-${candidate.kind}` });
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setStep({ name: 'idle' });
      load({ key: `r${loaded.receipt.id}-${prints.current}`, kind: 'print', label: `Your receipt, #${receiptNumber(loaded.receipt.id)}`, content: <VisitorReceipt {...loaded} /> }, loaded);
      refreshShippedState();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'ai-error';
      if (code === 'out-of-paper' || code === 'closed') {
        setStep({ name: 'idle' });
        slip('empty', 'Out of paper', outOfPaper, true);
        refreshShippedState();
        return;
      }
      const message = ERRORS[code] ?? ERRORS['ai-error'];
      setStep({ name: 'jammed' });
      setError(message);
      slip('jam', 'Paper jam', <Slip title="PAPER JAM" lines={[['RECEIPT', 'VOID'], ['CHARGED', '$0.00']]} note={message} />);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!readQuery(query)) {
      setError(ERRORS['invalid-query']);
      input.current?.focus();
      return;
    }
    setError(null);
    setStep({ name: 'looking' });
    try {
      const response = await fetch('/api/shipped/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      const result = (await response.json().catch(() => ({}))) as { candidates?: Candidate[]; auto?: boolean; error?: string };
      if (!response.ok || !result.candidates?.length) throw new Error(result.error ?? 'invalid-query');
      if (result.auto) return print(result.candidates[0]);
      setStep({ name: 'pick', candidates: result.candidates });
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(ERRORS[code] ?? 'Couldn’t look that up. Try again.');
      setStep({ name: 'idle' });
    }
  }

  const busy = step.name === 'looking' || step.name === 'feeding';
  const waitingForHuman = Boolean(generator?.human) && !token;
  const torn = paper === 'torn' && job.kind === 'print';

  // Sharing can't be tabbed to until the receipt is torn off and the bar is showing.
  useEffect(() => {
    after.current?.toggleAttribute('inert', !torn);
  }, [torn, current]);

  return (
    <div className="shipped-stage">
      <section className="shipped-kiosk" id="print" aria-labelledby="shipped-title">
        <p className="shipped-kiosk-eyebrow">BZ-80 · SELF-SERVE</p>
        <h2 id="shipped-title" className="shipped-kiosk-title">
          {title}
        </h2>
        <p className="shipped-kiosk-lede">Everything you shipped in {generator?.year ?? 'this year'}, itemized on one receipt. Apps, launches, repos, releases, sites.</p>

        <Countdown />

        {empty ? (
          <p className="shipped-kiosk-status" role="status">
            {closed ? 'The printer is off for good. Receipts already printed still open and share.' : 'Out of paper. Receipts already printed still open and share.'}
          </p>
        ) : offline ? (
          <p className="shipped-kiosk-status" role="status">
            The printer is offline. Check back soon.
          </p>
        ) : (
          <form className="shipped-kiosk-form" onSubmit={submit} noValidate>
            <label className="shipped-kiosk-label" htmlFor="shipped-query">
              Name, @handle, GitHub or website
            </label>
            <div className="shipped-kiosk-row">
              <input
                ref={input}
                id="shipped-query"
                className="shipped-kiosk-input"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (step.name === 'pick' || step.name === 'jammed') setStep({ name: 'idle' });
                  if (error) setError(null);
                }}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                enterKeyHint="go"
                placeholder="levelsio"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'shipped-print-error' : 'shipped-print-hint'}
              />
              <button type="submit" className="shipped-kiosk-go" disabled={busy || !generator}>
                {step.name === 'looking' ? 'Looking' : step.name === 'feeding' ? 'Printing' : 'Print'}
              </button>
            </div>
            {error ? (
              <p id="shipped-print-error" className="shipped-kiosk-error" role="alert">
                {error}
              </p>
            ) : (
              <p id="shipped-print-hint" className="shipped-kiosk-hint">
                Public pages only. Wrong? Remove or correct it after it prints. First line usually lands in about 15
                seconds; a reprint of the same name is instant.
              </p>
            )}

            {step.name === 'pick' ? (
              <fieldset className="shipped-kiosk-pick">
                <legend className="shipped-kiosk-label">Which one is you?</legend>
                <ul>
                  {step.candidates.map((candidate) => (
                    <li key={`${candidate.kind}:${candidate.id}`}>
                      <button type="button" className="shipped-kiosk-choice" onClick={() => print(candidate)} disabled={waitingForHuman}>
                        <span className="block font-semibold">{candidate.display}</span>
                        <span className="block opacity-60">{candidate.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ) : null}

            <label className="shipped-kiosk-check">
              <input type="checkbox" checked={listed} onChange={(event) => setListed(event.target.checked)} />
              <span>List it under “Recently printed”</span>
            </label>

            <HumanCheck ref={human} check={generator?.enabled ? generator.human : null} onToken={setToken} theme="dark" appearance="interaction-only" />
            {generator?.demo ? <p className="shipped-kiosk-hint">Staging: no AI key here, so receipts print from the free sources only.</p> : null}
          </form>
        )}

        <dl className="shipped-kiosk-count">
          <div>
            <dt>Printed</dt>
            <dd>{state ? state.printed.toLocaleString('en-US') : '—'}</dd>
          </div>
          <div>
            <dt>Shared</dt>
            <dd>{state ? state.shared.toLocaleString('en-US') : '—'}</dd>
          </div>
        </dl>
        <p className="shipped-kiosk-fine">
          Free. Public, professional work only, and every item links to its source. The same name within 7 days reprints the same receipt.{' '}
          <a href="/terms/" className="underline">
            Terms &amp; privacy
          </a>
        </p>
      </section>

      <div className="shipped-counter">
        <Machine
          job={job}
          display={display}
          tone={tone}
          tearSignal={tearSignal}
          onPrinted={() => setPaper('hanging')}
          onTorn={() => setPaper('torn')}
        />

        {current ? (
          <div className={`shipped-after${torn ? ' is-ready' : ''}`} ref={after}>
            <ShareBar receipt={current.receipt} />
            <p className="mt-2 text-center text-[11px] text-[#f3ead8]/55">
              Its own page:{' '}
              <a href={RECEIPT_PATH(current.receipt.id)} className="underline">
                {SHIPPED_HOST}
                {RECEIPT_PATH(current.receipt.id)}
              </a>
            </p>
          </div>
        ) : job.key === 'house' && torn ? (
          <div className="shipped-after is-ready is-cta">
            <button
              type="button"
              className="shipped-button is-big w-full"
              onClick={() => {
                input.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                input.current?.focus({ preventScroll: true });
              }}
            >
              PRINT YOURS
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
