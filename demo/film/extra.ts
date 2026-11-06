// @ts-nocheck
// Scenes made for the demo, not from the film: each shows one layer that the film scene can't (it has no walk, hand
// targets or clips here). Same rig and poses as dig.ts.
//   WALK: he starts, walks along -x, swerves out to his left and back, brakes and stops (lean into acceleration).
//   REACH: standing, his right hand goes to a shelf, a table at his side, the front, and back down (hand arcs); hand
//     points are in his own axes (x his left, y up, z forward, metres from his feet).
//   MOCAP: authored standing keys around two Mixamo clips (a startle that looks right, a breathing idle), the way the film
//     mixes them: every layer fades out over a clip and back after it (pose.ts mask).
const AT = [1.88, 0, 9.55];
const ST = (t, pose) => ({ t, pose, at: AT, yaw: -90 });

// the walk: speed up to 1.3 m/s over 1-2 s, swerve 0.6 m between 2 and 6 m walked, brake over 7.2-7.9 s
const HZ = 60, END = 12;
const speed = (t) => (t < 1 ? 0 : t < 2 ? 1.3 * (t - 1) : t < 7.2 ? 1.3 : t < 7.9 ? 1.3 * (1 - (t - 7.2) / 0.7) : 0);
const S = [0];
for (let i = 1; i <= END * HZ + 2; i++) S.push(S[i - 1] + speed((i - 0.5) / HZ) / HZ);
// out to his left and back between 2 and 6 m walked, flat at both ends so his facing never snaps
const side = (s) => (s < 2 || s > 6 ? 0 : 0.3 * (1 - Math.cos((2 * Math.PI * (s - 2)) / 4)));
const pathPoint = (t) => { const x = Math.min(Math.max(t * HZ, 0), S.length - 1.001), i = Math.floor(x), s = S[i] + (S[i + 1] - S[i]) * (x - i); return { s, x: AT[0] - s, z: AT[2] + side(s) }; };
export const walkPath = (t) => {
  const a = pathPoint(t), b = pathPoint(t + 0.02), c = pathPoint(t - 0.02);
  const dx = b.x - c.x, dz = b.z - c.z, moving = Math.hypot(dx, dz) > 1e-5;
  // facing follows the way he walks (three.js yaw: 0 faces +z); at rest the way he last walked
  const yaw = moving ? (Math.atan2(dx, dz) * 180) / Math.PI : -90;
  return { x: a.x, z: a.z, yaw, dist: a.s, speed: speed(t) };
};
export const WALK = {
  name: "walk", from: 0, to: END, blinksFrom: 0, moves: [ST(0, "stand"), ST(END, "stand")], look: [],
  face: [{ t: 0, mood: "neutral" }], path: walkPath,
};

export const REACH = {
  name: "reach", from: 0, to: 9, blinksFrom: 0, moves: [ST(0, "stand"), ST(9, "stand")],
  look: [{ t: 0, at: null }, { t: 1.2, at: null }, { t: 1.6, at: [1.43, 1.7, 9.8] }, { t: 3.2, at: [1.43, 1.7, 9.8] }, { t: 3.5, at: [1.36, 0.95, 10.0] }, { t: 5, at: [1.36, 0.95, 10.0] }, { t: 5.3, at: null }],
  face: [{ t: 0, mood: "neutral" }, { t: 1.6, mood: "curious" }],
  // right hand: null is the pose's own arm
  hands: [{ t: 0, R: null }, { t: 1, R: "rest" }, { t: 2.1, R: [-0.25, 1.7, 0.45] }, { t: 3.1, R: [-0.25, 1.7, 0.45] }, { t: 4, R: [-0.4, 1.0, 0.52] }, { t: 5, R: [-0.4, 1.0, 0.52] }, { t: 5.9, R: [-0.2, 0.95, 0.4] }, { t: 6.6, R: [-0.2, 0.95, 0.4] }, { t: 7.6, R: "rest" }, { t: 8.2, R: null }],
};

export const CLIP_A = "mixamo/Being_Surprised_And_Looking_Right_c9c8214a", CLIP_B = "mixamo/Breathing_Idle_c9c6d0d5";
// clip lengths are known once loaded: dur[ref] seconds
export const mocapScene = (dur) => {
  const a0 = 3, a1 = a0 + dur[CLIP_A], b0 = a1 + 4, b1 = b0 + 5, end = b1 + 4;
  return {
    name: "mocap", from: 0, to: end, blinksFrom: 0,
    // a clip key plays from its time; the same clip keyed again where it ends (from: that far in) holds it whole, then
    // the next key blends out of it, as in the film's steve.ts
    moves: [ST(0, "stand"), ST(2.4, "stand"), { ...ST(a0, null), clip: CLIP_A }, { ...ST(a1, null), clip: CLIP_A, from: a1 - a0 }, ST(a1 + 0.6, "stand"),
      ST(b0 - 0.6, "stand"), { ...ST(b0, null), clip: CLIP_B, loop: true }, { ...ST(b1, null), clip: CLIP_B, loop: true, from: b1 - b0 }, ST(b1 + 0.6, "stand"), ST(end, "stand")],
    look: [], face: [{ t: 0, mood: "neutral" }, { t: a0 + 0.2, mood: "surprised" }, { t: a1, mood: "uneasy" }],
    clips: [[a0, a1], [b0, b1]],
    // the same moments acted with hand-made keys and no clip: a start that looks to his right (gasp pose, head and eyes to
    // a point there), then standing where the breathing clip is (film-kit's breath and sway do the idle)
    authored: {
      moves: [ST(0, "stand"), ST(2.4, "stand"), ST(a0 + 0.25, "gasp"), ST(a0 + 0.55 * (a1 - a0), "gasp"), ST(a1 + 0.6, "stand"), ST(end, "stand")],
      look: [{ t: 0, at: null }, { t: a0, at: null }, { t: a0 + 0.3, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] }, { t: a1, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] }, { t: a1 + 0.7, at: null }],
    },
  };
};
