'use client';

// The printer's sounds, synthesized (no files to download): a tick per printed line, the motor's hum while
// it feeds, and the rip of the tear. Off until the visitor turns them on; the choice is remembered.
import { useEffect, useState } from 'react';

const KEY = 'shipped-sound';
const EVENT = 'shipped-sound';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let motor: { osc: OscillatorNode; gain: GainNode } | null = null;
let gestured = false;

/** Browsers block AudioContext until a tap. House-slip feed must not create one on load. */
export function allowSound() {
  gestured = true;
}

export function canPlaySound() {
  return soundOn() && gestured;
}

export function soundOn(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (!soundOn() || !gestured) return null;
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

export function setSound(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  if (!on) motorOff();
  window.dispatchEvent(new Event(EVENT));
  if (on) {
    allowSound();
    click();
  }
}

export function useSound(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(soundOn());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, () => setSound(!soundOn())];
}

function burst(at: number, length: number, frequency: number, q: number, level: number, sweepTo?: number) {
  const a = ctx;
  if (!a || !noise) return;
  const source = a.createBufferSource();
  source.buffer = noise;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, at);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
  filter.Q.value = q;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.004, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(a.destination);
  source.start(at, Math.random() * 0.5, length + 0.02);
}

/** One printed line: a short dry buzz from the head and stepper. */
export function tick() {
  const a = audio();
  if (!a) return;
  burst(a.currentTime, 0.03, 2600 + Math.random() * 900, 1.4, 0.09);
}

/** The feed button and the keys. */
export function click() {
  const a = audio();
  if (!a) return;
  burst(a.currentTime, 0.012, 5200, 0.8, 0.08);
}

/** Paper tearing against the serrated bar: a quick run of fibres giving way. */
export function rip() {
  const a = audio();
  if (!a) return;
  let at = a.currentTime;
  for (let i = 0; i < 9; i++) {
    burst(at, 0.035 + Math.random() * 0.03, 1900 - i * 120, 0.9, 0.14 - i * 0.008, 700);
    at += 0.012 + Math.random() * 0.02;
  }
}

export function motorOn() {
  const a = audio();
  if (!a || motor) return;
  const osc = a.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 92;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.018, a.currentTime + 0.08);
  osc.connect(filter).connect(gain).connect(a.destination);
  osc.start();
  motor = { osc, gain };
}

export function motorOff() {
  if (!ctx || !motor) return;
  const { osc, gain } = motor;
  motor = null;
  gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
  osc.stop(ctx.currentTime + 0.2);
}
