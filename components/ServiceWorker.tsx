'use client';

import { useEffect } from 'react';

// Registers public/sw.js (fast repeat visits, pages still open offline). Production only, so local
// development always sees fresh files.
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Shipped is its own host. The music-site worker caches pages/scripts in a way that
    // crashes React when a receipt page hydrates after the printer.
    const shipped = /\bshipped/.test(window.location.hostname);
    if (shipped) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister())).catch(() => {});
      return;
    }
    if (process.env.NODE_ENV !== 'production') return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
