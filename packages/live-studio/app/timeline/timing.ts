import { EDIT } from "film/edit";
import { DURATION, SHOTS } from "film/scene";

import { remapOutputTime } from "../../src/layer-timing.mjs";
import { recordLinkage, timingPlan as plan } from "../../src/linkage.mjs";
import { insertMainFreeze } from "../../src/main-track.mjs";
import { setTiming, timing, timingClock } from "../../src/timing-state.mjs";
import type { Timing } from "../../src/timing.mjs";
import {
  closeTimingGaps,
  deleteFreeze,
  frameVisible,
  freezeRange,
  freezesOf,
  joinRanges,
  moveFreeze,
  replaceSpeed,
  resizeFreeze,
  speedRange,
  visibleSourceRange,
} from "../../src/timing.mjs";
import { type Velocity, velocityCurve } from "../../src/velocity.mjs";
import { warp } from "../../src/warp.mjs";
import { createDoc } from "../core/doc";
import { pruneFreezeSelection, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set, setPref } from "../core/store";
import { refreshTimedDocs } from "../core/timed-doc";
import { seek, setPlaying } from "../playback/transport";
import { refreshTimes } from "./timeline";

let loaded = false;
const changed = () => {
  const before = timingClock,
    was = S.t;
  const keepFrame = loaded;
  loaded = true;
  if (S.playing) setPlaying(false);
  setTiming(timingDoc.data ?? {});
  refreshTimes();
  refreshTimedDocs();
  S.finalAt = -1;
  const state = get();
  set({
    timingRev: state.timingRev + 1,
    ...pruneFreezeSelection(state.freezePick, freezesOf(timing)),
  });
  if (S.el) seek(Math.min(DURATION, keepFrame ? remapOutputTime(before, timingClock, was) : was));
};
export const timingDoc = createDoc<Timing>("timing", {
  label: "timing",
  changed,
  saved: (timingSaved) => set({ timingSaved }),
  replaced: () => set({ freezePick: null }),
});
const changeTiming = (change: (data: Timing) => void, preview = false, link = get().linkage) =>
  (preview ? timingDoc.preview : timingDoc.edit)((data) => {
    const before = plan(data);
    change(data);
    if (JSON.stringify(before) === JSON.stringify(plan(data))) return;
    recordLinkage(data, before, plan(data), link, get().linkageKinds);
  });
export const loadTiming = async () => {
  set({ timing: !!(await timingDoc.load()) });
};
export const originalShot = (i: number): [number, number] => {
  if (!SHOTS[i]) return [0, 0];
  const heard = (t: number) => warp(EDIT.voice.warp, t, 0, 1);
  return [heard(SHOTS[i].t), SHOTS[i + 1] ? heard(SHOTS[i + 1].t) : timingClock.sourceDuration];
};
export const sourceShot = (i: number): [number, number] => {
  const [from, to] = originalShot(i);
  return visibleSourceRange(timingClock, from, to);
};
export const shotSpeed = (i: number) => {
  const [from, to] = sourceShot(i);
  if (to <= from) return;
  const effect = timing.speeds?.find((s) => s.from <= from && s.to >= to);
  return effect ? speedRange(effect, from, to) : undefined;
};
export const setShotSpeed = (
  i: number,
  speed: { rate: number } | { curve: [number, number][]; handles?: [number, number][] } | null,
  preview = false,
) => {
  const [from, to] = sourceShot(i);
  if (to <= from) return;
  changeTiming((data) => {
    data.speeds = replaceSpeed(data.speeds ?? [], from, to, speed);
    data.velocity = withoutVelocity(data.velocity, from, to);
  }, preview);
};

const withoutVelocity = (values: Velocity[] = [], from: number, to: number) =>
  values.flatMap((v) =>
    v.to <= from || v.from >= to
      ? [v]
      : [
          ...(v.from < from ? [{ ...v, to: from }] : []),
          ...(v.to > to ? [{ ...v, from: to }] : []),
        ],
  );
