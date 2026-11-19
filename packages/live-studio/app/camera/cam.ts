import { hfovOf, vfovOf } from "film-kit/lens";
import type { CameraChannel, CameraMotion, FocusTargetSpec } from "film-stage/camera";
import { cameraKeyOptics, cameraRailU, canMatchCameraSpeed, lensAspect } from "film-stage/camera";
import { EDIT, toSource } from "film/edit";

import { cameraShotAtBoundary, canPlaceCameraCut } from "../../src/camera-clock.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
// The film's camera keys (package.json "live-studio".camTimeline, keys as film-stage/camera.ts reads them), edited by hand on the
// camera row like the sound lanes (doc.ts: undo, saving, manual edits are protected). The film draws from EDIT.cam, so every change
// puts a fresh copy there and the picture follows at once; its caches are keyed on that array, so it is never edited in place.
// Rolling a shot boundary moves both the camera cut and its shot. Cuts inside a shot are camera keys only.
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
import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set, showError } from "../core/store";
import { FPS, r3, SAME, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { readSceneFrame } from "../picture/render";
import { seekExact } from "../playback/transport";
import {
  type CameraFieldGroup,
  cameraKeyNavigation,
  cameraSegmentAt,
  cameraTailIndex,
  type CameraView,
  copyCameraFields,
  createHoldCameraKey,
  type HandheldSpec,
  joinableCameraKeysInShot,
  keyAtTime,
  normalizeFocusSpec,
  normalizeHandheldSpec,
  redundantLinearCameraKeys,
  replaceCameraFraming,
  selectedCameraKeyAt,
  stripInvalidMatchSpeed,
} from "./camera-edit";
import { mergeShotHits, repartitionAdjacentHits, type ShotHit, splitShotHits } from "./shot-hits";
import { type ShotRow, shotsDoc } from "./shots";

export type { HandheldSpec };
export type Point = [number, number, number] | Record<string, unknown>; // a world point, or the film's anchor ({"eye": [...]})
export interface CamKey {
  id?: string;
  __timing?: { source: number; output: number; alias?: string | number };
  t: number;
  p: Point;
  l: Point;
  fov?: number;
  mm?: number;
  dollyZoomScale?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
  bob?: number;
  roll?: number;
  wave?: number;
  motion?: CameraMotion;
  reversePath?: boolean;
  cut?: boolean;
  tailId?: string | false;
  locked?: boolean;
  muted?: boolean;
  color?: "amber" | "blue" | "green" | "pink";
  inHandle?: [number, number, number];
  outHandle?: [number, number, number];
  railU?: number;
  reason?: string;
  ease?: Ease;
  matchSpeed?: boolean;
  easeChannels?: Partial<Record<CameraChannel, Ease>>;
  [k: string]: unknown;
}

const newRowId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export let keys: CamKey[] = [];
const initialKeyTimes = new Map<string, number>();
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
    if (was?.length !== doc.source?.length && (get().camKey !== null || get().camPicks.length))
      setKey(null);
  },
});
export const { sourceSnapshot: snapshot, restoreSource: restore } = doc;
export const takeCamera = (next: CamKey[]) => {
  const current = doc.source;
  if (!current?.length || !next.length) return;
  const cuts = (rows: CamKey[]) =>
    rows.filter((key, index) => index === 0 || key.cut).map((key) => key.t);
  if (JSON.stringify(cuts(current)) !== JSON.stringify(cuts(next)))
    return say("This take uses different shot cuts. Save a take with the current cuts first");
  const locked = (rows: CamKey[]) => rows.filter((key) => key.locked);
  if (JSON.stringify(locked(current)) !== JSON.stringify(locked(next)))
    return say("Unlock differing keys before applying this take");
  doc.editSource((rows) => rows.splice(0, rows.length, ...structuredClone(next)));
  setKey(null);
  return true;
};
const protectLocked = (change: (rows: CamKey[]) => void) => (rows: CamKey[]) => {
  const locked = rows.filter((key) => key.locked).map((key) => JSON.stringify(key));
  if (!locked.length) return change(rows);
  const next = structuredClone(rows);
  change(next);
  const after = next.filter((key) => key.locked).map((key) => JSON.stringify(key));
  if (locked.length === after.length && locked.every((key, i) => key === after[i]))
    rows.splice(0, rows.length, ...next);
};
export const edit: typeof doc.edit = (change, clock) => doc.edit(protectLocked(change), clock);
export const preview: typeof doc.preview = (change, clock) =>
  doc.preview(protectLocked(change), clock);
export const setKeyLocked = (i: number, locked: boolean) =>
  doc.edit((rows) => {
    if (locked) rows[i].locked = true;
    else delete rows[i].locked;
  });
