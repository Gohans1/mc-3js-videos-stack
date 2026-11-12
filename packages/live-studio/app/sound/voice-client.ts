import { EDIT } from "film/edit";
import { useSyncExternalStore } from "react";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { warp } from "../../src/warp.mjs";
import { getFile } from "../core/net";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { seek } from "../playback/transport";
import { loadVoice, marks } from "../timeline/timeline";
import type { ClipRef } from "./slice";
import {
  clipOf,
  editSource,
  invalidateSoundCaches,
  lanes,
  listenUrl,
  locked,
  type OneShot,
  seconds,
  setClip,
  sourceLanes,
  span,
} from "./sound";
import {
  findTakeLineIndex,
  resizeNarrationBrickForSwap,
  sliceNarrationClip,
  type SwappedVoiceSpan,
  voiceClipLabel,
  voiceClipSummary,
  type VoiceTakeItem,
} from "./voice-view";

let takesState: VoiceTakeItem[] = [];
let voiceRev = 0;
const subs = new Set<() => void>();

const notify = () => {
  voiceRev++;
  S.dirty = true;
  for (const fn of subs) fn();
};

marks.voiceLoaded = notify;

export const subscribeVoiceTakes = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const voiceTakesSnapshot = () => voiceRev;
export const useVoiceTakes = () => {
  useSyncExternalStore(subscribeVoiceTakes, voiceTakesSnapshot);
  return takesState;
};

export const loadVoiceTakes = async () => {
  const r = await getFile("/api/voice").catch(() => null);
  if (!r?.ok) return;
  const body = (await r.json()) as { takes?: VoiceTakeItem[] };
  takesState = Array.isArray(body.takes) ? body.takes : [];
  notify();
};

export const voiceAuditionId = (kind: "takes" | "try", file: string) => `voice:${kind}:${file}`;

export const listenVoiceFile = (kind: "takes" | "try", file: string) => {
  listenUrl(voiceAuditionId(kind, file), `/api/voice/audio/${kind}/${encodeURIComponent(file)}`);
};

export const promoteVoiceTry = async (takeId: string, tryFile: string): Promise<boolean> => {
  const priorVoiceBase = S.voiceBase;
  try {
    const r = await fetch("/api/voice/use-try", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ takeId, tryFile }),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      say(err.error ?? "Could not switch voice take");
      return false;
    }
    const body = (await r.json()) as {
      takes?: VoiceTakeItem[];
      swapped?: SwappedVoiceSpan;
      swappedSpans?: SwappedVoiceSpan[];
    };
    takesState = Array.isArray(body.takes) ? body.takes : takesState;
    const spans = body.swappedSpans?.length
      ? body.swappedSpans
      : body.swapped
        ? [body.swapped]
        : [];
    if (spans.length && sourceLanes()) {
      editSource((l) => {
        resizeNarrationBrickForSwap(l, spans, priorVoiceBase);
      });
    }
    invalidateSoundCaches();
    void loadVoice();
    notify();
    say(`Take ${takeId} switched to ${tryFile}`);
    return true;
  } catch {
    say("Could not switch voice take");
    return false;
  }
};

// Memoizes timeline label per OneShot object across 60fps scrub/zoom frames; invalidated on sound, timing, or voice changes
let labelCacheKey = "";
let labelCache = new WeakMap<object, string>();

export const cachedVoiceClipLabel = (clip: OneShot): string => {
  const key = `${S.timesRev}:${get().soundRev}:${voiceRev}`;
  if (key !== labelCacheKey) {
    labelCacheKey = key;
    labelCache = new WeakMap<object, string>();
  }
  const hit = labelCache.get(clip);
  if (hit !== undefined) return hit;
  const computed = voiceClipLabel(clip, seconds(clip.name), S.voiceBase, takesState);
  labelCache.set(clip, computed);
  return computed;
};

export const currentClipVoiceSummary = (clip: OneShot) =>
  voiceClipSummary(clip, seconds(clip.name), S.voiceBase, takesState);

export const findUnsplitNarrationRef = (): { ref: ClipRef; count: number } | null => {
  const src = sourceLanes();
  const name = src?.narration;
  if (!name || !src || !lanes) return null;
  const indices: number[] = [];
  src.sfx.forEach((c, i) => {
    if (c.name === name) indices.push(i);
  });
  if (indices.length !== 1) return null;
  const ref: ClipRef = { list: "sfx", i: indices[0] };
  if (!lanes.sfx[ref.i] || locked(ref)) return null;
  const bricks = sliceNarrationClip(src.sfx[ref.i], seconds(name), S.voiceBase);
  return bricks.length >= 2 ? { ref, count: bricks.length } : null;
};

