import React from 'react';
import type { StreamingService } from '../lib/streaming';
import { ResponsiveImage } from './ResponsiveImage';

// Overlapping app icons: says "listen on these apps" without any words.
export function AppStack({ services, size, overlap, ring }: { services: StreamingService[]; size: string; overlap: string; ring: string }) {
  return (
    <span className="flex items-center" aria-hidden="true">
      {services.map((service, index) => (
        <span
          key={service.key}
          className="relative shrink-0 overflow-hidden"
          style={{
            width: size,
            height: size,
            borderRadius: '28%',
            marginLeft: index === 0 ? 0 : `calc(${overlap} * -1)`,
            backgroundColor: service.tile,
            boxShadow: `0 0 0 ${ring} rgba(0, 0, 0, 0.22)`,
            zIndex: services.length - index,
            opacity: service.url ? 1 : 0.45,
          }}
        >
          <ResponsiveImage asset={service.icon} alt="" sizes="64px" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        </span>
      ))}
    </span>
  );
}
