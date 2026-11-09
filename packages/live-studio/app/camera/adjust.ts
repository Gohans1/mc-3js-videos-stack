import type { Grade } from "film-stage/grade";
import { S } from "../core/state";
import { say, set } from "../core/store";
import { shownShot } from "./anim";
import { shotsDoc } from "./shots";

export type GradeLibrary = { luts: { name: string; url: string }[]; presets: { id: string; name: string }[] };
export const gradeOf = (shot: number): Grade => shotsDoc.data?.[shot]?.adjust as Grade ?? {};
export const changeGrade = (shot: number, fn: (grade: Grade) => void, keep = true) => (keep ? shotsDoc.edit : shotsDoc.preview)((rows) => {
  const grade = structuredClone(rows[shot].adjust as Grade ?? {});
  fn(grade); rows[shot].adjust = grade;
});
async function request<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/adjust${url}`, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Could not save adjustments. Try again.");
  return data;
}
export const loadGrades = async () => set({ gradeLibrary: await request<GradeLibrary>("") });
export const putGrade = async (shot: number, grade: Grade) => {
  await S.render?.adjustments?.prepare([grade]);
  shotsDoc.edit((rows) => { rows[shot].adjust = grade; });
};
export const importLut = async (file: File, shot = shownShot()) => {
  if (file.size > 16 * 1024 * 1024) throw new Error("Choose a LUT smaller than 16 MB");
  const lut = await request<NonNullable<Grade["lut"]>>("/lut", { name: file.name, source: await file.text() });
  await loadGrades();
  await putGrade(shot, { ...gradeOf(shot), lut: { ...lut, amount: 100 } });
  say(`${lut.name} applied to shot ${shot}. Ctrl+Z to undo`);
};
export const applyPreset = async (id: string, shot = shownShot()) => {
  const grade = await request<Grade>(`/preset/${id}/apply`, {});
  await putGrade(shot, grade); await loadGrades();
  say(`Preset applied to shot ${shot}. Ctrl+Z to undo`);
};
export const savePreset = async (name: string, grade: Grade) => { await request("/preset", { name, grade }); await loadGrades(); };
