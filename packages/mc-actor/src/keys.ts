// @ts-nocheck
// The actor's keys (a film's src/timeline/steve.json) checked whole, the first time perform.ts reads each list: a typo
// anywhere in the film stops the page at once with every problem, its key, its time and the names that would be right,
// instead of a face that quietly goes neutral, or a crash only when the play head reaches that key. Fields are strict:
// one perform.ts doesn't read is an error (an "pos" for "at" would otherwise be ignored). A field perform.ts learns to read
// goes in MOVE here too.
import * as z from "zod";
import { EASES } from "film-stage/camera";

const t = z.number().nonnegative();
const xyz = z.tuple([z.number(), z.number(), z.number()]);
const unit = z.number().min(0).max(1);
const ease = z.union([z.enum(Object.keys(EASES)), z.tuple([unit, z.number(), unit, z.number()])]);
// a hand or look target: a world point, a film anchor's name or object, or null to let go
const target = z.union([z.null(), xyz, z.string().min(1), z.looseObject({})]);

export const MOVE = z.strictObject({
  t, at: xyz, yaw: z.number(), pose: z.string().optional(), clip: z.string().optional(), walk: z.boolean().optional(),
  via: z.string().optional(), do: z.string().optional(), from: z.number().optional(), rate: z.number().optional(), // 0 holds the clip's frame at from
  loop: z.boolean().optional(), blend: z.number().nonnegative().optional(), add: z.record(z.string(), z.unknown()).optional(),
  ease: ease.optional(),
}).refine((k) => !!k.pose !== !!k.clip, "a move key holds a body pose or a mocap clip: exactly one of pose, clip");
const TARGET = z.strictObject({ t, R: target.optional(), L: target.optional(), at: target.optional() });
const FACE = z.strictObject({ t, mood: z.string().min(1) });

// the closest of the right names, for a typo
const near = (word, names) => {
  const d = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    }
    return row[b.length];
  };
  const best = names.map((n) => [n, d(word.toLowerCase(), n.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(2, word.length / 3) ? ` (did you mean "${best[0]}"?)` : "";
};
const list = (names) => (names.length > 12 ? `${names.slice(0, 12).join(", ")}, ...` : names.join(", "));

// problems as lines; at: where a key is, e.g. moves[12] (t 45.2)
function check(keys, schema, row, more = () => []) {
  if (!Array.isArray(keys)) return [`${row}: a list of keys, got ${typeof keys}`];
  const out = [];
  const at = (i) => `${row}[${i}]${Number.isFinite(keys[i]?.t) ? ` (t ${keys[i].t})` : ""}`;
  keys.forEach((k, i) => {
    const r = schema.safeParse(k);
    if (!r.success) for (const e of r.error.issues) out.push(`${at(i)}${e.path.length ? ` ${e.path.join(".")}` : ""}: ${e.message}`);
    else out.push(...more(k, i).map((m) => `${at(i)}: ${m}`));
    if (i && Number.isFinite(k?.t) && k.t < keys[i - 1]?.t) out.push(`${at(i)}: comes before the key above it (${keys[i - 1].t}); keys go in order of time`);
  });
  return out;
}

const fail = (lines) => { if (lines.length) throw new Error(`The actor's keys (src/timeline/steve.json) are wrong:\n${lines.join("\n")}`); };

// moves against the film's poses, and against the loaded clips when it has them (clips: loadClips' result, or null)
export function checkMoves(moves, poses, clips) {
  const names = Object.keys(poses), loaded = clips ? Object.keys(clips) : null;
  fail(check(moves, MOVE, "moves", (k, i) => [
    ...(k.pose && !poses[k.pose] ? [`pose "${k.pose}" is not one of the film's poses (src/steve.ts POSES: ${list(names)})${near(k.pose, names)}`] : []),
    ...(k.via && !poses[k.via] ? [`via "${k.via}" is not one of the film's poses${near(k.via, names)}`] : []),
    ...(k.clip && loaded && !clips[k.clip] ? [`clip "${k.clip}" is not loaded (scene.ts loadClips gets every move's clip; is the name right?)${near(k.clip, loaded)}`] : []),
    ...(k.walk && i && moves[i - 1].clip ? [`a walk can't start out of a clip: put a key where the clip leaves him first`] : []),
  ]));
}

export const checkTargets = (keys, row) => fail(check(keys, TARGET, row));

export function checkFaces(keys, moods) {
  const names = Object.keys(moods);
  fail(check(keys, FACE, "face", (k) => (moods[k.mood] ? [] : [`mood "${k.mood}" is not a face (player.ts MOODS, src/steve.ts FACES: ${list(names)})${near(k.mood, names)}`])));
}
