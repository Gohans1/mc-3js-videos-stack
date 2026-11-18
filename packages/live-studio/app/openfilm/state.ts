import type { OpenFilmItem, OpenFilmRecipe } from "film-stage/openfilm";
import { registerOpenFilm } from "film-stage/openfilm";
import type { OpenFilmTemplate } from "film-stage/openfilm-recipes";
import { create } from "zustand";

import { OpenFilmTimeline as TimelineSchema } from "../../src/contract";
import { timingPlan } from "../../src/linkage.mjs";
import { clockForTimeline, timing, timingClock } from "../../src/timing-state.mjs";
import type { LayerHistory } from "../../src/timing.mjs";
import { lightItems } from "../activity/timeline-activity";
import { S } from "../core/state";
import { createTimedDoc } from "../core/timed-doc";
import { loadOpenFilmCatalog, setOpenFilmTimeline } from "./render";

export interface Recipe extends OpenFilmRecipe {
  about?: string;
  poster?: string;
  sample?: string;
  props?: { name: string; type: string; at?: string; var?: string }[];
  children?: Recipe[];
  clips?: OpenFilmTemplate["clips"];
}
export type OverlayItem = OpenFilmItem & {
  timebase?: LayerHistory & { sourceDuration: number };
  __timing?: unknown;
};
interface OverlayTimeline {
  items: OverlayItem[];
}
interface Doc {
  revision: number;
  data: OverlayTimeline;
}
export const overlayBasis = () =>
  structuredClone(
    clockForTimeline("openfilm").timebase ?? {
      base: timingPlan(timing),
      changes: [],
      sourceDuration: timingClock.sourceDuration,
    },
  );
export const useOpenFilm = create<{
  catalog: Recipe[];
  loaded: boolean;
  doc: Doc;
  selected: string | null;
  error: string;
  busy: boolean;
}>(() => ({
  catalog: [],
  loaded: false,
  doc: { revision: 0, data: { items: [] } },
  selected: null,
  error: "",
  busy: false,
}));
export const openFilmDoc = createTimedDoc<OverlayTimeline>("openfilm", {
  label: "overlays",
  changed: () => {
    const previous = useOpenFilm.getState();
    useOpenFilm.setState({
      doc: { revision: previous.doc.revision + 1, data: openFilmDoc.data ?? { items: [] } },
    });
    setOpenFilmTimeline(openFilmDoc.source ?? { items: [] });
    S.dirty = true;
  },
  received: (before, after) => lightItems("openfilm", before.items, after.items, (item) => item.id, (i) => {
    const { id, from, to } = openFilmDoc.data!.items[i];
    return { key: id, range: [from, to] };
  }),
  saved: (state) => useOpenFilm.setState({ busy: state === "busy" }),
});

export async function readOpenFilm() {
  await openFilmDoc.load();
  return useOpenFilm.getState().doc;
}
export async function loadOpenFilmAssets() {
  const catalog = (await loadOpenFilmCatalog()) as Recipe[];
  registerOpenFilm(catalog);
  useOpenFilm.setState({ catalog, loaded: true });
  return catalog;
}
export async function loadOpenFilm() {
  await loadOpenFilmAssets();
  await readOpenFilm();
}
export async function saveOpenFilm(items: OverlayItem[]) {
  TimelineSchema.parse({ items });
  if (!openFilmDoc.data) await readOpenFilm();
  openFilmDoc.edit((data) => {
    data.items = items;
  });
}
