// The film contract: everything the studio reads from a film, as zod schemas. The server checks the film's JSON files when the
// studio starts and whenever one changes; the page checks the film's module and its draw() once built. Problems are printed in
// the studio's terminal, where the AI working on the film reads them, and shown in the page. bun run skills get core --ref contract explains
// each part. What a schema doesn't name is the film's own (its camera keys, audio, props): loose objects let it through.
import * as z from "zod";

import { RATIOS } from "./frame.ts";

export const DOC = "bun run skills get core --ref contract";

const fn = z.custom<Function>((v) => typeof v === "function", "expected a function");
const three = (flag: string, what: string) =>
  z.custom<any>((v: any) => !!v?.[flag], `expected ${what}`);
const time = z
  .number({
    error: (iss) =>
      typeof iss.input === "string"
        ? `seconds as a number, like 50 for 0:50; got the text ${JSON.stringify(iss.input)}`
        : undefined,
  })
  .refine(Number.isFinite, "expected a finite number of seconds");
const unique = (list: any[]) => new Set(list).size === list.length;

const speedRate = z.number().min(0.1).max(10);
const timeRange = { from: z.number().nonnegative(), to: z.number().positive() };
const speedCurve = z
  .array(z.tuple([z.number().min(0).max(1), speedRate]))
  .min(2)
  .refine(
    (ps) =>
      ps[0][0] === 0 && ps.at(-1)![0] === 1 && ps.every((p, i) => i === 0 || p[0] > ps[i - 1][0]),
    "curve positions must increase from 0 to 1",
  );
const speedRange = z
  .object({
    ...timeRange,
    rate: speedRate.optional(),
    curve: speedCurve.optional(),
    handles: z.array(z.tuple([speedRate, speedRate])).optional(),
  })
  .refine(
    (s) => s.to > s.from && !(s.rate !== undefined && s.curve),
    "speed needs a positive range and either rate or curve",
  )
  .refine(
    (s) => !s.handles || (s.curve && s.handles.length === s.curve.length - 1),
    "each curve span needs one pair of speed handles",
  );
const cutRange = z.object(timeRange).refine((s) => s.to > s.from, "cut end must follow its start");
const disjoint = (xs: { from: number; to: number }[]) =>
  xs.every((a, i) => xs.every((b, j) => i === j || a.to <= b.from || b.to <= a.from));
