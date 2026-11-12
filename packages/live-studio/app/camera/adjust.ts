import type { Grade } from "film-stage/grade";

import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { shownShot } from "./anim";
import { layerItems, layerLocked, layersDoc } from "./layers";
import { shotsDoc } from "./shots";

export type GradeLibrary = {
  luts: { name: string; url: string }[];
  presets: { id: string; name: string }[];
};
export type GradeTarget = number | string;
export const gradeTarget = (): GradeTarget => get().layerPicks[0] ?? shownShot();
export const gradeDoc = (target: GradeTarget) =>
  typeof target === "string" ? layersDoc : shotsDoc;
export const gradeOf = (target: GradeTarget): Grade =>
  typeof target === "string"
    ? (layerItems().find((it) => it.id === target)?.grade ?? {})
    : ((shotsDoc.data?.[target]?.adjust as Grade) ?? {});
export const changeGrade = (target: GradeTarget, fn: (grade: Grade) => void, keep = true) => {
  if (typeof target === "string") {
    if (layerLocked(target)) return;
    (keep ? layersDoc.edit : layersDoc.preview)((file) => {
      const it = file.items.find((it) => it.id === target);
      if (it) fn(it.grade);
    });
  } else
    (keep ? shotsDoc.edit : shotsDoc.preview)((rows) => {
      const grade = structuredClone((rows[target].adjust as Grade) ?? {});
      fn(grade);
      rows[target].adjust = grade;
    });
};
export const resetGrade = (target: GradeTarget) =>
  changeGrade(target, (g) => {
    for (const key of Object.keys(g)) delete g[key as keyof Grade];
  });
async function request<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/adjust${url}`, {
    signal: AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Could not save adjustments. Try again.");
  return data;
}
export const loadGrades = async () => set({ gradeLibrary: await request<GradeLibrary>("") });
export const putGrade = async (shot: GradeTarget, grade: Grade) => {
  await S.render?.adjustments?.prepare([grade]);
  changeGrade(shot, (g) => {
    for (const key of Object.keys(g)) delete g[key as keyof Grade];
    Object.assign(g, grade);
  });
};
const targetLabel = (shot: GradeTarget) =>
  typeof shot === "string"
    ? (layerItems().find((it) => it.id === shot)?.name ?? "adjustment layer")
    : `shot ${shot}`;
export const importLut = async (file: File, shot = gradeTarget()) => {
  if (file.size > 16 * 1024 * 1024) throw new Error("Choose a LUT smaller than 16 MB");
  const lut = await request<NonNullable<Grade["lut"]>>("/lut", {
    name: file.name,
    source: await file.text(),
  });
  await loadGrades();
  await putGrade(shot, { ...gradeOf(shot), lut: { ...lut, amount: 100 } });
  set(transitionSelection({ kind: "adjustTarget", target: shot }, get().side));
  say(`${lut.name} applied to ${targetLabel(shot)}. Ctrl+Z to undo`);
};
export const applyPreset = async (id: string, shot = gradeTarget()) => {
  const grade = await request<Grade>(`/preset/${id}/apply`, {});
  await putGrade(shot, grade);
  await loadGrades();
  set(transitionSelection({ kind: "adjustTarget", target: shot }, get().side));
  say(`Preset applied to ${targetLabel(shot)}. Ctrl+Z to undo`);
};
export const savePreset = async (name: string, grade: Grade) => {
  await request("/preset", { name, grade });
  await loadGrades();
};
