// @ts-nocheck
import { SIGH } from "film-kit/sigh";
import { YAWN } from "film-kit/yawn";

const AT = [1.88, 0, 9.55];
const ST = (t, pose) => ({ t, pose, at: AT, yaw: -90 });

export const LIFE = {
  name: "life",
  from: 0,
  to: 36,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(36, "stand")],
  look: [],
  face: [
    { t: 0, mood: "neutral" },
    { t: 7, mood: "sad" },
    { t: 15.5, mood: "neutral" },
    { t: 24, mood: "happy" },
    { t: 28, mood: "scared" },
    { t: 31.5, mood: "angry" },
    { t: 34.5, mood: "neutral" },
  ],
  yawns: [{ t: 1.2 }],
  sighs: [{ t: 10.5 }, { t: 16, k: 0.8 }],
  think: [[18.5, 23]],
  touches: [
    { t: 1.9, spot: "mouth", side: "R", hold: 3.2 },
    { t: 19.2, spot: "chin", side: "L", hold: 2.4 },
  ],
  touchRate: 23,
};

const HITS = [
  { t: 1.5, from: [0, -1] },
  { t: 4.0, jump: true },
  { t: 4.2, from: [1, 0] },
  { t: 9.0, die: true },
];
export const MCS = {
  name: "mc",
  from: 0,
  to: 11.5,
  blinksFrom: 0,
  moves: [ST(0, "stand"), ST(11.5, "stand")],
  look: [],
  face: [
    { t: 0, mood: "neutral" },
    { t: 1.55, mood: "surprised" },
    { t: 2.6, mood: "angry" },
  ],
  bangs: [
    { t: 1.5, k: 0.6 },
    { t: 4.2, k: 0.6 },
  ],
  mc: {
    events: HITS,
    things: [
      ["item", 2.5, [AT[0] - 2.2, 1.1, AT[2] - 1.2], [0.06, 0.2, 0.05], 0x6aa84f],
      ["arrow", 5.2, [AT[0] - 9, 1.5, AT[2] - 2.0], [0.9, 0.22, 0], 0x8a6a3a],
      ["block", 6.4, [AT[0] + 2, 7, AT[2] + 1.6], [0, 0, 0], 0xdccf9a],
    ],
  },
};

export const CLIP_YAWN = "mixamo/Big_Yawn_While_Standing_c9c98361",
  CLIP_SIGH = "mixamo/Sighing_In_Relief_c9c92112",
  CLIP_THINK = "mixamo/Thinking_While_Standing_c9c990e8";
export const YAWN_ACME = 0.55,
  YAWN_TEMPO = 0.6,
  SIGH_OUT = 1.67;
const yawnAt = (a0) => a0 + YAWN_ACME - YAWN.inhale * YAWN_TEMPO;
const sighAt = (b0) => b0 + SIGH_OUT - (SIGH.first + SIGH.second + SIGH.hold);
export const lifeMocapScene = (dur) => {
  const a0 = 2,
    a1 = a0 + dur[CLIP_YAWN],
    b0 = a1 + 3,
    b1 = b0 + dur[CLIP_SIGH],
    c0 = b1 + 3,
    c1 = c0 + dur[CLIP_THINK],
    end = c1 + 3;
  return {
    name: "lifeMocap",
    from: 0,
    to: end,
    blinksFrom: 0,
    moves: [
      ST(0, "stand"),
      ST(a0 - 0.6, "stand"),
      { ...ST(a0, null), clip: CLIP_YAWN },
      { ...ST(a1, null), clip: CLIP_YAWN, from: a1 - a0 },
      ST(a1 + 0.6, "stand"),
      ST(b0 - 0.6, "stand"),
      { ...ST(b0, null), clip: CLIP_SIGH },
      { ...ST(b1, null), clip: CLIP_SIGH, from: b1 - b0 },
      ST(b1 + 0.6, "stand"),
      ST(c0 - 0.6, "stand"),
      { ...ST(c0, null), clip: CLIP_THINK },
      { ...ST(c1, null), clip: CLIP_THINK, from: c1 - c0 },
      ST(c1 + 0.6, "stand"),
      ST(end, "stand"),
    ],
    look: [],
    clips: [
      [a0, a1],
      [b0, b1],
      [c0, c1],
    ],
    face: [
      { t: 0, mood: "neutral" },
      { t: b0 - 1.5, mood: "sad" },
      { t: b0 + 1.5, mood: "neutral" },
    ],
    yawns: [{ t: yawnAt(a0), tempo: YAWN_TEMPO }],
    think: [[c0, c1]],
    authored: {
      moves: [ST(0, "stand"), ST(end, "stand")],
      look: [],
      yawns: [{ t: yawnAt(a0), tempo: YAWN_TEMPO }],
      sighs: [{ t: sighAt(b0) }],
      think: [[c0, c1]],
      touches: [
        {
          t: a0 + YAWN_ACME - 1,
          spot: "mouth",
          side: "R",
          hold: (YAWN.acme + YAWN.exhale) * YAWN_TEMPO,
        },
        { t: c0 + 0.5, spot: "chin", side: "R", hold: Math.max(1, c1 - c0 - 2.5) },
      ],
    },
  };
};
