// The film's shots as data (package.json "live-studio".shotsTimeline), edited by hand like the camera keys (doc.ts: undo, saving,
// an agent's edit wins): a cut moved on the camera row (cam.ts rollCut), a shot renamed in the Camera tab. Each change puts a fresh
// copy in EDIT.shots and runs the film's applyEdit, which rebuilds SHOTS and SHOTS_OUT from it in place.
import { equalJson } from "../../src/merge-edits.mjs";
import { lightEdit } from "../activity/activity";
import { changedRows, itemKey } from "../activity/timeline-activity";
import { transitionOf, transitionSpan } from "./transitions";
import { EDIT } from "film/edit";

import { createDoc } from "../core/doc";
import { SHOTS_OUT } from "../core/filmMeta";
import { pruneShotSelection, transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, invalidatePictures, set, showError } from "../core/store";
import { refreshTimes } from "../timeline/timeline";

export interface ShotRow {
  t: number;
  name?: string;
  [k: string]: unknown;
}

const changed = () => {
  const data = doc.data ?? [];
  (EDIT as Record<string, unknown>).shots = structuredClone(data);
  S.comments = data.map((s) => s.name ?? "");
  S.finalAt = -1;
  refreshTimes();
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
      lightEdit("transition", shown.map((i) => itemKey("transition", String(after[i].t))), shown.map((i) => transitionSpan(i)));
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
