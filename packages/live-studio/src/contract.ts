import { LIGHT_PRESET_IDS } from "film-stage/lights-meta";
import { FaceTimeline } from "mc-actor/toon-timeline";
import * as z from "zod";

import { isMcPackFilename } from "../../mc-assets/src/picks-manifest.ts";
import { findTarget, targetHelp } from "../render/target.ts";
import {
  ADJUSTMENT_KEYS,
  CAM_KEYS,
  isTimedKey,
  keyRows,
  PICK_KEYS,
  PLACED_KEY_KEYS,
  PLACED_OBJECT_KEYS,
  rowAt,
  SHOT_KEYS,
  SHOT_SLOT_KEYS,
  SOUND_KEYS,
  TEXT_KEYS,
  TEXT_SLOT_KEYS,
} from "./contract-keys.ts";
import { RATIOS } from "./frame.ts";

export {
  ADJUSTMENT_KEYS,
  CAM_KEYS,
  keyRows,
  PICK_KEYS,
  PLACED_KEY_KEYS,
  PLACED_OBJECT_KEYS,
  rowAt,
  SHOT_KEYS,
  SHOT_SLOT_KEYS,
  SOUND_KEYS,
  TEXT_KEYS,
  TEXT_SLOT_KEYS,
};

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
  .looseObject({
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
const cutRange = z
  .looseObject(timeRange)
  .refine((s) => s.to > s.from, "cut end must follow its start");
const disjoint = (xs: { from: number; to: number }[]) =>
  xs.every((a, i) => xs.every((b, j) => i === j || a.to <= b.from || b.to <= a.from));
const MainItem = z.discriminatedUnion("kind", [
  z
    .looseObject({
      id: z.string().min(1),
      kind: z.literal("clip"),
      sourceFrom: z.number().nonnegative(),
      sourceTo: z.number().positive(),
    })
    .refine((c) => c.sourceTo > c.sourceFrom, "main clip needs a positive source range"),
  z.looseObject({
    id: z.string().min(1),
    kind: z.literal("freeze"),
    frame: z.number().nonnegative(),
    duration: z.number().positive(),
  }),
  z.looseObject({ id: z.string().min(1), kind: z.literal("gap"), duration: z.number().positive() }),
]);
const TimingPlan = z.looseObject({
  main: z
    .array(MainItem)
    .refine((items) => unique(items.map((it) => it.id)), "main clip ids must differ")
    .optional(),
  speeds: z.array(speedRange).refine(disjoint, "speed ranges must not overlap").optional(),
  freezes: z
    .array(
      z.looseObject({
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
const LayerHistory = z.looseObject({
  base: TimingPlan,
  changes: z.array(z.looseObject({ before: TimingPlan, after: TimingPlan })),
});
export const OverlayTimebase = LayerHistory.extend({ sourceDuration: z.number().nonnegative() });
export const TimingTimeline = TimingPlan.extend({
  velocity: z.array(Velocity).refine(disjoint, "velocity ranges must not overlap").optional(),
  layers: LayerHistory.optional(),
  layerKinds: z
    .partialRecord(
      z.enum(["text", "overlays", "adjustment", "audio", "sfx", "voice"]),
      LayerHistory,
    )
    .optional(),
});
export const TIMING_KEYS = Object.keys(TimingTimeline.shape);

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

const TargetRow = z.object({ edit: z.string().min(1), path: z.array(z.string()) });
const Axes = z
  .tuple([z.boolean(), z.boolean(), z.boolean()])
  .refine((axes) => axes.some(Boolean), "at least one transform axis is needed");
const OpticsTelemetry = z.looseObject({
  shot: z.number().int().nonnegative(),
  shotName: z.string().optional(),
  mm: z.number().positive(),
  fov: z.number().positive(),
  fstop: z.number().nonnegative().optional(),
  focusM: z.number().positive().optional(),
  focusTarget: z.string().optional(),
  handheld: z.string().optional(),
  look: z.string().optional(),
  impulse: z.string().optional(),
});
export const Tools = z.looseObject({
  scene: three("isObject3D", "the THREE.Scene drawn"),
  camera: three("isCamera", "the THREE camera the film draws with"),
  look: three("isVector3", "a THREE.Vector3: the point the camera looks at"),
  free: z.looseObject({
    on: z.boolean(),
    previewEffects: z.boolean().optional(),
    p: three("isVector3", "a THREE.Vector3"),
    l: three("isVector3", "a THREE.Vector3"),
    fov: z.number(),
    roll: z.number().optional(),
    wave: z.number().optional(),
    bob: z.number().optional(),
    fstop: z.number().optional(),
    focus: z.unknown().optional(),
    handheld: z.unknown().optional(),
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
  optics: OpticsTelemetry.optional(),
  cameraSample: fn.optional(),
  cameraOpticsSample: fn.optional(),
  resizePreview: fn.optional(),
  cameraRig: z.literal(true).optional(),
  cameraProjection: z.literal(true).optional(),
  cameraRails: z.literal(true).optional(),
  cameraGroups: z.array(z.string()).optional(),
  apertureSampling: z.literal(true).optional(),
  sampleCameraPath: fn.optional(),
  sampleCameraTrack: fn.optional(),
  cameraClock: z.literal(true).optional(),
  moveCameraAnchor: fn.optional(),
  resolveCameraAnchor: fn.optional(),
  cameraAnchors: z.array(z.object({ target: z.string(), label: z.string() })).optional(),
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
    eases: z.record(z.string(), fn).optional(),
    keyEases: z
      .array(
        z.object({
          edit: z.string().min(1),
          path: z.array(z.string()),
          names: z.array(z.string()).min(1),
        }),
      )
      .optional(),
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
  by: z.string().min(1).optional(),
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
    lines: z.array(z.tuple([time, time])).optional(),
  }),
  takes: z
    .array(Take)
    .refine((ts) => unique(ts.map((t) => t.id)), "take ids must differ")
    .optional(),
  beats: z.record(z.string(), Beat),
  end: time.refine((s) => s > 0, "the film's end: seconds after 0").optional(),
});
export const EDIT_KEYS = Object.keys(Edit.shape);

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

const filePath = z.string().min(1).optional();
export const StudioConfig = z.looseObject({
  preload: z.array(z.string().min(1)).optional(),
  ratio: z.enum(RATIOS as unknown as [string, ...string[]]).optional(),
  soundSources: z.record(z.string().regex(/^\w[\w.-]*$/), z.string().min(1)).optional(),
  requiredKeyRows: z.record(z.string(), z.array(z.array(z.string()))).optional(),
  soundTimeline: filePath,
  camTimeline: filePath,
  lightsTimeline: filePath,
  shotsTimeline: filePath,
  textTimeline: filePath,
  adjustmentTimeline: filePath,
  openfilmTimeline: filePath,
  timingTimeline: filePath,
  keyFiles: z.record(z.string(), z.string()).optional(),
  sfx: filePath,
  sound: z.array(z.string()).optional(),
  soundVault: z.union([z.string().min(1), z.literal(false)]).optional(),
  liveLanes: z.boolean().optional(),
  chrome: filePath,
});
export const CONFIG_KEYS = Object.keys(StudioConfig.shape);

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
const isSafeRelativeIrPath = (s: string) =>
  s.length > 0 &&
  !s.includes("\0") &&
  !s.startsWith("/") &&
  !s.startsWith("\\") &&
  !/^[A-Za-z]:/.test(s) &&
  !s.split(/[\\/]/).includes("..");

const reverbSpace = z.string().min(1).refine(isSafeRelativeIrPath, "unsafe reverb space path");

export const ReverbSpec = z.looseObject({
  space: reverbSpace,
  wet: z.number().min(0).max(1).optional(),
  preDelayMs: z.number().min(0).max(500).optional(),
});

export const ShotSpace = z
  .looseObject({
    from: secs,
    to: secs.optional(),
    space: reverbSpace,
    wet: z.number().min(0).max(1).optional(),
    preDelayMs: z.number().min(0).max(500).optional(),
  })
  .refine((s: any) => s.to === undefined || s.to > s.from, "to must come after from");

const spatialVec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const SpatialSpec = z
  .looseObject({
    at: spatialVec3.optional(),
    target: z.string().min(1).optional(),
    offset: spatialVec3.optional(),
    refDistance: z.number().positive().optional(),
    maxDistance: z.number().positive().optional(),
    rolloff: z.number().min(0).max(10).optional(),
    occlusion: z.number().min(0).max(1).optional(),
    airAbsorption: z.boolean().optional(),
  })
  .refine(
    (s: any) =>
      s.refDistance === undefined || s.maxDistance === undefined || s.maxDistance >= s.refDistance,
    "maxDistance must be >= refDistance",
  );

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
    guide: z.boolean().optional(),
    muted: z.boolean().optional(),
    pan: z.number().min(-1).max(1).optional(),
    try: z.array(name).optional(),
    filters: z.array(audioFilter).optional(),
    track,
    reverb: ReverbSpec.optional(),
    spatial: SpatialSpec.optional(),
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
  guide: z.boolean().optional(),
  muted: z.boolean().optional(),
  pan: z.number().min(-1).max(1).optional(),
  try: z.array(name).optional(),
  filters: z.array(audioFilter).optional(),
  track,
  reverb: ReverbSpec.optional(),
  spatial: SpatialSpec.optional(),
});
const TrackRole = z.enum([
  "voice",
  "bgm",
  "whoosh",
  "riser",
  "pop-ui",
  "impact",
  "ambience",
  "custom",
]);
const Track = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  role: TrackRole.optional(),
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
    reverb: ReverbSpec.optional(),
    spaces: z.array(ShotSpace).optional(),
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

const point = z.union([z.tuple([z.number(), z.number(), z.number()]), z.looseObject({})], {
  error: 'a point [x, y, z], or the film\'s anchor like {"eye": [x, y, z]}',
});
const unit = z.number().min(0).max(1);
const Ease = z.union([z.string().min(1), z.tuple([unit, z.number(), unit, z.number()])]);
const FocusTargetObj = z.looseObject({
  target: z.string().min(1),
  offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
const FocusPoint = z.object({
  point: z.tuple([z.number(), z.number(), z.number()]),
  label: z.string().optional(),
});
const FocusTarget = z.union([z.number().positive(), z.string().min(1), FocusTargetObj, FocusPoint]);
const HandheldShape = z.looseObject({
  preset: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional(),
  speed: z.number().positive().optional(),
  move: z.number().nonnegative().optional(),
  offset: z.number().optional(),
  desync: z.number().optional(),
  octaves: z.number().int().min(1).max(4).optional(),
});
const HandheldObj = HandheldShape.refine(
  (h: any) => typeof h.preset === "string" || typeof h.kind === "string",
  "handheld preset or kind is required",
);
const Handheld = z.union([
  z.literal(false),
  z.string().min(1),
  HandheldObj,
  z.object({ mix: z.array(HandheldObj).min(1) }),
]);
const CamKey = z.looseObject({
  id: z.string().min(1).optional(),
  t: secs,
  p: point,
  l: point,
  cut: z.boolean().optional(),
  tailId: z.union([z.literal(false), z.string().min(1)]).optional(),
  keepTailOnMerge: z.literal(true).optional(),
  locked: z.boolean().optional(),
  muted: z.boolean().optional(),
  color: z.enum(["amber", "blue", "green", "pink"]).optional(),
  inHandle: z.tuple([z.number(), z.number(), z.number()]).optional(),
  outHandle: z.tuple([z.number(), z.number(), z.number()]).optional(),
  railU: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  ease: Ease.optional(),
  matchSpeed: z.boolean().optional(),
  easeChannels: z
    .object({
      position: Ease.optional(),
      aim: Ease.optional(),
      lens: Ease.optional(),
      dof: Ease.optional(),
      roll: Ease.optional(),
      shake: Ease.optional(),
    })
    .optional(),
  fov: z.number().positive().optional(),
  mm: z.number().positive().optional(),
  dollyZoomScale: z.number().positive().optional(),
  focus: FocusTarget.nullish(),
  fstop: z.number().nonnegative().optional(),
  handheld: Handheld.optional(),
  wave: z.number().optional(),
  roll: z.number().optional(),
  bob: z.number().finite().optional(),
  motion: z.enum(["smooth", "linear", "hold", "orbit"]).optional(),
  reversePath: z.boolean().optional(),
});
export const FOCUS_KEYS = [...Object.keys(FocusTargetObj.shape), ...Object.keys(FocusPoint.shape)];
export const HANDHELD_KEYS = Object.keys(HandheldShape.shape);
const distinctRowIds = (rows: { id?: string }[]) => unique(rows.flatMap((row) => row.id ?? []));
export const CamTimeline = z
  .array(CamKey)
  .min(1)
  .refine(
    (ks) => ks.every((k, i) => i === 0 || k.t >= ks[i - 1].t),
    "camera keys must be in order of time",
  )
  .refine(distinctRowIds, "camera key ids must differ")
  .refine(
    (ks) => ks.every((key) => !key.keepTailOnMerge || (key.cut && typeof key.tailId === "string")),
    "keepTailOnMerge requires a camera cut with a tailId",
  );

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const hexColor = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "expected #rgb or #rrggbb hex color");
const finiteNum = z.number().finite();
const PracticalFlickerSchema = z.union([
  z.boolean(),
  z.object({
    rate: z.number().positive().optional(),
    speed: z.number().positive().optional(),
    amount: unit.optional(),
    seed: finiteNum.optional(),
  }),
]);
export const LightPracticalSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(["point", "spot"]),
  at: vec3,
  target: vec3.optional(),
  color: hexColor,
  intensity: finiteNum.min(0),
  distance: finiteNum.min(0),
  decay: finiteNum.min(0).max(10),
  angle: finiteNum.min(1).max(89).optional(),
  penumbra: unit.optional(),
  flicker: PracticalFlickerSchema.optional(),
});
export const LightKey = z.looseObject({
  id: z.string().min(1).optional(),
  t: secs,
  cut: z.boolean().optional(),
  ease: Ease.optional(),
  preset: z.enum(LIGHT_PRESET_IDS as unknown as [string, ...string[]]).optional(),
  target: vec3.optional(),
  key: z
    .looseObject({
      enabled: z.boolean().optional(),
      color: hexColor.optional(),
      intensity: finiteNum.min(0).optional(),
      azimuth: finiteNum.min(-360).max(360).optional(),
      elevation: finiteNum.min(-90).max(90).optional(),
      shadowRadius: finiteNum.min(0).max(32).optional(),
      castShadow: z.boolean().optional(),
    })
    .optional(),
  fill: z
    .looseObject({
      enabled: z.boolean().optional(),
      color: hexColor.optional(),
      intensity: finiteNum.min(0).optional(),
      azimuth: finiteNum.min(-360).max(360).optional(),
      elevation: finiteNum.min(-90).max(90).optional(),
      negativeFill: z.boolean().optional(),
    })
    .optional(),
  rim: z
    .looseObject({
      enabled: z.boolean().optional(),
      color: hexColor.optional(),
      intensity: finiteNum.min(0).optional(),
      azimuth: finiteNum.min(-360).max(360).optional(),
      elevation: finiteNum.min(-90).max(90).optional(),
    })
    .optional(),
  world: z
    .looseObject({
      skyColor: hexColor.optional(),
      groundColor: hexColor.optional(),
      ambientIntensity: finiteNum.min(0).max(10).optional(),
      background: z.union([hexColor, z.null()]).optional(),
    })
    .optional(),
  fog: z
    .looseObject({
      mode: z.enum(["none", "linear", "exp2"]).optional(),
      color: hexColor.optional(),
      near: finiteNum.min(0).optional(),
      far: finiteNum.min(0).optional(),
      density: finiteNum.min(0).max(2).optional(),
    })
    .optional(),
  practicals: z
    .array(LightPracticalSchema)
    .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, "practical ids must differ")
    .optional(),
  godrays: z
    .looseObject({
      enabled: z.boolean().optional(),
      density: finiteNum.min(0).max(1).optional(),
      maxDensity: finiteNum.min(0).max(1).optional(),
      edgeStrength: finiteNum.min(0).max(20).optional(),
      edgeRadius: finiteNum.min(0).max(20).optional(),
      raymarchSteps: z.number().int().min(4).max(240).optional(),
      blur: z.boolean().optional(),
      weight: finiteNum.min(0).max(5).optional(),
      color: hexColor.optional(),
    })
    .optional(),
});
const lightKeysArray = z
  .array(LightKey)
  .refine(
    (ks) => ks.every((k, i) => i === 0 || k.t >= ks[i - 1].t),
    "lighting keys must be in order of time",
  );
export const LightsTimeline = z.union([
  lightKeysArray,
  z.looseObject({
    target: vec3.optional(),
    keys: lightKeysArray,
  }),
]);
export const PlacedKeySchema = z.looseObject({
  t: time.refine((x) => x >= 0, "t must be nonnegative"),
  at: vec3,
  rot: vec3.optional(),
  scale: z.number().finite().positive().optional(),
  visible: z.boolean().optional(),
  ease: Ease.optional(),
  clip: z.string().min(1).optional(),
  rate: z.number().finite().optional(),
});
export const PlacedObjectSchema = z.looseObject({
  what: z.string().regex(/^(?:block:[^:]+:.+|mob:.+)$/, 'expected "block:<ns>:<id>" or "mob:<id>"'),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  clip: z.string().min(1).optional(),
  rate: z.number().finite().optional(),
  keys: z
    .array(PlacedKeySchema)
    .min(1)
    .refine(
      (ks) => ks.every((k, i) => i === 0 || k.t >= ks[i - 1].t),
      "placed keys must be in order of time",
    ),
});
export const PlacedTimeline = z.record(z.string().min(1), PlacedObjectSchema);
export const PickEntrySchema = z
  .looseObject({
    jar: z.string().refine(isMcPackFilename, "expected a .jar or .zip filename in vault/packs"),
    namespace: z.string().min(1),
    blocks: z.array(z.string().min(1)).optional(),
    items: z.array(z.string().min(1)).optional(),
    licence: z.string().optional(),
    license: z.string().optional(),
    page: z.string().optional(),
  })
  .refine(
    (p) => (p.blocks?.length ?? 0) > 0 || (p.items?.length ?? 0) > 0,
    "each pick entry needs at least one block or item id",
  );
export const PicksFile = z.array(PickEntrySchema);

const AnimFx = z.looseObject({
  fx: z.string().min(1),
  len: z.number().positive().optional(),
  k: z.number().optional(),
  delay: z.number().finite().optional(),
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
export const PageElementOverride = z.object({
  selector: z.string().min(1),
  text: z.string().optional(),
  style: z.record(z.string(), z.string()).optional(),
  translate: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  scale: z.number().positive().optional(),
  rotate: z.number().finite().optional(),
});
const Transition = z.looseObject({
  params: z
    .record(
      z.string(),
      z.union([z.number().finite(), z.boolean(), z.array(z.number().finite()).min(2).max(4)]),
    )
    .optional(),
  fx: z.string().min(1),
  len: z.number().positive(),
  ease: Ease.optional(),
  feather: unit.optional(),
  flip: z.boolean().optional(),
  props: z
    .object({
      vars: z.record(z.string().startsWith("--"), z.string()).optional(),
      text: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
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
  look: z.string().min(1).optional(),
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
const ShotHit = z.looseObject({
  t: secs,
  amount: z.number().nonnegative(),
  fovPulse: z.number().optional(),
  source: z.literal("beat").optional(),
  decay: z.number().positive().optional(),
  freq: z.number().positive().optional(),
  max: z
    .union([
      z.number().nonnegative(),
      z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()]),
    ])
    .optional(),
  seed: z.number().optional(),
});
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Offset2 = z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]);
const CameraRig = z
  .object({
    look: z.enum(["target", "one-node", "tangent"]).optional(),
    position: Vec3.optional(),
    lead: z.number().min(-2).max(2).optional(),
    bank: z.number().min(-5).max(5).optional(),
    up: Vec3.optional(),
    frameOffset: Offset2.optional(),
    lensShift: Offset2.optional(),
    fovAxis: z
      .object({ mode: z.enum(["horizontal", "vertical"]), aspect: z.number().positive() })
      .optional(),
    near: z.number().positive().optional(),
    far: z.number().positive().optional(),
    hideGroups: z.array(z.string().min(1)).optional(),
    projection: z.enum(["perspective", "orthographic"]).optional(),
    orthographicDepth: z.number().positive().optional(),
    rail: z.array(Vec3).min(2).optional(),
    extrapolation: z.enum(["hold", "linear"]).optional(),
  })
  .refine(
    (rig) => rig.near === undefined || rig.far === undefined || rig.far > rig.near,
    "far must exceed near",
  );
const Shutter = z.object({
  angle: z.number().min(0).max(360).optional(),
  timing: z.enum(["open", "center", "close"]).optional(),
  phase: z.number().min(-1).max(1).optional(),
  samples: z.number().int().min(1).max(64).optional(),
  apertureSamples: z.number().int().min(1).max(32).optional(),
});
const OpticsKey = z.looseObject({
  t: z.number().finite(),
  ease: Ease.optional(),
  contextOf: z.string().min(1).optional(),
});
const CameraOpticsTracks = z.looseObject({
  focus: z
    .record(z.string().min(1), OpticsKey.extend({ value: FocusTarget.nullable() }))
    .optional(),
  focalLength: z
    .record(z.string().min(1), OpticsKey.extend({ value: z.number().positive() }))
    .optional(),
});
const ShotRow = z.looseObject({
  id: z.string().min(1).optional(),
  t: secs,
  cameraClock: z.enum(["scene", "output"]).optional(),
  camera: CameraRig.optional(),
  optics: CameraOpticsTracks.optional(),
  shutter: Shutter.optional(),
  continuityAxis: z
    .tuple([
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
    ])
    .optional(),
  name: z.string().optional(),
  anim: Anim.optional(),
  transition: Transition.optional(),
  adjust: Grade.optional(),
  hits: z.array(ShotHit).optional(),
});
export const GRADE_KEYS = Object.keys(Grade.shape);
export const HIT_KEYS = Object.keys(ShotHit.shape);
export const ShotsTimeline = z
  .array(ShotRow)
  .min(1)
  .refine(
    (s) => s.every((x, i) => i === 0 || x.t > s[i - 1].t),
    "shots must start in order of time, each after the one before",
  )
  .refine(distinctRowIds, "shot ids must differ");

const TextFx = z.looseObject({
  fx: z.string().min(1),
  len: z.number().positive().optional(),
  ease: Ease.optional(),
  stagger: unit.optional(),
  tint: z.string().min(1).optional(),
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
    read: z.boolean().optional(),
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

export const OpenFilmLayerShape = z.object({
  elements: z.array(PageElementOverride).optional(),
  id: z.string().min(1),
  asset: z.string().min(1),
  from: secs,
  to: secs,
  track: z.int().nonnegative().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  size: z.number().positive().max(4).optional(),
  rotate: z.number().finite().optional(),
  opacity: unit.optional(),
  rate: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
  loop: z.boolean().optional(),
  fadeIn: z.number().nonnegative().optional(),
  fadeOut: z.number().nonnegative().optional(),
  timebase: OverlayTimebase.optional(),
  vars: z.record(z.string().startsWith("--"), z.string()).optional(),
  text: z.record(z.string(), z.string()).optional(),
  blend: z
    .enum([
      "source-over",
      "screen",
      "overlay",
      "multiply",
      "lighten",
      "darken",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    .optional(),
});
export const OpenFilmLayer = OpenFilmLayerShape.refine((v) => v.to > v.from, "to must follow from");
export const OpenFilmTimeline = z
  .object({ items: z.array(OpenFilmLayer) })
  .refine((v) => new Set(v.items.map((x) => x.id)).size === v.items.length, "ids must differ");

const hasT = (k: any) => !!k && typeof k === "object" && !Array.isArray(k) && "t" in k;
const badTimes = (v: any, path: (string | number)[] = []): (string | number)[][] =>
  Array.isArray(v)
    ? v.some(hasT)
      ? v.flatMap((k, i) => (isTimedKey(k) ? [] : [[...path, i, "t"]]))
      : []
    : v && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => badTimes(x, [...path, k]))
      : [];
const rowKeys = (v: any, path: string[]): any[] => {
  const r = rowAt(v, path);
  return Array.isArray(r) ? r : isTimedKey(r) ? [r] : [];
};
export const KeyFile = z
  .union([z.looseObject({}), z.array(z.unknown())])
  .superRefine((v: any, ctx) => {
    for (const path of badTimes(v))
      ctx.addIssue({
        code: "custom",
        message:
          rowAt(v, path as string[]) === undefined
            ? `no "t": every row of a key list has its second, or the studio drops the whole list`
            : `"t" is a number of seconds, not ${JSON.stringify(rowAt(v, path as string[]))}`,
        path,
      });
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
export const keyFileSchema = (requiredRows: string[][] = [], edit?: string) => {
  const base = KeyFile.superRefine((v: any, ctx) => {
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
  if (edit === "placed") return base.and(PlacedTimeline);
  if (edit === "face") return base.and(FaceTimeline);
  return base;
};

export const problems = (schema: z.ZodType<any>, value: unknown, where: string): string[] => {
  const r = schema.safeParse(value);
  return r.success ? [] : [`${where}\n${z.prettifyError(r.error)}`];
};

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

const focusTargetFaults = (
  tools: any,
  cam?: any[],
  camPath = "src/timeline/cam.json",
): string[] => {
  if (!tools || !Array.isArray(cam)) return [];
  const issues: string[] = [];
  cam.forEach((key, i) => {
    const name =
      typeof key?.focus === "string"
        ? key.focus
        : typeof key?.focus?.target === "string"
          ? key.focus.target
          : null;
    if (!name || findTarget(tools, name)) return;
    issues.push(`${camPath} [${i}].focus\n✖ ${targetHelp(tools, name, { camera: false })}`);
  });
  return issues;
};

export const checkFilm = (scene: unknown, draw: any, cam?: any[], camPath?: string): string[] => [
  ...problems(SceneModule, scene, "src/scene.ts exports"),
  ...(typeof draw === "function"
    ? [
        ...problems(
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
        ),
        ...focusTargetFaults(draw.tools, cam, camPath),
      ]
    : ["buildScene()\n✖ must resolve to draw(t), a function"]),
];
