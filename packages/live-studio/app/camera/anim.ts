// A shot's In, Out and Combo (CapCut's Animation tab, for a 3D camera), kept on the shot in shots.json as "anim" {in, out,
// combo}, each {fx, len?, k?, curve?, flip?, optics?}, and drawn by the film (film-stage/animate.ts) on top of its camera keys:
// None takes one off and its length stays a number. The effects listed are the film's own (draw.anims). Each change is one undo
// step (shotsDoc); trying one on (hover) is a preview the picture plays without sound, put back when the pointer leaves. The In
// and Out bands on the camera row trim by dragging their inner edge.
import type { AnimCurve } from "film-stage/animate";
import type { AnimFx } from "film/scene";
import { DURATION, SHOTS_OUT } from "film/scene";

import { timingClock } from "../../src/timing-state.mjs";
import { shotIndex } from "../core/film";
import { type Side, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { seek, setPlaying } from "../playback/transport";
import { originalShot } from "../timeline/timing";
import {
  animSlotMetrics,
  applyAnimDuration,
  canLinkSeamPair,
  freshAnimSet,
  MIN_ANIM,
  shouldSyncPair,
  syncPairedOption,
  tidyAnimSet,
} from "./anim-math";
import { keys } from "./cam";
import { type ShotRow, shotsDoc } from "./shots";

export type Slot = "in" | "out" | "combo";
export interface AnimSet {
  fx: string;
  len?: number;
  k?: number;
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
export const clockOf = () => (get().timing && timingClock.sourceDuration > 0 ? timingClock : null);
export const shotSourceOf = (i: number): [number, number] =>
  clockOf() && SHOTS_OUT[i] ? originalShot(i) : shotSpan(i);
export const metricsOf = (i: number) => {
  const an = animOf(i);
  return animSlotMetrics(
    shotSourceOf(i),
    clockOf(),
    an,
    fxOf("in", an.in?.fx)?.len ?? 0.5,
    fxOf("out", an.out?.fx)?.len ?? 0.5,
  );
};
// The shot the Camera and Animation tabs show: the block picked on the camera row, else the picked key's, else the playhead's
export const shownShot = () => {
  const { shotPick: s, camKey: k } = get();
  return s !== null && SHOTS_OUT[s] ? s : shotIndex(k !== null && keys[k] ? keys[k].t : S.t);
};
// A shot block clicked on the camera row: its details show, in the Animation tab if that is open, else the Camera tab
export const pickShot = (i: number | null, side?: Side) => {
  set(transitionSelection({ kind: "shot", index: i, side }, get().side));
  S.dirty = true;
};

// Output-clock duration and max room for an In or Out (mapped through timingClock when speed/freezes are active)
export const roomFor = (i: number, slot: "in" | "out") => {
  const m = metricsOf(i);
  return slot === "in" ? m.inRoom : m.outRoom;
};
export const lenOf = (i: number, slot: "in" | "out") => {
  const m = metricsOf(i);
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
// What picking an effect stores: an In or Out with the effect's own length, cut to the room the shot has. The curve, mirror
// and optics choices of `from` (the effect being replaced) come along, but only when the new effect can still use them.
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
// Output duration for an In or Out (converted back to source seconds in shots.json), k (strength) for a Combo
export const setAmount = (i: number, slot: Slot, v: number, keep = true) => {
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
    clockOf(),
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
// The curve, mirror and optics choices (CapCut's curve picker and mirror, plus an Optics dial for the optical effects). A
// choice that is back at its default is deleted, so a film keeps the same data it had before the choice existed; a paired
// In/Out on the cut takes the same choice (when supported), so the seam stays one move
export const setOption = (
  i: number,
  slot: Slot,
  patch: Partial<Pick<AnimSet, "curve" | "flip" | "optics" | "seam">>,
  keep = true,
) => {
  const cur = animOf(i)[slot];
  if (!cur) return;
  const fx = fxOf(slot, cur.fx);
  const next = tidyAnimSet({ ...cur, ...patch }, fx);
  const p = shouldSyncPair(next, fx) ? pairAt(i, slot, cur.fx) : null;
  const { seam: _, ...syncPatch } = patch;
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
// Paste attributes (timeline/attributes.ts): a shot's In and Out ("anim", CapCut's Animation) and its Combo, as `from` has them
// (none takes one off), onto shot i, one undo step. An In and Out that don't fit the shot are shortened together, as CapCut
// shortens an animation to fit a short clip; short says so
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

// The seconds that show an effect: an In from the shot's start to a little after it lands, an Out from a little before it into
// the cut, a Combo the whole shot, and across the cut boundary when a paired cross-cut seam animation is active.
export const spanOf = (i: number, slot: Slot): [number, number] => {
  const [a, b] = shotSpan(i),
    last = b - 1 / 30;
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
  if (slot === "in") return [a, Math.min(last, a + lenOf(i, "in") + 0.6)];
  if (slot === "out") return [Math.max(a, b - lenOf(i, "out") - 0.8), last];
  return [a, last];
};

// The picture plays a stretch on its own, without sound (an effect tried on), then the playhead goes back where it was. Pressing
// play or seeking meanwhile ends it there
let run = 0,
  home: number | null = null,
  expect = -1;
export const playSpan = (a: number, b: number, loop = false) => {
  run++;
  if (S.playing) setPlaying(false);
  home ??= S.t;
  const id = run,
    t0 = performance.now(),
    rate = Math.max(1, (b - a) / 4); // a long Combo plays faster, in about 4 s
  const step = () => {
    if (id !== run) return;
    if (S.playing || (expect >= 0 && Math.abs(S.t - expect) > 0.05)) {
      run++;
      home = null;
      expect = -1;
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
    expect = S.t;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
export const stopSpan = () => {
  run++;
  expect = -1;
  if (home !== null) {
    seek(home);
    home = null;
  }
};
