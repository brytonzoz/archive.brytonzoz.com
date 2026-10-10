'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
  execute: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const tag = document.createElement('script');
    tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tag.async = true;
    tag.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    tag.onerror = () => {
      script = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(tag);
  });
  return script;
}

export type TurnstileHandle = { reset: () => void; execute: () => Promise<string | null> };

type TurnstileProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
  theme?: 'light' | 'dark';
  /** execute: run on Print. always: the checkbox. */
  appearance?: 'always' | 'interaction-only' | 'execute';
};

const EXECUTE_MS = 15_000;

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { siteKey, onToken, theme = 'light', appearance = 'execute' },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const api = useRef<TurnstileApi | null>(null);
  const token = useRef<string | null>(null);
  const spent = useRef(false);
  const waiters = useRef<((value: string | null) => void)[]>([]);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [challenge, setChallenge] = useState(appearance === 'always');
  const visible = appearance === 'always' || challenge;
  const [round, setRound] = useState(0);
  const [failed, setFailed] = useState(false);

  function emit(value: string | null) {
    token.current = value;
    spent.current = false;
    callback.current(value);
    const pending = waiters.current.splice(0);
    pending.forEach((resolve) => resolve(value));
  }

  function askToVerify() {
    setChallenge(true);
    setFailed(true);
    emit(null);
  }

  function resetWidget() {
    token.current = null;
    spent.current = false;
    callback.current(null);
    if (widget.current && api.current) {
      try {
        api.current.reset(widget.current);
      } catch {
        setRound((n) => n + 1);
      }
    }
  }

  useImperativeHandle(ref, () => ({
    reset: () => {
      resetWidget();
    },
    execute: () => {
      // A Turnstile token is single-use. Never hand the last one back.
      if (token.current && !spent.current) {
        spent.current = true;
        const value = token.current;
        token.current = null;
        return Promise.resolve(value);
      }
      token.current = null;
      spent.current = false;
      resetWidget();
      return new Promise((resolve) => {
        waiters.current.push(resolve);
        const start = Date.now();
        let kicked = false;
        const run = () => {
          if (token.current) return;
          if (widget.current && api.current && !kicked) {
            kicked = true;
            try {
              if (visible) api.current.reset(widget.current);
              else api.current.execute(widget.current);
            } catch {
              askToVerify();
              return;
            }
          }
          if (Date.now() - start > EXECUTE_MS) {
            askToVerify();
            return;
          }
          if (!token.current) window.setTimeout(run, 50);
        };
        run();
      });
    },
  }));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    loadTurnstile()
      .then((loaded) => {
        if (cancelled || widget.current) return;
        api.current = loaded;
        widget.current = loaded.render(el, {
          sitekey: siteKey,
          theme,
          appearance: visible ? 'always' : 'interaction-only',
          execution: visible ? 'render' : 'execute',
          size: visible ? 'flexible' : 'compact',
          callback: (value: string) => queueMicrotask(() => emit(value)),
          'expired-callback': () =>
            queueMicrotask(() => {
              spent.current = false;
              emit(null);
            }),
          'error-callback': () =>
            queueMicrotask(() => {
              if (!visible) {
                setChallenge(true);
                setFailed(true);
                setRound((n) => n + 1);
              }
              emit(null);
            }),
          'timeout-callback': () =>
            queueMicrotask(() => {
              setChallenge(true);
              setFailed(true);
              emit(null);
            }),
        });
      })
      .catch(() => {
        setChallenge(true);
        setFailed(true);
        emit(null);
      });
    const pending = waiters.current;
    return () => {
      cancelled = true;
      pending.splice(0).forEach((resolve) => resolve(null));
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      api.current = null;
    };
  }, [siteKey, theme, appearance, visible, round]);

  return (
    <div className={`shipped-turnstile${visible ? ' is-on' : ''}${challenge ? ' is-challenge' : ''}`}>
      {challenge ? (
        <p className="shipped-turnstile-label">
          <button
            type="button"
            className="shipped-turnstile-hit"
            onClick={() => {
              setFailed(false);
              resetWidget();
              setRound((n) => n + 1);
            }}
          >
            {failed ? 'Tap to verify' : 'Checking you’re human'}
          </button>
        </p>
      ) : null}
      <div ref={box} className="shipped-turnstile-box" />
    </div>
  );
});
