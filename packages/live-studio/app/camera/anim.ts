import type { AnimCurve } from "film-stage/animate";
import type { AnimFx } from "film/scene";

import { clockForTimeline, timingClock } from "../../src/timing-state.mjs";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { type Side, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { seek, setPlaying } from "../playback/transport";
import { originalShot } from "../timeline/timing";
import {
  animationOccurrenceClock,
  animSlotMetrics,
  applyAnimDuration,
  canLinkSeamPair,
  freshAnimSet,
  MIN_ANIM,
  type PlaySegment,
  shouldSyncPair,
  syncPairedOption,
  tidyAnimSet,
} from "./anim-math";
import { cameraKeyShotIndex, keys } from "./cam";
import { cameraShotIndex } from "./camera-rig";
import { type ShotRow, shotsDoc } from "./shots";

export type Slot = "in" | "out" | "combo";
export interface AnimSet {
  fx: string;
  len?: number;
  k?: number;
  delay?: number;
  curve?: AnimCurve;
  flip?: boolean;
  optics?: number;
  seam?: boolean;
}
export type ShotAnim = Partial<Record<Slot, AnimSet>>;

export const SLOT_NAMES: Record<Slot, string> = { in: "In", out: "Out", combo: "Combo" };
export const anims = () => S.render?.anims ?? null;
export const fxOf = (slot: Slot, id: string | undefined): AnimFx | undefined =>
  id ? anims()?.[slot].find((x) => x.id === id) : undefined;
export const shotSpan = (i: number): [number, number] => [
  SHOTS_OUT[i]?.t ?? 0,
  SHOTS_OUT[i + 1]?.t ?? DURATION,
];
export const animOf = (i: number): ShotAnim =>
  (shotsDoc.data?.[i]?.anim as ShotAnim | undefined) ?? {};
const pictureClock = () => (get().timing && timingClock.sourceDuration > 0 ? timingClock : null);
export const shotSourceOf = (i: number): [number, number] =>
  pictureClock() && SHOTS_OUT[i] ? originalShot(i) : shotSpan(i);

export const outputAnimationSpans = (i: number): PlaySegment[] => {
  if (!pictureClock() || SHOTS_OUT[i]?.cameraClock !== "output") return [];
  const [from, to] = shotSourceOf(i);
  return (clockForTimeline("cam").cameraSpans ?? []).filter(
    (span: PlaySegment) => span.sourceFrom >= from - 1e-7 && span.sourceTo <= to + 1e-7,
  );
};
const occurrenceAt = (i: number, at: number) => {
  const spans = outputAnimationSpans(i);
  return spans.find((span) => at >= span.from && at < span.to) ?? spans[0];
};
export const clockOf = (i: number, at = S.t) => {
  const picture = pictureClock();
  const occurrence = occurrenceAt(i, at);
  return picture && occurrence ? animationOccurrenceClock(picture, occurrence) : picture;
};

export const metricsOf = (i: number, clock = clockOf(i)) => {
  const an = animOf(i);
  return animSlotMetrics(
    shotSourceOf(i),
    clock,
    an,
    fxOf("in", an.in?.fx)?.len ?? 0.5,
    fxOf("out", an.out?.fx)?.len ?? 0.5,
  );
};
export const shownShot = () => {
  const { shotPick: s, camKey: k } = get();
  return s !== null && SHOTS_OUT[s]
    ? s
    : k !== null && keys[k]
      ? cameraKeyShotIndex(k)
      : cameraShotIndex(S.t);
};
export const pickShot = (i: number | null, side?: Side) => {
  set(transitionSelection({ kind: "shot", index: i, side }, get().side));
  S.dirty = true;
};

export const roomFor = (i: number, slot: "in" | "out") => {
  const m = metricsOf(i);
  return slot === "in" ? m.inRoom : m.outRoom;
};
export const lenOf = (i: number, slot: "in" | "out", clock = clockOf(i)) => {
  const m = metricsOf(i, clock);
  return slot === "in" ? m.inLen : m.outLen;
};

const pairAt = (
  i: number,
  slot: Slot,
  id: string | null | undefined,
): { j: number; otherSlot: "in" | "out"; fx: AnimFx } | null => {
  if (!id || slot === "combo") return null;
  const cur = fxOf(slot, id);
  if (!cur?.pair) return null;
  if (slot === "out" && i + 1 < SHOTS_OUT.length) {
    const fx = anims()?.in.find((x) => x.id === cur.pair || x.pair === cur.pair);
    return fx ? { j: i + 1, otherSlot: "in", fx } : null;
  }
  if (slot === "in" && i - 1 >= 0) {
    const fx = anims()?.out.find((x) => x.id === cur.pair || x.pair === cur.pair);
    return fx ? { j: i - 1, otherSlot: "out", fx } : null;
  }
  return null;
};

const put = (d: ShotRow[], i: number, slot: Slot, v: AnimSet | null) => {
  if (!d[i]) return;
  const a: ShotAnim = { ...(d[i].anim as ShotAnim | undefined) };
  if (v) a[slot] = v;
  else delete a[slot];
  if (Object.keys(a).length) d[i].anim = a;
  else delete d[i].anim;
};
const fresh = (i: number, slot: Slot, id: string, from?: AnimSet): AnimSet => {
  const fx = fxOf(slot, id),
    m = slot === "combo" ? null : metricsOf(i);
  return freshAnimSet({
    cur: animOf(i)[slot],
    from,
    slot,
    id,
    fx,
    maxSourceLen: slot === "in" ? m!.maxSrcIn : slot === "out" ? m!.maxSrcOut : 0,
  });
};
const writeWithPair = (d: ShotRow[], i: number, slot: Slot, id: string | null) => {
  const from = animOf(i)[slot];
  const nextSelf = id ? fresh(i, slot, id, from) : null;
  put(d, i, slot, nextSelf);
  if (!nextSelf || !shouldSyncPair(nextSelf, fxOf(slot, id ?? undefined))) return;
  const p = pairAt(i, slot, id);
  if (p && d[p.j]) {
    const other = (d[p.j].anim as ShotAnim | undefined)?.[p.otherSlot];
    if (other?.seam !== false) put(d, p.j, p.otherSlot, fresh(p.j, p.otherSlot, p.fx.id, from));
  }
};
export const setAnim = (i: number, slot: Slot, id: string | null) => {
  shotsDoc.edit((d) => writeWithPair(d, i, slot, id));
  say(
    id
      ? `${SLOT_NAMES[slot]}: ${fxOf(slot, id)?.title ?? id} on shot ${i}. Ctrl+Z to undo`
      : `${SLOT_NAMES[slot]} taken off shot ${i}`,
  );
};
export const previewAnim = (i: number, slot: Slot, id: string | null) =>
  shotsDoc.preview((d) => writeWithPair(d, i, slot, id));
export const setAmount = (i: number, slot: Slot, v: number, keep = true, clock = clockOf(i)) => {
  const an = animOf(i),
    cur = an[slot];
  if (!cur) return;
  if (slot === "combo") {
    const next = tidyAnimSet({ ...cur, k: v }, fxOf("combo", cur.fx));
    if (keep) shotsDoc.edit((d) => put(d, i, "combo", next));
    else shotsDoc.preview((d) => put(d, i, "combo", next));
    return;
  }
  const nextAnim = applyAnimDuration(
    shotSourceOf(i),
    clock,
    an,
    slot,
    v,
    fxOf("in", an.in?.fx)?.len ?? 0.5,
    fxOf("out", an.out?.fx)?.len ?? 0.5,
  );
  const apply = (d: ShotRow[]) => {
    put(d, i, "in", nextAnim.in ? tidyAnimSet(nextAnim.in, fxOf("in", nextAnim.in.fx)) : null);
    put(d, i, "out", nextAnim.out ? tidyAnimSet(nextAnim.out, fxOf("out", nextAnim.out.fx)) : null);
  };
  if (keep) shotsDoc.edit(apply);
  else shotsDoc.preview(apply);
};
export const setOption = (
  i: number,
  slot: Slot,
  patch: Partial<Pick<AnimSet, "curve" | "flip" | "optics" | "seam" | "delay">>,
  keep = true,
) => {
  const cur = animOf(i)[slot];
  if (!cur) return;
  const fx = fxOf(slot, cur.fx);
  const next = tidyAnimSet({ ...cur, ...patch }, fx);
  const p = shouldSyncPair(next, fx) ? pairAt(i, slot, cur.fx) : null;
  const { seam: _, delay: _delay, ...syncPatch } = patch;
  const apply = (d: ShotRow[]) => {
    put(d, i, slot, next);
    if (p && d[p.j]) {
      const other = (d[p.j].anim as ShotAnim | undefined)?.[p.otherSlot];
      if (patch.seam === true && other?.fx !== p.fx.id && other?.seam !== false) {
        put(d, p.j, p.otherSlot, fresh(p.j, p.otherSlot, p.fx.id, next));
      } else if (canLinkSeamPair(next, fx, other, p.fx.id) && Object.keys(syncPatch).length) {
        put(d, p.j, p.otherSlot, syncPairedOption(other!, syncPatch, p.fx));
      }
    }
  };
  if (keep) shotsDoc.edit(apply);
  else shotsDoc.preview(apply);
};
export const setStrength = (i: number, slot: Slot, v: number, keep = true) => {
  const cur = animOf(i)[slot];
  if (!cur) return;
  const fx = fxOf(slot, cur.fx);
  const next = tidyAnimSet({ ...cur, k: v }, fx);
  const p = shouldSyncPair(next, fx) ? pairAt(i, slot, cur.fx) : null;
  const apply = (d: ShotRow[]) => {
    put(d, i, slot, next);
    if (p && d[p.j]) {
      const otherCur = (d[p.j].anim as ShotAnim | undefined)?.[p.otherSlot];
      if (canLinkSeamPair(next, fx, otherCur, p.fx.id))
        put(d, p.j, p.otherSlot, tidyAnimSet({ ...otherCur!, k: v }, p.fx));
    }
  };
  if (keep) shotsDoc.edit(apply);
  else shotsDoc.preview(apply);
};
export const animFit = (i: number, from: ShotAnim) => {
  const [a, b] = shotSourceOf(i),
    lens = (["in", "out"] as const).map((s) =>
      from[s] ? (from[s].len ?? fxOf(s, from[s].fx)?.len ?? 0.5) : 0,
    );
  const k =
      lens[0] + lens[1] > b - a - MIN_ANIM
        ? Math.max(0, b - a - MIN_ANIM) / (lens[0] + lens[1])
        : 1,
    fit = (v: number) => Math.max(MIN_ANIM, Math.round(v * k * 100) / 100);
  return {
    in: from.in && { ...from.in, len: fit(lens[0]) },
    out: from.out && { ...from.out, len: fit(lens[1]) },
    short: k < 1,
  };
};
export const pasteAnims = (i: number, from: ShotAnim, what: ("anim" | "combo")[]) => {
  const f = animFit(i, from);
  shotsDoc.edit((d) => {
    if (what.includes("anim")) {
      put(d, i, "in", f.in ?? null);
      put(d, i, "out", f.out ?? null);
    }
    if (what.includes("combo")) put(d, i, "combo", from.combo ? structuredClone(from.combo) : null);
  });
};
export const clearAnims = (i: number) => {
  shotsDoc.edit((d) => {
    delete d[i].anim;
  });
  say(`Shot ${i} has no animation now. Ctrl+Z to undo`);
};

export const spanOf = (i: number, slot: Slot): [number, number] => {
  const occurrence = occurrenceAt(i, S.t);
  const [a, b] = occurrence ? [occurrence.from, occurrence.to] : shotSpan(i);
  const last = b - 1 / 30;
  const cur = animOf(i)[slot],
    fx = fxOf(slot, cur?.fx);
  const p = shouldSyncPair(cur, fx) ? pairAt(i, slot, cur?.fx) : null;
  if (p && canLinkSeamPair(cur, fx, animOf(p.j)[p.otherSlot], p.fx.id)) {
    if (slot === "out") {
      const [, c] = shotSpan(p.j);
      return [
        Math.max(a, b - lenOf(i, "out") - 0.5),
        Math.min(c - 1 / 30, b + lenOf(p.j, "in") + 0.5),
      ];
    }
    const [prevA] = shotSpan(p.j);
    return [Math.max(prevA, a - lenOf(p.j, "out") - 0.5), Math.min(last, a + lenOf(i, "in") + 0.5)];
  }
  if (slot === "combo") return [a, last];
  const [start, end] = shotSourceOf(i);
  const clock = clockOf(i);
  const { srcIn, srcOut } = metricsOf(i);
  const delay = cur?.delay ?? 0;
  const at = (t: number) => {
    const local = Math.max(start, Math.min(end, t));
    return clock ? clock.outputAt(local, slot === "in" ? "before" : "after") : local;
  };
  if (slot === "in") return [a, Math.min(last, at(start + srcIn + delay) + 0.6)];
  return [Math.max(a, Math.min(last, at(end - srcOut + delay)) - 0.8), last];
};

type SpanPlayback =
  | { status: "idle" }
  | { status: "playing"; rafId: number; home: number; expectedTime: number | null };

let playback: SpanPlayback = { status: "idle" };

export const playSpan = (a: number, b: number, loop = false) => {
  const home = playback.status === "playing" ? playback.home : S.t;
  if (playback.status === "playing") cancelAnimationFrame(playback.rafId);
  if (S.playing) setPlaying(false);
  const t0 = performance.now(),
    rate = Math.max(1, (b - a) / 4);
  const session: Extract<SpanPlayback, { status: "playing" }> = {
    status: "playing",
    rafId: 0,
    home,
    expectedTime: null,
  };
  playback = session;
  const step = () => {
    if (playback !== session) return;
    if (
      S.playing ||
      (session.expectedTime !== null && Math.abs(S.t - session.expectedTime) > 0.05)
    ) {
      playback = { status: "idle" };
      return;
    }
    let t = a + ((performance.now() - t0) / 1000) * rate;
    if (t >= b) {
      if (!loop) {
        stopSpan();
        return;
      }
      t = a + ((t - a) % Math.max(0.01, b - a));
    }
    seek(t);
    if (playback !== session) return;
    session.expectedTime = S.t;
    session.rafId = requestAnimationFrame(step);
  };
  session.rafId = requestAnimationFrame(step);
};
export const stopSpan = () => {
  if (playback.status !== "playing") return;
  const { rafId, home } = playback;
  playback = { status: "idle" };
  cancelAnimationFrame(rafId);
  seek(home);
};
