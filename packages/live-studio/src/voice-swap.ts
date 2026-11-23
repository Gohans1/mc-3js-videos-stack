export interface SwappedVoiceSpan {
  takeId: string;
  prevStart: number;
  prevEnd: number;
  prevSpokenStart?: number;
  prevSpokenEnd?: number;
  nextStart: number;
  nextEnd: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const resizeNarrationBrickForSwap = (
  audioDoc: {
    narration?: string;
    sfx: {
      name: string;
      at: number;
      start?: number;
      length?: number;
      rate?: number;
      reverse?: boolean;
      track?: string;
    }[];
  },
  swappedInput: SwappedVoiceSpan | readonly SwappedVoiceSpan[],
  voiceBase: readonly { s: number; e: number }[],
): boolean => {
  const nar = audioDoc.narration;
  const spans = Array.isArray(swappedInput) ? swappedInput : [swappedInput];
  if (!nar || !spans.length) return false;

  const origAtOf = new Map(audioDoc.sfx.map((c) => [c, c.at]));
  const updates: {
    clip: {
      name: string;
      at: number;
      start?: number;
      length?: number;
      rate?: number;
      reverse?: boolean;
      track?: string;
    };
    origAt: number;
    origLength: number;
    nextAt: number;
    nextStart: number;
    desiredLength: number;
  }[] = [];

  for (const c of audioDoc.sfx) {
    if (c.name !== nar || c.reverse || typeof c.length !== "number") continue;
    const rate = c.rate ?? 1;
    const cStart = c.start ?? 0;
    const cEnd = cStart + c.length * rate;
    const matched = spans.find((s) => {
      if (Math.abs(cStart - s.prevStart) <= 0.3 && Math.abs(cEnd - s.prevEnd) <= 0.35) return true;
      if (typeof s.prevSpokenStart === "number" && typeof s.prevSpokenEnd === "number") {
        const uiStart = Math.max(0, s.prevSpokenStart - 0.08 * rate);
        const uiEnd = s.prevSpokenEnd + 0.18 * rate;
        return Math.abs(cStart - uiStart) <= 0.3 && Math.abs(cEnd - uiEnd) <= 0.35;
      }
      return false;
    });
    if (!matched) continue;
    const otherLines = voiceBase.filter(
      (l) =>
        l.e > cStart + 0.02 &&
        l.s < cEnd - 0.02 &&
        (l.e < matched.prevStart - 0.1 || l.s > matched.prevEnd + 0.25),
    );
    if (otherLines.length > 0) continue;

    const startsNearTakeStart = Math.abs(cStart - matched.prevStart) <= 0.3;
    const headOffset = startsNearTakeStart ? Math.max(0, cStart - matched.prevStart) : 0;
    const nextStart = Math.max(0, r3(matched.nextStart + headOffset));
    const desiredEnd = Math.max(nextStart + 0.05, matched.nextEnd);
    const desiredLength = Math.max(0.05, r3((desiredEnd - nextStart) / rate));
    const deltaStart = matched.nextStart - matched.prevStart;
    const wasPristinePosition = Math.abs(c.at - cStart) < 0.05;
    const nextAt =
      deltaStart !== 0 && wasPristinePosition ? Math.max(0, r3(c.at + deltaStart)) : c.at;
    updates.push({ clip: c, origAt: c.at, origLength: c.length, nextAt, nextStart, desiredLength });
  }

  if (!updates.length) return false;
  updates.sort((a, b) => a.origAt - b.origAt);
  const updateByClip = new Map(updates.map((u) => [u.clip, u]));

  let changed = false;
  for (const u of updates) {
    let targetAt = u.nextAt;
    if (u.clip.track && targetAt !== u.origAt) {
      for (const other of audioDoc.sfx) {
        if (other === u.clip || other.track !== u.clip.track) continue;
        const otherOrigAt = origAtOf.get(other) ?? other.at;
        if (otherOrigAt < u.origAt) {
          const otherUpdate = updateByClip.get(other);
          const otherLen = otherUpdate ? otherUpdate.desiredLength : (other.length ?? 0.05);
          const minAt = r3(other.at + Math.max(0.05, otherLen) + 0.005);
          if (targetAt < minAt) targetAt = minAt;
        }
      }
    }
    if (u.clip.at !== targetAt) {
      u.clip.at = targetAt;
      changed = true;
    }
    if (u.clip.start !== u.nextStart) {
      u.clip.start = u.nextStart;
      changed = true;
    }
  }

  for (const u of updates) {
    let nextLength = u.desiredLength;
    if (u.clip.track) {
      for (const other of audioDoc.sfx) {
        if (other === u.clip || other.track !== u.clip.track) continue;
        const otherOrigAt = origAtOf.get(other) ?? other.at;
        if (otherOrigAt > u.origAt || other.at > u.clip.at + 0.005) {
          const room = r3(other.at - u.clip.at - 0.005);
          if (room < nextLength) nextLength = Math.max(0.05, room);
        }
      }
    }
    if (u.clip.length !== nextLength) {
      u.clip.length = nextLength;
      changed = true;
    }
  }
  return changed;
};
