// @ts-nocheck
import { EASES } from "film-stage/camera";
// The actor's keys (a film's src/timeline/steve.json) checked whole, the first time perform.ts reads each list: a typo
// anywhere in the film stops the page at once with every problem, its key, its time and the names that would be right,
// instead of a face that quietly goes neutral, or a crash only when the play head reaches that key. Fields are strict:
// one perform.ts doesn't read is an error (an "pos" for "at" would otherwise be ignored). A field perform.ts learns to read
// goes in MOVE_KEYS here too.

const isNum = (v): v is number => typeof v === "number" && Number.isFinite(v);
const isNonNeg = (v): v is number => isNum(v) && v >= 0;
const isUnit = (v): v is number => isNum(v) && v >= 0 && v <= 1;
const isPlain = (v): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isXyz = (v): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2]);
const isEase = (v) =>
  (typeof v === "string" && Object.hasOwn(EASES, v)) ||
  (Array.isArray(v) &&
    v.length === 4 &&
    isUnit(v[0]) &&
    isNum(v[1]) &&
    isUnit(v[2]) &&
    isNum(v[3]));
const isTarget = (v) =>
  v === null || isXyz(v) || (typeof v === "string" && v.length >= 1) || isPlain(v);

const MOVE_KEYS = new Set([
  "t",
  "at",
  "yaw",
  "pose",
  "clip",
  "walk",
  "via",
  "do",
  "from",
  "rate",
  "loop",
  "blend",
  "add",
  "ease",
]);
const TARGET_KEYS = new Set(["t", "R", "L", "at"]);
const FACE_KEYS = new Set(["t", "mood"]);

const unknownKeys = (k: Record<string, unknown>, allowed: Set<string>) => {
  const bad: string[] = [];
  for (const key in k) if (Object.hasOwn(k, key) && !allowed.has(key)) bad.push(key);
  return bad.length ? [`unrecognized key(s): ${bad.join(", ")}`] : [];
};

const validateMove = (k): string[] => {
  if (!isPlain(k)) return ["expected object"];
  const errs = unknownKeys(k, MOVE_KEYS);
  if (!isNonNeg(k.t)) errs.push("t: expected number >= 0");
  if (!isXyz(k.at)) errs.push("at: expected [x, y, z] numbers");
  if (!isNum(k.yaw)) errs.push("yaw: expected number");
  if (k.pose !== undefined && typeof k.pose !== "string") errs.push("pose: expected string");
  if (k.clip !== undefined && typeof k.clip !== "string") errs.push("clip: expected string");
  if (k.walk !== undefined && typeof k.walk !== "boolean") errs.push("walk: expected boolean");
  if (k.via !== undefined && typeof k.via !== "string") errs.push("via: expected string");
  if (k.do !== undefined && typeof k.do !== "string") errs.push("do: expected string");
  if (k.from !== undefined && !isNum(k.from)) errs.push("from: expected number");
  if (k.rate !== undefined && !isNum(k.rate)) errs.push("rate: expected number");
  if (k.loop !== undefined && typeof k.loop !== "boolean") errs.push("loop: expected boolean");
  if (k.blend !== undefined && !isNonNeg(k.blend)) errs.push("blend: expected number >= 0");
  if (k.add !== undefined && !isPlain(k.add)) errs.push("add: expected object");
  if (k.ease !== undefined && !isEase(k.ease)) errs.push("ease: expected ease name or 4 numbers");
  if (!errs.length && !!k.pose === !!k.clip)
    errs.push("a move key holds a body pose or a mocap clip: exactly one of pose, clip");
  return errs;
};

const validateTarget = (k): string[] => {
  if (!isPlain(k)) return ["expected object"];
  const errs = unknownKeys(k, TARGET_KEYS);
  if (!isNonNeg(k.t)) errs.push("t: expected number >= 0");
  for (const hand of ["R", "L", "at"]) {
    if (k[hand] !== undefined && !isTarget(k[hand]))
      errs.push(`${hand}: expected point [x, y, z], anchor, object or null`);
  }
  return errs;
};

const validateFace = (k): string[] => {
  if (!isPlain(k)) return ["expected object"];
  const errs = unknownKeys(k, FACE_KEYS);
  if (!isNonNeg(k.t)) errs.push("t: expected number >= 0");
  if (typeof k.mood !== "string" || k.mood.length < 1) errs.push("mood: expected non-empty string");
  return errs;
};

// the closest of the right names, for a typo
const near = (word, names) => {
  const d = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return row[b.length];
  };
  const best = names
    .map((n) => [n, d(word.toLowerCase(), n.toLowerCase())])
    .sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(2, word.length / 3) ? ` (did you mean "${best[0]}"?)` : "";
};
const list = (names) =>
  names.length > 12 ? `${names.slice(0, 12).join(", ")}, ...` : names.join(", ");

// problems as lines; at: where a key is, e.g. moves[12] (t 45.2)
function check(
  keys,
  validate: (k) => string[],
  row,
  more: (k: any, i: number) => string[] = () => [],
) {
  if (!Array.isArray(keys)) return [`${row}: a list of keys, got ${typeof keys}`];
  const out = [];
  const at = (i) => `${row}[${i}]${Number.isFinite(keys[i]?.t) ? ` (t ${keys[i].t})` : ""}`;
  keys.forEach((k, i) => {
    const errs = validate(k);
    if (errs.length) {
      for (const e of errs) out.push(`${at(i)} ${e}`);
    } else {
      out.push(...more(k, i).map((m) => `${at(i)}: ${m}`));
    }
    if (i && Number.isFinite(k?.t) && k.t < keys[i - 1]?.t)
      out.push(
        `${at(i)}: comes before the key above it (${keys[i - 1].t}); keys go in order of time`,
      );
  });
  return out;
}

const fail = (lines) => {
  if (lines.length)
    throw new Error(`The actor's keys (src/timeline/steve.json) are wrong:\n${lines.join("\n")}`);
};

// moves against the film's poses, and against the loaded clips when it has them (clips: loadClips' result, or null)
export function checkMoves(moves, poses, clips) {
  const names = Object.keys(poses),
    loaded = clips ? Object.keys(clips) : null;
  fail(
    check(moves, validateMove, "moves", (k, i) => [
      ...(k.pose && !poses[k.pose]
        ? [
            `pose "${k.pose}" is not one of the film's poses (src/steve.ts POSES: ${list(names)})${near(k.pose, names)}`,
          ]
        : []),
      ...(k.via && !poses[k.via]
        ? [`via "${k.via}" is not one of the film's poses${near(k.via, names)}`]
        : []),
      ...(k.clip && loaded && !clips[k.clip]
        ? [
            `clip "${k.clip}" is not loaded (scene.ts loadClips gets every move's clip; is the name right?)${near(k.clip, loaded)}`,
          ]
        : []),
      ...(k.walk && i && moves[i - 1]?.clip
        ? [`a walk can't start out of a clip: put a key where the clip leaves him first`]
        : []),
    ]),
  );
}

export const checkTargets = (keys, row) => fail(check(keys, validateTarget, row));

export function checkFaces(keys, moods) {
  const names = Object.keys(moods);
  fail(
    check(keys, validateFace, "face", (k) =>
      moods[k.mood]
        ? []
        : [
            `mood "${k.mood}" is not a face (player.ts MOODS, src/steve.ts FACES: ${list(names)})${near(k.mood, names)}`,
          ],
    ),
  );
}
