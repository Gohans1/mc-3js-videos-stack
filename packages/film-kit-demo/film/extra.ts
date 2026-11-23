// @ts-nocheck
import { stretch } from "film-kit/hesitate";

const AT = [1.88, 0, 9.55];
const ST = (t, pose) => ({ t, pose, at: AT, yaw: -90 });

const HZ = 60,
  END = 12;
const speed = (t) =>
  t < 1 ? 0 : t < 2 ? 1.3 * (t - 1) : t < 7.2 ? 1.3 : t < 7.9 ? 1.3 * (1 - (t - 7.2) / 0.7) : 0;
const S = [0];
for (let i = 1; i <= END * HZ + 2; i++) S.push(S[i - 1] + speed((i - 0.5) / HZ) / HZ);
const side = (s) => (s < 2 || s > 6 ? 0 : 0.3 * (1 - Math.cos((2 * Math.PI * (s - 2)) / 4)));
const pathPoint = (t) => {
  const x = Math.min(Math.max(t * HZ, 0), S.length - 1.001),
    i = Math.floor(x),
    s = S[i] + (S[i + 1] - S[i]) * (x - i);
  return { s, x: AT[0] - s, z: AT[2] + side(s) };
};
export const walkPath = (t) => {
  const a = pathPoint(t),
    b = pathPoint(t + 0.02),
    c = pathPoint(t - 0.02);
  const dx = b.x - c.x,
    dz = b.z - c.z,
    moving = Math.hypot(dx, dz) > 1e-5;
  const yaw = moving ? (Math.atan2(dx, dz) * 180) / Math.PI : -90;
  return { x: a.x, z: a.z, yaw, dist: a.s, speed: speed(t) };
};
export const WALK = {
  name: "walk",
  from: 0,
  to: END,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(END, "stand")],
  look: [],
  face: [{ t: 0, mood: "neutral" }],
  path: walkPath,
};

export const REACH = {
  name: "reach",
  from: 0,
  to: 9.6,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(9.6, "stand")],
  tremble: [{ t: 4.8, until: 7.4, k: 0.6 }],
  look: [
    { t: 0, at: null },
    { t: 1.2, at: null },
    { t: 1.6, at: [1.43, 1.7, 9.8] },
    { t: 3.2, at: [1.43, 1.7, 9.8] },
    { t: 3.5, at: [1.36, 0.95, 10.0] },
    { t: 5, at: [1.36, 0.95, 10.0] },
    { t: 5.3, at: null },
  ],
  face: [
    { t: 0, mood: "neutral" },
    { t: 1.6, mood: "curious" },
  ],
  handLooks: true,
  hands: [
    { t: 0, R: null },
    { t: 1, R: "rest" },
    { t: 2.1, R: [-0.25, 1.7, 0.45] },
    { t: 3.1, R: [-0.25, 1.7, 0.45] },
    { t: 4, R: [-0.4, 1.0, 0.52] },
    { t: 5, R: [-0.4, 1.0, 0.52] },
    { t: 6.6, R: [-0.15, 1.05, 0.55], doubt: 1 },
    { t: 7.3, R: [-0.15, 1.05, 0.55] },
    { t: 8.3, R: "rest" },
    { t: 8.9, R: null },
  ],
};

const orientKeys = (b, src) => [
  { t: b.t + 0.42, at: null },
  { t: b.t + 0.8, at: src },
  { t: b.t + 2.2, at: src },
  { t: b.t + 2.8, at: null },
];
const DOOR = [AT[0] + 1.0, 1.3, AT[2] - 2.6];

const BUG = [
  { t: 1.8, p: [AT[0] - 2.0, 0.05, AT[2] - 0.55] },
  { t: 2.8, p: [AT[0] - 1.8, 0.05, AT[2]] },
  { t: 3.6, p: [AT[0] - 1.8, 0.05, AT[2]] },
  { t: 4.6, p: [AT[0] - 2.1, 0.05, AT[2] + 0.55] },
];
const ease = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
export const bugAt = (t) => {
  let i = 0;
  while (i < BUG.length - 2 && t >= BUG[i + 1].t) i++;
  const a = BUG[i],
    b = BUG[i + 1],
    k = ease((t - a.t) / (b.t - a.t));
  return a.p.map((v, c) => v + (b.p[c] - v) * k);
};
const BANGS = [
  { t: 7, k: 1, at: DOOR },
  { t: 17.5, k: 0.7, at: DOOR },
];
const DESK = [AT[0] - 0.9, 1.25, AT[2] + 0.9];
export const SCARE = {
  name: "scare",
  from: 0,
  to: 22,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(22, "stand")],
  look: [{ t: 0, at: null }, ...BANGS.flatMap((b) => orientKeys(b, b.at))],
  face: [
    { t: 0, mood: "neutral" },
    { t: 1.8, mood: "worried" },
    { t: 7.1, mood: "scared" },
    { t: 10.5, mood: "worried" },
  ],
  bangs: BANGS,
  bug: bugAt,
  pursuit: [[1.8, 5.6]],
  think: [[11, 16.5]],
  freeze: [
    { t: 7.3, until: 10.5 },
    { t: 17.8, until: 20.5, k: 0.7 },
  ],
  tremble: [
    { t: 7.3, until: 12, k: 0.8 },
    { t: 17.8, until: 21, k: 0.5 },
  ],
  sights: [
    { t: 13.2, at: DESK },
    { t: 15.4, at: DESK },
  ],
  target: (t) =>
    t < 1.4 || t > 6.2
      ? null
      : { at: bugAt(t - 0.25), w: ease((t - 1.4) / 0.4) * (1 - ease((t - 5.8) / 0.4)) },
  shifts: [1.4],
  explore: [0, 10.5],
};

