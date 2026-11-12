// The body takes on the emotion the face shows: a held change of posture, and bigger or smaller movement. Measured on
// motion-captured walks (Roether, Omlor, Christensen & Giese 2009; Crane & Gross 2009 / Gross et al. 2012):
//   sadness: the head hangs, the strongest single cue of any emotion in the body (Roether: head inclination about 19
//     degrees more than neutral; Crane: the neck alone ~10 degrees more flexed); small, slow movements.
//   joy: head up (Roether ~6 degrees; Crane ~2), big fast movements.
//   anger: elbows bent more (Roether), head a little down (Crane ~3), big fast movements.
//   fear: elbows bent more, upper arms drawn back, knees bent (Roether: "widespread postural tension"), small movements.
// Directions are measured; for the head under sadness and joy the sizes are too. The elbow, arm and knee sizes here are
// chosen to read on screen in the measured direction (the papers report them in plots, not numbers).
// Walking speed per emotion is measured (Roether, m/s): anger 1.82, joy 1.31, fear 0.83, sadness 0.68.
//   const body = posture(faceKeys, { kind: KIND });   pose = addPose(pose, scalePose(body(t), clipMask(t)))
//   body.amp(t): how big the movement is, x neutral (scale overlap, cartoon, micro's drift); POSTURE.speed for a walk's pace
// The same keys as the face (express.ts), changing at each emotion's own pace, so face and body move together. A held
// offset like this sits on keyed poses; a mocap clip performs its own emotion, so fade it out over clip spans.
import { changeTime, KIND } from "./express";
import type { Pose } from "./pose";

type Shape = {
  head?: number[];
  chest?: number[];
  body?: number[];
  uaL?: number[];
  uaR?: number[];
  laL?: number[];
  laR?: number[];
  root?: Record<string, number>;
};
// joints in the character's axes: +x on body/chest/head bends forward and down; +x on the upper arms takes them back;
// -x on the forearms bends the elbows; root.y sinks the hips (planted-foot leg IK turns that into bent knees)
export const POSTURE: {
  shape: Record<string, Shape>;
  amp: Record<string, number>;
  speed: Record<string, number>;
} = {
  shape: {
    sadness: { head: [10, 0, 0], chest: [5, 0, 0], body: [4, 0, 0] },
    joy: { head: [-4, 0, 0], chest: [-2, 0, 0] },
    anger: { head: [3, 0, 0], laL: [-8, 0, 0], laR: [-8, 0, 0] },
    fear: {
      uaL: [5, 0, 0],
      uaR: [5, 0, 0],
      laL: [-10, 0, 0],
      laR: [-10, 0, 0],
      root: { y: -0.02 },
    },
  },
  amp: { sadness: 0.7, joy: 1.25, anger: 1.3, fear: 0.75 },
  speed: { neutral: 1.3, sadness: 0.68, fear: 0.83, joy: 1.31, anger: 1.82 },
};

const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
const JOINTS = ["head", "chest", "body", "uaL", "uaR", "laL", "laR"] as const;

// keys: [{ t, mood }] as the face's; kind maps a mood name to an emotion (express.ts KIND); k scales every shape
export function posture(
  keys: { t: number; mood: string }[],
  { kind = KIND, k = 1, tempo = 1 } = {},
) {
  const shapeOf = (m: string) => POSTURE.shape[kind[m] ?? ""] ?? {};
  const ampOf = (m: string) => POSTURE.amp[kind[m] ?? ""] ?? 1;
  // each change starts from wherever the last one had got to (a change cut short goes on from there)
  type S = { v: number[][]; y: number; a: number };
  const target = (m: string): S => {
    const s = shapeOf(m);
    return { v: JOINTS.map((j) => s[j] ?? [0, 0, 0]), y: s.root?.y ?? 0, a: ampOf(m) };
  };
  const mix = (a: S, b: S, u: number): S => ({
    v: a.v.map((x, i) => x.map((c, j) => c + (b.v[i][j] - c) * u)),
    y: a.y + (b.y - a.y) * u,
    a: a.a + (b.a - a.a) * u,
  });
  const from: S[] = [],
    dur: number[] = [];
  const at = (i: number, t: number): S =>
    i === 0
      ? target(keys[0].mood)
      : mix(from[i], target(keys[i].mood), minJerk((t - keys[i].t) / dur[i]));
  keys.forEach((key, i) => {
    dur.push(i === 0 ? 0 : changeTime(keys[i - 1].mood, key.mood, kind, tempo));
    from.push(i === 0 ? target(key.mood) : at(i - 1, key.t));
  });
  const now = (t: number) => {
    if (!keys.length) return null;
    let i = 0;
    while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
    return at(i, t);
  };
  const body = (t: number): Pose => {
    const s = now(t),
      out: Pose = { root: {} };
    if (!s) return out;
    JOINTS.forEach((j, i) => {
      if (s.v[i].some((c) => c !== 0)) out[j] = s.v[i].map((c) => c * k);
    });
    if (s.y) out.root!.y = s.y * k;
    return out;
  };
  return Object.assign(body, { amp: (t: number) => now(t)?.a ?? 1 });
}
