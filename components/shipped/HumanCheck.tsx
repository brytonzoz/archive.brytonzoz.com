'use client';

// "Are you human?" for printing, takedowns and checkouts: Cloudflare Turnstile when the server has its keys,
// otherwise a small proof-of-work puzzle from /api/shipped/challenge, solved in the background (about a
// second on a phone). Either way the parent gets a single-use token through onToken.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Turnstile, type TurnstileHandle } from './Turnstile';

export type HumanCheckConfig = { kind: 'turnstile'; siteKey: string } | { kind: 'pow'; bits: number };
export type HumanCheckHandle = { reset: () => void };

type Props = {
  check: HumanCheckConfig | null | undefined;
  onToken: (token: string | null) => void;
  theme?: 'light' | 'dark';
  appearance?: 'always' | 'interaction-only';
};

function zeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

async function solve(signal: { cancelled: boolean }): Promise<string | null> {
  const response = await fetch('/api/shipped/challenge', { cache: 'no-store' });
  if (!response.ok) return null;
  const { challenge, bits } = (await response.json()) as { challenge?: string; bits?: number };
  if (!challenge || !bits) return null;
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < 50_000_000; nonce++) {
    if (signal.cancelled) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}:${nonce}`)));
    if (zeroBits(digest) >= bits) return `pow:${challenge}:${nonce}`;
    // Let the page breathe between batches.
    if (nonce % 2000 === 1999) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

function Puzzle({ onToken, round }: { onToken: (token: string | null) => void; round: number }) {
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    const signal = { cancelled: false };
    solve(signal)
      .then((token) => !signal.cancelled && callback.current(token))
      .catch(() => !signal.cancelled && callback.current(null));
    return () => {
      signal.cancelled = true;
    };
  }, [round]);
  return null;
}

export const HumanCheck = forwardRef<HumanCheckHandle, Props>(function HumanCheck({ check, onToken, theme, appearance }, ref) {
  const turnstile = useRef<TurnstileHandle>(null);
  const [round, setRound] = React.useState(0);
  useImperativeHandle(ref, () => ({
    reset: () => {
      onToken(null);
      if (check?.kind === 'turnstile') turnstile.current?.reset();
      else setRound((n) => n + 1);
    },
  }));
  if (!check) return null;
  if (check.kind === 'turnstile') return <Turnstile ref={turnstile} siteKey={check.siteKey} onToken={onToken} theme={theme} appearance={appearance} />;
  return <Puzzle onToken={onToken} round={round} />;
});
