'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { externalReferrer, track } from '../lib/analytics';

// Counts page views for the /admin dashboard (the admin pages themselves are not counted).
export function PageViews() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    track({ type: 'view', detail: pathname, referrer: first.current ? externalReferrer() : undefined });
    first.current = false;
  }, [pathname]);

  return null;
}
