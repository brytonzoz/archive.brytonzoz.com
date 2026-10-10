'use client';

import { useEffect, useState } from 'react';
import { HERO_SLOT, isSlot } from '../../lib/shipped-sponsors';

export type SponsorSheet = 'choose' | 'form' | false;
type PickState = { slot: number; open: SponsorSheet; cents: number | null };

let current: PickState = { slot: HERO_SLOT, open: false, cents: null };
const listeners = new Set<() => void>();

function emit(next: PickState) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Lowest / Highest chooser for a slot. */
export function chooseSponsor(slot: number) {
  emit({ slot: isSlot(slot) ? slot : HERO_SLOT, open: 'choose', cents: null });
}

/** Open the bid form. Lowest/Highest pass the cents they posted. */
export function openSponsor(slot: number, cents?: number) {
  emit({ slot: isSlot(slot) ? slot : HERO_SLOT, open: 'form', cents: Number.isInteger(cents) ? cents! : null });
}

export function closeSponsor() {
  emit({ ...current, open: false });
}

/** Shared pick between the board, the bid chooser and the bid sheet. */
export function useSponsorPick(): PickState {
  const [state, setState] = useState(current);
  useEffect(() => {
    const listener = () => setState(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
