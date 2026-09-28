'use client';

import React, { useEffect, useState } from 'react';

const VISIBLE_MS = 1800;

// A small confirmation ("Added to queue", "Link copied") that drops in at the top, like iOS.
export function Toast({ toast }: { toast: { id: number; message: string } | null }) {
  const [shown, setShown] = useState<{ id: number; message: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setLeaving(false);
    const hide = window.setTimeout(() => setLeaving(true), VISIBLE_MS);
    const remove = window.setTimeout(() => setShown(null), VISIBLE_MS + 250);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(remove);
    };
  }, [toast]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center font-body" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      {shown ? (
        <div key={shown.id} className={`glass-capsule toast rounded-full px-4 py-2.5 text-[14px] font-semibold text-white ${leaving ? 'is-leaving' : ''}`}>
          {shown.message}
        </div>
      ) : null}
    </div>
  );
}
