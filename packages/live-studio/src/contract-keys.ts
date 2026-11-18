// Pure field-key lists and timed key-row helpers shared with app/ without pulling zod into initial browser bundles.
export const SOUND_KEYS = {
  audio: ["beds", "sfx", "tracks", "narration", "voice", "voiceGain", "lufs", "drive"],
  beds: [
    "name",
    "from",
    "to",
    "gain",
    "gainKeys",
    "rate",
    "pitch",
    "changePitch",
    "reverse",
    "voiceFilter",
    "voiceStrength",
    "dialogue",
    "beats",
    "beatMode",
    "bpm",
    "beatSource",
    "fadeIn",
    "fadeOut",
    "start",
    "duck",
    "pan",
    "try",
    "filters",
    "track",
  ],
  sfx: [
    "at",
    "name",
    "gain",
    "gainKeys",
    "rate",
    "pitch",
    "changePitch",
    "reverse",
    "voiceFilter",
    "voiceStrength",
    "dialogue",
    "beats",
    "beatMode",
    "bpm",
    "beatSource",
    "start",
    "length",
    "fadeIn",
    "fadeOut",
    "pan",
    "try",
    "filters",
    "track",
  ],
};

export const CAM_KEYS = [
  "id",
  "t",
  "p",
  "l",
  "cut",
  "tailId",
  "locked",
  "reason",
  "ease",
  "easeChannels",
  "fov",
  "mm",
  "focus",
  "fstop",
  "handheld",
  "wave",
  "roll",
  "bob",
  "motion",
  "reversePath",
];
export const SHOT_KEYS = ["id", "t", "cameraClock", "name", "anim", "transition", "adjust", "hits"];
export const SHOT_SLOT_KEYS = [
  ...["in", "out", "combo"].flatMap((s) =>
    ["fx", "len", "k", "curve", "flip", "optics", "seam"].map((k) => `anim.${s}.${k}`),
  ),
  ...["fx", "len", "ease", "feather", "flip", "props"].map((k) => `transition.${k}`),
];
export const ADJUSTMENT_KEYS = ["id", "name", "from", "to", "track", "grade", "timebase"];
export const TEXT_KEYS = [
  "kind",
  "from",
  "to",
  "timebase",
  "track",
  "text",
  "x",
  "y",
  "at",
  "in",
  "out",
  "read",
];
export const TEXT_SLOT_KEYS = ["in", "out"].flatMap((s) =>
  ["fx", "len", "ease", "stagger", "tint", "hold"].map((k) => `${s}.${k}`),
);

export const isTimedKey = (k: any): k is { t: number } =>
  !!k && typeof k === "object" && !Array.isArray(k) && Number.isFinite(k.t);

export const keyRows = (v: any, path: string[] = []): string[][] => {
  if (Array.isArray(v)) return v.length && v.every(isTimedKey) ? [path] : [];
  if (!v || typeof v !== "object") return [];
  const own = path.length > 0 && isTimedKey(v) ? [path] : [];
  return [...own, ...Object.entries(v).flatMap(([k, x]) => keyRows(x, [...path, k]))];
};

export const rowAt = (v: any, path: string[]): any => path.reduce((x, k) => x?.[k], v);
