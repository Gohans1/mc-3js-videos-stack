import { useEffect, useState } from "react";

import { prefersReduced } from "../components/Motion";

export const DECK_SHRINK_LATCH_MS = 240;

export interface DeckShrinkLatchState {
  desiredW: number;
  trailKey: string;
  active: boolean;
  animate?: boolean;
}

export interface DeckShrinkLatch {
  paneW: number;
  innerW: number;
  seq: number;
}

export function nextDeckShrinkLatch({
  prev,
  next,
  current,
  reduced,
}: {
  prev: DeckShrinkLatchState;
  next: DeckShrinkLatchState;
  current: DeckShrinkLatch | null;
  reduced: boolean;
}): DeckShrinkLatch | null {
  if (!next.active || !prev.active || next.animate === false || reduced) return null;

  const prevVisibleW = current ? current.paneW : prev.desiredW;
  if (next.trailKey === prev.trailKey) {
    if (!current) return null;
    if (next.desiredW !== prev.desiredW) {
      return next.desiredW < current.paneW ? null : { ...current, innerW: next.desiredW };
    }
    return current;
  }

  if (next.desiredW < prevVisibleW) {
    return {
      paneW: prevVisibleW,
      innerW: next.desiredW,
      seq: (current?.seq ?? 0) + 1,
    };
  }

  return null;
}

export function useDeckShrinkLatch({
  desiredW,
  trailKey,
  active,
  animate = true,
  settleMs = DECK_SHRINK_LATCH_MS,
}: DeckShrinkLatchState & { settleMs?: number }): { paneW: number; lockW: number | null } {
  const [prev, setPrev] = useState<DeckShrinkLatchState>({ desiredW, trailKey, active, animate });
  const [latch, setLatch] = useState<DeckShrinkLatch | null>(null);

  let effLatch = latch;
  if (
    prev.desiredW !== desiredW ||
    prev.trailKey !== trailKey ||
    prev.active !== active ||
    prev.animate !== animate
  ) {
    effLatch = nextDeckShrinkLatch({
      prev,
      next: { desiredW, trailKey, active, animate },
      current: latch,
      reduced: prefersReduced(),
    });
    setPrev({ desiredW, trailKey, active, animate });
    setLatch(effLatch);
  }

  const seq = effLatch?.seq ?? null;
  useEffect(() => {
    if (seq === null) return;
    const id = setTimeout(() => setLatch(null), settleMs);
    return () => clearTimeout(id);
  }, [seq, settleMs]);

  return effLatch
    ? { paneW: effLatch.paneW, lockW: effLatch.innerW }
    : { paneW: desiredW, lockW: null };
}