const MainItem = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1),
      kind: z.literal("clip"),
      sourceFrom: z.number().nonnegative(),
      sourceTo: z.number().positive(),
    })
    .refine((c) => c.sourceTo > c.sourceFrom, "main clip needs a positive source range"),
  z.object({
    id: z.string().min(1),
    kind: z.literal("freeze"),
    frame: z.number().nonnegative(),
    duration: z.number().positive(),
  }),
  z.object({ id: z.string().min(1), kind: z.literal("gap"), duration: z.number().positive() }),
]);
const TimingPlan = z.object({
  main: z
    .array(MainItem)
    .refine((items) => unique(items.map((it) => it.id)), "main clip ids must differ")
    .optional(),
  speeds: z.array(speedRange).refine(disjoint, "speed ranges must not overlap").optional(),
  freezes: z
    .array(
      z.object({
        at: z.number().nonnegative(),
        frame: z.number().nonnegative().optional(),
        duration: z.number().positive(),
        padBefore: z.number().nonnegative().optional(),
        padAfter: z.number().nonnegative().optional(),
        blank: z.boolean().optional(),
      }),
    )
    .optional(),
  cuts: z.array(cutRange).refine(disjoint, "cut ranges must not overlap").optional(),
  gaps: z.array(cutRange).refine(disjoint, "gap ranges must not overlap").optional(),
});
const Velocity = z
  .looseObject({
    ...timeRange,
    music: z.string().min(1),
    musicAt: time.optional(),
    beats: z
      .array(z.number().nonnegative())
      .refine((ts) => ts.every((t, i) => !i || t > ts[i - 1]), "beats must increase in time"),
    effect: z.string().min(1),
    frequency: z.union([z.literal(1), z.literal(2)]),
    speed: z.enum(["normal", "fast", "veryFast"]),
    intensity: z.number().min(0).max(100),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.to > v.from, "velocity needs a positive range");
const LayerHistory = z.object({
  base: TimingPlan,
  changes: z.array(z.object({ before: TimingPlan, after: TimingPlan })),
});
const OverlayTimebase = LayerHistory.extend({ sourceDuration: z.number().nonnegative() });
export const TimingTimeline = TimingPlan.extend({
  velocity: z.array(Velocity).refine(disjoint, "velocity ranges must not overlap").optional(),
  layers: LayerHistory.optional(),
  layerKinds: z
    .partialRecord(z.enum(["text", "adjustment", "audio", "sfx", "voice"]), LayerHistory)
    .optional(),
});

// ---------- src/scene.ts
const Shot = z.looseObject({ t: time });
export const SceneModule = z
  .looseObject({
    buildScene: fn,
    SHOTS: z.array(Shot).min(1),
    SHOTS_OUT: z.array(Shot).min(1),
    DURATION: z.number().positive(),
    applyEdit: fn,
  })
  .refine((m: any) => m.SHOTS_OUT.length === m.SHOTS.length, {
    error: "SHOTS_OUT must hold one entry per shot in SHOTS",
    path: ["SHOTS_OUT"],
  })
  .refine(
    (m: any) => m.SHOTS_OUT.every((s: any, i: number, a: any[]) => i === 0 || s.t >= a[i - 1].t),
    { error: "shots must start in order of time", path: ["SHOTS_OUT"] },
  );

// ---------- What buildScene() resolves to: draw(t), with these attached
const TargetRow = z.object({ edit: z.string().min(1), path: z.array(z.string()) });
const Axes = z
  .tuple([z.boolean(), z.boolean(), z.boolean()])
  .refine((axes) => axes.some(Boolean), "at least one transform axis is needed");
export const Tools = z.looseObject({
  scene: three("isObject3D", "the THREE.Scene drawn"),
  camera: three("isCamera", "the THREE camera the film draws with"),
  look: three("isVector3", "a THREE.Vector3: the point the camera looks at"),
  free: z.looseObject({
    on: z.boolean(),
    p: three("isVector3", "a THREE.Vector3"),
    l: three("isVector3", "a THREE.Vector3"),
    fov: z.number(),
  }),
  home: z
    .object({
      p: z.tuple([z.number(), z.number(), z.number()]),
      l: z.tuple([z.number(), z.number(), z.number()]),
      fov: z.number().optional(),
    })
    .optional(),
  objects: z.array(z.tuple([three("isObject3D", "a THREE.Object3D"), z.string()])).optional(),
  targets: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        objects: z.array(three("isObject3D", "a THREE.Object3D")).min(1),
        rows: z.array(TargetRow).min(1),
        transform: z
          .object({
            row: TargetRow,
            read: fn,
            write: fn,
            axes: z
              .object({
                translate: Axes.optional(),
                rotate: Axes.optional(),
                scale: Axes.optional(),
              })
              .refine(
                (modes) => Object.values(modes).some(Boolean),
                "at least one transform mode is needed",
              ),
          })
          .optional(),
      }),
    )
    .refine((targets) => unique(targets.map((t) => t.id)), "target ids must differ")
    .optional(),
  materials: z.array(z.tuple([three("isMaterial", "a THREE.Material"), z.string()])).optional(),
  // mc-assets/placed.ts makePlaced: what the creator drops into the scene from the Objects library, in one of the film's keyFiles
  placed: z
    .looseObject({
      key: z.string().min(1),
      root: three("isObject3D", "a THREE.Object3D"),
      sync: fn,
      draw: fn,
      objectOf: fn,
      nameOf: fn,
      clipsOf: fn,
      catalog: fn,
      icon: fn,
    })
    .optional(),
});
const Look = z.looseObject({ id: z.string().min(1), title: z.string() });
export const Variant = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  options: z
    .array(Look)
    .min(2)
    .refine((o) => unique(o.map((x) => x.id)), "option ids must differ")
    .refine(
      (o) => o.every((x) => x.id !== "off"),
      '"off" is the studio\'s Off chip, not an option id',
    ),
  set: fn,
  pick: Look,
  ranges: z.array(z.tuple([time, time])),
  off: z.boolean().optional(),
});
export const Draw = z
  .looseObject({
    tools: Tools,
    describe: fn.optional(),
    checks: z.record(z.string(), fn).optional(),
    variants: z
      .array(Variant)
      .refine((v) => unique(v.map((x) => x.id)), "variant ids must differ")
      .optional(),
    eases: z.record(z.string(), fn).optional(), // the camera keys' named eases (film-stage EASES), drawn in the studio's ease picker
    keyEases: z
      .array(
        z.object({
          edit: z.string().min(1),
          path: z.array(z.string()),
          names: z.array(z.string()).min(1),
        }),
      )
      .optional(),
    // film-stage ANIMS: the In, Out and Combo effects the film draws from a shot's "anim", listed in the studio's Animation tab
    anims: z
      .object(
        Object.fromEntries(
          ["in", "out", "combo"].map((k) => [
            k,
            z.array(
              z.looseObject({
                id: z.string().min(1),
                title: z.string(),
                cat: z.string(),
                tip: z.string(),
              }),
            ),
          ]),
        ),
      )
      .optional(),
    transitions: z
      .array(z.looseObject({ id: z.string().min(1), title: z.string(), tip: z.string() }))
      .optional(),
    velocity: z.boolean().optional(),
    velocityEffects: z
      .array(
        z.union([
          z.string().min(1),
          z.looseObject({
            id: z.string().min(1),
            title: z.string().optional(),
            preview: z.string().optional(),
          }),
        ]),
      )
      .refine(
        (es) => unique(es.map((e) => (typeof e === "string" ? e : e.id))),
        "velocityEffect ids must differ",
      )
      .optional(),
    adjustments: z.looseObject({ prepare: fn }).optional(),
  })
  .refine(
    (draw: any) =>
      draw.keyEases?.every((row: any) =>
        row.names.every((name: string) => typeof draw.eases?.[name] === "function"),
      ) ?? true,
    { error: "each key easing must have a draw.eases evaluator", path: ["keyEases"] },
  );