export const opticsOfKey = (i: number) => {
  const rows = doc.source ?? [];
  const key = keys[i];
  const at =
    key?.id === undefined
      ? rows.findIndex((row) => row.t === (key?.__timing?.source ?? key?.t))
      : rows.findIndex((row) => row.id === key.id);
  return cameraKeyOptics(
    rows,
    at,
    S.tools?.camera?.aspect || 16 / 9,
    cameraAxisAt(key ? cameraKeyFrameTime(i) : 0),
  );
};
export const loadCam = async () => {
  const ok = !!(await doc.load());
  initialKeyTimes.clear();
  if (ok) {
    for (const k of keys) {
      if (k.id) initialKeyTimes.set(k.id, k.t);
    }
  }
  set({ cam: ok });
};
export const initialKeyTime = (i: number): number | undefined => {
  const id = keys[i]?.id;
  return id ? initialKeyTimes.get(id) : undefined;
};

// What film-stage/camera.ts gives a key without an ease (core/ease.ts works out how each one spends its span)
export const DEFAULT_EASE = "smooth";
export const holds = (a: CamKey, b: CamKey) =>
  b.motion === "hold" ||
  JSON.stringify([a.p, a.l, a.fov, a.mm, a.fstop, a.focus, a.handheld, a.roll, a.wave, a.bob]) ===
    JSON.stringify([b.p, b.l, b.fov, b.mm, b.fstop, b.focus, b.handheld, b.roll, b.wave, b.bob]);
// The keys a key may move between: its shot's cut (or the film's start) and the next cut, never past its neighbours
const placementRoom = (k: CamKey): [number, number] => {
  const placement = clockForTimeline("cam").cameraSpans?.find(
    (span) => k.t >= span.from && k.t < span.to,
  );
  return placement ? [placement.from, Math.max(k.t, placement.to - SAME)] : [0, Infinity];
};
export const room = (i: number): [number, number] => {
  const [from, to] = placementRoom(keys[i]);
  return [
    Math.max(from, i > 0 ? Math.min(keys[i].t, keys[i - 1].t + SAME) : 0),
    Math.min(to, i + 1 < keys.length ? Math.max(keys[i].t, keys[i + 1].t - SAME) : Infinity),
  ];
};
export const movable = (i: number) =>
  i > 0 && !!keys[i] && !keys[i].cut && !keys[i].locked && keys[i].__timing?.source !== 0;
const boundaryOf = (i: number) => {
  const key = keys[i];
  if (!key?.cut) return -1;
  const clock = clockForTimeline("cam");
  return clock.cameraShotStarts?.length
    ? cameraShotAtBoundary(clock, cameraSourceTime(key))
    : SHOTS_OUT.findIndex((shot) => Math.abs(shot.t - key.t) < SAME);
};
export const isHardCut = (i: number) =>
  i > 0 && !!keys[i]?.cut && keys[i].__timing?.source !== 0 && boundaryOf(i) < 0;
const deletableKey = (i: number) => movable(i) || (isHardCut(i) && !keys[i].locked);
export const canDeleteCameraKey = (i: number) => deletableKey(i) || rollable(i);
const cameraSourceTime = (key: CamKey) =>
  key.__timing?.source ?? clockForTimeline("cam").sourceAt(key.t, key.cut ? "after" : "before");
const sourceShotStarts = () => {
  const starts = clockForTimeline("cam").cameraShotStarts;
  return starts?.length ? starts : SHOTS_OUT.map((shot) => shot.t);
};
export const canConvertHardCut = (i: number) => {
  if (!isHardCut(i) || keys[i].locked) return false;
  const t = cameraSourceTime(keys[i]);
  if (sourceShotStarts().some((start) => Math.abs(start - t) < SAME)) return false;
  return (doc.source ?? []).filter((row) => Math.abs(row.t - t) < 1e-7).length === 1;
};
export const convertHardCutToKeyframe = (i: number) => {
  if (!canConvertHardCut(i)) return;
  const { id, t } = keys[i];
  const sourceTime = cameraSourceTime(keys[i]);
  if (
    !preserveRailPositions([i - 1, i], () =>
      edit((rows) => {
        delete rows[i].cut;
        delete rows[i].tailId;
      }),
    )
  )
    return;
  const matches = (key: CamKey) =>
    id ? key.id === id : Math.abs(cameraSourceTime(key) - sourceTime) < 1e-7;
  const here = keys.findIndex((key) => matches(key) && Math.abs(key.t - t) < SAME);
  const next = here >= 0 ? here : keys.findIndex(matches);
  setKey(next >= 0 ? next : null);
  say("Converted to a regular keyframe. Ctrl+Z to undo");
};

