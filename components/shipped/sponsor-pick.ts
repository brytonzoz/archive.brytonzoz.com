'use client';

import { useEffect, useState } from 'react';
import { HERO_SLOT, isSlot } from '../../lib/shipped-sponsors';

type PickState = { slot: number; open: boolean };

let current: PickState = { slot: HERO_SLOT, open: false };
const listeners = new Set<() => void>();

function emit(next: PickState) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Open the bid sheet on a slot. The board's take buttons call this. */
export function openSponsor(slot: number) {
  emit({ slot: isSlot(slot) ? slot : HERO_SLOT, open: true });
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
