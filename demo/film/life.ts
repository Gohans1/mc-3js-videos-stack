// @ts-nocheck
// Scenes for round 7 (any Minecraft film, not one film's moments). Same rig and poses as dig.ts.
//   LIFE: standing. A yawn with his right hand over his mouth, sad (the head hangs, smaller movement) and a sigh, a sigh of
//     relief as it passes, thinking with a hand to his chin and his own face touches, happy (head up), scared (elbows in,
//     knees give), angry. Left: the film now (no layers).
//   MC: Minecraft's own motion. He is hit (knocked back the game's distance, red for 10 ticks), jumps (1.25 blocks, 12
//     ticks), is hit from behind mid-air, an item pops out and bounces to a stop, an arrow arcs in and sticks, a sand
//     block falls; he dies (red, tips onto his left side, gone in a puff after 1 s). Left: the same beats keyed by hand
//     with smoothsteps.
//   LIFE_MOCAP: the same yawn, sigh and thinking played by Mixamo clips on the right (film-kit adds only the face, eyes
//     and timing; posture and touches stand back over the clips), keyed with film-kit's body layers on the left.
import { SIGH } from "../../src/sigh";
import { YAWN } from "../../src/yawn";

const AT = [1.88, 0, 9.55];
const ST = (t, pose) => ({ t, pose, at: AT, yaw: -90 });

export const LIFE = {
  name: "life", from: 0, to: 36, blinksFrom: 0, moves: [ST(0, "stand"), ST(36, "stand")], look: [],
  face: [{ t: 0, mood: "neutral" }, { t: 7, mood: "sad" }, { t: 15.5, mood: "neutral" }, { t: 24, mood: "happy" }, { t: 28, mood: "scared" }, { t: 31.5, mood: "angry" }, { t: 34.5, mood: "neutral" }],
  yawns: [{ t: 1.2 }],
  sighs: [{ t: 10.5 }, { t: 16, k: 0.8 }],
  think: [[18.5, 23]],
  // his right hand over his mouth from the yawn's gape until it lets go; the chin while he thinks
  touches: [{ t: 1.9, spot: "mouth", side: "R", hold: 3.2 }, { t: 19.2, spot: "chin", side: "L", hold: 2.4 }],
  touchRate: 23,
};

// he faces -x, the camera looks along +x: the first hit comes from his right (screen left) and slides him to screen right,
// away from the left Steve; the second, mid-air, from behind him, so it throws him towards the camera
const HITS = [{ t: 1.5, from: [0, -1] }, { t: 4.0, jump: true }, { t: 4.2, from: [1, 0] }, { t: 9.0, die: true }];
export const MCS = {
  name: "mc", from: 0, to: 11.5, blinksFrom: 0, moves: [ST(0, "stand"), ST(11.5, "stand")], look: [],
  face: [{ t: 0, mood: "neutral" }, { t: 1.55, mood: "surprised" }, { t: 2.6, mood: "angry" }],
  // a hit is also a shock to the body: the startle reflex on the right Steve (the game itself has none)
  bangs: [{ t: 1.5, k: 0.6 }, { t: 4.2, k: 0.6 }],
  mc: {
    events: HITS,
    // things in the game's own motion: [kind, start time, from, velocity in blocks a tick]
    things: [
      ["item", 2.5, [AT[0] - 2.2, 1.1, AT[2] - 1.2], [0.06, 0.2, 0.05], 0x6aa84f],
      ["arrow", 5.2, [AT[0] - 9, 1.5, AT[2] - 2.0], [0.9, 0.22, 0], 0x8a6a3a],
      ["block", 6.4, [AT[0] + 2, 7, AT[2] + 1.6], [0, 0, 0], 0xdccf9a],
    ],
  },
};

export const CLIP_YAWN = "mixamo/Big_Yawn_While_Standing_c9c98361", CLIP_SIGH = "mixamo/Sighing_In_Relief_c9c92112", CLIP_THINK = "mixamo/Thinking_While_Standing_c9c990e8";
// clip lengths are known once loaded: dur[ref] seconds. Where the clips' own beats fall, measured on Steve (head pitch
// against the facing, demo lab): the yawn clip has his head furthest back from 0.55 s in (its acme, ~0.9 s), a short
// yawn, so the face's yawn runs at 0.6 x the mean pace (3.5 s, Provine's shortest); the sigh clip lifts his head from the
// start and drops it 1.67 s in (the breath out)
export const YAWN_ACME = 0.55, YAWN_TEMPO = 0.6, SIGH_OUT = 1.67;
const yawnAt = (a0) => a0 + YAWN_ACME - YAWN.inhale * YAWN_TEMPO;
const sighAt = (b0) => b0 + SIGH_OUT - (SIGH.first + SIGH.second + SIGH.hold);
export const lifeMocapScene = (dur) => {
  const a0 = 2, a1 = a0 + dur[CLIP_YAWN], b0 = a1 + 3, b1 = b0 + dur[CLIP_SIGH], c0 = b1 + 3, c1 = c0 + dur[CLIP_THINK], end = c1 + 3;
  return {
    name: "lifeMocap", from: 0, to: end, blinksFrom: 0,
    moves: [ST(0, "stand"), ST(a0 - 0.6, "stand"), { ...ST(a0, null), clip: CLIP_YAWN }, { ...ST(a1, null), clip: CLIP_YAWN, from: a1 - a0 }, ST(a1 + 0.6, "stand"),
      ST(b0 - 0.6, "stand"), { ...ST(b0, null), clip: CLIP_SIGH }, { ...ST(b1, null), clip: CLIP_SIGH, from: b1 - b0 }, ST(b1 + 0.6, "stand"),
      ST(c0 - 0.6, "stand"), { ...ST(c0, null), clip: CLIP_THINK }, { ...ST(c1, null), clip: CLIP_THINK, from: c1 - c0 }, ST(c1 + 0.6, "stand"), ST(end, "stand")],
    look: [], clips: [[a0, a1], [b0, b1], [c0, c1]],
    face: [{ t: 0, mood: "neutral" }, { t: b0 - 1.5, mood: "sad" }, { t: b0 + 1.5, mood: "neutral" }],
    // the clip yawns and sighs: film-kit gives the face (and the breath under it is the clip's own: no sigh layer)
    yawns: [{ t: yawnAt(a0), tempo: YAWN_TEMPO }], think: [[c0, c1]],
    authored: {
      moves: [ST(0, "stand"), ST(end, "stand")], look: [],
      yawns: [{ t: yawnAt(a0), tempo: YAWN_TEMPO }], sighs: [{ t: sighAt(b0) }], think: [[c0, c1]],
      // the hand reaches the mouth as the acme starts and stays through the breath out
      touches: [{ t: a0 + YAWN_ACME - 1, spot: "mouth", side: "R", hold: (YAWN.acme + YAWN.exhale) * YAWN_TEMPO }, { t: c0 + 0.5, spot: "chin", side: "R", hold: Math.max(1, c1 - c0 - 2.5) }],
    },
  };
};
