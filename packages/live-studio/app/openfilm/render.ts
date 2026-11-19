import {
  makeOpenFilmLayers,
  type OpenFilmRecipe,
  type OpenFilmTimeline,
  registerOpenFilm,
} from "film-stage/openfilm";
import type { Draw, FrameOptions } from "film/scene";

import { overlayTime } from "../../src/layer-timing.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
import type { OverlayItem } from "./state";

let catalog: Promise<OpenFilmRecipe[]> | undefined;
let currentTimeline: OpenFilmTimeline | null = null;
const timelineListeners = new Set<(data: OpenFilmTimeline) => void>();
export function setOpenFilmTimeline(data: OpenFilmTimeline) {
  currentTimeline = data;
  for (const listener of timelineListeners) listener(data);
}
export const loadOpenFilmCatalog = () =>
  (catalog ??= fetch("/_openfilm/catalog").then(async (res) => {
    if (!res.ok) throw new Error(`OpenFilm catalog: HTTP ${res.status}`);
    return res.json();
  }));
export async function prepareOpenFilm(
  shots: { transition?: { fx: string } }[],
  timeline: OpenFilmTimeline,
) {
  const used = timeline.items.length > 0 || shots.some((s) => s.transition?.fx.startsWith("of:"));
  if (!used) return [];
  const recipes = await loadOpenFilmCatalog();
  registerOpenFilm(recipes);
  return recipes;
}

export function withOpenFilm(
  draw: Draw,
  timeline: OpenFilmTimeline,
  recipes: OpenFilmRecipe[],
  hasTransitions: () => boolean,
) {
  timeline = currentTimeline ?? timeline;
  const renderer = draw.tools?.renderer;
  let layers: ReturnType<typeof makeOpenFilmLayers> | undefined;
  const asyncDraw = draw as Draw & {
    prepareFrame?: (t: number) => Promise<void>;
    renderFrame?: (t: number) => void | Promise<void>;
  };
  const drawFrame = asyncDraw.renderFrame?.bind(draw) ?? ((t: number, options?: FrameOptions) => Promise.resolve(draw(t, options)));
  const changed = (data: OpenFilmTimeline) => {
    timeline = data;
  };
  timelineListeners.add(changed);
  let queue = Promise.resolve();
  return Object.assign(draw, {
    inspectOpenFilm: () => layers?.inspect() ?? [],
    renderFrame(t: number, options?: FrameOptions) {
      const render = async () => {
        if (hasTransitions()) {
          if (!recipes.length) {
            recipes = await loadOpenFilmCatalog();
            registerOpenFilm(recipes);
          }
          if (asyncDraw.needsPreparation?.(t) ?? true) {
            await drawFrame(t, options);
            await asyncDraw.prepareFrame?.(t);
          }
        }
        await drawFrame(t, options);
        if (timeline.items.length) {
          if (!renderer)
            throw new Error("OpenFilm requires draw.tools.renderer (Three.js WebGLRenderer)");
          if (!recipes.length) recipes = await loadOpenFilmCatalog();
          layers ??= makeOpenFilmLayers(
            renderer,
            recipes.flatMap((r) => [
              r,
              ...((r as OpenFilmRecipe & { children?: OpenFilmRecipe[] }).children ?? []),
            ]),
          );
          await layers.render(timeline.items, t, (item) =>
            overlayTime(clockForTimeline("openfilm"), t, item as OverlayItem),
          );
        } else if (layers) {
          layers.dispose();
          layers = undefined;
        }
      };
      const next = queue.then(render);
      queue = next.catch(() => {});
      return next;
    },
    disposeOpenFilm() {
      timelineListeners.delete(changed);
      layers?.dispose();
    },
  });
}
