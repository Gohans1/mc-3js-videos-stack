import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";

import * as z from "zod";

import { safePath } from "../../../scripts/openfilm/catalog.mjs";
import { expandTemplate, makeCube, nativeCatalog } from "../../../scripts/openfilm/native.mjs";
import { LOCAL } from "../../../scripts/vault.mjs";
import {
  AdjustmentTimeline,
  OpenFilmLayerShape,
  OpenFilmTimeline,
  SoundTimeline,
} from "./contract.ts";
import { openGrades } from "./grades.mjs";
import { openTimelineFile } from "./timeline_file.mjs";
export { OpenFilmTimeline } from "./contract.ts";
import { placeTransition } from "./asset-timelines.mjs";
import { projectClock } from "./project-clock.mjs";
import { mapTimeline } from "./timing-data.mjs";

export const OPENFILM_FILE = "src/timeline/openfilm.json";
export const OpenFilmUse = OpenFilmLayerShape.omit({ id: true })
  .partial({ from: true, to: true })
  .extend({ shot: z.int().positive().optional() });
const empty = { version: "missing", data: { items: [] } };
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const PageProps = OpenFilmLayerShape.pick({ vars: true, text: true });
export function openFilmHTML(source, input = {}) {
  const props = PageProps.parse(input),
    vars = JSON.stringify(props.vars ?? {}).replaceAll("<", "\\u003c");
  const host = `<script>window.filmHost=true;(()=>{const contexts=window.__openFilmCanvas2D=new Set(),original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){const context=Reflect.apply(original,this,args);if(args[0]==='2d'&&context)contexts.add(context);return context}})();for(const [k,v]of Object.entries(${vars}))document.documentElement.style.setProperty(k,v)</script>`;
  const rewriter = new HTMLRewriter().on("head", {
    element: (element) => element.prepend(host, { html: true }),
  });
  for (const [selector, text] of Object.entries(props.text ?? {}))
    rewriter.on(selector, { element: (element) => element.setInnerContent(text) });
  return rewriter.transform(source);
}
let cached;
export const openFilmCatalog = () =>
  (cached ??= existsSync(join(LOCAL, "openfilm/library/index.json"))
    ? nativeCatalog(join(LOCAL, "openfilm/library"))
    : []);
export function openFilmLut(project, id) {
  const recipe = openFilmCatalog().find((r) => r.id === id && r.render === "look");
  if (!recipe) throw new Error(`Unknown OpenFilm filter: ${id}`);
  return openGrades(join(project, "assets/public")).addLut({
    name: `${recipe.title}.cube`,
    source: makeCube(recipe.grade, recipe.title),
  });
}

