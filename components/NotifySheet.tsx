'use client';

import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { campaign, visitorId } from '../lib/analytics';
import { CloseIcon } from './player/icons';
import { useSheet } from './useSheet';

export const NOTIFY_KEY = 'bz.notify';

export function hasSignedUp(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

// "Notify me": one email field. The address goes only to the list in /admin, to write to
// people when the next release is out.
export function NotifySheet({ isOpen, onClose, onDone }: { isOpen: boolean; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const { sheetRef, isClosing, requestClose, dragHandlers, sheetStyle } = useSheet(isOpen, onClose);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  if (!isOpen) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === 'sending') return;
    const form = new FormData(event.currentTarget);
    setState('sending');
    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, website: form.get('website'), source: 'teaser', campaign: campaign(), visitor: visitorId() }),
      });
      if (!response.ok) throw new Error(String(response.status));
      try {
        window.localStorage.setItem(NOTIFY_KEY, '1');
      } catch {
        // Storage blocked: they may see the button again, which is harmless.
      }
      setState('done');
      onDone();
    } catch {
      setState('error');
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-[100] flex items-end justify-center font-body sm:items-center sm:p-6 ${isClosing ? 'is-closing' : ''}`}
    >
      <div aria-hidden="true" onClick={requestClose} className="sheet-backdrop absolute inset-0 touch-none bg-black/60" />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet-panel relative w-full max-w-[420px] overflow-hidden rounded-t-[32px] bg-[#161616] text-white outline-none sm:rounded-[32px]"
        style={{ ...sheetStyle, paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
      >
        <div aria-hidden="true" className="teaser-notify-glow pointer-events-none absolute inset-x-0 top-0 h-40" />
        <div {...dragHandlers} className="relative touch-none select-none px-3 pt-2">
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-white/30 sm:invisible" />
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/75 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="relative px-7 pt-8">
          {state === 'done' ? (
            <div className="pb-2 pt-2 text-center" role="status">
              <span className="notify-check mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-black">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h2 id={titleId} className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">You’re on the list</h2>
              <p className="mt-1.5 text-[15px] text-white/55">One email when it’s out.</p>
              <button
                type="button"
                onClick={requestClose}
                className="mt-7 h-[52px] w-full rounded-full bg-white/10 text-[16px] font-semibold transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h2 id={titleId} className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">Be first to hear it</h2>
              <p className="mt-1.5 text-[15px] text-white/55">One email when it’s out. Nothing else.</p>
              <label className="mt-6 block">
                <span className="sr-only">Email</span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder="Email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (state === 'error') setState('idle');
                  }}
                  className="h-[54px] w-full rounded-[16px] bg-white/[0.08] px-5 text-[17px] text-white placeholder:text-white/35 outline-none ring-1 ring-inset ring-white/10 transition-shadow focus:ring-2 focus:ring-white/60"
                />
              </label>
              {/* Only bots fill this in. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
              {state === 'error' ? (
                <p role="alert" className="mt-2.5 text-[14px] text-[#ff8a80]">That didn’t go through. Check the address and try again.</p>
              ) : null}
              <button
                type="submit"
                disabled={state === 'sending'}
                className="mt-4 h-[54px] w-full rounded-full bg-white text-[17px] font-semibold text-black transition-[transform,opacity] active:scale-[0.98] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              >
                {state === 'sending' ? 'Adding…' : 'Notify me'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
