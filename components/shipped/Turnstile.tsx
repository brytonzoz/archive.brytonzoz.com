'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

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
  /** execute: invisible until Print runs it. always: the checkbox. */
  appearance?: 'always' | 'interaction-only' | 'execute';
};

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { siteKey, onToken, theme = 'light', appearance = 'execute' },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const api = useRef<TurnstileApi | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<((value: string | null) => void)[]>([]);
  const callback = useRef(onToken);
  callback.current = onToken;

  function emit(value: string | null) {
    token.current = value;
    callback.current(value);
    const pending = waiters.current.splice(0);
    pending.forEach((resolve) => resolve(value));
  }

  useImperativeHandle(ref, () => ({
    reset: () => {
      token.current = null;
      callback.current(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
    execute: () => {
      if (token.current) return Promise.resolve(token.current);
      return new Promise((resolve) => {
        waiters.current.push(resolve);
        const start = Date.now();
        let kicked = false;
        const run = () => {
          if (token.current) return;
          if (appearance !== 'always' && widget.current && api.current && !kicked) {
            kicked = true;
            api.current.execute(widget.current);
          }
          if (Date.now() - start > 12_000) {
            emit(null);
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
          appearance,
          execution: appearance === 'always' ? 'render' : 'execute',
          // Invisible widgets don't paint the Success badge into the share sheet or the print form.
          size: appearance === 'always' ? 'flexible' : 'invisible',
          callback: (value: string) => emit(value),
          'expired-callback': () => emit(null),
          'error-callback': () => emit(null),
        });
      })
      .catch(() => emit(null));
    return () => {
      cancelled = true;
      waiters.current.splice(0).forEach((resolve) => resolve(null));
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      api.current = null;
    };
  }, [siteKey, theme, appearance]);

  return <div ref={box} className={appearance === 'always' ? 'min-h-[65px]' : 'shipped-turnstile'} />;
});