// ---------- src/edit.json: the studio reads the voice, the script takes, the beats and their sounds. Everything else in it is the film's
const Take = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "take id may only use letters, digits, _ and -"),
  text: z.string().optional(),
  t: time.optional(),
  start: time.optional(),
  voice: z.string().optional(),
  model: z.string().optional(),
  language: z.string().optional(),
  speed: z.number().positive().optional(),
  stability: z.number().min(0).max(1).optional(),
  guide: z.string().optional(),
});
const Beat = z.looseObject({
  title: z.string(),
  at: time,
  dur: z.number().nonnegative(),
  kind: z.enum(["motion", "sound"]),
  sounds: z.array(z.tuple([time, z.string(), z.number()])),
});
export const Edit = z.looseObject({
  voice: z.looseObject({
    edits: z.record(z.string(), z.unknown()),
    warp: z.array(z.tuple([time, time])),
  }),
  takes: z
    .array(Take)
    .refine((ts) => unique(ts.map((t) => t.id)), "take ids must differ")
    .optional(),
  beats: z.record(z.string(), Beat),
});

// ---------- renders/live/trials.json (written by the film's sound.py) and choices.json (written by the studio)
const Option = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  files: z.array(z.string()).min(1),
});
const options = z
  .array(Option)
  .min(2)
  .refine((o) => unique(o.map((x) => x.id)), "option ids must differ")
  .refine(
    (o) => o.every((x) => x.id !== "off"),
    '"off" is the studio\'s Off chip, not an option id',
  );
const StemGroup = z
  .looseObject({ title: z.string(), kind: z.literal("stem"), from: time, to: time, options })
  .refine((g) => g.to > g.from, "to must come after from");
const CueGroup = z.looseObject({
  title: z.string(),
  options,
  cues: z.array(
    z.looseObject({ at: time, pick: z.int().nonnegative(), rate: z.number(), gain: z.number() }),
  ),
});
export const Trials = z.record(z.string(), z.union([StemGroup, CueGroup]));
export const Choices = z.record(
  z.string(),
  z.looseObject({ set: z.string(), gain: z.number().positive().optional() }),
);

// ---------- package.json "live-studio": the paths in it are checked where they are opened (film.mjs); here what has a shape
export const StudioConfig = z.looseObject({
  ratio: z.enum(RATIOS as unknown as [string, ...string[]]).optional(),
  soundSources: z.record(z.string().regex(/^\w[\w.-]*$/), z.string().min(1)).optional(),
  requiredKeyRows: z.record(z.string(), z.array(z.array(z.string()))).optional(),
});

