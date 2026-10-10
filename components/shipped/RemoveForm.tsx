'use client';

// "Report or remove this receipt": the receipt comes down at once and the report waits in /admin. If it's about
// the person asking, it stays down and that name, handle or site can't be printed again.
import React, { useEffect, useRef, useState } from 'react';
import { receiptNumber } from '../../lib/shipped-year';
import { Rule, Ticket } from './paper';
import { useShippedState } from './state';
import { HumanCheck, type HumanCheckHandle } from './HumanCheck';

export function RemoveForm() {
  const state = useShippedState();
  const [id, setId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const human = useRef<HumanCheckHandle>(null);

  useEffect(() => {
    const value = Number(new URLSearchParams(window.location.search).get('id'));
    setId(Number.isSafeInteger(value) && value > 0 ? value : null);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!id) return;
    if (!token) return setError('One second, checking you’re human…');
    setBusy(true);
    setError(null);
    const response = await fetch('/api/shipped/takedown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, reason, token }),
    }).catch(() => null);
    if (response?.ok) setDone(true);
    else setError(response?.status === 404 ? 'That receipt doesn’t exist.' : response?.status === 429 ? 'Too many reports from here. Try again later.' : 'Couldn’t send that. Try again.');
    human.current?.reset();
    setBusy(false);
  }

  return (
    <Ticket label="Remove a receipt">
      <header className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.32em] text-[#1c1917]/70">CUSTOMER SERVICE</p>
        <h1 className="mt-2 text-[20px] font-semibold tracking-[0.2em]">REMOVE A RECEIPT</h1>
      </header>
      <div className="mt-3">
        <Rule />
      </div>
      {done ? (
        <p className="mt-4 text-center text-[12.5px] leading-relaxed" role="status">
          Done. The receipt, its page and its images are down now. A person reviews every report; if it’s about you, it stays down and
          that name, handle or site can’t be printed again.
        </p>
      ) : id ? (
        <form className="mt-3 space-y-3" onSubmit={submit} noValidate>
          <p className="text-[12.5px] leading-relaxed">
            Is receipt #{receiptNumber(id)} about you and you don’t want it up, is it wrong, or is it being used to harass someone? It
            comes down as soon as you send this.
          </p>
          <label className="block text-[11px] font-semibold tracking-[0.16em]" htmlFor="remove-reason">
            ANYTHING TO ADD? <span className="font-normal opacity-60">(optional)</span>
          </label>
          <textarea
            id="remove-reason"
            className="shipped-field w-full px-2.5 py-2 text-[14px] outline-none"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-[10.5px] text-[#1c1917]/60">Please don’t include contact details; none are needed.</p>
          <HumanCheck ref={human} check={state?.generator.human} onToken={setToken} />
          <button type="submit" className="shipped-button w-full" disabled={busy}>
            {busy ? 'SENDING…' : 'REMOVE IT'}
          </button>
          {error ? (
            <p className="text-center text-[12px] font-semibold" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="mt-4 text-center text-[12.5px]">Open this page from the “Report or remove” link on the receipt.</p>
      )}
      <p className="mt-5 text-center text-[12px]">
        <a href="/" className="shipped-link font-semibold">
          Back to Shipped
        </a>
      </p>
    </Ticket>
  );
}
