// Pure field-key lists and timed key-row helpers shared with app/ without pulling zod into initial browser bundles.
export const SOUND_KEYS = {
  audio: [
    "beds",
    "sfx",
    "tracks",
    "narration",
    "voice",
    "voiceGain",
    "lufs",
    "drive",
    "reverb",
    "spaces",
  ],
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
    "reverb",
    "spatial",
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
    "reverb",
    "spatial",
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
  "muted",
  "color",
  "inHandle",
  "outHandle",
  "railU",
  "reason",
  "ease",
  "matchSpeed",
  "easeChannels",
  "fov",
  "mm",
  "dollyZoomScale",
  "focus",
  "fstop",
  "handheld",
  "wave",
  "roll",
  "bob",
  "motion",
  "reversePath",
];
export const SHOT_KEYS = [
  "id",
  "t",
  "cameraClock",
  "camera",
  "shutter",
  "continuityAxis",
  "name",
  "anim",
  "transition",
  "adjust",
  "hits",
];
export const SHOT_SLOT_KEYS = [
  ...["in", "out", "combo"].flatMap((s) =>
    ["fx", "len", "k", "delay", "curve", "flip", "optics", "seam"].map((k) => `anim.${s}.${k}`),
  ),
  ...["params", "fx", "len", "ease", "feather", "flip", "props"].map((k) => `transition.${k}`),
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
export const PLACED_OBJECT_KEYS = ["what", "properties", "clip", "rate", "keys"];
export const PLACED_KEY_KEYS = ["t", "at", "rot", "scale", "visible", "ease", "clip", "rate"];
export const PICK_KEYS = ["jar", "namespace", "blocks", "items", "licence", "license", "page"];

export const isTimedKey = (k: any): k is { t: number } =>
  !!k && typeof k === "object" && !Array.isArray(k) && Number.isFinite(k.t);

export const keyRows = (v: any, path: string[] = []): string[][] => {
  if (Array.isArray(v)) return v.length && v.every(isTimedKey) ? [path] : [];
  if (!v || typeof v !== "object") return [];
  const own = path.length > 0 && isTimedKey(v) ? [path] : [];
  return [...own, ...Object.entries(v).flatMap(([k, x]) => keyRows(x, [...path, k]))];
};

export const rowAt = (v: any, path: string[]): any => path.reduce((x, k) => x?.[k], v);

const containsNestedTimed = (v: unknown, seen: WeakSet<object>): boolean => {
  if (!v || typeof v !== "object") return false;
  if (seen.has(v)) return false;
  seen.add(v);
  if (Array.isArray(v)) {
    return v.some((item) => isTimedKey(item) || containsNestedTimed(item, seen));
  }
  return Object.values(v).some((child) => isTimedKey(child) || containsNestedTimed(child, seen));
};

/**
 * Finds paths to arrays whose non-timed object elements contain nested timed `{t}` arrays/objects
 * (e.g. `thugs: [{ id: "boss", moves: [{ t: 0 }] }]`), which `keyRows()` otherwise silently skips.
 */
export const nestedTimedArrayPaths = (
  v: any,
  path: string[] = [],
  seen = new WeakSet<object>(),
): string[][] => {
  if (!v || typeof v !== "object") return [];
  if (seen.has(v)) return [];
  seen.add(v);
  if (Array.isArray(v)) {
    if (!v.length || v.every(isTimedKey)) return [];
    const hasNested = v.some(
      (item) =>
        !!item &&
        typeof item === "object" &&
        !isTimedKey(item) &&
        containsNestedTimed(item, new WeakSet<object>([v])),
    );
    return hasNested ? [path] : [];
  }
  return Object.entries(v).flatMap(([k, x]) => nestedTimedArrayPaths(x, [...path, k], seen));
};
