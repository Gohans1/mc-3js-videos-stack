// A startle: the body's reflex to a sudden bang or shock, the same in everyone and out of their control. It runs down the
// body in a fixed order (EMG onsets, Landis & Hunt 1939; Brown et al. 1991): eyes shut at 20-40 ms, head at 60-120 ms,
// shoulders at 100-120, arms at 125-195, legs at 145-395. The pattern: lids shut hard, head down and forward, shoulders up
// and forward, elbows bend, trunk bends, knees give. It is over in 0.2-1.5 s depending on how strong it was. Repeat it
// within a couple of minutes and the body part fades out (gone after 4-6 repeats) but the blink never does and the head
// jerk rarely does. About 0.4 s after the bang the "what was that?" turn to the source begins (the orienting response):
// that is a look, so the caller keys it, at orientAt(event).
//   const jolt = startle([{ t: 6, k: 1 }]);   pose = addPose(pose, jolt(t).pose) before IK;  blink = max(blink, jolt(t).blink)
//   idle(poseAt, end, { gasps: events }) holds the breath through it; lookKeys.push({ t: orientAt(e), at: source })
// k: 0..1, how strong (a door slam 1, a creak 0.4). Joints in the character's axes (x his left, y up, z forward): +x on
// body/chest/head bends forward and down; on the upper arms -x raises them forward and -z (left) / +z (right) brings them
// in across the body; -x on the forearms bends the elbows.
import type { Pose } from "./pose";

export type Startle = { t: number; k?: number };
export const STARTLE = {
  onset: { blink: 0.03, head: 0.09, arms: 0.14, trunk: 0.16, legs: 0.2 }, // s after the bang
  rise: 0.045, // s, each part's jolt rises this fast
  decay: [0.1, 0.28], // s, how slowly it lets go: a weak startle .. a full one
  blink: [0.12, 0.25], // s the lids stay shut: weak .. full
  orient: 0.42, // s, the turn to the source starts
  habit: 120, // s, repeats within this fade the body part
  fade: 0.55, // the body part's size per earlier repeat
};
// a full startle's pose (deg, metres)
export const JOLT = {
  head: [14, 0, 0],
  chest: [7, 0, 0],
  body: [4, 0, 0],
  uaL: [-12, 0, -7],
  uaR: [-12, 0, 7],
  laL: [-22, 0, 0],
  laR: [-22, 0, 0],
  sink: 0.035,
};

// a jolt shaped as a fast rise and slower let-go (two exponentials), peak 1
const pulse = (u: number, rise: number, decay: number) => {
  if (u <= 0) return 0;
  const tp = (Math.log(decay / rise) * rise * decay) / (decay - rise);
  const f = (x: number) => Math.exp(-x / decay) - Math.exp(-x / rise);
  return f(u) / f(tp);
};
const lerp = ([a, b]: number[], k: number) => a + (b - a) * k;
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

export const orientAt = (e: Startle) => e.t + STARTLE.orient;

export function startle(events: Startle[]) {
  const ev = [...events].sort((a, b) => a.t - b.t).map((e, i, all) => {
    const k = Math.min(1, Math.max(0, e.k ?? 1));
    const n = all.slice(0, i).filter((p) => e.t - p.t < STARTLE.habit).length;
    return { t: e.t, k, body: k * STARTLE.fade ** n, head: k * Math.max(0.5, 0.8 ** n) };
  });
  const S = STARTLE.onset;
  const at = (t: number) => {
    const pose: Pose = { root: { y: 0 } };
    const add = (j: keyof typeof JOLT, w: number) => { const v = JOLT[j] as number[], p = (pose[j] as number[]) ?? [0, 0, 0]; pose[j] = p.map((x, c) => x + v[c] * w); };
    let blink = 0;
    for (const e of ev) {
      const u = t - e.t;
      if (u < 0 || u > 3) continue;
      const decay = lerp(STARTLE.decay, e.k), part = (on: number) => pulse(u - on, STARTLE.rise, decay);
      add("head", e.head * part(S.head));
      for (const j of ["uaL", "uaR", "laL", "laR"] as const) add(j, e.body * part(S.arms));
      add("chest", e.body * part(S.trunk));
      add("body", e.body * part(S.trunk));
      pose.root!.y! -= JOLT.sink * e.body * part(S.legs);
      // shut in 40 ms, held, open over 0.12 s
      const shut = lerp(STARTLE.blink, e.k), b = u - S.blink;
      blink = Math.max(blink, b < 0 ? 0 : b < 0.04 ? smooth(b / 0.04) : b < 0.04 + shut ? 1 : 1 - smooth((b - 0.04 - shut) / 0.12));
    }
    return { pose, blink };
  };
  return Object.assign(at, { events: ev });
}