export const canSplitClipIntoBricks = (ref: ClipRef): number => {
  const src = sourceLanes();
  const c = clipOf(ref);
  const srcClip = ref.list === "sfx" ? src?.sfx[ref.i] : undefined;
  if (
    !c ||
    !srcClip ||
    ref.list !== "sfx" ||
    !lanes?.narration ||
    c.name !== lanes.narration ||
    locked(ref)
  )
    return 0;
  const bricks = sliceNarrationClip(srcClip, seconds(c.name), S.voiceBase);
  return bricks.length >= 2 ? bricks.length : 0;
};

export const splitNarrationIntoBricks = (targetRef?: ClipRef) => {
  const ref = targetRef ?? findUnsplitNarrationRef()?.ref;
  if (!ref || ref.list !== "sfx") return;
  if (locked(ref)) {
    say("Unlock the voice track first to split into phrase bricks");
    return;
  }
  const src = sourceLanes();
  const srcClip = src?.sfx[ref.i];
  if (!srcClip || !lanes?.narration || srcClip.name !== lanes.narration) return;
  const planned = sliceNarrationClip(srcClip, seconds(srcClip.name), S.voiceBase);
  if (planned.length < 2) {
    say("Need at least 2 aligned voiceover takes inside this clip to split");
    return;
  }
  let madeCount = 0;
  editSource((l) => {
    const base = l.sfx[ref.i];
    if (!base) return;
    const bricks = sliceNarrationClip(base, seconds(base.name), S.voiceBase);
    if (bricks.length < 2) return;
    madeCount = bricks.length;
    l.sfx.splice(ref.i, 1, ...bricks);
  });
  if (madeCount > 0 && lanes) {
    let activeIdx = ref.i;
    for (let k = 0; k < madeCount; k++) {
      const idx = ref.i + k;
      if (!lanes.sfx[idx]) break;
      const [from, to] = span({ list: "sfx", i: idx });
      if (S.t >= from - 0.05 && S.t <= to + 0.05) {
        activeIdx = idx;
        break;
      }
    }
    setClip({ list: "sfx", i: activeIdx });
    say(`Split narration into ${madeCount} phrase bricks. Ctrl+Z to undo`);
  }
};

const pickNarrationClipForTake = (takeId: string, sec: number): ClipRef | null => {
  if (!lanes?.narration) return null;
  const nar = lanes.narration;
  const candidates: number[] = [];
  lanes.sfx.forEach((c, i) => {
    if (c.name !== nar) return;
    const [from, to] = span({ list: "sfx", i });
    if (sec >= from - 0.05 && sec <= to + 0.05) candidates.push(i);
  });
  if (!candidates.length) return null;
  const exact = candidates.find((i) =>
    currentClipVoiceSummary(lanes!.sfx[i]).matches.some((m) => m.id === takeId),
  );
  return { list: "sfx", i: exact ?? candidates[0] };
};

export const resolveVoiceTakeTarget = (
  take: VoiceTakeItem,
): { sec: number; ref: ClipRef | null } | null => {
  const lineIdx = findTakeLineIndex(take.id, S.voiceBase, takesState);
  if (lineIdx >= 0) {
    const projected = marks.voice([S.voiceBase[lineIdx]]);
    const sec = projected[0]?.s;
    if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
    return { sec, ref: pickNarrationClipForTake(take.id, sec) };
  }
  const anchor = typeof take.t === "number" ? take.t : take.start;
  if (
    (!take.aligned || S.voiceBase.length === 0) &&
    typeof anchor === "number" &&
    Number.isFinite(anchor)
  ) {
    const sec = clockForTimeline("voice").outputAt(warp(EDIT.voice.warp, anchor, 0, 1));
    if (!Number.isFinite(sec)) return null;
    if (lanes?.narration) {
      const ref = pickNarrationClipForTake(take.id, sec);
      return ref ? { sec, ref } : null;
    }
    return { sec, ref: null };
  }
  return null;
};

export const focusVoiceTake = (take: VoiceTakeItem) => {
  const target = resolveVoiceTakeTarget(take);
  if (target) {
    seek(Math.max(0, target.sec));
    if (target.ref) setClip(target.ref);
    return;
  }
  if (take.file) listenVoiceFile("takes", take.file);
};
