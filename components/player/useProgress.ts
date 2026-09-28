'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './context';

function readProgress(audio: HTMLAudioElement | null, fallbackDuration: number) {
  const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDuration;
  return { time: audio?.currentTime ?? 0, duration };
}

// Smooth, per-frame playback position without re-rendering the whole player tree.
export function useProgress() {
  const { audioRef, current } = usePlayer();
  const fallback = current ? current.durationMs / 1000 : 0;
  const [progress, setProgress] = useState(() => readProgress(audioRef.current, fallback));

  useEffect(() => {
    let frame = 0;
    let last = { time: -1, duration: -1 };
    const tick = () => {
      const next = readProgress(audioRef.current, fallback);
      if (next.time !== last.time || next.duration !== last.duration) {
        last = next;
        setProgress(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioRef, fallback]);

  return progress;
}

// Same idea for a bar that only needs its width: writes to the DOM directly.
export function useProgressBar<T extends HTMLElement>() {
  const { audioRef, current } = usePlayer();
  const barRef = useRef<T>(null);
  const fallback = current ? current.durationMs / 1000 : 0;

  const hasTrack = Boolean(current);

  useEffect(() => {
    if (!hasTrack) return;
    let frame = 0;
    const tick = () => {
      const { time, duration } = readProgress(audioRef.current, fallback);
      if (barRef.current) barRef.current.style.transform = `scaleX(${duration > 0 ? Math.min(1, time / duration) : 0})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioRef, fallback, hasTrack]);

  return barRef;
}