export const retimable = (i: number) => deletableKey(i);
export const setKey = (i: number | null) => {
  set(transitionSelection({ kind: "camKey", index: i }, get().side));
  S.dirty = true;
};
const selectPlacement = (id: string | undefined, t: number) => {
  const i = keys.findIndex((row) => row.id === id && Math.abs(row.t - t) < SAME);
  setKey(i >= 0 ? i : null);
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
    const [from, to] = placementRoom(keys[i]);
    lo = Math.max(lo, from - keys[i].t);
    hi = Math.min(hi, to - keys[i].t);
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
        !keys.some((x, i) => !movable(i) && Math.abs(x.t - k.t) < SAME),
    );
  if (!ok.length) {
    say(
      "Nothing pasted: these keyframes would land on a cut, the opening key, or off the film. Move the playhead",
    );
    return;
  }
  const recipients = ok.map((key) => keys.findLastIndex((candidate) => candidate.t <= key.t));
  if (
    !preserveRailPositions(recipients, () =>
      edit((ks) => {
        const pastedIds = new Set<string>();
        for (const k of ok) {
          delete k.cut;
          delete k.tailId;
          delete k.__timing;
          delete k.locked;
          delete k.reason;
          const on = ks.findIndex((x, i) => i > 0 && Math.abs(x.t - k.t) < SAME);
          if (on > 0) {
            const target = ks[on];
            const id = target.id ?? newRowId();
            pastedIds.add(id);
            ks[on] = { ...k, id, __timing: target.__timing };
            continue;
          }
          const i = ks.findIndex((x) => x.t > k.t);
          const id = newRowId();
          pastedIds.add(id);
          ks.splice(i < 0 ? ks.length : i, 0, { ...k, id });
        }
        stripInvalidMatchSpeed(
          ks,
          ks.flatMap((key, index) => (key.id && pastedIds.has(key.id) ? [index] : [])),
        );
      }),
    )
  )
    return;
  pickCamKeys(
    ok.map((k) => keys.findIndex((x, i) => i > 0 && !x.cut && Math.abs(x.t - k.t) < 1e-6)),
  );
  say(
    `${ok.length} keyframe${ok.length > 1 ? "s" : ""} pasted at ${stamp(S.t)}${ok.length < items.length ? `, ${items.length - ok.length} left out (on a cut or off the film)` : ""}`,
  );
};
export const removeCamKeys = (is: number[]) => {
  const ok = [...new Set(is.filter(deletableKey))].sort((a, b) => b - a);
  if (!ok.length) return;
  if (
    !preserveRailPositions(
      ok.flatMap((i) => (isHardCut(i) ? [i - 1, i] : [i])),
      () =>
        edit((ks) => {
          for (const i of ok) ks.splice(i, 1);
        }),
    )
  )
    return;
  setKey(null);
  say(`${ok.length} keyframes deleted. Ctrl+Z to undo`);
};

export const simplifyCameraKeys = (picked: number[]) => {
  const rows = doc.source ?? [];
  const clock = clockForTimeline("cam");
  const selected = new Set(
    picked
      .filter((i) => movable(i) && !railAtKey(i))
      .map((i) => {
        const key = keys[i];
        if (key.id) return key.id;
        return key.__timing?.source ?? clock.sourceAt(key.t, "before");
      }),
  );
  const removed = redundantLinearCameraKeys(rows, selected, SAME);
  if (!removed.length) return say("No redundant linear keys in this selection");
  doc.editSource((rows) => removed.reverse().forEach((i) => rows.splice(i, 1)));
  setKey(null);
  say("Simplified " + removed.length + " camera keys");
};

export const nearestKey = (t: number) =>
  keys.reduce((best, k, i) => (Math.abs(k.t - t) < Math.abs(keys[best].t - t) ? i : best), 0);
const retimedTime = (i: number, t: number) => {
  const [a, b] = room(i);
  const next = r3(Math.max(a, Math.min(b, t)));
  if (!isHardCut(i)) return next;
  const key = keys[i];
  const clock = clockForTimeline("cam");
  const picture = clock.cameraPicture ?? clock;
  const to = clock.sourceAt(next);
  const from = cameraSourceTime(key);
  if (
    (!clock.cameraRateAt?.(next) && !canPlaceCameraCut(picture, next)) ||
    sourceShotStarts().some(
      (at) => at >= Math.min(from, to) - SAME && at <= Math.max(from, to) + SAME,
    )
  )
    return key.t;
  return next;
};
export const retime = (i: number, t: number, apply: typeof edit = edit) => {
  if (!retimable(i)) return keys[i]?.t ?? t;
  const id = keys[i].id;
  const next = retimedTime(i, t);
  if (next === keys[i].t) return next;
  apply((ks) => {
    ks[i].t = next;
    if (ks[i].cut) ks[i].tailId = false;
  });
  if (apply === edit) selectPlacement(id, next);
  return next;
};
// fov in degrees, roll in radians (film-stage turns the picture by it), wave the sway's size (1 the film's own)
export type LensField = "fov" | "mm" | "fstop" | "roll" | "wave" | "bob";
export const cameraAxisAt = (time: number) => SHOTS_OUT[shotIndex(time)]?.camera?.fovAxis;
export const lensAspectAt = (time: number) =>
  lensAspect(S.tools?.camera?.aspect || 16 / 9, cameraAxisAt(time));