// ---------- The sound lanes (package.json "live-studio".soundTimeline), which the studio also writes: beds loop from..to, a
// one-shot plays from at for length seconds or to its end. Gains in dB. Anything else on an entry (filters, try) is the film's
const name = z.string().regex(/^\w[\w.-]*$/, "an audio source name, without .wav");
const MAX_FILM_SECONDS = 3600;
const MAX_PROCESS_SECONDS = 900;
const ALLOWED_AUDIO_FILTER =
  /^(?:lowpass|highpass|bandpass|bandreject|allpass|equalizer|lowshelf|highshelf|bass|treble|acompressor|alimiter|agate|asoftclip|aecho|aphaser|aflanger|achorus|vibrato|tremolo|stereowiden|extrastereo|volume|dynaudnorm|adeclick|adeclip|afftdn|deesser)(?:=[A-Za-z0-9_.:=|+\s%-]+)?$/;
const audioFilter = z
  .string()
  .regex(ALLOWED_AUDIO_FILTER, "unsafe or unsupported ffmpeg audio filter");
const secs = time.refine(
  (v) => v >= 0 && v <= MAX_FILM_SECONDS,
  `expected seconds from the film's start, 0..${MAX_FILM_SECONDS}`,
);
const track = z.string().min(1).optional();
const dB = z.number().refine(Number.isFinite, "expected a finite number of dB");
const gainKeys = z
  .array(z.object({ t: time, gain: dB }))
  .refine(
    (keys) => keys.every((k, i) => i === 0 || k.t > keys[i - 1].t),
    "volume keys must increase in time",
  )
  .optional();
const processing = {
  rate: z.number().min(0.1).max(10).optional(),
  pitch: z.number().min(-24).max(24).optional(),
  changePitch: z.boolean().optional(),
  reverse: z.boolean().optional(),
  voiceFilter: z.enum(["none", "telephone", "walkieTalkie", "megaphone"]).optional(),
  voiceStrength: z.number().min(0).max(100).optional(),
  dialogue: z.boolean().optional(),
};
const segmentRange = {
  ...timeRange,
  sourceFrom: secs,
  sourceTo: secs,
  blank: z.boolean().optional(),
};
const soundTiming = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({
        ...segmentRange,
        kind: z.literal("play"),
        rate0: z.number().positive(),
        rate1: z.number().positive(),
      }),
      z.object({ ...segmentRange, kind: z.literal("freeze") }),
    ]),
  )
  .refine(
    (ss) =>
      ss.every(
        (s, i) =>
          s.to > s.from &&
          s.to <= MAX_PROCESS_SECONDS &&
          s.sourceTo >= s.sourceFrom &&
          (i === 0 ? s.from === 0 : Math.abs(s.from - ss[i - 1].to) < 1e-7),
      ),
    "audio timing segments must be contiguous, positive, and within 900s",
  );
export const SoundProcess = z.object({
  name,
  start: secs,
  duration: z.number().positive().max(MAX_PROCESS_SECONDS),
  loop: z.boolean(),
  ...processing,
  timeline: soundTiming.optional(),
});
const beatMarkers = {
  beats: z
    .array(time)
    .refine((ts) => ts.every((t, i) => i === 0 || t > ts[i - 1]), "beats must increase in time")
    .optional(),
  beatMode: z.union([z.literal(1), z.literal(2)]).optional(),
  bpm: z.number().nonnegative().optional(),
  beatSource: name.optional(),
};
const Bed = z
  .looseObject({
    name,
    from: secs,
    to: secs,
    gain: dB,
    gainKeys,
    ...processing,
    ...beatMarkers,
    fadeIn: z.number().nonnegative(),
    fadeOut: z.number().nonnegative(),
    start: z.number().nonnegative().optional(),
    duck: z.number().nonnegative().optional(),
    pan: z.number().min(-1).max(1).optional(),
    try: z.array(name).optional(),
    filters: z.array(audioFilter).optional(),
    track,
  })
  .refine((b: any) => b.to > b.from, "to must come after from");
