import { SAME } from "../core/time";

export function stepReviewPickId(
  ids: readonly string[],
  currentId: string | null,
  delta: -1 | 1,
): string | null {
  if (!ids.length) return null;
  const idx = currentId ? ids.indexOf(currentId) : -1;
  const origin = idx === -1 ? 0 : idx;
  const nextIdx = origin + delta;
  return nextIdx >= 0 && nextIdx < ids.length ? ids[nextIdx]! : null;
}

export function nextReviewNeighborId(
  ids: readonly string[],
  currentId: string | null,
): string | null {
  if (!ids.length) return null;
  if (!currentId) return ids[0] ?? null;
  const idx = ids.indexOf(currentId);
  if (idx === -1) return ids[0] ?? null;
  return ids[idx + 1] ?? ids[idx - 1] ?? null;
}

export function replyStaysInList(kind: "fix" | "ask" | "open" | "done"): boolean {
  return kind === "open";
}

export function pickSnapshotSource({
  at,
  playhead,
  finalAt,
  hasFinal,
  hasRender,
  tolerance = SAME + 1e-9,
}: {
  at: number;
  playhead: number;
  finalAt: number;
  hasFinal: boolean;
  hasRender: boolean;
  tolerance?: number;
}): "final" | "render" | null {
  if (
    hasFinal &&
    finalAt >= 0 &&
    Math.abs(at - playhead) <= tolerance &&
    Math.abs(finalAt - playhead) <= tolerance
  ) {
    return "final";
  }
  return hasRender ? "render" : null;
}
