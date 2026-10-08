'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<TurnstileApi> | null = null;

// Loaded only when a form that needs it is on screen, so /shipped/ stays light.
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

export type TurnstileHandle = { reset: () => void };

export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string | null) => void }>(function Turnstile(
  { siteKey, onToken },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      callback.current(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const start = () => {
      loadTurnstile()
        .then((api) => {
          if (cancelled || widget.current) return;
          widget.current = api.render(el, {
            sitekey: siteKey,
            theme: 'light',
            size: 'flexible',
            callback: (token: string) => callback.current(token),
            'expired-callback': () => callback.current(null),
            'error-callback': () => callback.current(null),
          });
        })
        .catch(() => callback.current(null));
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  return <div ref={box} className="min-h-[65px]" />;
});
