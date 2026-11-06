// @ts-nocheck
// A copy of one stretch of "The Sealed Room" (Desktop/minecraft-openai-huggingface-incident-gohans, 1:21.3-1:34.1:
// the pages flung off the desk, then the dig through the drawer), so the motion layers can be watched on a real scene.
// Keys and poses are copied from that film's src/timeline/steve.json and src/steve.ts (not linked: the film is never
// touched from here). Left out: the walk at 1:23.35 (no planted feet here, so he kneels where he stands), hand targets
// (the arms keep the pose's own) and props (each anchor is a fixed point where that prop is). IDLE below is made from
// the film's poses but is not a scene of it.
import * as THREE from "three";
import { MOODS, PX, addPose, arm, leg } from "mc-actor/player";

export const POSES = {
  stand: (s) => addPose(arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6), arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6), { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] }),
  desk: (s) => addPose(POSES.stand(s), { body: [16, 0, 0], head: [18, 0, 0] }),
  readUp: (s) => addPose(POSES.stand(s), { body: [4, 0, 0], chest: [-3, 0, 0] }),
  fling: (s) => addPose(POSES.stand(s), { body: [14, 26, 0], chest: [4, 16, 0] }),
  pant: (s) => addPose(POSES.stand(s), { body: [6, 0, 0], chest: [-2 + 3 * Math.sin(s * 6.5), 0, 0] }),
  kneel: (s, lean = 0) => addPose(leg("L", 0, 3, 90), leg("R", 0, 3, 90), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.2 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  pull: (s) => POSES.kneel(s, 18),
  hold: (s) => POSES.kneel(s, 10),
  digReach: (s) => POSES.kneel(s, 42),
  digRead: (s) => addPose(POSES.kneel(s, 4), { head: [4, 0, 0] }),
  tossR: (s) => addPose(POSES.kneel(s, 8), { chest: [0, -24, 0], body: [0, -10, 0] }),
  tossL: (s) => addPose(POSES.kneel(s, 8), { chest: [0, 24, 0], body: [0, 10, 0] }),
  frenzy: (s) => addPose(POSES.kneel(s, 40), { chest: [3 * Math.sin(s * 9.4), 6 * Math.sin(s * 4.7), 0] }),
  gasp: (s) => addPose(POSES.stand(s), arm("L", 75, 30, 0, 80), arm("R", 75, 30, 0, 80), { body: [-14, 0, 0], head: [-16, 0, 0] }),
  oneKnee: (s, lean = 0) => addPose(leg("R", 0, 3, 90), leg("L", 70, 3, 70), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.15 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  kneelPull: (s) => POSES.oneKnee(s, 45),
  kneelBack: (s) => POSES.oneKnee(s, 12),
};

const AT = [1.88, 0, 9.55];
export const MOVES = [
  [81.3, "readUp"], [81.5, "desk"], [81.8, "fling"], [82.35, "pant"], [83.75, "kneelPull"], [84.1, "kneelBack"],
  [84.45, "digRead"], [84.55, "digReach"], [84.97, "digRead"], [86.04, "tossR"], [86.19, "digReach"], [86.61, "digRead"],
  [87.43, "tossL"], [87.58, "digReach"], [88.0, "digRead"], [88.62, "tossR"], [88.77, "digReach"], [89.19, "digRead"],
  [89.66, "tossL"], [89.81, "digReach"], [90.23, "digRead"], [90.6, "tossR"], [90.75, "digReach"], [91.17, "digRead"],
  [91.46, "tossL"], [91.56, "frenzy"], [94.12, "pull"],
].map(([t, pose]) => ({ t, pose, at: AT, yaw: -90 }));

const PT = { desk_page: [0.98, 1.27, 9.75], handle: [1.3, 0.45, 9.55], folder: [1.3, 0.45, 9.55] };
const P = (a) => (typeof a === "string" ? PT[a.replace(/_\d+$/, "")] : a);
export const LOOK = [
  [81.15, "desk_page"], [81.45, "desk_page"], [81.7, [1.7, 0.1, 10.55]], [82.9, [1.7, 0.1, 10.55]], [83.3, "handle"],
  [84.15, [1.3, 0.4, 9.55]], [84.5, "folder_0"], [84.92, [1.55, 1.15, 9.45]], [86.02, [1.55, 1.15, 9.45]], [86.14, "folder_1"],
  [86.17, [2.6, 0.3, 9.1]], [86.56, [1.55, 1.15, 9.65]], [87.41, [1.55, 1.15, 9.65]], [87.53, "folder_2"], [87.56, [2.6, 0.3, 10.0]],
  [87.95, [1.55, 1.15, 9.45]], [88.6, [1.55, 1.15, 9.45]], [88.72, "folder_3"], [88.75, [2.6, 0.3, 9.1]], [89.14, [1.55, 1.15, 9.65]],
  [89.64, [1.55, 1.15, 9.65]], [89.76, "folder_4"], [89.79, [2.6, 0.3, 10.0]], [90.18, [1.55, 1.15, 9.45]], [90.58, [1.55, 1.15, 9.45]],
  [90.7, "folder_5"], [90.73, [2.6, 0.3, 9.1]], [91.12, [1.55, 1.15, 9.65]], [91.44, [1.55, 1.15, 9.65]], [91.56, [1.3, 0.4, 9.55]],
  [91.59, [2.6, 0.3, 10.0]], [94.12, "handle"],
].map(([t, at]) => ({ t, at: P(at) }));

const FACE = [[80.6, "restless"], [81.15, "seething"], [84.2, "curious"], [85.57, "unimpressed"], [86.61, "curious"], [87.06, "unimpressed"], [89.43, "restless"], [90.41, "seething"]].map(([t, mood]) => ({ t, mood }));
export const DIG = { name: "dig", from: 81.3, to: 94.6, moves: MOVES, look: LOOK, face: FACE, blinksFrom: 27 };

// Not in the film: the film's own poses arranged so the standing life shows. He stands idle (breath, weight shifts),
// starts at something up to his right (gasp: arms up, leaning back), recovers, then a burst of flinging (effort), pants
// and stands idle again. Look keys: null is the pose's own head.
const ST = (t, pose) => ({ t, pose, at: AT, yaw: -90 });
export const IDLE = {
  name: "idle", from: 0, to: 22, blinksFrom: 0,
  moves: [ST(0, "stand"), ST(5, "stand"), ST(5.2, "gasp"), ST(6.2, "gasp"), ST(6.9, "stand"), ST(9, "stand"), ST(9.3, "fling"), ST(9.6, "readUp"),
    ST(9.9, "fling"), ST(10.2, "readUp"), ST(10.5, "fling"), ST(10.8, "desk"), ST(11.1, "fling"), ST(11.5, "pant"), ST(12.6, "stand"), ST(22, "stand")],
  look: [{ t: 0, at: null }, { t: 5, at: null }, { t: 5.15, at: [0.6, 2.1, 8.4] }, { t: 6.6, at: [0.6, 2.1, 8.4] }, { t: 7.2, at: null }],
  face: [{ t: 0, mood: "neutral" }, { t: 5.15, mood: "surprised" }, { t: 6.6, mood: "uneasy" }, { t: 9, mood: "restless" }, { t: 11.5, mood: "seething" }, { t: 14, mood: "annoyed" }],
};

export const FACES = {
  uneasy: { y: 0.15, tilt: 14, open: 0.9, squint: 0, pupil: 0.95, smile: -0.25 },
  annoyed: { y: 0, tilt: -6, open: 0.85, squint: 0.15, pupil: 1, smile: -0.3 },
  restless: { y: 0, tilt: -10, open: 0.9, squint: 0.25, pupil: 1, smile: -0.55 },
  seething: { y: 0.05, tilt: -14, open: 0.95, squint: 0.2, pupil: 0.9, smile: -0.7 },
  curious: { y: 0.3, tilt: 4, open: 1, squint: 0, pupil: 0.85, smile: 0.1 },
  unimpressed: { y: -0.1, tilt: 6, open: 0.55, squint: 0.15, pupil: 1, smile: -0.4 },
};
const moodOf = (n) => FACES[n] ?? MOODS[n] ?? MOODS.neutral;
const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
export function moodAt(FACE, t) {
  let i = 0; while (i < FACE.length - 1 && t >= FACE[i + 1].t) i++;
  const a = moodOf(FACE[i].mood), prev = i > 0 ? moodOf(FACE[i - 1].mood) : a, k = t < FACE[i].t ? 0 : smooth((t - FACE[i].t) / 0.5);
  return Object.fromEntries(Object.keys(MOODS.neutral).map((f) => [f, THREE.MathUtils.lerp(prev[f] ?? 0, a[f] ?? 0, k)]));
}
export function blinkAt(t, from = 27) {
  if (t < from) return 0;
  let at = from + 1.5, n = 0;
  while (at < t - 0.2) { n++; at += 2.5 + 3 * ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1; }
  const u = (t - at) / 0.16;
  return u >= 0 && u <= 1 ? Math.sin(u * Math.PI) : 0;
}
