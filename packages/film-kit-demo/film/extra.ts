// @ts-nocheck
// Scenes made for the demo, not from the film: each shows one layer that the film scene can't (it has no walk, hand
// targets or clips here). Same rig and poses as dig.ts.
//   WALK: he starts, walks along -x, swerves out to his left and back, brakes and stops (lean into acceleration).
//   REACH: standing, his right hand goes to a shelf, a table at his side, the front, and back down (hand arcs); hand
//     points are in his own axes (x his left, y up, z forward, metres from his feet). The left Steve's look is keyed
//     by hand; the right one's comes only from where his hand goes (handLooks: film-kit handeye). The right one's hand
//     moves at its own pace (film-kit reach) and the reach to the front is unsure (doubt: hesitate), the hands shaking
//     a little (tremble: tremor).
//   SCARE: standing; a silverfish dashes across the floor in front of him in two bursts (eyes glide after it), a door
//     bangs behind him to his right (startle, breath held then let go, the turn to look), he stands thinking (eyes look
//     away), a second, softer bang (a smaller startle: habituation).
//     After the first bang he freezes (stillness of fear) while listening; something moves on the desk to his left twice
//     (he notices the first, the second pulls less: habituation). His hands shake from the bang until he calms (tremor).
//   MOCAP: authored standing keys around three Mixamo clips (a startle that looks right, a breathing idle, pushing a
//     button), the way the film mixes them: every layer fades out over a clip and back after it (pose.ts mask). During
//     the idle clip something moves to his left (a glance over the clip), then the bang and a freeze; the button clip's
//     reach is found in the clip's own hand path and the eyes go to the button first (eyes only: the clip's head does
//     its own). The hand-keyed Steve just stands through the button clip. The press is unsure: the clip's reach is
//     stretched (hesitate.ts) and his hands shake from the bang on (tremor over the clips). His eyes scan the place
//     at the start and again once the freeze lets go (explore: eyes only, so on over the clips too).
//   WAKE: see below. SCARE also looks around at the start and when the freeze ends.
import { stretch } from "film-kit/hesitate";

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
  name: "reach", from: 0, to: 9.6, blinksFrom: 0, moves: [ST(0, "stand"), ST(9.6, "stand")], tremble: [{ t: 4.8, until: 7.4, k: 0.6 }],
  look: [{ t: 0, at: null }, { t: 1.2, at: null }, { t: 1.6, at: [1.43, 1.7, 9.8] }, { t: 3.2, at: [1.43, 1.7, 9.8] }, { t: 3.5, at: [1.36, 0.95, 10.0] }, { t: 5, at: [1.36, 0.95, 10.0] }, { t: 5.3, at: null }],
  face: [{ t: 0, mood: "neutral" }, { t: 1.6, mood: "curious" }], handLooks: true,
  // right hand: null is the pose's own arm
  hands: [{ t: 0, R: null }, { t: 1, R: "rest" }, { t: 2.1, R: [-0.25, 1.7, 0.45] }, { t: 3.1, R: [-0.25, 1.7, 0.45] }, { t: 4, R: [-0.4, 1.0, 0.52] }, { t: 5, R: [-0.4, 1.0, 0.52] }, { t: 6.6, R: [-0.15, 1.05, 0.55], doubt: 1 }, { t: 7.3, R: [-0.15, 1.05, 0.55] }, { t: 8.3, R: "rest" }, { t: 8.9, R: null }],
};

// the turn to a bang's source: from 0.42 s after it (the orienting response) for a couple of seconds, then back
const orientKeys = (b, src) => [{ t: b.t + 0.42, at: null }, { t: b.t + 0.8, at: src }, { t: b.t + 2.2, at: src }, { t: b.t + 2.8, at: null }];
// behind him to his right (he faces -x; his right is -z)
const DOOR = [AT[0] + 1.0, 1.3, AT[2] - 2.6];

const BUG = [{ t: 1.8, p: [AT[0] - 2.0, 0.05, AT[2] - 0.55] }, { t: 2.8, p: [AT[0] - 1.8, 0.05, AT[2]] }, { t: 3.6, p: [AT[0] - 1.8, 0.05, AT[2]] }, { t: 4.6, p: [AT[0] - 2.1, 0.05, AT[2] + 0.55] }];
const ease = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
export const bugAt = (t) => {
  let i = 0;
  while (i < BUG.length - 2 && t >= BUG[i + 1].t) i++;
  const a = BUG[i], b = BUG[i + 1], k = ease((t - a.t) / (b.t - a.t));
  return a.p.map((v, c) => v + (b.p[c] - v) * k);
};
const BANGS = [{ t: 7, k: 1, at: DOOR }, { t: 17.5, k: 0.7, at: DOOR }];
// on the desk ahead to his left (he faces -x; his left is +z)
const DESK = [AT[0] - 0.9, 1.25, AT[2] + 0.9];
export const SCARE = {
  name: "scare", from: 0, to: 22, blinksFrom: 0, moves: [ST(0, "stand"), ST(22, "stand")],
  look: [{ t: 0, at: null }, ...BANGS.flatMap((b) => orientKeys(b, b.at))],
  face: [{ t: 0, mood: "neutral" }, { t: 1.8, mood: "worried" }, { t: 7.1, mood: "scared" }, { t: 10.5, mood: "worried" }],
  bangs: BANGS, bug: bugAt, pursuit: [[1.8, 5.6]], think: [[11, 16.5]],
  freeze: [{ t: 7.3, until: 10.5 }, { t: 17.8, until: 20.5, k: 0.7 }], tremble: [{ t: 7.3, until: 12, k: 0.8 }, { t: 17.8, until: 21, k: 0.5 }],
  sights: [{ t: 13.2, at: DESK }, { t: 15.4, at: DESK }],
  // the head follows the silverfish a quarter second behind (the eyes lead it), fading in as it starts and out after
  target: (t) => (t < 1.4 || t > 6.2 ? null : { at: bugAt(t - 0.25), w: ease((t - 1.4) / 0.4) * (1 - ease((t - 5.8) / 0.4)) }),
  shifts: [1.4], explore: [0, 10.5],
};

