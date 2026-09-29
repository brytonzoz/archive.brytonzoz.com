import React from 'react';
import type { MediaAsset } from '../lib/media';

type ResponsiveImageProps = {
  asset: MediaAsset;
  alt: string;
  sizes: string;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
  draggable?: boolean;
  loading?: 'lazy' | 'eager';
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
};

export function ResponsiveImage({
  asset,
  alt,
  sizes,
  className,
  style,
  priority = false,
  draggable,
  loading,
  onLoad,
}: ResponsiveImageProps) {
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={asset.avif} sizes={sizes} />
      <img
        src={asset.src}
        srcSet={asset.webp}
        sizes={sizes}
        alt={alt}
        width={asset.width}
        height={asset.height}
        decoding="async"
        loading={loading}
        fetchPriority={priority ? 'high' : undefined}
        draggable={draggable}
        className={className}
        style={style}
        onLoad={onLoad}
      />
    </picture>
  );
}

export function placeholderBackground(asset: MediaAsset, position = 'center'): React.CSSProperties | undefined {
  if (!asset.placeholder) return undefined;
  return {
    backgroundImage: `url(${asset.placeholder})`,
    backgroundSize: 'cover',
    backgroundPosition: position,
  };
}
