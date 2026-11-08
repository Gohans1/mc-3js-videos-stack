// The film's shots as data (package.json "live-studio".shotsTimeline), edited by hand like the camera keys (doc.ts: undo, saving,
// an agent's edit wins): a cut moved on the camera row (cam.ts rollCut), a shot renamed in the Camera tab. Each change puts a fresh
// copy in EDIT.shots and runs the film's applyEdit, which rebuilds SHOTS and SHOTS_OUT from it in place.
import { EDIT } from "film/edit";
import { createDoc } from "../core/doc";
import { S } from "../core/state";
import { get, set } from "../core/store";
import { refreshTimes } from "../timeline/timeline";

export interface ShotRow { t: number; name?: string; [k: string]: unknown }

const changed = () => {
  const data = doc.data ?? [];
  (EDIT as Record<string, unknown>).shots = structuredClone(data);
  S.comments = data.map((s) => s.name ?? "");
  S.finalAt = -1;
  refreshTimes();
  set({ shotsRev: get().shotsRev + 1 });
};
const doc = createDoc<ShotRow[]>("shots", { label: "shots", changed, saved: (shotsSaved) => set({ shotsSaved }) });
export const shotsDoc = doc;
export const loadShots = async () => { set({ shots: !!(await doc.load()) }); };
export const renameShot = (i: number, name: string) => doc.edit((s) => { s[i].name = name; });