export function openOpenFilm(project, conf = {}, options = {}) {
  const clockFor = (kind, fallback = 0) => projectClock(project, conf, kind, fallback, options);
  const timeline = openTimelineFile(
    project,
    conf.openfilmTimeline ?? OPENFILM_FILE,
    OpenFilmTimeline,
  );
  const read = () => timeline.read() ?? structuredClone(empty);
  const check = (base, data) => {
    const problem = timeline.check(base, data);
    if (problem) return problem;
    const known = new Set(
      openFilmCatalog()
        .flatMap((r) => [r, ...(r.children ?? [])])
        .filter((r) => ["page", "motion"].includes(r.render))
        .map((r) => r.id),
    );
    const unknown = data.items
      .filter((it) => !known.has(it.asset))
      .map(
        (it) =>
          `Unknown overlay asset: ${it.asset}; use its native cut/grade lane if it is a transition or filter`,
      );
    return unknown.length ? { problems: unknown } : null;
  };
  const write = (base, data, options) => {
    const problem = check(base, data);
    if (problem) return problem;
    const parsed = OpenFilmTimeline.parse(data);
    mkdirSync(dirname(timeline.FILE), { recursive: true });
    return timeline.write(base, parsed, options);
  };
  const view = () => {
    const current = read();
    const { clock } = clockFor("overlays");
    return { ...current, data: mapTimeline("openfilm", current.data, clock) };
  };
  const edit = (id, props) => {
    const current = read();
    const { clock } = clockFor("overlays");
    const data = mapTimeline("openfilm", current.data, clock);
    if (!data.items.some((it) => it.id === id)) throw new Error(`No overlay layer: ${id}`);
    data.items = data.items.map((it) => (it.id === id ? { ...it, ...props, id } : it));
    const source = mapTimeline("openfilm", data, clock, true, current.data);
    const saved = write(current.version, source);
    if (saved.conflict || saved.problems) throw new Error(JSON.stringify(saved));
    return { ...saved, data: view().data };
  };
  const append = (file, schema, value) => {
    if (!file) throw new Error("This film has no corresponding native timeline configured");
    const lane = openTimelineFile(project, file, schema),
      current = lane.read();
    const data = current?.data ?? { items: [] };
    const result = lane.write(current?.version ?? "", { ...data, items: [...data.items, value] });
    if (result.conflict || result.problems) throw new Error(JSON.stringify(result));
    return { file, value };
  };
  const use = (input) => {
    const request = OpenFilmUse.parse(input),
      recipe = openFilmCatalog().find((r) => r.id === request.asset);
    if (!recipe) throw new Error(`Unknown OpenFilm asset: ${request.asset}`);
    const from = request.from ?? 0,
      to = request.to ?? from + (recipe.durationMs ?? 3000) / 1000;
    if (to <= from) throw new Error("to must follow from");
    if (recipe.cat === "transition")
      return placeTransition(
        project,
        conf,
        {
          fx: `of:${recipe.id}`,
          len: to - from,
          ...((request.vars || request.text) && {
            props: {
              ...(request.vars && { vars: request.vars }),
              ...(request.text && { text: request.text }),
            },
          }),
        },
        request.shot,
        options,
      );
    if (recipe.render === "look") {
      const { basis: timebase } = clockFor("adjustment", to);
      const lut = openFilmLut(project, recipe.id);
      return append(conf.adjustmentTimeline, AdjustmentTimeline, {
        id: randomUUID(),
        name: recipe.title,
        from,
        to,
        track: request.track ?? 0,
        timebase,
        grade: { lut },
      });
    }
    const current = read();
    const { basis } = clockFor("overlays", to);
    if (recipe.render === "group") {
      const plan = expandTemplate(recipe, from, to);
      const applied = plan.items.map((it) => ({ ...it, id: randomUUID(), timebase: basis }));
      const data = { items: [...current.data.items, ...applied] };
      const check = timeline.check(current.version, data);
      if (check) throw new Error(JSON.stringify(check));
      let sound, audio, soundData;
      if (plan.music) {
        if (!conf.soundTimeline)
          throw new Error("This template includes music; configure soundTimeline first");
        sound = openTimelineFile(project, conf.soundTimeline, SoundTimeline);
        audio = sound.read();
        const name = `of-bgm-${plan.music
          .split("/")
          .pop()
          .replace(/\.[^.]+$/, "")}`;
        const { clock } = clockFor("audio", to);
        const bed = mapTimeline(
          "sound",
          { beds: [{ name, from, to, gain: -24, fadeIn: 0.2, fadeOut: 0.5 }], sfx: [] },
          clock,
          true,
        ).beds[0];
        soundData = {
          ...(audio?.data ?? { beds: [], sfx: [] }),
          beds: [...(audio?.data.beds ?? []), bed],
        };
        const bad = sound.check(audio?.version ?? "", soundData);
        if (bad) throw new Error(JSON.stringify(bad));
      }
      const result = write(current.version, data);
      if (result.conflict || result.problems) throw new Error(JSON.stringify(result));
      if (sound) {
        mkdirSync(dirname(sound.FILE), { recursive: true });
        const saved = sound.write(audio?.version ?? "", soundData);
        if (saved.conflict || saved.problems) throw new Error(JSON.stringify(saved));
      }
      return {
        file: conf.openfilmTimeline ?? OPENFILM_FILE,
        ...plan,
        items: applied,
        picture:
          "Slots describe the existing 3D picture; set camera cuts to these times to match the template rhythm.",
      };
    }
    const next = { id: randomUUID(), ...request, from, to, timebase: basis };
    delete next.shot;
    const result = write(current.version, { items: [...current.data.items, next] });
    if (result.conflict || result.problems) throw new Error(JSON.stringify(result));
    return { file: conf.openfilmTimeline ?? OPENFILM_FILE, item: next };
  };
  return { ...timeline, read, check, write, use, view, edit };
}

export function openFilmResource(req) {
  const url = new URL(req.url);
  if (req.method !== "GET") return null;
  if (url.pathname === "/_openfilm/catalog") return Response.json(openFilmCatalog());
  if (url.pathname === "/_openfilm/compositor.html")
    return new Response(
      "<!doctype html><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}</style><script>window.film={frame(){}}</script>",
      { headers: { "content-type": "text/html" } },
    );
  if (!url.pathname.startsWith("/_openfilm/library/")) return null;
  try {
    const file = safePath(
      join(LOCAL, "openfilm/library"),
      decodeURIComponent(url.pathname.slice("/_openfilm/library/".length)),
    );
    if (!existsSync(file)) return new Response("OpenFilm asset not found", { status: 404 });
    let body = readFileSync(file);
    if (extname(file) === ".html")
      body = Buffer.from(
        openFilmHTML(body.toString("utf8"), JSON.parse(url.searchParams.get("_of") ?? "{}")),
      );
    return new Response(body, {
      headers: { "content-type": mime[extname(file)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Invalid OpenFilm path", { status: 400 });
  }
}
