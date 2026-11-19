import type { FocusTargetSpec } from "film-stage/camera";
import { EDIT, toSource } from "film/edit";

// The film's camera keys (package.json "live-studio".camTimeline, keys as film-stage/camera.ts reads them), edited by hand on the
// camera row like the sound lanes (doc.ts: undo, saving, an agent's edit wins). The film draws from EDIT.cam, so every change
// puts a fresh copy there and the picture follows at once; its caches are keyed on that array, so it is never edited in place.
// A key's time moves only inside its shot. A cut belongs to the film's SHOTS as much as to the camera, so a cut key moves only
// when the film keeps its shots as data (shots.ts), and then both move together (rollCut), and a shot can be split at the playhead
// or merged with the one before (splitShot, removeKey on a cut), CapCut's Split and its undo.
import { lightEdit } from "../activity/activity";
import { together } from "../core/doc";
import {
  alignedEntryCurve,
  alignedExitCurve,
  type Bezier,
  type Ease,
  easeFn,
  easeToBezier,
  endSlope,
  entryHandleForSlope,
  exitHandleForSlope,
  startSlope,
} from "../core/ease";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { r3, SAME, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { mergeShotHits, repartitionAdjacentHits, type ShotHit, splitShotHits } from "./shot-hits";
import { type ShotRow, shotsDoc } from "./shots";

export type Point = [number, number, number] | Record<string, unknown>; // a world point, or the film's anchor ({"eye": [...]})
export type HandheldSpec =
  | false
  | string
  | {
      preset?: string;
      kind?: string;
      amount?: number;
      move?: number;
      speed?: number;
      offset?: number;
    };
export interface CamKey {
  t: number;
  p: Point;
  l: Point;
  fov?: number;
  mm?: number;
  fstop?: number;
  focus?: FocusTargetSpec;
  handheld?: HandheldSpec;
  bob?: number;
  roll?: number;
  wave?: number;
  cut?: boolean;
  ease?: Ease;
  [k: string]: unknown;
}

export let keys: CamKey[] = [];
let initialKeyTimes: number[] = [];
const changed = () => {
  keys = doc.data ?? [];
  (EDIT as Record<string, unknown>).cam = structuredClone(doc.source ?? []);
  S.dirty = true;
  S.finalAt = -1;
  const { camKey: k, camPicks: ps } = get();
  set({
    camRev: get().camRev + 1,
    ...(k !== null && !keys[k] ? { camKey: null } : {}),
    ...(ps.some((i) => !keys[i]) ? { camPicks: [] } : {}),
  });
};
const doc = createTimedDoc<CamKey[]>("cam", {
  label: "camera",
  changed,
  received: () => lightEdit("cam"),
  saved: (camSaved) => set({ camSaved }),
  replaced: (was) => {
    if (was?.length !== keys.length && (get().camKey !== null || get().camPicks.length))
      setKey(null);
  },
});
export const { edit, preview, snapshot, restore } = doc;
export const loadCam = async () => {
  const ok = !!(await doc.load());
  if (ok && keys.length) initialKeyTimes = keys.map((k) => k.t);
  set({ cam: ok });
};
export const initialKeyTime = (i: number): number | undefined =>
  keys.length === initialKeyTimes.length ? initialKeyTimes[i] : undefined;

// What film-stage/camera.ts gives a key without an ease (core/ease.ts works out how each one spends its span)
export const DEFAULT_EASE = "smooth";
export const holds = (a: CamKey, b: CamKey) =>
  JSON.stringify([a.p, a.l, a.fov, a.mm, a.fstop, a.focus, a.handheld]) ===
  JSON.stringify([b.p, b.l, b.fov, b.mm, b.fstop, b.focus, b.handheld]);
// The keys a key may move between: its shot's cut (or the film's start) and the next cut, never past its neighbours
export const room = (i: number): [number, number] => [
  i > 0 ? Math.min(keys[i].t, keys[i - 1].t + SAME) : 0,
  i + 1 < keys.length ? Math.max(keys[i].t, keys[i + 1].t - SAME) : Infinity,
];
export const movable = (i: number) => i > 0 && !!keys[i] && !keys[i].cut;
export const setKey = (i: number | null) => {
  set(transitionSelection({ kind: "camKey", index: i }, get().side));
  S.dirty = true;
};
// Selection includes fixed keys; group retiming and deletion still preserve shot boundaries.
export const pickCamKeys = (is: number[], shots?: number[]) => {
  const ok = [...new Set(is)].filter((i) => !!keys[i]).sort((a, b) => a - b);
  if (ok.length < 2 && !shots?.length) {
    setKey(ok[0] ?? null);
    return;
  }
  set(transitionSelection({ kind: "camKeys", indices: ok, shots }, get().side));
  S.dirty = true;
};
// How far the picked keys may move together: until the first of them meets a key left out
export const groupRoom = (is: number[]): [number, number] => {
  is = is.filter(movable);
  let lo = -Infinity,
    hi = Infinity;
  for (const i of is) {
    let p = i - 1,
      n = i + 1;
    while (is.includes(p)) p--;
    while (is.includes(n)) n++;
    lo = Math.max(lo, Math.min(0, (p >= 0 ? keys[p].t + SAME : 0) - keys[i].t));
    if (n < keys.length) hi = Math.min(hi, Math.max(0, keys[n].t - SAME - keys[i].t));
  }
  return [lo, hi];
};
export const shiftCamKeys = (is: number[], d: number, apply: typeof edit = edit) =>
  apply((ks) => {
    for (const i of is.filter(movable)) ks[i].t = r3(ks[i].t + d);
  });
// Copies of keys (timeline/clipboard.ts), d seconds later: each lands in whatever shot it falls in, taking the place of a key on
// that frame; one that would land on a cut, the film's first key or past its end is left out. The copies are picked after
export const pasteCamKeys = (items: CamKey[], d: number) => {
  const ok = items
    .map((k) => ({ ...structuredClone(k), t: r3(k.t + d) }))
    .filter(
      (k) =>
        k.t >= SAME &&
        k.t <= DURATION - SAME &&
        !keys.some((x) => x.cut && Math.abs(x.t - k.t) < SAME),
    );
  if (!ok.length) {
    say("Nothing pasted: these keyframes would land on a cut or off the film. Move the playhead");
    return;
  }
  edit((ks) => {
    for (const k of ok) {
      delete k.cut;
      const on = ks.findIndex((x, i) => i > 0 && Math.abs(x.t - k.t) < SAME);
      if (on > 0) {
        ks[on] = k;
        continue;
      }
      const i = ks.findIndex((x) => x.t > k.t);
      ks.splice(i < 0 ? ks.length : i, 0, k);
    }
  });
  pickCamKeys(ok.map((k) => keys.findIndex((x, i) => i > 0 && !x.cut && x.t === k.t)));
  say(
    `${ok.length} keyframe${ok.length > 1 ? "s" : ""} pasted at ${stamp(S.t)}${ok.length < items.length ? `, ${items.length - ok.length} left out (on a cut or off the film)` : ""}`,
  );
};
export const removeCamKeys = (is: number[]) => {
  const ok = is.filter(movable).sort((a, b) => b - a);
  if (!ok.length) return;
  edit((ks) => {
    for (const i of ok) ks.splice(i, 1);
  });
  setKey(null);
  say(`${ok.length} keyframes deleted. Ctrl+Z to undo`);
};

export const nearestKey = (t: number) =>
  keys.reduce((best, k, i) => (Math.abs(k.t - t) < Math.abs(keys[best].t - t) ? i : best), 0);
export const retime = (i: number, t: number) =>
  edit((ks) => {
    const [a, b] = room(i);
    ks[i].t = r3(Math.max(a, Math.min(b, t)));
  });
// fov in degrees, roll in radians (film-stage turns the picture by it), wave the sway's size, bob walking step amount
export const setLens = (
  i: number,
  field: "fov" | "roll" | "wave" | "bob",
  v: number | undefined,
  apply: typeof edit = edit,
) =>
  apply((ks) => {
    if (!ks[i]) return;
    if (field === "fov") delete ks[i].mm;
    if (v === undefined) delete ks[i][field];
    else ks[i][field] = field === "roll" ? Math.round(v * 1e4) / 1e4 : r3(v);
  });
// The Camera tab's reset: the key draws with the film's own FOV, roll and sway again
export const resetLens = (i: number) =>
  edit((ks) => {
    if (!ks[i]) return;
    delete ks[i].fov;
    delete ks[i].mm;
    delete ks[i].roll;
    delete ks[i].wave;
  });
export const resetLensField = (i: number, field: "fov" | "roll" | "wave" | "bob") =>
  edit((ks) => {
    if (!ks[i]) return;
    if (field === "fov") delete ks[i].mm;
    delete ks[i][field];
  });

export const setFocalLength = (i: number, mm: number | undefined, apply: typeof edit = edit) =>
  apply((ks) => {
    if (!ks[i]) return;
    delete ks[i].fov;
    if (mm === undefined) delete ks[i].mm;
    else ks[i].mm = r3(Math.max(5, mm));
  });

export const setFstop = (i: number, fstop: number | undefined, apply: typeof edit = edit) =>
  apply((ks) => {
    if (!ks[i]) return;
    if (fstop === undefined) delete ks[i].fstop;
    else ks[i].fstop = Math.max(0, r3(fstop));
  });

export const setFocus = (
  i: number,
  focus: FocusTargetSpec | undefined,
  apply: typeof edit = edit,
) =>
  apply((ks) => {
    if (!ks[i]) return;
    if (focus === undefined) {
      delete ks[i].focus;
      return;
    }
    if (typeof focus === "number") {
      ks[i].focus = Math.max(0.05, r3(focus));
      return;
    }
    if (typeof focus === "string") {
      const clean = focus.trim();
      if (!clean) delete ks[i].focus;
      else ks[i].focus = clean;
      return;
    }
    const target = focus.target.trim();
    if (!target) {
      delete ks[i].focus;
      return;
    }
    const offset = focus.offset?.map(r3) as [number, number, number] | undefined;
    ks[i].focus = offset && offset.some((n) => Math.abs(n) > 1e-6) ? { target, offset } : target;
  });

export const setHandheld = (
  i: number,
  handheld: HandheldSpec | undefined,
  apply: typeof edit = edit,
) =>
  apply((ks) => {
    if (!ks[i]) return;
    if (handheld === undefined) {
      delete ks[i].handheld;
      return;
    }
    if (handheld === false) {
      ks[i].handheld = false;
      return;
    }
    if (typeof handheld === "string") {
      const clean = handheld.trim();
      if (!clean) delete ks[i].handheld;
      else ks[i].handheld = clean;
      return;
    }
    const rawPreset = String(handheld.preset ?? handheld.kind ?? "THE_CLOSEUP").trim();
    if (!rawPreset) {
      delete ks[i].handheld;
      return;
    }
    const out: Record<string, unknown> =
      handheld.kind && !handheld.preset ? { kind: rawPreset } : { preset: rawPreset };
    if (handheld.amount !== undefined && Math.abs(handheld.amount - 1) > 1e-3)
      out.amount = Math.max(0, r3(handheld.amount));
    if (handheld.move !== undefined && Math.abs(handheld.move - 1) > 1e-3)
      out.move = Math.max(0, r3(handheld.move));
    if (handheld.speed !== undefined && Math.abs(handheld.speed - 1) > 1e-3)
      out.speed = Math.max(0.05, r3(handheld.speed));
    if (handheld.offset !== undefined && Math.abs(handheld.offset) > 1e-3)
      out.offset = r3(handheld.offset);
    ks[i].handheld = Object.keys(out).length === 1 ? rawPreset : out;
  });

export const setKeyPoint = (i: number, which: "p" | "l", next: Point, apply: typeof edit = edit) =>
  apply((ks) => {
    if (!ks[i]) return;
    if (Array.isArray(next)) {
      ks[i][which] = [r3(next[0]), r3(next[1]), r3(next[2])];
      return;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      out[k] = Array.isArray(v) ? v.map((n) => (typeof n === "number" ? r3(n) : n)) : v;
    }
    ks[i][which] = out;
  });

export const focusTargetNames = (): string[] => {
  const names = new Set<string>();
  const tools = S.tools;
  if (tools?.objects) {
    for (const [, label] of tools.objects) {
      if (label && label !== "cam") names.add(label);
    }
  }
  if (tools?.bones) {
    for (const boneName of Object.keys(tools.bones)) {
      if (boneName && boneName !== "cam") names.add(boneName);
    }
    if (tools.objects) {
      for (const [obj, label] of tools.objects) {
        if (!label) continue;
        for (const [boneName, boneObj] of Object.entries(tools.bones)) {
          let cur: { parent?: unknown } | null = boneObj;
          while (cur) {
            if (cur === obj) {
              names.add(`${label}.${boneName}`);
              break;
            }
            cur = (cur.parent as { parent?: unknown } | null | undefined) ?? null;
          }
        }
      }
    }
  }
  for (const k of keys) {
    if (typeof k.focus === "string" && k.focus.trim()) names.add(k.focus.trim());
    else if (
      k.focus &&
      typeof k.focus === "object" &&
      "target" in k.focus &&
      typeof k.focus.target === "string" &&
      k.focus.target.trim()
    ) {
      names.add(k.focus.target.trim());
    }
  }
  return [...names];
};

export { alignedEntryCurve, alignedExitCurve, endSlope, startSlope };

const canJoinBefore = (ks: CamKey[], i: number) =>
  i >= 2 &&
  !!ks[i] &&
  !!ks[i - 1] &&
  !!ks[i - 2] &&
  !ks[i].cut &&
  !ks[i - 1].cut &&
  !holds(ks[i - 2], ks[i - 1]) &&
  !holds(ks[i - 1], ks[i]);

const canJoinAfter = (ks: CamKey[], i: number) =>
  i >= 1 &&
  i + 1 < ks.length &&
  !!ks[i] &&
  !!ks[i + 1] &&
  !ks[i].cut &&
  !ks[i + 1].cut &&
  !holds(ks[i], ks[i + 1]);

const spanMismatch = (ks: CamKey[], idx: number) => {
  if (!canJoinBefore(ks, idx)) return 0;
  const fPrev = easeFn(ks[idx - 1].ease, DEFAULT_EASE);
  const fCurr = easeFn(ks[idx].ease, DEFAULT_EASE);
  if (!fPrev || !fCurr) return 0;
  const dtPrev = Math.max(1e-4, ks[idx - 1].t - ks[idx - 2].t);
  const dtCurr = Math.max(1e-4, ks[idx].t - ks[idx - 1].t);
  return Math.abs(endSlope(fPrev) / dtPrev - startSlope(fCurr) / dtCurr);
};

export const joinMismatch = (i: number) =>
  Math.max(spanMismatch(keys, i), canJoinAfter(keys, i) ? spanMismatch(keys, i + 1) : 0);

const syncPair = (ks: CamKey[], rightIdx: number) => {
  if (!canJoinBefore(ks, rightIdx)) return;
  ks[rightIdx].ease = alignedEntryCurve({
    prevCurve: ks[rightIdx - 1].ease,
    prevDuration: ks[rightIdx - 1].t - ks[rightIdx - 2].t,
    currCurve: ks[rightIdx].ease,
    currDuration: ks[rightIdx].t - ks[rightIdx - 1].t,
  });
};

export const setEase = (i: number, ease: Ease | undefined) =>
  edit((ks) => {
    if (ease === undefined) delete ks[i].ease;
    else ks[i].ease = ease;
    if (get().autoConnectEase) {
      syncPair(ks, i);
      syncPair(ks, i + 1);
    }
  });

export const applyAlignedCustomEase = (i: number, next: Bezier, prev?: Bezier) =>
  edit((ks) => {
    const prevBezier = prev ?? easeToBezier(ks[i].ease, DEFAULT_EASE);
    ks[i].ease = next;
    if (!get().autoConnectEase) return;
    const entryChanged =
      Math.abs(next[0] - prevBezier[0]) > 1e-4 || Math.abs(next[1] - prevBezier[1]) > 1e-4;
    const exitChanged =
      Math.abs(next[2] - prevBezier[2]) > 1e-4 || Math.abs(next[3] - prevBezier[3]) > 1e-4;
    if (entryChanged && canJoinBefore(ks, i)) {
      ks[i - 1].ease = alignedExitCurve({
        currCurve: ks[i - 1].ease,
        currDuration: ks[i - 1].t - ks[i - 2].t,
        nextCurve: next,
        nextDuration: ks[i].t - ks[i - 1].t,
      });
    }
    if ((exitChanged || !entryChanged) && canJoinAfter(ks, i)) {
      syncPair(ks, i + 1);
    }
  });

export const connectSmoothly = (i: number, glide = false) =>
  edit((ks) => {
    if (canJoinBefore(ks, i)) {
      const dtPrev = Math.max(1e-4, ks[i - 1].t - ks[i - 2].t);
      const dtCurr = Math.max(1e-4, ks[i].t - ks[i - 1].t);
      const fPrev = easeFn(ks[i - 1].ease, DEFAULT_EASE);
      const sPrev = fPrev ? endSlope(fPrev) : 0;
      if (glide || sPrev < 0.05) {
        // Promote dead-stop start junction into a smooth cruise velocity across both segments.
        const vPass = Math.max(sPrev / dtPrev, 0.75 / Math.max(dtPrev, dtCurr, 0.25));
        const [px1, py1] = easeToBezier(ks[i - 1].ease, DEFAULT_EASE);
        const [px2, py2] = exitHandleForSlope(vPass * dtPrev);
        const [, , cx2, cy2] = easeToBezier(ks[i].ease, DEFAULT_EASE);
        const [cx1, cy1] = entryHandleForSlope(vPass * dtCurr);
        ks[i - 1].ease = [px1, py1, px2, py2];
        ks[i].ease = [cx1, cy1, cx2, cy2];
      } else {
        syncPair(ks, i);
      }
    }
    if (canJoinAfter(ks, i)) {
      const dtCurr = Math.max(1e-4, ks[i].t - ks[i - 1].t);
      const dtNext = Math.max(1e-4, ks[i + 1].t - ks[i].t);
      const fCurr = easeFn(ks[i].ease, DEFAULT_EASE);
      const sCurr = fCurr ? endSlope(fCurr) : 0;
      if (glide && sCurr < 0.05) {
        const vPass = 0.75 / Math.max(dtCurr, dtNext, 0.25);
        const [cx1, cy1] = easeToBezier(ks[i].ease, DEFAULT_EASE);
        const [cx2, cy2] = exitHandleForSlope(vPass * dtCurr);
        ks[i].ease = [cx1, cy1, cx2, cy2];
      }
      syncPair(ks, i + 1);
    }
  });

export const connectShotSpeeds = (i: number) =>
  edit((ks) => {
    let start = i;
    while (start > 0 && !ks[start].cut) start--;
    let end = i;
    while (end + 1 < ks.length && !ks[end + 1].cut) end++;
    for (let j = start + 2; j <= end; j++) syncPair(ks, j);
  });
// Paste attributes (timeline/attributes.ts): the lens (FOV, roll, sway) and the speed (ease) of key `from`, as it has them (none:
// the film's own), onto keys `to`, one undo step. A shot's first key has no speed, so it takes the lens alone
export const pasteKeyAttrs = (from: CamKey, to: number[], what: ("lens" | "speed")[]) =>
  edit((ks) => {
    for (const i of to) {
      const k = ks[i] as Record<string, unknown> | undefined;
      if (!k) continue;
      if (what.includes("lens"))
        for (const f of ["fov", "mm", "fstop", "focus", "handheld", "bob", "roll", "wave"]) {
          if (from[f] === undefined) delete k[f];
          else k[f] = structuredClone(from[f]);
        }
      if (what.includes("speed") && movable(i)) {
        if (from.ease === undefined) delete k.ease;
        else k.ease = structuredClone(from.ease);
      }
    }
  });
export const removeKey = (i: number) => {
  if (keys[i]?.cut && get().shots) {
    mergeShot(i);
    return;
  }
  if (!movable(i)) {
    say(
      i === 0
        ? "The film's first keyframe can't be deleted"
        : "Deleting a cut merges two shots. Ask the AI in a note",
    );
    return;
  }
  edit((ks) => {
    ks.splice(i, 1);
  });
  setKey(null);
  say(`Keyframe deleted. Ctrl+Z to undo`);
};
// A still stretch: the same framing again `secs` later (or just before the next key), so the camera rests between the two
export const holdAfter = (i: number, secs = 1) => {
  const k = keys[i],
    next = keys[i + 1];
  const t = r3(Math.min(k.t + secs, next ? next.t - SAME * 2 : k.t + secs));
  if (t - k.t < SAME * 2) {
    say("No room before the next keyframe. Move it later first");
    return;
  }
  edit((ks) => {
    const { ease: _, cut: __, ...pose } = structuredClone(ks[i]);
    ks.splice(i + 1, 0, { ...pose, t, ease: "linear" });
  });
  setKey(i + 1);
  say(`Camera holds ${stamp(k.t)} → ${stamp(t)}. Drag the new keyframe to hold longer`);
};

// The key on the playhead: on a cut both the shot's last key and the cut sit at that second, and the picture there is the cut's
export const keyAt = (t: number) => keys.findLastIndex((k) => Math.abs(k.t - t) < SAME);
// The key the Camera and Speed tabs show: the one picked on the camera row, else the one on the playhead (-1: none)
export const shownKey = (t: number) => {
  const k = get().camKey;
  return k !== null && keys[k] ? k : keyAt(t);
};
type View = { p: Point; l: Point; fov: number; roll?: number; wave?: number };
// A new key at t with this framing, keeping the shot's own sway (wave, bob, roll) from the key before it
const insertKey = (t: number, view: View) => {
  const i = keys.findIndex((k) => k.t > t),
    before = keys[(i < 0 ? keys.length : i) - 1];
  const {
    t: _,
    p: __,
    l: ___,
    fov: ____,
    mm: ____m,
    cut: _____,
    ease: ______,
    ...sway
  } = structuredClone(before ?? ({} as CamKey));
  edit((ks) => {
    ks.splice(i < 0 ? ks.length : i, 0, { t, ...view, ...sway });
  });
  setKey(i < 0 ? keys.length - 1 : i);
  say(`Camera keyframe added at ${stamp(t)}. Ctrl+Z to undo`);
};
// The free camera's view (F) as a key at the playhead: it replaces the key on that moment, or goes in between. With `only`, that
// key's framing is replaced, wherever the playhead is
export const saveView = (only?: number) => {
  const f = S.tools?.free;
  if (!f?.on) {
    say("Turn on Free camera (F) and frame the shot first");
    return;
  }
  const t = r3(S.t),
    p = f.p.toArray().map(r3) as Point,
    l = f.l.toArray().map(r3) as Point,
    fov = Math.round(f.fov * 10) / 10,
    extras: Partial<CamKey> = {
      ...(f.roll ? { roll: Math.round(f.roll * 1e4) / 1e4 } : {}),
      ...(f.wave ? { wave: r3(f.wave) } : {}),
    };
  const at = only ?? keyAt(t);
  if (at >= 0) {
    const anchored = !Array.isArray(keys[at].p) || !Array.isArray(keys[at].l);
    edit((ks) => {
      delete ks[at].mm;
      Object.assign(ks[at], { p, l, fov, ...extras });
    });
    setKey(at);
    say(
      `Keyframe at ${stamp(keys[at].t)} updated${anchored ? ". It followed an object before; now it's a fixed point" : ""}`,
      5000,
    );
    return;
  }
  insertKey(t, { p, l, fov, ...extras });
};
// CapCut's ◇ on the Camera section: a key at the playhead holding the picture as it is now (the free camera's view when it is on)
export const addKeyHere = () => {
  if (S.tools?.free.on) saveView();
  else if (S.tools) insertKey(r3(S.t), drawnView());
};

// ---------- A cut moved (a roll edit): the shot before ends sooner or later and the one after starts with it; nothing in the film
// moves, only where the picture changes camera. The shot's start in shots.json moves with its cut key (one undo step for both),
// and so does the last key of the shot before when it sits on the cut (its framing held up to the cut, a frame or less before)
export const tailOf = (i: number) =>
  i > 1 && !keys[i - 1].cut && keys[i].t - keys[i - 1].t < SAME * 2 ? i - 1 : -1;

// On a split cut, target the paired closing keyframe right before the cut so easing into the split remains editable.
export const easeKeyIndex = (i: number) => {
  const k = keys[i];
  if (!k) return -1;
  if (k.cut) {
    const tail = tailOf(i);
    return tail > 0 && !keys[tail].cut ? tail : -1;
  }
  return i > 0 ? i : -1;
};
export const shotOfCut = (i: number) =>
  keys[i]?.cut ? SHOTS_OUT.findIndex((s) => Math.abs(s.t - keys[i].t) < SAME) : -1;
export const rollable = (i: number) => get().shots && shotOfCut(i) > 0;
export const rollRoom = (i: number): [number, number] => {
  const tail = tailOf(i),
    before = keys[(tail >= 0 ? tail : i) - 1];
  return [before.t + SAME * 3, keys[i + 1] ? keys[i + 1].t - SAME : DURATION - SAME];
};
type Apply<T> = (change: (d: T) => void) => void;
const setHits = (row: ShotRow, hits: ShotHit[] | undefined) => {
  if (hits) row.hits = hits;
  else delete row.hits;
};
const rollWith = (i: number, t: number, cam: Apply<CamKey[]>, shots: Apply<ShotRow[]>) => {
  const s = shotOfCut(i),
    tail = tailOf(i),
    [lo, hi] = rollRoom(i),
    at = r3(Math.max(lo, Math.min(hi, t))),
    d = at - keys[i].t;
  cam((ks) => {
    if (tail >= 0) ks[tail].t = r3(ks[tail].t + d);
    ks[i].t = at;
  });
  shots((sh) => {
    if (!sh[s]) return;
    const cutSource = r3(toSource(at));
    sh[s].t = cutSource;
    if (s > 0 && sh[s - 1]) {
      const { prev, next } = repartitionAdjacentHits(sh[s - 1].hits, sh[s].hits, cutSource);
      setHits(sh[s - 1], prev);
      setHits(sh[s], next);
    }
  });
};
export const rollCut = (i: number, t: number) =>
  together(() => rollWith(i, t, edit, shotsDoc.edit));
export const previewRoll = (i: number, t: number) => rollWith(i, t, preview, shotsDoc.preview);

// ---------- Split and merge (CapCut's Split, B). Splitting at the playhead changes nothing on screen: the first half keeps its move
// up to a key a millisecond before the cut (the film's own tails sit there too), and the second half starts on the same picture,
// from the free camera's view when it is on. The new shot copies the old one's fields (how the film draws it). Merging is the
// reverse: the cut, its tail and the shot go, and the camera glides from one shot's keys into the other's
const TAIL = 0.001;
// The film's own draw with the free camera off, for its camera alone: no overlays (picture/render.ts) on a frame nobody sees
const drawnView = (): View => {
  const f = S.tools!.free,
    was = f.on;
  f.on = false;
  S.render!(S.t);
  const v = {
    p: S.tools!.camera.position.toArray().map(r3) as Point,
    l: S.tools!.look.toArray().map(r3) as Point,
    fov: Math.round(S.tools!.camera.fov * 10) / 10,
  };
  f.on = was;
  S.dirty = true;
  return v;
};
// The new half's name: "Hall (2)", and splitting "Hall (2)" again gives "Hall (3)", never "Hall (2) (2)" or a name taken
const secondName = (name: string, shots: ShotRow[]) => {
  const base = name.replace(/ \(\d+\)$/, ""),
    taken = new Set(shots.map((x) => x.name));
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
};
export const splitShot = () => {
  if (!get().shots) {
    say("This film keeps its shots in code: ask the AI in a note to split one");
    return;
  }
  const t = r3(S.t),
    s = SHOTS_OUT.findLastIndex((x) => x.t <= t + SAME);
  if (
    t < SAME * 3 ||
    t > DURATION - SAME * 3 ||
    keys.some((k) => k.cut && Math.abs(k.t - t) < SAME * 3) ||
    Math.abs(SHOTS_OUT[s].t - t) < SAME * 3
  ) {
    say("A shot starts or ends here already. Move the playhead");
    return;
  }
  const f = S.tools!.free,
    here = drawnView();
  const next = f.on
    ? {
        p: f.p.toArray().map(r3) as Point,
        l: f.l.toArray().map(r3) as Point,
        fov: Math.round(f.fov * 10) / 10,
      }
    : here;
  const i = keys.findIndex((k) => k.t > t),
    at = i < 0 ? keys.length : i,
    before = keys[at - 1];
  const anchored = !Array.isArray(before.p) || !Array.isArray(before.l);
  const {
    t: _,
    p: __,
    l: ___,
    fov: ____,
    mm: ____m,
    cut: _____,
    ease: ______,
    ...sway
  } = structuredClone(before);
  together(() => {
    edit((ks) => {
      ks.splice(at, 0, { ...sway, t: r3(t - TAIL), ...here }, { ...sway, t, ...next, cut: true });
    });
    shotsDoc.edit((sh) => {
      const splitSource = r3(toSource(t));
      const { t: _t, name, transition: _transition, hits, ...rest } = sh[s];
      const { before, after } = splitShotHits(hits, splitSource);
      setHits(sh[s], before);
      sh.splice(s + 1, 0, {
        ...structuredClone(rest),
        ...(after ? { hits: after } : {}),
        t: splitSource,
        name: secondName(name ?? `Shot ${s}`, sh),
      });
    });
  });
  setKey(at + 1);
  say(
    `Shot ${s} split at ${stamp(t)}.${f.on ? "" : " Frame the new shot: Free camera (F), then Use current view."}${anchored ? " Its new keys are fixed points: they don't follow an object." : ""}`,
    6000,
  );
};
const mergeShot = (i: number) => {
  const s = shotOfCut(i),
    tail = tailOf(i);
  if (s <= 0) {
    say("This cut has no shot of its own in shots.json. Ask the AI in a note");
    return;
  }
  together(() => {
    edit((ks) => {
      ks.splice(i, 1);
      if (tail >= 0) ks.splice(tail, 1);
    });
    shotsDoc.edit((sh) => {
      const removed = sh[s];
      if (s > 0) setHits(sh[s - 1], mergeShotHits(sh[s - 1].hits, removed?.hits));
      sh.splice(s, 1);
    });
  });
  set(transitionSelection({ kind: "clearShots" }, get().side));
  say(`Shots ${s - 1} and ${s} merged. Ctrl+Z to undo`);
};