const fovForStorage = (fov: number, t: number) => {
  const aspect = S.tools?.camera?.aspect || 16 / 9;
  const axis = cameraAxisAt(t);
  return axis?.mode === "horizontal" ? vfovOf(hfovOf(fov, aspect), axis.aspect) : fov;
};
export const writeLens = (
  key: CamKey,
  field: LensField,
  value: number | undefined,
  frame = key.t,
) => {
  if (field === "fov" || field === "mm") delete key.dollyZoomScale;
  if (field === "fov" && value !== undefined) delete key.mm;
  if (field === "mm" && value !== undefined) delete key.fov;
  if (value === undefined) delete key[field];
  else
    key[field] =
      field === "roll"
        ? Math.round(value * 1e4) / 1e4
        : r3(field === "fov" ? fovForStorage(value, frame) : value);
};
export const setLens = (
  i: number,
  field: LensField,
  v: number | undefined,
  apply: typeof edit = edit,
) =>
  apply((ks) => {
    if (!ks[i]) return;
    writeLens(ks[i], field, v, cameraKeyFrameTime(i));
  });
export const resetLens = (i: number) =>
  edit((ks) => {
    if (!ks[i]) return;
    copyCameraFields({}, ks[i], ["lens", "dof", "shake"]);
    delete ks[i].roll;
    delete ks[i].dollyZoomScale;
  });
export const resetDof = (i: number) =>
  edit((ks) => {
    if (!ks[i]) return;
    copyCameraFields({}, ks[i], ["dof"]);
  });
export const resetShake = (i: number) =>
  edit((ks) => {
    if (!ks[i]) return;
    copyCameraFields({}, ks[i], ["shake"]);
  });
export const resetLensField = (i: number, field: LensField) =>
  edit((ks) => {
    if (!ks[i]) return;
    if (field === "fov" || field === "mm") {
      delete ks[i].fov;
      delete ks[i].mm;
      delete ks[i].dollyZoomScale;
      return;
    }
    delete ks[i][field];
  });

export const setFocalLength = (i: number, mm: number | undefined, apply: typeof edit = edit) =>
  apply((ks) => {
    if (!ks[i]) return;
    writeLens(ks[i], "mm", mm === undefined ? undefined : Math.max(5, mm), cameraKeyFrameTime(i));
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
    const normalized = normalizeFocusSpec(focus);
    if (normalized === undefined) delete ks[i].focus;
    else ks[i].focus = normalized;
  });

