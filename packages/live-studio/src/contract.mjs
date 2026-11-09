// The film contract: everything the studio reads from a film, as zod schemas. The server checks the film's JSON files when the
// studio starts and whenever one changes; the page checks the film's module and its draw() once built. Problems are printed in
// the studio's terminal, where the AI working on the film reads them, and shown in the page. docs/film-contract.md explains
// each part. What a schema doesn't name is the film's own (its camera keys, audio, props): loose objects let it through.
import * as z from "zod";
import { RATIOS } from "./frame.mjs";

export const DOC = "live-studio/docs/film-contract.md";

const fn = z.custom((v) => typeof v === "function", "expected a function");
const three = (flag, what) => z.custom((v) => !!v?.[flag], `expected ${what}`);
const time = z.number().refine(Number.isFinite, "expected a finite number of seconds");
const unique = (list) => new Set(list).size === list.length;

// ---------- src/scene.ts
const Shot = z.looseObject({ t: time });
export const SceneModule = z.looseObject({
  buildScene: fn,
  SHOTS: z.array(Shot).min(1),
  SHOTS_OUT: z.array(Shot).min(1),
  DURATION: z.number().positive(),
  applyEdit: fn,
})
  .refine((m) => m.SHOTS_OUT.length === m.SHOTS.length, { error: "SHOTS_OUT must hold one entry per shot in SHOTS", path: ["SHOTS_OUT"] })
  .refine((m) => m.SHOTS_OUT.every((s, i, a) => i === 0 || s.t >= a[i - 1].t), { error: "shots must start in order of time", path: ["SHOTS_OUT"] });

// ---------- What buildScene() resolves to: draw(t), with these attached
export const Tools = z.looseObject({
  scene: three("isObject3D", "the THREE.Scene drawn"),
  camera: three("isCamera", "the THREE camera the film draws with"),
  look: three("isVector3", "a THREE.Vector3: the point the camera looks at"),
  free: z.looseObject({ on: z.boolean(), p: three("isVector3", "a THREE.Vector3"), l: three("isVector3", "a THREE.Vector3"), fov: z.number() }),
  home: z.object({ p: z.tuple([z.number(), z.number(), z.number()]), l: z.tuple([z.number(), z.number(), z.number()]), fov: z.number().optional() }).optional(),
  objects: z.array(z.tuple([three("isObject3D", "a THREE.Object3D"), z.string()])).optional(),
  materials: z.array(z.tuple([three("isMaterial", "a THREE.Material"), z.string()])).optional(),
  // mc-assets/placed.ts makePlaced: what the creator drops into the scene from the Objects library, in one of the film's keyFiles
  placed: z.looseObject({ key: z.string().min(1), root: three("isObject3D", "a THREE.Object3D"), sync: fn, draw: fn, objectOf: fn, nameOf: fn, clipsOf: fn, catalog: fn, icon: fn }).optional(),
});
const Look = z.looseObject({ id: z.string().min(1), title: z.string() });
export const Variant = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  options: z.array(Look).min(2).refine((o) => unique(o.map((x) => x.id)), "option ids must differ").refine((o) => o.every((x) => x.id !== "off"), "\"off\" is the studio's Off chip, not an option id"),
  set: fn,
  pick: Look,
  ranges: z.array(z.tuple([time, time])),
  off: z.boolean().optional(),
});
export const Draw = z.looseObject({
  tools: Tools,
  describe: fn.optional(),
  checks: z.record(z.string(), fn).optional(),
  variants: z.array(Variant).refine((v) => unique(v.map((x) => x.id)), "variant ids must differ").optional(),
  eases: z.record(z.string(), fn).optional(), // the camera keys' named eases (film-stage EASES), drawn in the studio's ease picker
  // film-stage ANIMS: the In, Out and Combo effects the film draws from a shot's "anim", listed in the studio's Animation tab
  anims: z.object(Object.fromEntries(["in", "out", "combo"].map((k) => [k, z.array(z.looseObject({ id: z.string().min(1), title: z.string(), cat: z.string(), tip: z.string() }))]))).optional(),
});

