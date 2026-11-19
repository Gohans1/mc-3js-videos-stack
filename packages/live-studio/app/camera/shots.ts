// The film's shots as data (package.json "live-studio".shotsTimeline), edited by hand like the camera keys (doc.ts: undo, saving,
// manual edits are protected): a cut moved on the camera row (cam.ts rollCut), a shot renamed in the Camera tab. Each change puts a fresh
// copy in EDIT.shots and runs the film's applyEdit, which rebuilds SHOTS and SHOTS_OUT from it in place.
import type { CameraRig } from "film-stage/camera";
import { EDIT, toSource } from "film/edit";

import { equalJson } from "../../src/merge-edits.mjs";
import type { Shutter } from "../../src/shutter";
import { clockForTimeline } from "../../src/timing-state.mjs";
import { lightEdit } from "../activity/activity";
import { changedRows, itemKey } from "../activity/timeline-activity";
import { createDoc } from "../core/doc";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { pruneShotSelection, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, invalidatePictures, set, showError } from "../core/store";
import { r3 } from "../core/time";
import { refreshTimedDocs } from "../core/timed-doc";
import { refreshTimes } from "../timeline/timeline";
import type { ShotHit } from "./shot-hits";
import { transitionOf, transitionSpan } from "./transitions";

export interface ShotRow {
  id?: string;
  t: number;
  cameraClock?: "scene" | "output";
  camera?: CameraRig;
  shutter?: Shutter;
  name?: string;
  [k: string]: unknown;
}

const changed = () => {
  const data = doc.data ?? [];
  (EDIT as Record<string, unknown>).shots = structuredClone(data);
  S.comments = data.map((s) => s.name ?? "");
  S.finalAt = -1;
  const previousClock = clockForTimeline("cam");
  refreshTimes();
  if (previousClock !== clockForTimeline("cam")) refreshTimedDocs();
  const state = get();
  set({ shotsRev: state.shotsRev + 1, ...pruneShotSelection(state, SHOTS_OUT.length) });
  if (S.render?.adjustments)
    void S.render.adjustments
      .prepare(data.map((s) => s.adjust))
      .then(() => {
        S.dirty = true;
        S.finalAt = -1;
        invalidatePictures();
      })
      .catch(showError);
};
const doc = createDoc<ShotRow[]>("shots", {
  label: "shots",
  changed,
  received: (before, after) => {
    if (!get().aiActivity) return;
    const previous = new Map(before.map((shot) => [shot.t, shot.transition]));
    const changedTransitions = changedRows(before, after, (shot) => String(shot.t)).filter(
      (i) => !equalJson(previous.get(after[i].t), after[i].transition),
    );
    lightEdit("cam");
    if (changedTransitions.length) {
      const shown = changedTransitions.filter((i) => transitionOf(i)).slice(0, 20);
      lightEdit(
        "transition",
        shown.map((i) => itemKey("transition", String(after[i].t))),
        shown.map((i) => transitionSpan(i)),
      );
    }
  },
  saved: (shotsSaved) => set({ shotsSaved }),
  replaced: (was) => {
    if (!was || was.length !== (doc.data?.length ?? 0))
      set(transitionSelection({ kind: "shot", index: null }, get().side));
  },
});
export const shotsDoc = doc;
export const loadShots = async () => {
  set({ shots: !!(await doc.load()) });
};
export const renameShot = (i: number, name: string) =>
  doc.edit((s) => {
    s[i].name = name;
  });

export const setShotCameraClock = (i: number, mode: "scene" | "output") =>
  doc.edit((shots) => {
    if (mode === "output") shots[i].cameraClock = mode;
    else delete shots[i].cameraClock;
  });

export type ShotHitPatch = {
  t?: number;
  amount?: number;
  decay?: number;
  freq?: number;
  seed?: number;
};

const shotSourceBounds = (sh: ShotRow[], i: number): [number, number] => {
  const start = sh[i]?.t ?? 0;
  const end = sh[i + 1]?.t ?? Math.max(start, r3(toSource(DURATION)));
  return [start, end];
};

const normalizeHitList = (raw: unknown): ShotHit[] =>
  Array.isArray(raw)
    ? raw
        .filter((h): h is ShotHit =>
          Boolean(h && typeof h === "object" && typeof (h as { t?: unknown }).t === "number"),
        )
        .map((h) => ({ ...h }))
        .sort((a, b) => a.t - b.t)
    : [];

const writeHits = (row: ShotRow, hits: ShotHit[]) => {
  if (hits.length) row.hits = hits;
  else delete row.hits;
};

export const shotHitsOf = (i: number): ShotHit[] => normalizeHitList(doc.data?.[i]?.hits);

export const shotSourceSpan = (i: number): [number, number] => shotSourceBounds(doc.data ?? [], i);

export const addShotHit = (shot: number, sourceTime: number, amount = 0.6) =>
  doc.edit((sh) => {
    const row = sh[shot];
    if (!row) return;
    const [lo, hi] = shotSourceBounds(sh, shot);
    const t = r3(Math.max(lo, Math.min(hi, sourceTime)));
    const next = normalizeHitList(row.hits);
    next.push({ t, amount: Math.max(0, r3(amount)), decay: 1.5, freq: 14 });
    next.sort((a, b) => a.t - b.t);
    writeHits(row, next);
  });

export const updateShotHit = (
  shot: number,
  hitIndex: number,
  patch: ShotHitPatch,
  apply: typeof doc.edit = doc.edit,
) =>
  apply((sh) => {
    const row = sh[shot];
    if (!row) return;
    const list = Array.isArray(row.hits)
      ? row.hits
          .filter((h): h is ShotHit =>
            Boolean(h && typeof h === "object" && typeof (h as { t?: unknown }).t === "number"),
          )
          .map((h) => ({ ...h }))
      : [];
    const cur = list[hitIndex];
    if (!cur) return;
    const [lo, hi] = shotSourceBounds(sh, shot);
    if (patch.t !== undefined) cur.t = r3(Math.max(lo, Math.min(hi, patch.t)));
    if (patch.amount !== undefined) cur.amount = Math.max(0, r3(patch.amount));
    if (patch.decay !== undefined) cur.decay = Math.max(0.1, r3(patch.decay));
    if (patch.freq !== undefined) cur.freq = Math.max(1, r3(patch.freq));
    if (patch.seed !== undefined) cur.seed = Math.round(patch.seed);
    if (apply === doc.edit) list.sort((a, b) => a.t - b.t);
    writeHits(row, list);
  });

export const removeShotHit = (shot: number, hitIndex: number) =>
  doc.edit((sh) => {
    const row = sh[shot];
    if (!row) return;
    const list = normalizeHitList(row.hits);
    if (!list[hitIndex]) return;
    list.splice(hitIndex, 1);
    writeHits(row, list);
  });
