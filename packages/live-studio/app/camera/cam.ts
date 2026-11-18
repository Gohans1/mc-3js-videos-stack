import type { CameraMotion } from "film-stage/camera";
import { cameraKeyOptics } from "film-stage/camera";
import { EDIT, toSource } from "film/edit";

import { canPlaceCameraCut } from "../../src/camera-clock.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
// The film's camera keys (package.json "live-studio".camTimeline, keys as film-stage/camera.ts reads them), edited by hand on the
// camera row like the sound lanes (doc.ts: undo, saving, manual edits are protected). The film draws from EDIT.cam, so every change
// puts a fresh copy there and the picture follows at once; its caches are keyed on that array, so it is never edited in place.
// A key's time moves only inside its shot. A cut belongs to the film's SHOTS as much as to the camera, so a cut key moves only
// when the film keeps its shots as data (shots.ts), and then both move together (rollCut), and a shot can be split at the playhead
// or merged with the one before (splitShot, removeKey on a cut), CapCut's Split and its undo.
import { lightEdit } from "../activity/activity";
import { together } from "../core/doc";
import type { Ease } from "../core/ease";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set, showError } from "../core/store";
import { r3, SAME, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { readSceneFrame } from "../picture/render";
import {
  type CameraFieldGroup,
  cameraTailIndex,
  type CameraView,
  copyCameraFields,
  keyAtTime,
  replaceCameraFraming,
  selectedCameraKeyAt,
} from "./camera-edit";
import { mergeShotHits, repartitionAdjacentHits, type ShotHit, splitShotHits } from "./shot-hits";
import { type ShotRow, shotsDoc } from "./shots";

export type Point = [number, number, number] | Record<string, unknown>; // a world point, or the film's anchor ({"eye": [...]})
export interface CamKey {
  id?: string;
  __timing?: { source: number; output: number; alias?: string | number };
  t: number;
  p: Point;
  l: Point;
  fov?: number;
  mm?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
  roll?: number;
  wave?: number;
  bob?: number;
  motion?: CameraMotion;
  cut?: boolean;
  tailId?: string | false;
  locked?: boolean;
  reason?: string;
  ease?: Ease;
  [k: string]: unknown;
}

const newRowId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export let keys: CamKey[] = [];
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
  return cameraKeyOptics(rows, at, S.tools?.camera?.aspect || 16 / 9);
};
export const loadCam = async () => {
  set({ cam: !!(await doc.load()) });
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
  edit((ks) => {
    for (const k of ok) {
      delete k.cut;
      delete k.tailId;
      delete k.__timing;
      delete k.locked;
      delete k.reason;
      const on = ks.findIndex((x, i) => i > 0 && Math.abs(x.t - k.t) < SAME);
      if (on > 0) {
        const target = ks[on];
        ks[on] = { ...k, id: target.id ?? newRowId(), __timing: target.__timing };
        continue;
      }
      const i = ks.findIndex((x) => x.t > k.t);
      ks.splice(i < 0 ? ks.length : i, 0, { ...k, id: newRowId() });
    }
  });
  pickCamKeys(
    ok.map((k) => keys.findIndex((x, i) => i > 0 && !x.cut && Math.abs(x.t - k.t) < 1e-6)),
  );
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
export const retime = (i: number, t: number) => {
  const id = keys[i]?.id;
  const [a, b] = room(i);
  const next = r3(Math.max(a, Math.min(b, t)));
  edit((ks) => {
    ks[i].t = next;
  });
  selectPlacement(id, next);
};
// fov in degrees, roll in radians (film-stage turns the picture by it), wave the sway's size (1 the film's own)
export type LensField = "fov" | "mm" | "fstop" | "roll" | "wave" | "bob";
export const writeLens = (key: CamKey, field: LensField, value: number | undefined) => {
  if (field === "fov" && value !== undefined) delete key.mm;
  if (field === "mm" && value !== undefined) delete key.fov;
  if (value === undefined) delete key[field];
  else key[field] = field === "roll" ? Math.round(value * 1e4) / 1e4 : r3(value);
};
export const setLens = (i: number, field: LensField, v: number | undefined) =>
  edit((ks) => {
    writeLens(ks[i], field, v);
  });
export const resetLens = (i: number) =>
  edit((ks) => {
    copyCameraFields({}, ks[i], ["lens", "dof", "shake"]);
    delete ks[i].roll;
  });
export const setEase = (i: number, ease: Ease | undefined) =>
  edit((ks) => {
    if (ease === undefined) delete ks[i].ease;
    else ks[i].ease = ease;
  });
export const pasteKeyAttrs = (from: CamKey, to: number[], what: CameraFieldGroup[]) =>
  edit((ks) => {
    for (const i of to) {
      if (!ks[i] || ks[i].locked) continue;
      copyCameraFields(from, ks[i], movable(i) ? what : what.filter((group) => group !== "speed"));
    }
  });
export const removeKey = (i: number) => {
  if (keys[i]?.locked) return say("Unlock this camera keyframe first");
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
    next = keys[i + 1],
    [, end] = placementRoom(k);
  const t = r3(Math.min(k.t + secs, next ? next.t - SAME * 2 : Infinity, end));
  if (t - k.t < SAME * 2) {
    say("No room before the next keyframe. Move it later first");
    return;
  }
  const id = newRowId();
  edit((ks) => {
    const {
      ease: _,
      cut: __,
      tailId: _tail,
      __timing: _timing,
      locked: _lock,
      reason: _reason,
      ...pose
    } = structuredClone(ks[i]);
    ks.splice(i + 1, 0, { ...pose, id, t, motion: "hold" });
  });
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
  return { p: vectorPoint(f.p), l: vectorPoint(f.l), fov: f.fov };
};
const withFraming = (key: CamKey, view: CameraView) => {
  const tools = S.tools!;
  return replaceCameraFraming(key, view, tools.camera.aspect, tools.moveCameraAnchor);
};
const capturedKey = (t: number, view: CameraView, before?: CamKey, incoming?: CamKey) => {
  const previous: Partial<CamKey> = before ?? {};
  const {
    id: _id,
    cut: _cut,
    tailId: _tail,
    ease: _ease,
    motion: _motion,
    __timing: _timing,
    locked: _locked,
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
  edit((ks) => ks.splice(i, 0, key));
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
export const addKeyHere = () => {
  if (S.tools?.free.on) saveView();
  else if (S.tools && keyAt(S.t) < 0) insertKey(r3(S.t), drawnView());
};
// ---------- A cut moved (a roll edit): the shot before ends sooner or later and the one after starts with it; nothing in the film
// moves, only where the picture changes camera. The shot's start in shots.json moves with its cut key (one undo step for both),
// and so does the last key of the shot before when it sits on the cut (its framing held up to the cut, a frame or less before)
const tailOf = (i: number) => cameraTailIndex(keys, i, SAME * 2);
export const shotOfCut = (i: number) =>
  keys[i]?.cut ? SHOTS_OUT.findIndex((s) => Math.abs(s.t - keys[i].t) < SAME) : -1;
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
export const rollCut = (i: number, t: number) =>
  together(() => rollWith(i, t, edit, shotsDoc.edit));
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
  );
  selectPlacement(start.id, start.t);
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
  );
  set(transitionSelection({ kind: "clearShots" }, get().side));
  say(`Shots ${s - 1} and ${s} merged. Ctrl+Z to undo`);
};
