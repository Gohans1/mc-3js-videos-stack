// One mood knob for every layer: Laban Movement Analysis describes how a person moves with four Effort factors, each
// from indulging to fighting (Space indirect..direct, Weight light..strong, Time sustained..sudden, Flow free..bound);
// EMOTE (Chi, Costa, Zhao & Badler, SIGGRAPH 2000) showed those four numbers, applied to the same key poses, change what
// a performance means. EMOTE drives its own interpolation and arm parameters; this maps the same four factors onto
// film-kit's layers instead, so it is in EMOTE's spirit, not its equations. Shape's rise..sink (EMOTE's torso) is added
// as a held bend of the chest and head.
//   const fx = effort(MOOD.tense);   overlap(base, end, fx.overlap); cartoon(base, end, fx.cartoon); idle(base, end, { ...fx.idle, standing });
//   gaze(shifts, end, fx.gaze); micro(fx.micro); keys = phrase(keys, fx.hold); pose = addPose(pose, fx.posture)
// Each factor -1..1, 0 neutral (every layer at its default).
//   time > 0 (sudden): each move holds its start pose, then goes in the rest of its time (phrase); sharper anticipation.
//   weight > 0 (strong): bigger anticipation, follow-through and settle; < 0 (light): smaller.
//   flow > 0 (bound, held back): stiffer joints that swing less, less drift; < 0 (free): looser, more swing.
//   space > 0 (direct): longer fixations on fewer points near the target; < 0 (indirect): eyes and body wander.
//   sink > 0: the chest and head bend forward and down (tired, beaten); < 0 rises (alert, proud).
import type { Pose } from "./pose";

export type Effort = { space?: number; weight?: number; time?: number; flow?: number; sink?: number };
export const MOOD: Record<string, Effort> = {
  calm: {},
  tense: { space: 0.7, weight: 0.4, time: 0.8, flow: 0.8, sink: -0.3 },
  tired: { space: -0.6, weight: -0.7, time: -0.8, flow: -0.5, sink: 0.8 },
};

const c1 = (x = 0) => Math.max(-1, Math.min(1, x));

export function effort(e: Effort = {}) {
  const space = c1(e.space), weight = c1(e.weight), time = c1(e.time), flow = c1(e.flow), sink = c1(e.sink);
  return {
    hold: 0.4 * Math.max(0, time),
    overlap: { damping: 0.6 + 0.25 * flow, amount: 1 - 0.45 * flow },
    cartoon: { amount: Math.max(0, 0.25 * (1 + 0.6 * weight + 0.4 * time)) },
    idle: { settle: Math.max(0, 1 + 0.6 * weight + 0.3 * time), sway: Math.max(0, 1 - 0.5 * flow) },
    gaze: { mean: 0.75 * (1 + 0.6 * space), wander: Math.max(0.2, 1 - 0.6 * space) },
    micro: { amount: Math.max(0, 1 - 0.4 * flow - 0.4 * space) },
    posture: { chest: [6 * sink, 0, 0], head: [3 * sink, 0, 0] } as Pose,
  };
}

// Key times rephrased for a sudden Time: each move between two keys holds its first pose for `hold` of its interval and
// then moves in the rest, so it lands on the same key time, faster. Returns the keys with a held copy added before each
// move (same fields, `held: true`); the caller blends them as before (a key equal to the one before stops there). A move
// into or out of a key with a `clip` (mocap keeps its own timing) is left as it is.
export function phrase<K extends { t: number; clip?: unknown }>(keys: K[], hold: number): (K & { held?: boolean })[] {
  if (!(hold > 0)) return keys;
  const out: (K & { held?: boolean })[] = [];
  keys.forEach((k, i) => {
    out.push(k);
    const n = keys[i + 1];
    if (n && n.t - k.t > 0.05 && !k.clip && !n.clip) out.push({ ...k, t: k.t + hold * (n.t - k.t), held: true });
  });
  return out;
}