const WAKE_BANG = { t: 11, k: 0.8, at: DOOR };
export const WAKE = {
  name: "wake",
  from: 0,
  to: 22,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(22, "stand")],
  look: [{ t: 0, at: null }, ...orientKeys(WAKE_BANG, DOOR)],
  bangs: [WAKE_BANG],
  asleep: [
    [0, 2],
    [3.6, 4.5],
  ],
  drowsy: [
    { t: 0, k: 1 },
    { t: 2, k: 1 },
    { t: 10.9, k: 0.5 },
    { t: 11.3, k: 0 },
  ],
  explore: [2.1, 17.5],
  face: [
    { t: 0, mood: "neutral" },
    { t: 11.05, mood: "surprised" },
    { t: 11.7, mood: "scared" },
    { t: 14.3, mood: "sad" },
    { t: 18, mood: "neutral" },
  ],
};

export const CLIP_A = "mixamo/Being_Surprised_And_Looking_Right_c9c8214a",
  CLIP_B = "mixamo/Breathing_Idle_c9c6d0d5",
  CLIP_C = "mixamo/Pushing_A_Button_With_The_Right_Hand_c9c8f267";
const PRESS = [0.35, 1.0];
export const mocapScene = (dur) => {
  const a0 = 3,
    a1 = a0 + dur[CLIP_A],
    b0 = a1 + 4,
    b1 = b0 + 5,
    c0 = b1 + 3,
    c1 = c0 + dur[CLIP_C],
    end = c1 + 3;
  const st = stretch(c0 + PRESS[0], PRESS[1] - PRESS[0], 1),
    x = st.extra;
  const bang = { t: b0 + 2.5, k: 0.8, at: DOOR };
  return {
    bangs: [bang],
    explore: [0, b1 + 0.6],
    freeze: [{ t: bang.t + 0.3, until: b1 }],
    stretch: st,
    tremble: [{ t: bang.t + 0.3, until: c1 + x, k: 0.7 }],
    sights: [{ t: b0 + 0.8, at: [AT[0] - 1.2, 1.1, AT[2] + 1.6] }],
    name: "mocap",
    from: 0,
    to: end + x,
    blinksFrom: 0,
    moves: [
      ST(0, "stand"),
      ST(2.4, "stand"),
      { ...ST(a0, null), clip: CLIP_A },
      { ...ST(a1, null), clip: CLIP_A, from: a1 - a0 },
      ST(a1 + 0.6, "stand"),
      ST(b0 - 0.6, "stand"),
      { ...ST(b0, null), clip: CLIP_B, loop: true },
      { ...ST(b1, null), clip: CLIP_B, loop: true, from: b1 - b0 },
      ST(b1 + 0.6, "stand"),
      ST(c0 - 0.6, "stand"),
      { ...ST(c0, null), clip: CLIP_C },
      { ...ST(c1, null), clip: CLIP_C, from: c1 - c0 },
      ST(c1 + 0.6, "stand"),
      ST(end, "stand"),
    ],
    look: [{ t: 0, at: null }, ...orientKeys(bang, DOOR)],
    face: [
      { t: 0, mood: "neutral" },
      { t: a0 + 0.2, mood: "surprised" },
      { t: a1, mood: "uneasy" },
    ],
    clips: [
      [a0, a1],
      [b0, b1],
      [c0, c1 + x],
    ],
    reachClips: [[c0, c1 + x]],
    authored: {
      moves: [
        ST(0, "stand"),
        ST(2.4, "stand"),
        ST(a0 + 0.25, "gasp"),
        ST(a0 + 0.55 * (a1 - a0), "gasp"),
        ST(a1 + 0.6, "stand"),
        ST(end, "stand"),
      ],
      look: [
        { t: 0, at: null },
        { t: a0, at: null },
        { t: a0 + 0.3, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] },
        { t: a1, at: [AT[0] - 0.6, 1.7, AT[2] - 2.2] },
        { t: a1 + 0.7, at: null },
        ...orientKeys(bang, DOOR),
      ],
    },
  };
};
