// The film inside the studio's Vite build: the names the page imports it by, and one copy of three.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { STUDIO } from "./film.mjs";
import { OPENFILM_FILE } from "./openfilm.mjs";

export const filmPlugin = (film) => {
  const project = dirname(film.SRC),
    pkgFile = join(project, "package.json");
  const timingRel = existsSync(pkgFile)
    ? JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"]?.timingTimeline
    : null;
  const timingFile = film.timing?.FILE ?? (timingRel ? join(project, timingRel) : null);
  const openfilmFile = join(
    project,
    (existsSync(pkgFile)
      ? JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"]?.openfilmTimeline
      : null) ?? OPENFILM_FILE,
  );
  const sceneId = "virtual:live-studio/scene",
    editId = "virtual:live-studio/edit";
  const file = (p) => JSON.stringify(p.replaceAll("\\", "/"));
  return {
    name: "live-studio-film",
    enforce: "pre",
    config: () => ({
      resolve: {
        alias: [
          { find: /^film\/scene$/, replacement: sceneId },
          ...(timingFile ? [{ find: /^film\/edit$/, replacement: editId }] : []),
          { find: /^film\/(.*)$/, replacement: join(film.SRC, "$1") },
          { find: /^live-studio\/edit$/, replacement: join(STUDIO, "src/edit.ts") },
        ],
      },
    }),
    // Asked for by name from the folder that has it, not aliased to a path: an alias skips three's exports map, and
    // three/addons, three/webgpu and three/tsl stop resolving
    async resolveId(source, importer, options) {
      if (source === sceneId || source === editId) return `\0${source}`;
      if (!/^three(\/|$)/.test(source) || options?.custom?.oneThree) return null;
      return this.resolve(source, join(film.threeFrom, "package.json"), {
        ...options,
        skipSelf: true,
        custom: { ...options?.custom, oneThree: true },
      });
    },
    load(id) {
      if (id === `\0${sceneId}`) {
        if (existsSync(openfilmFile)) this.addWatchFile(openfilmFile);
        const initial = existsSync(openfilmFile)
          ? JSON.parse(readFileSync(openfilmFile, "utf8"))
          : { items: [] };
        const native = `
        import { prepareOpenFilm, withOpenFilm } from ${file(join(STUDIO, "app/openfilm/render.ts"))};
        const openfilm = ${JSON.stringify(initial).replaceAll("<", "\\u003c")};
        const nativeCuts = () => source.SHOTS_OUT.some(s => s.transition?.fx?.startsWith('of:'));
        `;
        if (!timingFile)
          return `
          import * as source from ${file(join(film.SRC, "scene.ts"))};
          export * from ${file(join(film.SRC, "scene.ts"))};
          ${native}
          export async function buildScene(...args) {
            const recipes = await prepareOpenFilm(source.SHOTS_OUT, openfilm);
            return withOpenFilm(await source.buildScene(...args), openfilm, recipes, nativeCuts);
          }
        `;
        return `
        import * as source from ${file(join(film.SRC, "scene.ts"))};
        import initial from ${file(timingFile)};
        import { timing, timingClock, layerDuration, setTiming, timedDraw } from ${file(join(STUDIO, "src/timing-state.mjs"))};
        export * from ${file(join(film.SRC, "scene.ts"))};
        ${native}
        export const SHOTS_OUT = [];
        export let DURATION = 0;
        setTiming(initial, source.DURATION);
        export function applyEdit() {
          source.applyEdit?.();
          setTiming(timing, source.DURATION);
          DURATION = Math.max(1 / 30, timingClock.duration, layerDuration());
          SHOTS_OUT.splice(
            0,
            SHOTS_OUT.length,
            ...source.SHOTS_OUT.map((s) => ({
              ...s,
              t: timingClock.outputAt(s.t, "before"),
              ...(Array.isArray(s.hits)
                ? { hits: s.hits.map((h) => ({ ...h, t: timingClock.outputAt(h.t, "after") })) }
                : {}),
            })),
          );
        }
        applyEdit();
        export async function buildScene(...args) {
          const recipes = await prepareOpenFilm(source.SHOTS_OUT, openfilm);
          return withOpenFilm(timedDraw(await source.buildScene(...args)), openfilm, recipes, nativeCuts);
        }
      `;
      }
      if (id === `\0${editId}`)
        return `
        import ${JSON.stringify(sceneId)};
        import * as source from ${file(join(film.SRC, "edit.ts"))};
        import { timingClock } from ${file(join(STUDIO, "src/timing-state.mjs"))};
        export * from ${file(join(film.SRC, "edit.ts"))};
        export const fromSource = t => timingClock.outputAt(source.fromSource(t));
        export const toSource = t => source.toSource(timingClock.sourceAt(t));
      `;
    },
  };
};
