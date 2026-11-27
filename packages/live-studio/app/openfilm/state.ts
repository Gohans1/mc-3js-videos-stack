import type { OpenFilmItem, OpenFilmRecipe } from "film-stage/openfilm";
import { registerOpenFilm } from "film-stage/openfilm";
import type { OpenFilmTemplate } from "film-stage/openfilm-recipes";
import { create } from "zustand";

import { OpenFilmTimeline as TimelineSchema } from "../../src/contract";
import { timingPlan } from "../../src/linkage.mjs";
import { clockForTimeline, timing, timingClock } from "../../src/timing-state.mjs";
import type { LayerHistory } from "../../src/timing.mjs";
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
export type OpenFilmSelection =
  | { kind: "none" }
  | { kind: "item"; id: string }
  | { kind: "element"; id: string; selector: string };

export type OpenFilmCatalogState =
  | { status: "loading"; recipes: Recipe[] }
  | { status: "ready"; recipes: Recipe[] }
  | { status: "error"; recipes: Recipe[]; message: string };

export const useOpenFilm = create<{
  catalogState: OpenFilmCatalogState;
  doc: Doc;
  selection: OpenFilmSelection;
  busy: boolean;
}>(() => ({
  catalogState: { status: "loading", recipes: [] },
  doc: { revision: 0, data: { items: [] } },
  selection: { kind: "none" },
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
    S.finalAt = -1;
  },
  saved: (state) => useOpenFilm.setState({ busy: state === "busy" }),
});

export async function readOpenFilm() {
  await openFilmDoc.load();
  return useOpenFilm.getState().doc;
}
let catalogLoadSeq = 0;
export async function loadOpenFilmAssets() {
  const seq = ++catalogLoadSeq;
  const prev = useOpenFilm.getState().catalogState;
  useOpenFilm.setState({ catalogState: { status: "loading", recipes: prev.recipes } });
  try {
    const catalog = (await loadOpenFilmCatalog()) as Recipe[];
    if (catalogLoadSeq !== seq) return catalog;
    registerOpenFilm(catalog);
    useOpenFilm.setState({ catalogState: { status: "ready", recipes: catalog } });
    return catalog;
  } catch (e) {
    if (catalogLoadSeq !== seq) throw e;
    useOpenFilm.setState({
      catalogState: {
        status: "error",
        recipes: useOpenFilm.getState().catalogState.recipes,
        message: e instanceof Error ? e.message : String(e),
      },
    });
    throw e;
  }
}
export async function loadOpenFilm() {
  const assets = loadOpenFilmAssets();
  const seq = catalogLoadSeq;
  await assets;
  try {
    await readOpenFilm();
  } catch (e) {
    if (catalogLoadSeq !== seq) throw e;
    useOpenFilm.setState((s) => ({
      catalogState: {
        status: "error",
        recipes: s.catalogState.recipes,
        message: e instanceof Error ? e.message : String(e),
      },
    }));
    throw e;
  }
}
export async function saveOpenFilm(items: OverlayItem[]) {
  TimelineSchema.parse({ items });
  if (!openFilmDoc.data) await readOpenFilm();
  openFilmDoc.edit((data) => {
    data.items = items;
  });
}
