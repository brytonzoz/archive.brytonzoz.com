'use client';

// The top of / and /r/<id>/: one receipt printer on the desk. Type a name on its LCD and press PRINT.
// It looks the name up, lets the visitor pick if it could be more than one person, tears off whatever is
// hanging, feeds while the sources are searched, and prints theirs. Jams and an empty roll print a slip.
import React, { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { countdown } from '../../lib/shipped-event';
import { readQuery, receiptNumber, type Candidate } from '../../lib/shipped-year';
import { press } from './feel';
import { HumanCheck, type HumanCheckHandle } from './HumanCheck';
import { Machine, type Job, type Tone } from './Machine';
import { Line, Rule, Tall } from './paper';
import { Ticker } from './Ticker';
import { refreshShippedState, useShippedClock, useShippedState } from './state';
import { applyPrintChunk, fetchReceipt, followReceipt, forgetTorn, isReceiptOpen, readPrintResponse, readTorn, rememberTorn, type PrintChunk } from './print-stream';
import { SharePill, VisitorReceipt, rememberPile, type Loaded } from './visitor';

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

type Step =
  | { name: 'idle' }
  | { name: 'looking' }
  | { name: 'retry' }
  | { name: 'pick'; candidates: Candidate[] }
  | { name: 'feeding' }
  | { name: 'jammed' };

const LOOKUP_MS = 15_000;

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
    return {
      key: `r${opening.loaded.receipt.id}`,
      kind: 'print',
      fast: true,
      label: `Shipped receipt #${receiptNumber(opening.loaded.receipt.id)}`,
      content: <VisitorReceipt {...opening.loaded} />,
      revision: opening.loaded.receipt.items.length,
    };
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

/** Hanging house slip is never clipped. Focused receipts fill the viewport. Other hanging paper fades into the desk. */
function usePaperMax(focus: boolean, house: boolean) {
  const [max, setMax] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (focus || house) {
      setMax(undefined);
      return;
    }
    const measure = () => setMax(Math.max(200, Math.round(window.innerHeight - 360)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [focus, house]);
  return max;
}

/** "PRINTER SHUTS OFF IN 13d 4h": ticks against the server's clock, not the visitor's. */
function Countdown() {
  const { left, closed } = useShippedClock();
  if (left === null) return <p className="shipped-clock" aria-hidden="true">&nbsp;</p>;
  if (closed || left <= 0) {
    return (
      <p className="shipped-clock" role="status">
        THE PRINTER IS OFF
      </p>
    );
  }
  return (
    <p className="shipped-clock" aria-live="off">
      shuts off in {countdown(left)}
    </p>
  );
}

export function ShippedStage({ opening, title }: { opening: Opening; title: React.ReactNode }) {
  const state = useShippedState();
  const generator = state?.generator;
  const [query, setQuery] = useState('');
  const [listed, setListed] = useState(true);
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
  const run = useRef(0);
  const printKey = useRef<string | null>(null);
  const follow = useRef<{ cancelled: boolean } | null>(null);
  const paperRef = useRef(paper);
  const currentRef = useRef(current);
  paperRef.current = paper;
  currentRef.current = current;
  const house = job.key === 'house' || Boolean(job.kind === 'print' && job.slip);
  const focus = paper === 'torn' && Boolean(current) && job.kind === 'print' && !house;
  const paperMax = usePaperMax(focus, house);

  useEffect(() => {
    try {
      setListed(window.localStorage.getItem('shipped-wall-off') !== '1');
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  }, []);

  // /shipped/r/<id>/ finds out which receipt it is after the first render.
  useEffect(() => {
    if (touched.current) return;
    if (opening.kind === 'loaded') {
      const next = opening.loaded;
      setCurrent(next);
      setJob((prev) => {
        if (prev.kind === 'print' && (prev.key === `r${next.receipt.id}` || prev.key.startsWith(`r${next.receipt.id}-`))) {
          return { ...prev, content: <VisitorReceipt {...next} />, revision: next.receipt.items.length };
        }
        return openingJob(opening);
      });
      return;
    }
    setJob(openingJob(opening));
    setCurrent(null);
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
  else if (step.name === 'retry') [display, tone] = ['TRY AGAIN', 'error'];
  else if (step.name === 'pick') [display, tone] = ['WHICH ONE?', 'ready'];
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
    // Keep the last printed receipt during the feed so TEAR after a successful print still opens share.
    if (loaded || next.kind !== 'feed') setCurrent(loaded);
    setJob(next);
  }

  function showReceipt(loaded: Loaded) {
    touched.current = true;
    setCurrent(loaded);
    rememberTorn(loaded.receipt.id);
    const existing = printKey.current;
    const key = existing ?? `r${loaded.receipt.id}-${prints.current + 1}`;
    if (!existing) {
      printKey.current = key;
      prints.current += 1;
      setPaper('printing');
    }
    setJob({
      key,
      kind: 'print',
      label: `Your receipt, #${receiptNumber(loaded.receipt.id)}`,
      content: <VisitorReceipt {...loaded} />,
      revision: loaded.receipt.items.length,
    });
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

  async function print(candidate: Candidate, gen = run.current) {
    const humanToken = token ?? (await human.current?.execute()) ?? null;
    if (run.current !== gen) return;
    if (!humanToken) {
      setStep({ name: 'retry' });
      return setError(ERRORS.turnstile);
    }
    // Invalidate the LOOKING UP timeout so a long print never flips the LCD to TRY AGAIN.
    if (run.current === gen) ++run.current;
    setError(null);
    setTick(0);
    setStep({ name: 'feeding' });
    printKey.current = null;
    if (follow.current) follow.current.cancelled = true;
    const watching = { cancelled: false };
    follow.current = watching;
    clear(() => load({ key: `feed-${prints.current}`, kind: 'feed', label: `Printing ${candidate.display}’s receipt` }, null));
    try {
      const response = await fetch('/api/shipped/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: { kind: candidate.kind, id: candidate.id, display: candidate.display }, token: humanToken, listed }),
      });
      let loaded: Loaded | null = null;
      let lastId: number | undefined;
      const apply = (chunk: PrintChunk) => {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.id) {
          lastId = chunk.id;
          rememberPile(chunk.id, chunk.pile);
        }
        const next = applyPrintChunk(loaded, chunk);
        if (next) {
          loaded = next;
          showReceipt(next);
        }
      };
      const result = await readPrintResponse(response, apply);
      human.current?.reset();
      if (result.error) throw new Error(result.error);
      if (!response.ok && !loaded) throw new Error(result.error ?? 'ai-error');
      if (!loaded && (result.id || lastId)) {
        const id = result.id ?? lastId!;
        rememberPile(id, result.pile);
        loaded = await fetchReceipt(id);
      }
      if (!loaded) throw new Error('ai-error');
      track({ type: 'open', release: 'shipped', detail: `print-${candidate.kind}` });
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setStep({ name: 'idle' });
      showReceipt(loaded);
      refreshShippedState();
      if (isReceiptOpen(result) || isReceiptOpen(loaded)) {
        void followReceipt(loaded.receipt.id, (next) => {
          if (!watching.cancelled) showReceipt(next);
        }, watching);
      }
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

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!readQuery(query)) {
      setError(ERRORS['invalid-query']);
      input.current?.focus();
      return;
    }
    const gen = ++run.current;
    setError(null);
    setStep({ name: 'looking' });
    const timer = window.setTimeout(() => {
      if (run.current !== gen) return;
      ++run.current;
      setStep({ name: 'retry' });
      setError(ERRORS.turnstile);
    }, LOOKUP_MS);
    try {
      const response = await fetch('/api/shipped/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      const result = (await response.json().catch(() => ({}))) as { candidates?: Candidate[]; auto?: boolean; error?: string };
      if (run.current !== gen) return;
      if (!response.ok || !result.candidates?.length) throw new Error(result.error ?? 'invalid-query');
      // Lookup is done. Clear the 15s timer before Turnstile/print, or TRY AGAIN fires while execute() runs.
      window.clearTimeout(timer);
      if (result.auto) {
        await print(result.candidates[0], gen);
        return;
      }
      setStep({ name: 'pick', candidates: result.candidates });
    } catch (failure) {
      if (run.current !== gen) return;
      const code = failure instanceof Error ? failure.message : '';
      setError(ERRORS[code] ?? 'Couldn’t look that up. Try again.');
      setStep({ name: 'idle' });
    } finally {
      window.clearTimeout(timer);
    }
  }

  const busy = step.name === 'looking' || step.name === 'feeding';

  useEffect(() => {
    document.documentElement.classList.toggle('shipped-focus', focus);
    return () => document.documentElement.classList.remove('shipped-focus');
  }, [focus]);

  useEffect(() => {
    if (focus && current) rememberTorn(current.receipt.id);
  }, [focus, current]);

  // Stripe / bfcache: put the torn receipt back so Back doesn't drop the visitor on the house slip.
  useEffect(() => {
    const restore = () => {
      if (currentRef.current && paperRef.current === 'torn') return;
      if (opening.kind === 'loaded') return;
      const id = readTorn();
      if (!id) return;
      void fetchReceipt(id).then((loaded) => {
        if (!loaded || currentRef.current?.receipt.id === loaded.receipt.id) return;
        printKey.current = null;
        showReceipt(loaded);
      });
    };
    restore();
    const onShow = () => restore();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
    // opening is the first-screen house slip or /r/<id>/; restore only needs that once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening.kind]);

  function printAnother() {
    forgetTorn();
    printKey.current = null;
    if (follow.current) follow.current.cancelled = true;
    if (opening.kind === 'loaded' || opening.kind === 'missing' || opening.kind === 'loading') {
      window.location.assign('/');
      return;
    }
    touched.current = true;
    setCurrent(null);
    setPaper('printing');
    setJob(openingJob(opening));
    setStep({ name: 'idle' });
    setQuery('');
    setError(null);
    input.current?.focus();
  }

  return (
    <div className={`shipped-stage${focus ? ' is-focus' : ''}`}>
      <div className="shipped-ticker-pin">
        <Ticker />
        <Countdown />
      </div>

      <section className="shipped-counter" id="print" aria-labelledby="shipped-title">
        <h1 id="shipped-title" className="sr-only">
          {title}
        </h1>

        <Machine
          job={job}
          display={display}
          tone={tone}
          tearSignal={tearSignal}
          onPrinted={() => {
            setPaper('hanging');
            // Visitor receipts open full-screen on their own. TEAR stays as an optional gesture.
            if (currentRef.current) {
              window.setTimeout(() => setTearSignal((n) => n + 1), 120);
            }
          }}
          onTorn={() => setPaper('torn')}
          paperMax={paperMax}
          focus={focus}
          inputRef={input}
          console={
            empty || (offline && !busy)
              ? undefined
              : {
                  query,
                  onQuery: (value) => {
                    setQuery(value);
                    if (step.name === 'pick' || step.name === 'jammed' || step.name === 'retry') setStep({ name: 'idle' });
                    if (error) setError(null);
                  },
                  onPrint: () => void submit(),
                  printing: busy,
                  retry: step.name === 'retry',
                  listed,
                  onListed: (value) => {
                    setListed(value);
                    try {
                      window.localStorage.setItem('shipped-wall-off', value ? '0' : '1');
                    } catch {
                      // Private mode: the choice lasts for this page only.
                    }
                  },
                  closed,
                  invalid: Boolean(error),
                }
          }
        />

        <HumanCheck ref={human} check={generator?.enabled ? generator.human : null} onToken={setToken} theme="dark" appearance="execute" />

        {error ? (
          <p id="shipped-print-error" className="shipped-desk-error" role="alert">
            {error}
          </p>
        ) : null}

        {step.name === 'pick' ? (
          <fieldset className="shipped-pick">
            <legend className="shipped-pick-legend">Which one is you?</legend>
            <ul>
              {step.candidates.map((candidate) => (
                <li key={`${candidate.kind}:${candidate.id}`}>
                  <button type="button" className="shipped-pick-choice" onPointerDown={press} onClick={() => print(candidate)} disabled={busy}>
                    <span className="block font-semibold">{candidate.display}</span>
                    <span className="block opacity-60">{candidate.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {empty ? (
          <p className="shipped-desk-status" role="status">
            {closed ? 'The printer is off for good. Receipts already printed still open and share.' : 'Out of paper. Receipts already printed still open and share.'}
          </p>
        ) : offline && !busy ? (
          <p className="shipped-desk-status" role="status">
            The printer is offline. Check back soon.
          </p>
        ) : null}

        {focus && current ? <SharePill receipt={current.receipt} onPrintAnother={printAnother} /> : null}
      </section>
    </div>
  );
}
