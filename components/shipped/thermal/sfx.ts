'use client';

// Paper sounds for the pile and the toss, synthesized like the printer's (components/shipped/sound.ts) and
// behind the same SND switch: nothing plays until the visitor turns sound on. The printer's own sounds
// (tick, motor, rip, click) are re-exported so a page imports one module for every hook.
import { soundOn } from '../sound';

export { click, motorOff, motorOn, rip, tick, soundOn, useSound } from '../sound';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!soundOn()) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function burst(a: AudioContext, at: number, length: number, frequency: number, q: number, level: number, type: BiquadFilterType = 'bandpass') {
  if (!noise) return;
  const source = a.createBufferSource();
  source.buffer = noise;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.003, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(a.destination);
  source.start(at, Math.random() * 0.5, length + 0.02);
}

/** Paper balled up in a fist: a dense run of crackles that tightens toward the end. */
export function crumple(duration = 0.45) {
  const a = audio();
  if (!a) return;
  let at = a.currentTime;
  const end = at + duration;
  while (at < end) {
    const t = 1 - (end - at) / duration;
    burst(a, at, 0.008 + Math.random() * 0.02, 2200 + Math.random() * 4200, 1.2 + Math.random() * 2, 0.05 + Math.random() * 0.07 * (1 - t * 0.5));
    at += 0.006 + Math.random() * 0.03 * (1 - t * 0.6);
  }
}

/** Smoothing a ball back out: slower, softer crackles. */
export function uncrumple(duration = 0.5) {
  const a = audio();
  if (!a) return;
  let at = a.currentTime;
  const end = at + duration;
  while (at < end) {
    burst(a, at, 0.012 + Math.random() * 0.025, 1600 + Math.random() * 3000, 1.1, 0.035 + Math.random() * 0.04);
    at += 0.02 + Math.random() * 0.05;
  }
}

/** A ball leaving the hand. */
export function whoosh() {
  const a = audio();
  if (!a) return;
  burst(a, a.currentTime, 0.18, 900, 0.7, 0.03, 'bandpass');
}

/** A ball landing on the pile; `strength` 0..1 from the impact speed. */
export function land(strength = 0.5) {
  const a = audio();
  if (!a) return;
  const s = Math.max(0.05, Math.min(1, strength));
  burst(a, a.currentTime, 0.05, 420, 0.9, 0.06 * s, 'lowpass');
  burst(a, a.currentTime + 0.004, 0.03, 2600, 1.4, 0.04 * s);
}
