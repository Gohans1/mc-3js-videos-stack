import { EDIT } from "film/edit";
import { DURATION } from "film/scene";
import type { AdjustmentFile, AdjustmentLayer } from "film-stage/grade-layers";
import { createDoc } from "../core/doc";
import { S } from "../core/state";
import { get, set, showError } from "../core/store";
import { FPS, r3 } from "../core/time";

export const layerItems = () => layersDoc.data?.items ?? [];
export const layerTrack = (track: number) => layersDoc.data?.tracks?.[track] ?? {};
export const layerLocked = (id: string) => !!layerTrack(layerItems().find((it) => it.id === id)?.track ?? 0).lock;
const changed = () => {
  const data = layersDoc.data ?? { items: [] };
  (EDIT as Record<string, unknown>).adjustments = structuredClone(data);
  S.dirty = true; S.finalAt = -1;
  set({ layersRev: get().layersRev + 1, layerPicks: get().layerPicks.filter((id) => data.items.some((it) => it.id === id)) });
  void S.render?.adjustments?.prepare(data.items.map((it) => it.grade)).then(() => { S.dirty = true; S.finalAt = -1; }).catch(showError);
};
export const layersDoc = createDoc<AdjustmentFile>("adjustment", { label: "adjustment layers", changed, saved: (layersSaved) => set({ layersSaved }) });
export const loadLayers = async () => set({ layers: !!(await layersDoc.load()) });
export const pickLayers = (ids: string[]) => {
  const layerPicks = [...new Set(ids)].filter((id) => layerItems().some((it) => it.id === id));
  set(layerPicks.length ? { layerPicks, side: "adjust", camKey: null, camPicks: [], shotPick: null, textPicks: [], clips: [], clip: null, keyPicks: [], object: null } : { layerPicks });
  S.dirty = true;
};
export const layerRoom = (ids: string[]): [number, number] => {
  const list = layerItems().filter((it) => ids.includes(it.id));
  return [-Math.min(...list.map((it) => it.from)), DURATION - Math.max(...list.map((it) => it.to))];
};
export const shiftLayers = (ids: string[], d: number) => (f: AdjustmentFile) => {
  for (const it of f.items) if (ids.includes(it.id) && !layerLocked(it.id)) { it.from = r3(it.from + d); it.to = r3(it.to + d); }
};
export const freeLayerTrack = (list: AdjustmentLayer[], from: number, to: number, track = 0, skip: string[] = []): number => {
  let k = Math.max(0, track);
  while (layerTrack(k).lock || list.some((it) => !skip.includes(it.id) && it.track === k && from < it.to - .001 && to > it.from + .001)) k++;
  return k;
};
export const addLayer = (from = S.t) => {
  if (!get().layers || !S.render?.adjustments) return;
  const id = crypto.randomUUID(), to = Math.min(DURATION, from + 5);
  if (to - from < 1 / FPS) return;
  layersDoc.edit((f) => f.items.push({ id, name: "Adjustment", from: r3(from), to: r3(to), track: freeLayerTrack(f.items, from, to), grade: {} }));
  pickLayers([id]);
};
export const removeLayers = (ids: string[]) => {
  const removing = ids.filter((id) => !layerLocked(id));
  if (removing.length) layersDoc.edit((f) => { f.items = f.items.filter((it) => !removing.includes(it.id)); });
};
export const splitLayers = (ids: string[], t = S.t) => {
  const candidates = layerItems().filter((it) => ids.includes(it.id) && !layerLocked(it.id) && t > it.from + 1 / FPS && t < it.to - 1 / FPS).map((it) => it.id);
  if (!candidates.length) return;
  const made: string[] = [];
  layersDoc.edit((f) => {
    for (const it of f.items.filter((it) => candidates.includes(it.id))) {
      const id = crypto.randomUUID(); f.items.push({ ...structuredClone(it), id, from: r3(t) }); it.to = r3(t); made.push(it.id, id);
    }
  });
  if (made.length) pickLayers(made);
};
export const pasteLayers = (items: AdjustmentLayer[], delta: number) => {
  const ids: string[] = [];
  layersDoc.edit((f) => {
    for (const original of items) {
      const from = Math.max(0, original.from + delta), to = Math.min(DURATION, original.to + delta);
      if (to - from < 1 / FPS) continue;
      const id = crypto.randomUUID(); ids.push(id);
      f.items.push({ ...structuredClone(original), id, from: r3(from), to: r3(to), track: freeLayerTrack(f.items, from, to, original.track) });
    }
  });
  return ids;
};

export const trimLayers = (ids: string[], side: "left" | "right", t = S.t) => {
  const eligible = layerItems().filter((it) => ids.includes(it.id) && !layerLocked(it.id) && t > it.from + 1 / FPS && t < it.to - 1 / FPS).map((it) => it.id);
  if (eligible.length) layersDoc.edit((f) => { for (const it of f.items) if (eligible.includes(it.id)) it[side === "left" ? "from" : "to"] = r3(t); });
};
