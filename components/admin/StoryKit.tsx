'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SITE_URL } from '../../lib/artist';
import { releasePath, releases, trackPath, type Release } from '../../lib/tracks';

// Story kit: a 1080×1920 image for Instagram/TikTok stories, made from the real cover art, for a
// release or one of its songs. The link sticker goes on top in the app; the address is printed too.

const W = 1080;
const H = 1920;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrinks the text until it fits on one line.
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px Inter, system-ui, -apple-system, sans-serif`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 28);
}

async function draw(canvas: HTMLCanvasElement, release: Release, trackId: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const track = release.tracks.find((t) => t.id === trackId);
  const cover = await loadImage(release.cover.src);
  await document.fonts?.ready;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(0, 0, W, H);

  // The cover, blurred and enlarged, is the background (as in the player).
  ctx.save();
  ctx.filter = 'blur(80px) saturate(1.5)';
  ctx.globalAlpha = 0.85;
  ctx.drawImage(cover, -W * 0.4, -H * 0.1, W * 1.8, H * 1.2);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  shade.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const size = 820;
  const x = (W - size) / 2;
  const y = 400;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 40;
  roundedRect(ctx, x, y, size, size, 36);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, x, y, size, size, 36);
  ctx.clip();
  ctx.drawImage(cover, x, y, size, size);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  fitText(ctx, track?.title ?? release.title, W - 160, 76, 700);
  ctx.fillText(track?.title ?? release.title, W / 2, y + size + 140);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  fitText(ctx, track ? `Bryton Zoz · ${release.title}` : 'Bryton Zoz', W - 160, 44, 500);
  ctx.fillText(track ? `Bryton Zoz · ${release.title}` : 'Bryton Zoz', W / 2, y + size + 206);

  const path = track ? trackPath(track) : releasePath(release);
  const address = `${new URL(SITE_URL).host}${path.replace(/\/$/, '')}`;
  ctx.font = '600 36px Inter, system-ui, -apple-system, sans-serif';
  const pillW = Math.min(W - 120, ctx.measureText(address).width + 96);
  roundedRect(ctx, (W - pillW) / 2, H - 330, pillW, 96, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  fitText(ctx, address, pillW - 72, 36, 600);
  ctx.fillText(address, W / 2, H - 270);
}

export function StoryKit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [releaseId, setReleaseId] = useState(releases[0]?.id ?? '');
  const [trackId, setTrackId] = useState('');
  const release = releases.find((r) => r.id === releaseId);

  useEffect(() => {
    if (canvasRef.current && release) draw(canvasRef.current, release, trackId).catch(() => {});
  }, [release, trackId]);

  if (!release) return <p className="text-[14px] text-white/50">No releases in the player yet.</p>;

  const download = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const track = release.tracks.find((t) => t.id === trackId);
      link.download = `story-${release.id}${track ? `-${track.slug}` : ''}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const select = 'h-10 w-full rounded-[10px] bg-white/[0.08] px-3 text-[14px] text-white outline-none ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-white/40';

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <canvas ref={canvasRef} width={W} height={H} aria-label="Story preview" className="aspect-[9/16] w-[150px] shrink-0 self-center rounded-[14px] bg-black ring-1 ring-white/10 sm:self-start" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <label className="text-[13px] font-medium text-white/55">
          Release
          <select value={releaseId} onChange={(event) => { setReleaseId(event.target.value); setTrackId(''); }} className={`mt-1 ${select}`}>
            {releases.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-medium text-white/55">
          Song
          <select value={trackId} onChange={(event) => setTrackId(event.target.value)} className={`mt-1 ${select}`}>
            <option value="">Whole release</option>
            {release.tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <button type="button" onClick={download} className="mt-auto h-10 rounded-full bg-white text-[14px] font-semibold text-black">
          Download story
        </button>
      </div>
    </div>
  );
}