export const shotVelocity = (i: number) => {
  const [from, to] = sourceShot(i);
  return timing.velocity?.find((v) => v.from <= from && v.to >= to);
};
export const setShotVelocity = (
  i: number,
  value: Omit<Velocity, "from" | "to"> | null,
  preview = false,
) => {
  if (!value && !shotVelocity(i)) return;
  const [from, to] = sourceShot(i);
  if (to <= from) return;
  changeTiming(
    (data) => {
      data.velocity = withoutVelocity(data.velocity, from, to);
      const next = value && { ...value, from, to };
      if (next) data.velocity.push(next);
      data.speeds = replaceSpeed(
        data.speeds ?? [],
        from,
        to,
        next && next.enabled !== false ? velocityCurve(next) : null,
      );
    },
    preview,
    false,
  );
};
export const addFreeze = () => {
  const pressAt = S.t,
    at = timingClock.sourceAt(pressAt);
  if (!frameVisible(timingClock, pressAt)) {
    say("Move the playhead onto a clip to freeze its frame");
    return;
  }
  changeTiming((data) => {
    if (data.main) {
      insertMainFreeze(data, timingClock, pressAt, 3);
      return;
    }
    data.freezes ??= [];
    const existing = data.freezes.find((f) => Math.abs(f.at - at) < 1e-6);
    if (existing) existing.duration += 3;
    else data.freezes.push({ at, duration: 3 });
    data.freezes.sort((a, b) => a.at - b.at);
  });
  const pick = timing.main
    ? freezesOf(timing).findIndex((_, i) => {
        const [a, b] = freezeRange(timing, timingClock, i);
        return pressAt >= a - 1e-6 && pressAt <= b + 1e-6;
      })
    : timing.freezes!.findIndex((f) => Math.abs(f.at - at) < 1e-6);
  set(transitionSelection({ kind: "freeze", index: pick >= 0 ? pick : null }, get().side));
  seek(pick >= 0 ? freezeRange(timing, timingClock, pick)[0] : timingClock.outputAt(at, "before"));
};
export const setFreezeDuration = (i: number, duration: number, preview = false, edge: -1 | 1 = 1) =>
  changeTiming(
    (data) => resizeFreeze(data, i, duration, get().mainMagnet, edge),
    preview,
    get().mainMagnet && get().linkage,
  );
export const relocateFreeze = (i: number, start: number) => {
  const [from, to] = freezeRange(timing, timingClock, i),
    offset = S.t >= from && S.t < to ? S.t - from : null;
  let index = i;
  changeTiming((data) => {
    index = moveFreeze(data, i, start, timingClock.sourceDuration, get().mainMagnet);
  });
  set(transitionSelection({ kind: "freeze", index }, get().side));
  if (offset !== null) seek(freezeRange(timing, timingClock, index)[0] + offset);
};
export const removeFreeze = (i: number) => {
  changeTiming(
    (data) => deleteFreeze(data, i, get().mainMagnet),
    false,
    get().mainMagnet && get().linkage,
  );
  set(transitionSelection({ kind: "freeze", index: null }, get().side));
};

export const removeShotTime = (i: number, side?: "left" | "right") => {
  if (!side) {
    removeShotsTime([i]);
    return;
  }
  let [from, to] = sourceShot(i);
  const at = timingClock.sourceAt(S.t);
  if (side) {
    if (at <= from || at >= to) {
      say("Move the playhead inside the selected shot to trim it");
      return;
    }
    if (side === "left") to = at;
    else from = at;
  }
  if (to <= from) return;
  changeTiming((data) => {
    const key = get().mainMagnet ? "cuts" : "gaps";
    data[key] = joinRanges([...(data[key] ?? []), { from, to }]);
  });
  set(transitionSelection({ kind: "none" }, get().side));
  seek(Math.min(DURATION, timingClock.outputAt(from, "before")));
};

export const removeShotsTime = (indices: number[]) => {
  const ranges = [...new Set(indices)]
    .map(sourceShot)
    .filter(([from, to]) => to > from)
    .map(([from, to]) => ({ from, to }));
  if (!ranges.length) return;
  changeTiming((data) => {
    const key = get().mainMagnet ? "cuts" : "gaps";
    data[key] = joinRanges([...(data[key] ?? []), ...ranges]);
  });
  set(transitionSelection({ kind: "clearShots" }, get().side));
  seek(Math.min(DURATION, timingClock.outputAt(Math.min(...ranges.map((r) => r.from)), "before")));
};

export const toggleMainMagnet = () => {
  const enabled = !get().mainMagnet;
  setPref("mainMagnet", enabled);
  if (
    enabled &&
    (timing.gaps?.length ||
      timing.main?.some((it) => it.kind === "gap") ||
      timing.freezes?.some((f) => f.blank || f.padBefore || f.padAfter))
  ) {
    changeTiming(closeTimingGaps);
    set(transitionSelection({ kind: "freeze", index: null }, get().side));
  }
};
