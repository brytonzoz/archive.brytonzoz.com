'use client';

import React, { useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { GITHUB_USERNAME, RECEIPT_PATH, receiptNumber, type PrintMode } from '../../lib/shipped-receipt';
import { Line, Rule, Ticket } from './paper';
import { useShippedState } from './state';
import { Turnstile, type TurnstileHandle } from './Turnstile';

const ERRORS: Record<string, string> = {
  'invalid-username': 'That isn’t a GitHub username.',
  'no-such-user': 'No GitHub user by that name.',
  'not-a-person': 'That’s an organization. Try a person’s username.',
  'github-busy': 'GitHub is rate limiting the printer. Try again in a few minutes.',
  'github-error': 'Couldn’t reach GitHub. Try again.',
  turnstile: 'Couldn’t check you’re human. Try again.',
  'slow-down': 'The printer is hot. Try again in an hour.',
  'taken-down': 'That receipt was taken down.',
  'out-of-paper': 'Out of paper for today. Back tomorrow.',
};
const OFFLINE: Record<string, string> = {
  'out-of-paper': 'OUT OF PAPER FOR TODAY. BACK TOMORROW.',
};

export function PrintForm() {
  const state = useShippedState();
  const [login, setLogin] = useState('');
  const [mode, setMode] = useState<PrintMode>('flex');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const generator = state?.generator;
  const name = login.trim().replace(/^@/, '');
  const valid = GITHUB_USERNAME.test(name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return setError(ERRORS['invalid-username']);
    if (!token) return setError('One second, checking you’re human…');
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/shipped/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: name, mode, token }),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (response.ok && result.id) {
        track({ type: 'open', release: 'shipped', detail: `print-${mode}` });
        window.location.assign(RECEIPT_PATH(result.id));
        return;
      }
      setError(ERRORS[result.error ?? ''] ?? 'The printer jammed. Try again.');
    } catch {
      setError('The printer jammed. Try again.');
    }
    turnstile.current?.reset();
    setBusy(false);
  }

  return (
    <Ticket id="print" label="Print my receipt">
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">SELF-SERVE KIOSK</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-none tracking-[0.2em]">PRINT MY RECEIPT</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-[#1c1917]/75">Your public GitHub, itemized: shipped, in progress, abandoned.</p>
      </header>
      <div className="mt-3 text-[12px]">
        <Line label="RECEIPTS PRINTED" value={state ? receiptNumber(state.printed) : '······'} />
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
          <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="shipped-login">
            GITHUB USERNAME
          </label>
          <div className="shipped-field flex items-center">
            <span aria-hidden="true" className="pl-2.5 text-[#1c1917]/55">
              @
            </span>
            <input
              id="shipped-login"
              className="w-full bg-transparent px-1.5 py-2 text-[15px] outline-none"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={40}
              placeholder="octocat"
              aria-invalid={login.length > 0 && !valid}
              aria-describedby={error ? 'shipped-print-error' : undefined}
            />
          </div>

          <fieldset>
            <legend className="text-[11px] font-semibold tracking-[0.16em]">EDITION</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['flex', 'roast'] as PrintMode[]).map((option) => (
                <label key={option} className={`shipped-choice text-center ${mode === option ? 'is-on' : ''}`}>
                  <input type="radio" name="mode" value={option} checked={mode === option} onChange={() => setMode(option)} className="sr-only" />
                  <span className="text-[13px] font-semibold tracking-[0.18em]">{option.toUpperCase()}</span>
                  <span className="block text-[11px] opacity-70">{option === 'flex' ? 'hype what shipped' : 'tease the graveyard'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {generator?.turnstileSiteKey ? <Turnstile ref={turnstile} siteKey={generator.turnstileSiteKey} onToken={setToken} /> : null}

          <button type="submit" className="shipped-button w-full" disabled={busy || !generator}>
            {busy ? 'PRINTING…' : 'PRINT'}
          </button>
          {error ? (
            <p id="shipped-print-error" className="text-center text-[12px] font-semibold" role="alert">
              {error}
            </p>
          ) : null}
          {generator?.demo ? (
            <p className="text-center text-[11px] text-[#1c1917]/65">Staging: the AI is off, so receipts print as a demo layout.</p>
          ) : null}
        </form>
      )}

      <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[#1c1917]/60">
        Made from public profile data. One receipt per username per edition per day. Not affiliated with GitHub.
      </p>
    </Ticket>
  );
}