export const setHandheld = (
  i: number,
  handheld: HandheldSpec | undefined,
  apply: typeof edit = edit,
) =>
  apply((ks) => {
    if (!ks[i]) return;
    const normalized = normalizeHandheldSpec(handheld);
    if (normalized === undefined) delete ks[i].handheld;
    else ks[i].handheld = normalized;
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
export const applyEasyEase = (indices: number[], incoming = false) => {
  const curve: Ease = [1 / 3, incoming ? 1 / 3 : 0, 2 / 3, 1];
  edit((rows) => {
    for (const i of indices.filter(movable)) {
      rows[i].ease = [...curve];
      if (rows[i].motion === "hold") delete rows[i].motion;
    }
  });
};
export const seekCameraKey = (index: number) => {
  if (!keys[index]) return;
  seekExact(cameraKeyFrameTime(index));
  setKey(index);
};
const cameraPicks = () => {
  const { camKey, camPicks } = get();
  return camPicks.length ? camPicks : camKey === null ? [] : [camKey];
};
export const easeCameraPicks = (incoming: boolean) => applyEasyEase(cameraPicks(), incoming);
export const nudgeCameraPicks = (direction: -1 | 1) => {
  const picked = cameraPicks().filter(movable);
  if (!picked.length) return;
  const [min, max] = groupRoom(picked);
  const offset = Math.max(min, Math.min(max, direction / FPS));
  if (offset) shiftCamKeys(picked, offset);
};
export const stepCameraKey = (direction: -1 | 1) => {
  const nav = cameraKeyNavigation(keys, S.t, get().camKey, SAME);
  const index = direction < 0 ? nav.prev : nav.next;
  if (index !== null) seekCameraKey(index);
};

export const pasteKeyAttrs = (from: CamKey, to: number[], what: CameraFieldGroup[]) =>
  edit((ks) => {
    const applied: number[] = [];
    for (const i of to) {
      if (!ks[i] || ks[i].locked) continue;
      copyCameraFields(from, ks[i], movable(i) ? what : what.filter((group) => group !== "speed"));
      applied.push(i);
    }
    stripInvalidMatchSpeed(ks, applied);
  });
export const removeKey = (i: number) => {
  if (keys[i]?.locked) return say("Unlock this camera keyframe first");
  if (shotOfCut(i) > 0 && get().shots) {
    mergeShot(i);
    return;
  }
  if (!deletableKey(i)) {
    say(
      i === 0
        ? "The film's first keyframe can't be deleted"
        : "This camera keyframe marks a shot boundary",
    );
    return;
  }
  if (
    !preserveRailPositions(isHardCut(i) ? [i - 1, i] : [i], () =>
      edit((ks) => {
        ks.splice(i, 1);
      }),
    )
  )
    return;
  setKey(null);
  say(`Keyframe deleted. Ctrl+Z to undo`);
};
// A still stretch: the same framing again `secs` later (or just before the next key), so the camera rests between the two
export const holdAfter = (i: number, secs = 1) => {
  const k = keys[i],
    next = keys[i + 1],
    [, end] = placementRoom(k);
  const t = r3(Math.min(k.t + secs, next ? next.t - SAME * 2 : Infinity, end));
  if (t - k.t < SAME * 2) {
    say("No room before the next keyframe. Move it later first");
    return;
  }
  const id = newRowId();
  const railU = railAtKey(i) ? railPositionForKey(i) : k.railU;
  if (
    !preserveRailPositions([i], () =>
      edit((ks) => {
        ks.splice(i + 1, 0, createHoldCameraKey(ks[i], id, t, railU));
      }),
    )
  )
    return;
  selectPlacement(id, t);
  say(`Camera holds ${stamp(k.t)} → ${stamp(t)}. Drag the new keyframe to hold longer`);
};

// The key on the playhead: on a cut both the shot's last key and the cut sit at that second, and the picture there is the cut's
export const keyAt = (t: number) => keyAtTime(keys, t, SAME);
// The key the Camera and Speed tabs show: the one picked on the camera row, else the one on the playhead (-1: none)
export const shownKey = (t: number) => {
  const k = get().camKey;
  return k !== null && keys[k] ? k : keyAt(t);
};
export const vectorPoint = (v: { toArray(): number[] }) =>
  v.toArray().map(r3) as [number, number, number];

export const cameraKeyFrameTime = (i: number) => {
  const key = keys[i];
  return !key.cut && keys[i + 1]?.cut && keys[i + 1].t === key.t ? key.t - 1e-6 : key.t;
};
export const sourceCameraSegment = (index: number) => {
  const key = keys[index],
    track = doc.source ?? [];
  if (!key) return null;
  const at = track.findIndex((candidate) =>
    key.id
      ? candidate.id === key.id
      : Math.abs(candidate.t - cameraSourceTime(key)) < 1e-7 && !!candidate.cut === !!key.cut,
  );
  return cameraSegmentAt(track, at);
};

export const canMatchCameraKey = (index: number) => {
  const segment = sourceCameraSegment(index);
  return !!(segment && canMatchCameraSpeed(segment.active, segment.at));
};

export const setCameraKeyMatchSpeed = (index: number, on: boolean) =>
  edit((rows) => {
    if (!rows[index]) return;
    if (on) rows[index].matchSpeed = true;
    else delete rows[index].matchSpeed;
  });

export const canMatchAllInShot = (index: number) =>
  joinableCameraKeysInShot(keys, index).some((key) => !key.matchSpeed);

export const matchAllInShot = (index: number) => {
  const targets = joinableCameraKeysInShot(keys, index);
  if (!targets.length) {
    say("No joinable interior keyframes in this shot to match");
    return false;
  }
  if (!targets.some((key) => !key.matchSpeed)) {
    say("Every joinable keyframe in this shot already matches speed");
    return true;
  }
  edit((rows) => {
    for (const key of joinableCameraKeysInShot(rows, index)) key.matchSpeed = true;
  });
  say(`Matched speed across ${targets.length} keyframe${targets.length === 1 ? "" : "s"} in shot`);
  return true;
};

export const railPositionForKey = (i: number) => {
  const segment = sourceCameraSegment(i);
  return segment && segment.at >= 0
    ? cameraRailU(keys[i], segment.at, segment.active.length)
    : keys[i].railU;
};

const railAtKey = (i: number) =>
  keys[i] && SHOTS_OUT[shotIndex(cameraKeyFrameTime(i))]?.camera?.rail;

const preserveRailPositions = (indices: number[], change: () => void) => {
  const track = doc.source ?? [];
  const positions = new Map<CamKey, number>();
  const visited = new Set<CamKey>();
  for (const i of indices) {
    if (!keys[i]) continue;
    const shot = shotIndex(cameraKeyFrameTime(i));
    if (!SHOTS_OUT[shot]?.camera?.rail) continue;
    const active = sourceCameraSegment(i)?.active ?? [];
    if (!active.length || visited.has(active[0])) continue;
    visited.add(active[0]);
    active.forEach((key, index) => {
      if (index === 0 && key.locked) return;
      if (key.railU === undefined) positions.set(key, cameraRailU(key, index, active.length));
    });
  }
  if (!positions.size) {
    change();
    return true;
  }
  if ([...positions.keys()].some((key) => key.locked)) {
    say("Unlock camera keys with an inherited rail position before changing the shot’s keys");
    return false;
  }
  const values = track.map((row) => positions.get(row));
  together(() => {
    doc.editSource((rows) =>
      rows.forEach((row, index) => {
        const u = values[index];
        if (u !== undefined) row.railU = u;
      }),
    );
    change();
  });
  return true;
};

export const setCameraKeyMuted = (i: number, muted: boolean) =>
  preserveRailPositions([i], () =>
    edit((rows) => {
      rows[i].muted = muted || undefined;
    }),
  );

export const cameraKeyIsAnchored = (key?: CamKey) =>
  !!key && (!Array.isArray(key.p) || !Array.isArray(key.l));

export const editCameraKeyInScene = (
  i: number,
  needsScene: boolean,
  change: (index: number, key: CamKey) => void,
) => {
  const selected = keys[i];
  if (!selected || selected.locked) return;
  if (!needsScene) return change(i, selected);
  void readSceneFrame(cameraKeyFrameTime(i), () => {
    const at = keys.findIndex((row) => row.id === selected.id && row.t === selected.t);
    if (at >= 0 && !keys[at].locked) change(at, keys[at]);
  }).catch(showError);
};

const viewFromFree = (): CameraView => {
  const f = S.tools!.free;
  const touched = get().freeTouched;
  return {
    p: vectorPoint(f.p),
    l: vectorPoint(f.l),
    fov: Math.round(f.fov * 10) / 10,
    ...(f.roll ? { roll: Math.round(f.roll * 1e4) / 1e4 } : touched.roll ? { roll: 0 } : {}),
    ...(f.wave ? { wave: r3(f.wave) } : touched.wave ? { wave: 0 } : {}),
    ...(f.bob ? { bob: r3(f.bob) } : touched.bob ? { bob: 0 } : {}),
    ...(f.fstop ? { fstop: r3(f.fstop) } : touched.fstop ? { fstop: 0 } : {}),
    ...(f.focus !== undefined
      ? { focus: structuredClone(f.focus) }
      : touched.focus
        ? { focus: null }
        : {}),
    ...(f.handheld
      ? { handheld: structuredClone(f.handheld) }
      : touched.handheld
        ? { handheld: false }
        : {}),
  };
};
const withFraming = (key: CamKey, view: CameraView) => {
  const tools = S.tools!;
  const aspect = lensAspectAt(key.t);
  const saved = replaceCameraFraming(key, view, aspect, tools.moveCameraAnchor);
  if (saved) {
    if (key.fov !== undefined) key.fov = r3(fovForStorage(view.fov, key.t));
    if (view.roll !== undefined) {
      if (view.roll) key.roll = view.roll;
      else delete key.roll;
    }
    if (view.wave !== undefined) key.wave = view.wave;
    if (view.bob !== undefined) {
      if (view.bob) key.bob = view.bob;
      else delete key.bob;
    }
    if (view.fstop !== undefined) {
      if (view.fstop > 0) key.fstop = view.fstop;
      else delete key.fstop;
    }
    if ("focus" in view) {
      const norm = normalizeFocusSpec(view.focus);
      if (norm === undefined) delete key.focus;
      else key.focus = norm;
    }
    if ("handheld" in view) {
      if (view.handheld === false) delete key.handheld;
      else key.handheld = structuredClone(view.handheld);
    }
  }
  return saved;
};
const capturedKey = (t: number, view: CameraView, before?: CamKey, incoming?: CamKey) => {
  const previous: Partial<CamKey> = before ?? {};
  const {
    id: _id,
    cut: _cut,
    tailId: _tail,
    ease: _ease,
    matchSpeed: _match,
    easeChannels: _channels,
    motion: _motion,
    __timing: _timing,
    locked: _locked,
    muted: _muted,
    inHandle: _incoming,
    outHandle: _outgoing,
    railU: _rail,
    reason: _reason,
    ...fields
  } = structuredClone(previous);
  const key: CamKey = { ...fields, ...view, id: newRowId(), t };
  if (before) {
    key.p = before.p;
    key.l = before.l;
  }
  if (incoming && !incoming.cut) {
    key.motion = incoming.motion;
    key.ease = structuredClone(incoming.ease);
    key.easeChannels = structuredClone(incoming.easeChannels);
  }
  return withFraming(key, view) ? key : null;
};
const anchorUnavailable = () =>
  say(
    "This film cannot move the camera anchor. Choose a fixed point or provide a camera anchor editor.",
  );

const insertKey = (t: number, view: CameraView, free?: CameraView) => {
  const next = keys.findIndex((k) => k.t > t);
  const i = next < 0 ? keys.length : next;
  const key = capturedKey(t, view, keys[i - 1], keys[i]);
  if (!key || (free && !withFraming(key, free))) return anchorUnavailable();
  if (!preserveRailPositions([i - 1], () => edit((ks) => ks.splice(i, 0, key)))) return;
  selectPlacement(key.id, t);
  say(`Camera keyframe added at ${stamp(t)}. Ctrl+Z to undo`);
};
export const saveView = (only?: number) => {
  if (!S.tools?.free.on) {
    say("Turn on Free camera (F) and frame the shot first");
    return;
  }
  const t = r3(S.t),
    view = viewFromFree();
  const at = only ?? selectedCameraKeyAt(keys, S.t, get().camKey, SAME);
  if (SHOTS_OUT[shotIndex(at >= 0 ? cameraKeyFrameTime(at) : t)]?.camera?.rail)
    return say("The rail sets camera position. Remove it to use a free camera view");
  if (at >= 0) {
    if (keys[at].locked) return say("Unlock this camera keyframe first");
    editCameraKeyInScene(at, cameraKeyIsAnchored(keys[at]), (i, current) => {
      const next = structuredClone(current);
      if (!withFraming(next, view)) return anchorUnavailable();
      edit((ks) => {
        ks[i] = next;
      });
      selectPlacement(next.id, next.t);
      say("Camera keyframe updated at " + stamp(next.t));
    });
  } else {
    insertKey(t, drawnView(), view);
  }
};
export const applyFreeToKeyframe = saveView;
export const addKeyHere = () => {
  if (S.tools?.free.on) saveView();
  else if (S.tools && keyAt(S.t) < 0) insertKey(r3(S.t), drawnView());
};
// ---------- A cut moved (a roll edit): the shot before ends sooner or later and the one after starts with it; nothing in the film
// moves, only where the picture changes camera. The shot's start in shots.json moves with its cut key (one undo step for both),
// and so does the last key of the shot before when it sits on the cut (its framing held up to the cut, a frame or less before)
export const tailOf = (i: number) => cameraTailIndex(keys, i, SAME * 2);

// On a split cut, target the paired closing keyframe right before the cut so easing into the split remains editable.
export const easeKeyIndex = (i: number) => {
  const k = keys[i];
  if (!k) return -1;
  if (k.cut) {
    if (isHardCut(i)) return -1;
    const tail = tailOf(i);
    return tail > 0 && !keys[tail].cut ? tail : -1;
  }
  return i > 0 ? i : -1;
};
export const shotOfCut = (i: number) => {
  const shot = boundaryOf(i);
  return shot >= 0 && Math.abs(SHOTS_OUT[shot].t - keys[i].t) < SAME ? shot : -1;
};
export const rollable = (i: number) =>
  get().shots && shotOfCut(i) > 0 && !keys[i]?.locked && !keys[tailOf(i)]?.locked;
export const rollRoom = (i: number): [number, number] => {
  const tail = tailOf(i),
    before = keys[(tail >= 0 ? tail : i) - 1];
  const margin = keys[i].tailId === false ? 0 : SAME * 3;
  return [before.t + margin, keys[i + 1] ? keys[i + 1].t - SAME : DURATION - SAME];
};
type Apply<T> = (change: (d: T) => void) => void;
const setHits = (row: ShotRow, hits: ShotHit[] | undefined) => {
  if (hits) row.hits = hits;
  else delete row.hits;
};
const applyShotAndCamera = (
  shotEdit: () => void,
  applyCamera: typeof edit,
  cameraEdit: (ks: CamKey[], usePictureCut: boolean) => void,
) => {
  const clock = clockForTimeline("cam");
  if (clock.cameraPicture) {
    shotEdit();
    applyCamera((ks) => cameraEdit(ks, true), clock);
  } else {
    applyCamera((ks) => cameraEdit(ks, false));
    shotEdit();
  }
};

const ambiguousCut = (at: number) => {
  const picture = clockForTimeline("cam").cameraPicture;
  return picture && !canPlaceCameraCut(picture, at);
};

const rollWith = (i: number, t: number, cam: typeof edit, shots: Apply<ShotRow[]>) => {
  if (!rollable(i)) return;
  const s = shotOfCut(i),
    tail = tailOf(i),
    [lo, hi] = rollRoom(i),
    at = r3(Math.max(lo, Math.min(hi, t))),
    was = keys[i].t,
    cutSource = r3(toSource(at));
  if (ambiguousCut(at)) return say("Move the cut to a playing frame");
  applyShotAndCamera(
    () =>
      shots((sh) => {
        if (!sh[s]) return;
        sh[s].t = cutSource;
        if (s > 0 && sh[s - 1]) {
          const { prev, next } = repartitionAdjacentHits(sh[s - 1].hits, sh[s].hits, cutSource);
          setHits(sh[s - 1], prev);
          setHits(sh[s], next);
        }
      }),
    cam,
    (ks, usePictureCut) => {
      const next = usePictureCut ? SHOTS_OUT[s].t : at;
      if (tail >= 0)
        ks[tail].t = usePictureCut ? ks[tail].t + next - was : r3(ks[tail].t + next - was);
      ks[i].t = next;
    },
  );
};
const speechAtCut = (t: number) =>
  S.voiceOut.flatMap((line) => line.words).find((word) => word.s < t && t < word.e)?.w;
export const rollCut = (i: number, t: number) => {
  const shot = shotOfCut(i);
  const was = SHOTS_OUT[shot]?.t;
  together(() => rollWith(i, t, edit, shotsDoc.edit));
  const at = SHOTS_OUT[shot]?.t;
  if (at !== undefined && at !== was) {
    const word = speechAtCut(at);
    if (word) say("Cut crosses the spoken word “" + word + "”");
  }
};
export const previewRoll = (i: number, t: number) => rollWith(i, t, preview, shotsDoc.preview);

// ---------- Split and merge (CapCut's Split, B). Splitting at the playhead changes nothing on screen: the first half keeps its move
// up to a key a millisecond before the cut (the film's own tails sit there too), and the second half starts on the same picture,
// from the free camera's view when it is on. The new shot copies the old one's fields (how the film draws it). Merging is the
// reverse: the cut, its tail and the shot go, and the camera glides from one shot's keys into the other's
const TAIL = 0.001;
// The film's own draw with the free camera off, for its camera alone: no overlays (picture/render.ts) on a frame nobody sees
const drawnView = (): CameraView => {
  const tools = S.tools!;
  const was = tools.free.on;
  tools.free.on = false;
  try {
    S.render!(S.t);
    return (
      tools.cameraSample?.() ?? {
        p: vectorPoint(tools.camera.position),
        l: vectorPoint(tools.look),
        fov: tools.camera.fov,
      }
    );
  } finally {
    tools.free.on = was;
    S.dirty = true;
  }
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
    s < 0 ||
    t < SAME * 3 ||
    t > DURATION - SAME * 3 ||
    keys.some((k) => k.cut && Math.abs(k.t - t) < SAME * 3) ||
    Math.abs(SHOTS_OUT[s].t - t) < SAME * 3
  ) {
    say("A shot starts or ends here already. Move the playhead");
    return;
  }
  if (ambiguousCut(t)) return say("Move the playhead to a playing frame to split the shot");
  const free = S.tools?.free.on ? viewFromFree() : undefined;
  const here = drawnView();
  const i = keys.findIndex((k) => k.t > t);
  const at = i < 0 ? keys.length : i;
  const before = keys[at - 1];
  const reuseKey = !!before && Math.abs(before.t - t) < 1e-6;
  if (reuseKey && before.locked && clockForTimeline("cam").cameraPicture)
    return say("Unlock this camera keyframe before splitting at its time");
  const tail = reuseKey
    ? null
    : capturedKey(Math.max(before?.t ?? 0, r3(t - TAIL)), here, before, keys[at]);
  const start = capturedKey(t, here, before);
  if ((!reuseKey && !tail) || !start || (free && !withFraming(start, free)))
    return anchorUnavailable();
  start.cut = true;
  start.tailId = tail?.id ?? false;
  const splitSource = r3(toSource(t));
  if (
    !preserveRailPositions([at - 1], () =>
      together(() =>
        applyShotAndCamera(
          () =>
            shotsDoc.edit((sh) => {
              const { t: _t, name, transition: _transition, hits, ...rest } = sh[s];
              const { before, after } = splitShotHits(hits, splitSource);
              setHits(sh[s], before);
              sh.splice(s + 1, 0, {
                ...structuredClone(rest),
                ...(after ? { hits: after } : {}),
                id: newRowId(),
                t: splitSource,
                name: secondName(name ?? `Shot ${s}`, sh),
              });
            }),
          edit,
          (ks, usePictureCut) => {
            if (usePictureCut) {
              start.t = SHOTS_OUT[s + 1].t;
              if (reuseKey) ks[at - 1].t = start.t;
              if (tail) tail.t = Math.min(tail.t, start.t);
            }
            ks.splice(at, 0, ...(tail ? [tail, start] : [start]));
          },
        ),
      ),
    )
  )
    return;
  selectPlacement(start.id, start.t);
  const word = speechAtCut(start.t);
  if (word)
    return say("Shot split at " + stamp(start.t) + ". The cut crosses “" + word + "”.", 6000);
  say(
    `Shot ${s} split at ${stamp(t)}.${free ? "" : " Frame the new shot with Free camera (F)."}`,
    6000,
  );
};
const mergeShot = (i: number) => {
  const s = shotOfCut(i),
    tail = tailOf(i);
  if (keys[tail]?.locked) return say("Unlock the outgoing keyframe before merging");
  if (s <= 0) {
    say("This cut has no shot of its own in shots.json. Ask the AI in a note");
    return;
  }
  if (
    !preserveRailPositions([i - 1, i], () =>
      together(() =>
        applyShotAndCamera(
          () =>
            shotsDoc.edit((sh) => {
              const removed = sh[s];
              if (s > 0) setHits(sh[s - 1], mergeShotHits(sh[s - 1].hits, removed?.hits));
              sh.splice(s, 1);
            }),
          edit,
          (ks) => {
            ks.splice(i, 1);
            if (tail >= 0) ks.splice(tail, 1);
          },
        ),
      ),
    )
  )
    return;
  set(transitionSelection({ kind: "clearShots" }, get().side));
  say(`Shots ${s - 1} and ${s} merged. Ctrl+Z to undo`);
};