const Shot1 = z.looseObject({
  at: secs,
  name,
  gain: dB,
  gainKeys,
  ...processing,
  ...beatMarkers,
  start: z.number().nonnegative().optional(),
  length: z.number().positive().max(MAX_FILM_SECONDS).optional(),
  fadeIn: z.number().nonnegative().optional(),
  fadeOut: z.number().nonnegative().optional(),
  pan: z.number().min(-1).max(1).optional(),
  try: z.array(name).optional(),
  filters: z.array(audioFilter).optional(),
  track,
});
// tracks (top to bottom) and each entry's track: app/sound/tracks.ts. Optional, the page adds them; mute leaves a track out of the mix,
// filters (the clip EQ's ffmpeg entries) and gain (dB) shape every clip on it after its own chain, as real-sound's buses do
const Track = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  mute: z.boolean().optional(),
  filters: z.array(audioFilter).optional(),
  gain: z.number().min(-60).max(12).optional(),
  lock: z.boolean().optional(),
});
export const SoundTimeline = z
  .looseObject({
    beds: z.array(Bed),
    sfx: z.array(Shot1),
    tracks: z.array(Track).optional(),
    narration: name.optional(),
    voice: z.boolean().optional(),
    voiceGain: dB.optional(),
    lufs: dB.optional(),
    drive: dB.optional(),
  })
  .refine((l: any) => !l.tracks || unique(l.tracks.map((t: any) => t.id)), "track ids must differ")
  .superRefine((l: any, ctx) => {
    if (!l.tracks) return;
    const ids = l.tracks.map((t: any) => t.id);
    for (const list of ["beds", "sfx"])
      l[list].forEach((e: any, i: number) => {
        if (e.track && !ids.includes(e.track))
          ctx.addIssue({
            code: "custom",
            path: [list, i, "track"],
            message: `"${e.track}" is not one of the tracks (${ids.join(", ")})`,
          });
      });
  });

// The keys the mix and the studio read on each part of the sound timeline: a key next to one of these by a letter or two is a
// typo the loose schemas let through (bun run check names it)
export const SOUND_KEYS = {
  audio: Object.keys(SoundTimeline.shape),
  beds: Object.keys(Bed.shape),
  sfx: Object.keys(Shot1.shape),
};

// ---------- The camera keys (package.json "live-studio".camTimeline), which the studio also writes: one entry per key, in time
// order, t in the seconds draw(t) is given. p and l are a point [x, y, z] or the film's own anchor ({"eye": [...]}); ease is a
// named ease of the film or a CSS cubic-bezier [x1, y1, x2, y2]; fov, wave and roll are numbers every film's camera reads.
// Any other key on a key is the film's own
const point = z.union([z.tuple([z.number(), z.number(), z.number()]), z.looseObject({})], {
  error: 'a point [x, y, z], or the film\'s anchor like {"eye": [x, y, z]}',
});
const unit = z.number().min(0).max(1);
const Ease = z.union([z.string().min(1), z.tuple([unit, z.number(), unit, z.number()])]);
const CamKey = z.looseObject({
  t: secs,
  p: point,
  l: point,
  cut: z.boolean().optional(),
  ease: Ease.optional(),
  fov: z.number().positive().optional(),
  wave: z.number().optional(),
  roll: z.number().optional(),
});
export const CAM_KEYS = Object.keys(CamKey.shape);
export const CamTimeline = z
  .array(CamKey)
  .min(1)
  .refine(
    (ks) => ks.every((k, i) => i === 0 || k.t >= ks[i - 1].t),
    "camera keys must be in order of time",
  );

// ---------- The shots (package.json "live-studio".shotsTimeline): SHOTS as data, so the studio can move a cut. Each shot starts at t
// (the voice's source seconds, like SHOTS) and may carry a name the timeline shows; the film reads them from EDIT.shots in applyEdit
// anim: the shot's In, Out and Combo ({fx, len?, k?, curve?, flip?, optics?}, fx an id from the film's draw.anims), drawn by film-stage/animate.ts
const AnimFx = z.looseObject({
  fx: z.string().min(1),
  len: z.number().positive().optional(),
  k: z.number().positive().optional(),
  curve: Ease.optional(),
  flip: z.boolean().optional(),
  optics: unit.optional(),
  seam: z.boolean().optional(),
});
const Anim = z.looseObject({
  in: AnimFx.optional(),
  out: AnimFx.optional(),
  combo: AnimFx.optional(),
});
const Transition = z.looseObject({
  fx: z.string().min(1),
  len: z.number().positive(),
  ease: Ease.optional(),
  feather: unit.optional(),
  flip: z.boolean().optional(),
});
const basicControl = (min: number) => z.number().min(min).max(100).optional();
const Curve = z
  .array(z.tuple([unit, unit]))
  .min(2)
  .max(16)
  .refine(
    (pts) => pts.every((p, i) => i === 0 || p[0] > pts[i - 1][0]),
    "curve inputs must increase",
  );
