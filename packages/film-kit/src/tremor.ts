// Trembling with fear. Everyone's hands shake a little all the time (physiological tremor: a hump around 8-10 Hz on
// broadband noise); fear and anxiety make it bigger, not faster (Lader 1974: more tremor in anxious people, most of it
// 6-17 Hz, same peak frequency). At its strongest a coarser 5-6 Hz component appears (Redfearn 1957). It comes in runs
// that wax and wane, and the two hands shake independently. It is biggest with the arm held out or holding something,
// smallest with it hanging. Real amplitudes are fractions of a millimetre; here they are made big enough to read on
// screen, mostly through what the hand holds (a sheet of paper shakes at its far edge).
//   const shake = tremor((t) => fear level 0..1);   pose = addPose(pose, shake(t)) after the arm IK, last
// It adds small turns to the upper arms and forearms, so it works the same over keyed arms, IK hands and mocap clips.
// At 30 fps an 8-10 Hz shake is sampled 3-4 times a cycle and reads as a jitter: that is also how a camera sees one.
import { hash } from "./hash";
export const TREMOR = {
  forearm: 1.4, arm: 0.6, // deg at full fear, roughly the peak swing
  fine: [6.3, 7.4, 8.2, 8.9, 9.7, 11.3, 12.6], // Hz, weighted to a hump at 8-9
  coarse: [5.3, 5.9], // Hz, grows with the square of the fear
  runs: [0.45, 0.9], // Hz, the waxing and waning
};
const WEIGHT = [0.5, 0.75, 1, 1, 0.8, 0.5, 0.35];


type Pose = Record<string, number[]>;
export function tremor(level: (t: number) => number, { seed = 3 } = {}) {
  const ph = (i: number, k: number) => 2 * Math.PI * hash(i, seed + k);
  // one shake signal, about -1..1, for one hand and one axis
  const sig = (t: number, f: number, s: number) => {
    let fine = 0, wsum = 0;
    TREMOR.fine.forEach((hz, i) => { fine += WEIGHT[i] * Math.sin(2 * Math.PI * hz * t + ph(i, s)); wsum += WEIGHT[i]; });
    let coarse = 0;
    TREMOR.coarse.forEach((hz, i) => { coarse += Math.sin(2 * Math.PI * hz * t + ph(i + 10, s)); });
    const runs = 0.65 + 0.35 * Math.sin(2 * Math.PI * TREMOR.runs[0] * t + ph(20, s)) * Math.sin(2 * Math.PI * TREMOR.runs[1] * t + ph(21, s));
    return runs * ((fine / wsum) * 1.6 + f * f * 0.5 * coarse);
  };
  return Object.assign((t: number): Pose => {
    const f = Math.min(1, Math.max(0, level(t)));
    if (f <= 0) return {};
    const out: Pose = {};
    ["L", "R"].forEach((sd, h) => {
      const s = 30 * h;
      out[`la${sd}`] = [f * TREMOR.forearm * sig(t, f, s), 0, 0];
      out[`ua${sd}`] = [f * TREMOR.arm * sig(t, f, s + 7), 0, f * TREMOR.arm * 0.6 * sig(t, f, s + 13)];
    });
    return out;
  }, { level });
}