// ---------- src/edit.json: the studio reads the voice, the beats and their sounds. Everything else in it is the film's
const Beat = z.looseObject({ title: z.string(), at: time, dur: z.number().nonnegative(), kind: z.enum(["motion", "sound"]), sounds: z.array(z.tuple([time, z.string(), z.number()])) });
export const Edit = z.looseObject({
  voice: z.looseObject({ edits: z.record(z.string(), z.unknown()), warp: z.array(z.tuple([time, time])) }),
  beats: z.record(z.string(), Beat),
});

// ---------- renders/live/trials.json (written by the film's sound.py) and choices.json (written by the studio)
const Option = z.looseObject({ id: z.string().min(1), title: z.string(), files: z.array(z.string()).min(1) });
const options = z.array(Option).min(2).refine((o) => unique(o.map((x) => x.id)), "option ids must differ").refine((o) => o.every((x) => x.id !== "off"), "\"off\" is the studio's Off chip, not an option id");
const StemGroup = z.looseObject({ title: z.string(), kind: z.literal("stem"), from: time, to: time, options }).refine((g) => g.to > g.from, "to must come after from");
const CueGroup = z.looseObject({ title: z.string(), options, cues: z.array(z.looseObject({ at: time, pick: z.int().nonnegative(), rate: z.number(), gain: z.number() })) });
export const Trials = z.record(z.string(), z.union([StemGroup, CueGroup]));
export const Choices = z.record(z.string(), z.looseObject({ set: z.string(), gain: z.number().positive().optional() }));

// ---------- package.json "live-studio": the paths in it are checked where they are opened (film.mjs); here what has a shape
export const StudioConfig = z.looseObject({ ratio: z.enum(RATIOS).optional() });

// ---------- The sound lanes (package.json "live-studio".soundTimeline), which the studio also writes: beds loop from..to, a
// one-shot plays from at for length seconds or to its end. Gains in dB. Anything else on an entry (filters, try) is the film's
const name = z.string().regex(/^[\w.-]+$/, "a file name in the sfx folder, without .wav");
const secs = time.refine((v) => v >= 0, "expected seconds from the film's start, 0 or more");
const track = z.string().min(1).optional();
const dB = z.number().refine(Number.isFinite, "expected a finite number of dB");
const Bed = z.looseObject({ name, from: secs, to: secs, gain: dB, fadeIn: z.number().nonnegative(), fadeOut: z.number().nonnegative(), start: z.number().nonnegative().optional(), duck: z.number().nonnegative().optional(), track }).refine((b) => b.to > b.from, "to must come after from");
const Shot1 = z.looseObject({ at: secs, name, gain: dB, start: z.number().nonnegative().optional(), length: z.number().positive().optional(), fadeIn: z.number().nonnegative().optional(), fadeOut: z.number().nonnegative().optional(), track });
// tracks (top to bottom) and each entry's track: app/sound/tracks.ts. Optional, the page adds them; mute leaves a track out of the mix
const Track = z.looseObject({ id: z.string().min(1), name: z.string(), mute: z.boolean().optional(), lock: z.boolean().optional() });
export const SoundTimeline = z.looseObject({ beds: z.array(Bed), sfx: z.array(Shot1), tracks: z.array(Track).optional() })
  .refine((l) => !l.tracks || unique(l.tracks.map((t) => t.id)), "track ids must differ")
  .refine((l) => !l.tracks || [...l.beds, ...l.sfx].every((e) => !e.track || l.tracks.some((t) => t.id === e.track)), "an entry names a track that isn't in tracks");

// ---------- The camera keys (package.json "live-studio".camTimeline), which the studio also writes: one entry per key, in time
// order, t in the seconds draw(t) is given. p and l are a point [x, y, z] or the film's own anchor ({"eye": [...]}); ease is a
// named ease of the film or a CSS cubic-bezier [x1, y1, x2, y2]. Anything else on a key (fov, wave, roll) is the film's
const point = z.union([z.tuple([z.number(), z.number(), z.number()]), z.looseObject({})]);
const unit = z.number().min(0).max(1);
const Ease = z.union([z.string().min(1), z.tuple([unit, z.number(), unit, z.number()])]);
const CamKey = z.looseObject({ t: secs, p: point, l: point, cut: z.boolean().optional(), ease: Ease.optional() });
export const CamTimeline = z.array(CamKey).min(1).refine((ks) => ks.every((k, i) => i === 0 || k.t >= ks[i - 1].t), "camera keys must be in order of time");

