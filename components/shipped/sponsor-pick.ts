'use client';

import { useEffect, useState } from 'react';
import { HERO_SLOT, isSlot } from '../../lib/shipped-sponsors';

type PickState = { slot: number; open: boolean; cents: number | null };

let current: PickState = { slot: HERO_SLOT, open: false, cents: null };
const listeners = new Set<() => void>();

function emit(next: PickState) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Open the bid sheet on a slot. Lowest/Highest bid buttons pass the cents they posted. */
export function openSponsor(slot: number, cents?: number) {
  emit({ slot: isSlot(slot) ? slot : HERO_SLOT, open: true, cents: Number.isInteger(cents) ? cents! : null });
}

export function closeSponsor() {
  emit({ ...current, open: false });
}

/** Shared pick between the board and the bid sheet. */
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