const Hsl = z.looseObject({
  enabled: z.boolean().optional(),
  ...Object.fromEntries(
    ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"].map((key) => [
      key,
      z
        .object({
          hue: basicControl(-100),
          saturation: basicControl(-100),
          brightness: basicControl(-100),
        })
        .optional(),
    ]),
  ),
});
const Curves = z.looseObject({
  enabled: z.boolean().optional(),
  luma: Curve.optional(),
  red: Curve.optional(),
  green: Curve.optional(),
  blue: Curve.optional(),
});
const wheelChannel = z.number().min(-1).max(1);
const Wheel = z.object({
  rgb: z.tuple([wheelChannel, wheelChannel, wheelChannel]).optional(),
  saturation: z.number().min(0).max(200).optional(),
});
const Wheels = z.looseObject({
  enabled: z.boolean().optional(),
  mode: z.enum(["primary", "log"]).optional(),
  amount: basicControl(0),
  ...Object.fromEntries(
    ["shadows", "midtones", "highlights", "offset"].map((k) => [k, Wheel.optional()]),
  ),
});
export const Grade = z.looseObject({
  enabled: z.boolean().optional(),
  // film-stage's ADJUSTMENTS (grade-color.ts), listed here so the server's contract loads no three.js; test/contract.test.mjs keeps them equal
  basic: z
    .looseObject({
      ...Object.fromEntries(
        [
          "temp",
          "tint",
          "saturation",
          "exposure",
          "contrast",
          "highlight",
          "shadow",
          "whites",
          "blacks",
          "brilliance",
          "vignette",
        ].map((key) => [key, basicControl(-100)]),
      ),
      ...Object.fromEntries(
        [
          "sharpen",
          "clarity",
          "soften",
          "fringe",
          "fisheye",
          "particles",
          "fade",
          "halation",
          "dither",
        ].map((key) => [key, basicControl(0)]),
      ),
    })
    .optional(),
  hsl: Hsl.optional(),
  curves: Curves.optional(),
  wheels: Wheels.optional(),
  lut: z
    .object({
      name: z.string(),
      url: z.string().regex(/^\/studio-luts\/[a-f0-9]{64}\.(cube|3dl)$/),
      amount: z.number().min(0).max(100).optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
});
const AdjustmentItem = z
  .looseObject({
    id: z.string().min(1),
    name: z.string(),
    from: secs,
    to: secs,
    track: z.int().nonnegative(),
    grade: Grade,
    timebase: OverlayTimebase.optional(),
  })
  .refine((it: any) => it.to > it.from, "to must come after from");
export const AdjustmentTimeline = z
  .looseObject({
    items: z.array(AdjustmentItem),
    tracks: z
      .record(
        z.string(),
        z.looseObject({ lock: z.boolean().optional(), hidden: z.boolean().optional() }),
      )
      .optional(),
  })
  .refine((f: any) => unique(f.items.map((it: any) => it.id)), "adjustment ids must differ");
export const ShotsTimeline = z
  .array(
    z.looseObject({
      t: time,
      name: z.string().optional(),
      anim: Anim.optional(),
      transition: Transition.optional(),
      adjust: Grade.optional(),
    }),
  )
  .min(1)
  .refine(
    (s) => s.every((x, i) => i === 0 || x.t > s[i - 1].t),
    "shots must start in order of time, each after the one before",
  );

// ---------- Words and shapes over the picture (package.json "live-studio".textTimeline), which the studio also writes: CapCut's
// Text and Shapes, drawn by film-stage/titles.ts. Each item is on screen from `from` to `to` (the seconds draw(t) gets) on a text
// track (0 is the one just over the camera row); x, y its anchor in the frame (0 to 1); `at` a world point it follows instead.
// Anything else on an item (size, font, colour, stroke, background, in, out, custom shapes) is the drawer's
const TextFx = z.looseObject({
  fx: z.string().min(1),
  len: z.number().positive().optional(),
  ease: Ease.optional(),
  stagger: unit.optional(),
  tint: z.string().min(1).optional(),
  // Steps the voice every N film frames (Cinetic on-twos / on-threes)
  hold: z.number().int().min(1).max(12).optional(),
});
const TextItem = z
  .looseObject({
    kind: z.string().min(1),
    from: secs,
    to: secs,
    timebase: OverlayTimebase.optional(),
    track: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    at: z.tuple([z.number(), z.number(), z.number()]).optional(),
    in: TextFx.optional(),
    out: TextFx.optional(),
  })
  .refine((it: any) => it.to > it.from, "to must come after from");
export const TextTimeline = z.looseObject({
  items: z.array(TextItem),
  tracks: z
    .record(
      z.string().regex(/^\d+$/),
      z.looseObject({ lock: z.boolean().optional(), hidden: z.boolean().optional() }),
    )
    .optional(),
});

// ---------- Key files (package.json "live-studio".keyFiles: { file: the EDIT key the film reads it from }): every list of
// {t, ...} or single timed {t, ...} event object in the file, at any depth through objects, is a row of keys the studio shows
// and retimes (Steve's moves, a drawer's opening, a single desk drop); each list row stays in time order
const isTimedKey = (k: any): k is { t: number } =>
  !!k && typeof k === "object" && !Array.isArray(k) && Number.isFinite(k.t);
export const keyRows = (v: any, path: string[] = []): string[][] => {
  if (Array.isArray(v)) return v.length && v.every(isTimedKey) ? [path] : [];
  if (!v || typeof v !== "object") return [];
  const own = path.length > 0 && isTimedKey(v) ? [path] : [];
  return [...own, ...Object.entries(v).flatMap(([k, x]) => keyRows(x, [...path, k]))];
};
export const rowAt = (v: any, path: string[]): any => path.reduce((x, k) => x?.[k], v);
const rowKeys = (v: any, path: string[]): any[] => {
  const r = rowAt(v, path);
  return Array.isArray(r) ? r : isTimedKey(r) ? [r] : [];
};
export const KeyFile = z
  .union([z.looseObject({}), z.array(z.unknown())])
  .superRefine((v: any, ctx) => {
    for (const path of keyRows(v)) {
      const ks = rowKeys(v, path),
        i = ks.findIndex((k: any, j: number) => j > 0 && k.t < ks[j - 1].t);
      if (i > 0)
        ctx.addIssue({
          code: "custom",
          message: `keys must be in order of time (${ks[i].t} comes after ${ks[i - 1].t})`,
          path: [...path, i, "t"],
        });
    }
  });
export const keyFileSchema = (requiredRows: string[][] = []) =>
  KeyFile.superRefine((v: any, ctx) => {
    for (const path of requiredRows) {
      const keys = rowKeys(v, path);
      if (!keys.length)
        ctx.addIssue({
          code: "custom",
          message: `no "${path.join(".")}" keys: the studio needs at least one, the object's base state (renamed or deleted?)`,
          path,
        });
    }
  });

// One block of text per part that's wrong, naming the file to fix
export const problems = (schema: z.ZodType<any>, value: unknown, where: string): string[] => {
  const r = schema.safeParse(value);
  return r.success ? [] : [`${where}\n${z.prettifyError(r.error)}`];
};

// files: { name: [schema, text or undefined] }, a missing file is no problem
export const checkFiles = (files: Record<string, [z.ZodType<any>, string | undefined]>): string[] =>
  Object.entries(files).flatMap(([name, [schema, text]]) => {
    if (text === undefined) return [];
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e: any) {
      return [`${name}\n✖ not valid JSON: ${e.message}`];
    }
    return problems(schema, value, name);
  });

export const checkFilm = (scene: unknown, draw: any): string[] => [
  ...problems(SceneModule, scene, "src/scene.ts exports"),
  ...(typeof draw === "function"
    ? problems(
        Draw,
        {
          tools: draw.tools,
          describe: draw.describe,
          checks: draw.checks,
          variants: draw.variants,
          anims: draw.anims,
          transitions: draw.transitions,
          eases: draw.eases,
          keyEases: draw.keyEases,
          velocity: draw.velocity,
          velocityEffects: draw.velocityEffects,
          adjustments: draw.adjustments,
        },
        "what buildScene() resolves to (draw)",
      )
    : ["buildScene()\n✖ must resolve to draw(t), a function"]),
];
