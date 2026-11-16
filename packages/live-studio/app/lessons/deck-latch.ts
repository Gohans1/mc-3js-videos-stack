import { useEffect, useState } from "react";

import { prefersReduced } from "../components/Motion";

/** Duration to hold a shrinking Lessons pane open while outgoing panels exit and kept columns FLIP cleanly. */
export const DECK_SHRINK_LATCH_MS = 240;

export interface DeckShrinkLatchState {
  desiredW: number;
  trailKey: string;
  active: boolean;
}

export interface DeckShrinkLatch {
  paneW: number;
  innerW: number;
  seq: number;
}

/** Pure step helper so width latching on folder/file collapse is deterministic and testable. */
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
  if (!next.active || !prev.active || reduced) return null;

  const prevVisibleW = current ? current.paneW : prev.desiredW;
  if (next.trailKey === prev.trailKey) {
    // Manual splitter drag or viewport resize without a trail change takes effect immediately
    if (!current) return null;
    if (next.desiredW !== prev.desiredW) {
      return next.desiredW < current.paneW ? null : { ...current, innerW: next.desiredW };
    }
    return current;
  }

  // Hold the wider pane during fold-in so exiting sheets and FLIP-moving columns stay unclipped
  if (next.desiredW < prevVisibleW) {
    return {
      paneW: prevVisibleW,
      innerW: next.desiredW,
      seq: (current?.seq ?? 0) + 1,
    };
  }

  return null;
}

/** Latches a shrinking Lessons pane width until outgoing exit/FLIP transitions complete, avoiding frame-0 slicing and Stage bleed. */
export function useDeckShrinkLatch({
  desiredW,
  trailKey,
  active,
  settleMs = DECK_SHRINK_LATCH_MS,
}: DeckShrinkLatchState & { settleMs?: number }): { paneW: number; lockW: number | null } {
  const [prev, setPrev] = useState<DeckShrinkLatchState>({ desiredW, trailKey, active });
  const [latch, setLatch] = useState<DeckShrinkLatch | null>(null);

  let effLatch = latch;
  if (prev.desiredW !== desiredW || prev.trailKey !== trailKey || prev.active !== active) {
    effLatch = nextDeckShrinkLatch({
      prev,
      next: { desiredW, trailKey, active },
      current: latch,
      reduced: prefersReduced(),
    });
    setPrev({ desiredW, trailKey, active });
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