// he stands dozing, eyes shut; they open slowly and heavy, sink shut again for a moment, open again and stay heavy
// (drowsy blinks, low lids) while his eyes scan the place (explore); a bang wakes him fully (surprise comes on fast, then fear), he sinks into sadness (slow onset)
// and calms (slow offset); then he looks around again (a new event: explore)
const WAKE_BANG = { t: 11, k: 0.8, at: DOOR };
export const WAKE = {
  name: "wake", from: 0, to: 22, blinksFrom: 0, moves: [ST(0, "stand"), ST(22, "stand")],
  look: [{ t: 0, at: null }, ...orientKeys(WAKE_BANG, DOOR)], bangs: [WAKE_BANG],
  asleep: [[0, 2], [3.6, 4.5]], drowsy: [{ t: 0, k: 1 }, { t: 2, k: 1 }, { t: 10.9, k: 0.5 }, { t: 11.3, k: 0 }], explore: [2.1, 17.5],
  face: [{ t: 0, mood: "neutral" }, { t: 11.05, mood: "surprised" }, { t: 11.7, mood: "scared" }, { t: 14.3, mood: "sad" }, { t: 18, mood: "neutral" }],
};

export const CLIP_A = "mixamo/Being_Surprised_And_Looking_Right_c9c8214a", CLIP_B = "mixamo/Breathing_Idle_c9c6d0d5", CLIP_C = "mixamo/Pushing_A_Button_With_The_Right_Hand_c9c8f267";
// clip lengths are known once loaded: dur[ref] seconds
// the button clip's own reach, from the hand leaving to it on the button (seconds into the clip)
const PRESS = [0.35, 1.0];
export const mocapScene = (dur) => {
  const a0 = 3, a1 = a0 + dur[CLIP_A], b0 = a1 + 4, b1 = b0 + 5, c0 = b1 + 3, c1 = c0 + dur[CLIP_C], end = c1 + 3;
  // the keys stay on the clip's own clock; the film plays the press `extra` s longer
  const st = stretch(c0 + PRESS[0], PRESS[1] - PRESS[0], 1), x = st.extra;
  // a bang behind him in the middle of the breathing clip: the clip can't know about it, the startle layer adds the flinch
  const bang = { t: b0 + 2.5, k: 0.8, at: DOOR };
  return {
    bangs: [bang], explore: [0, b1 + 0.6], freeze: [{ t: bang.t + 0.3, until: b1 }], stretch: st, tremble: [{ t: bang.t + 0.3, until: c1 + x, k: 0.7 }], sights: [{ t: b0 + 0.8, at: [AT[0] - 1.2, 1.1, AT[2] + 1.6] }],
    name: "mocap", from: 0, to: end + x, blinksFrom: 0,
    // a clip key plays from its time; the same clip keyed again where it ends (from: that far in) holds it whole, then
    // the next key blends out of it, as in the film's steve.ts
    moves: [ST(0, "stand"), ST(2.4, "stand"), { ...ST(a0, null), clip: CLIP_A }, { ...ST(a1, null), clip: CLIP_A, from: a1 - a0 }, ST(a1 + 0.6, "stand"),
      ST(b0 - 0.6, "stand"), { ...ST(b0, null), clip: CLIP_B, loop: true }, { ...ST(b1, null), clip: CLIP_B, loop: true, from: b1 - b0 }, ST(b1 + 0.6, "stand"),
      ST(c0 - 0.6, "stand"), { ...ST(c0, null), clip: CLIP_C }, { ...ST(c1, null), clip: CLIP_C, from: c1 - c0 }, ST(c1 + 0.6, "stand"), ST(end, "stand")],
    look: [{ t: 0, at: null }, ...orientKeys(bang, DOOR)], face: [{ t: 0, mood: "neutral" }, { t: a0 + 0.2, mood: "surprised" }, { t: a1, mood: "uneasy" }],
    clips: [[a0, a1], [b0, b1], [c0, c1 + x]], reachClips: [[c0, c1 + x]],
    // the same moments acted with hand-made keys and no clip: a start that looks to his right (gasp pose, head and eyes to
    // a point there), then standing where the breathing clip is (film-kit's breath and sway do the idle)
    authored: {
      moves: [ST(0, "stand"), ST(2.4, "stand"), ST(a0 + 0.25, "gasp"), ST(a0 + 0.55 * (a1 - a0), "gasp"), ST(a1 + 0.6, "stand"), ST(end, "stand")],
      look: [{ t: 0, at: null }, { t: a0, at: null }, { t: a0 + 0.3, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] }, { t: a1, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] }, { t: a1 + 0.7, at: null }, ...orientKeys(bang, DOOR)],
    },
  };
};