// ---------- The shots (package.json "live-studio".shotsTimeline): SHOTS as data, so the studio can move a cut. Each shot starts at t
// (the voice's source seconds, like SHOTS) and may carry a name the timeline shows; the film reads them from EDIT.shots in applyEdit
// anim: the shot's In, Out and Combo ({fx, len?, k?}, fx an id from the film's draw.anims), drawn by film-stage/animate.ts
const AnimFx = z.looseObject({ fx: z.string().min(1), len: z.number().positive().optional(), k: z.number().optional() });
const Anim = z.looseObject({ in: AnimFx.optional(), out: AnimFx.optional(), combo: AnimFx.optional() });
const Transition = z.object({ fx: z.enum(["dissolve", "black", "white", "wipe"]), len: z.number().positive() });
export const ShotsTimeline = z.array(z.looseObject({ t: time, name: z.string().optional(), anim: Anim.optional(), transition: Transition.optional() })).min(1)
  .refine((s) => s.every((x, i) => i === 0 || x.t > s[i - 1].t), "shots must start in order of time, each after the one before");

// ---------- Words and shapes over the picture (package.json "live-studio".textTimeline), which the studio also writes: CapCut's
// Text and Shapes, drawn by film-stage/titles.ts. Each item is on screen from `from` to `to` (the seconds draw(t) gets) on a text
// track (0 is the one just over the camera row); x, y its anchor in the frame (0 to 1); `at` a world point it follows instead.
// Anything else on an item (size, font, colour, stroke, background, in, out) is the drawer's
const TextItem = z.looseObject({ kind: z.enum(["text", "arrow", "circle"]), from: secs, to: secs, track: z.number().int().nonnegative().optional(), text: z.string().optional(), x: z.number().optional(), y: z.number().optional(), at: z.tuple([z.number(), z.number(), z.number()]).optional() })
  .refine((it) => it.to > it.from, "to must come after from");
export const TextTimeline = z.looseObject({ items: z.array(TextItem), tracks: z.record(z.string().regex(/^\d+$/), z.looseObject({ lock: z.boolean().optional(), hidden: z.boolean().optional() })).optional() });

// ---------- Key files (package.json "live-studio".keyFiles: { file: the EDIT key the film reads it from }): every list of
// {t, ...} in the file, at any depth through objects, is a row of keys the studio shows and retimes (Steve's moves, a drawer's
// opening); the studio may write anything else on a key it was given. Each row stays in time order
export const keyRows = (v, path = []) => {
  if (Array.isArray(v)) return v.length && v.every((k) => k && typeof k === "object" && !Array.isArray(k) && Number.isFinite(k.t)) ? [path] : [];
  return v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => keyRows(x, [...path, k])) : [];
};
export const rowAt = (v, path) => path.reduce((x, k) => x?.[k], v);
export const KeyFile = z.union([z.looseObject({}), z.array(z.unknown())])
  .superRefine((v, ctx) => {
    for (const path of keyRows(v)) {
      const ks = rowAt(v, path), i = ks.findIndex((k, j) => j > 0 && k.t < ks[j - 1].t);
      if (i > 0) ctx.addIssue({ code: "custom", message: `keys must be in order of time (${ks[i].t} comes after ${ks[i - 1].t})`, path: [...path, i, "t"] });
    }
  });

// One block of text per part that's wrong, naming the file to fix
export const problems = (schema, value, where) => {
  const r = schema.safeParse(value);
  return r.success ? [] : [`${where}\n${z.prettifyError(r.error)}`];
};

// files: { name: [schema, text or undefined] }, a missing file is no problem
export const checkFiles = (files) => Object.entries(files).flatMap(([name, [schema, text]]) => {
  if (text === undefined) return [];
  let value;
  try { value = JSON.parse(text); } catch (e) { return [`${name}\n✖ not valid JSON: ${e.message}`]; }
  return problems(schema, value, name);
});

export const checkFilm = (scene, draw) => [
  ...problems(SceneModule, scene, "src/scene.ts exports"),
  ...(typeof draw === "function" ? problems(Draw, { tools: draw.tools, describe: draw.describe, checks: draw.checks, variants: draw.variants, anims: draw.anims }, "what buildScene() resolves to (draw)") : ["buildScene()\n✖ must resolve to draw(t), a function"]),
];
