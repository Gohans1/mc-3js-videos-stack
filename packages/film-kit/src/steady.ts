// A head that holds itself steady while the trunk under it moves, the way a person's does (Simon Unger, IO Interactive,
// "Head over heels: upper body movement in gameplay": the vestibulocollic reflex keeps the head still and the eyes on
// level while the body turns, bends and lands under it). Fast tilts of the hips, waist and chest are countered at the
// neck; a slow, held posture is kept (bending over a desk keeps the head down with it). Sideways (roll) tilts are also
// partly countered when held, so the eyes stay near level.
//   const steadyHead = steady((t) => layeredPose(t), filmEnd);   pose = addPose(pose, steadyHead(t))
// The input pose's root rx/rz and the chain's x (forward) and z (sideways) angles add up to the trunk's tilt under the
// neck; its fast part is what moved in the last `tau` seconds. Returns a head offset {head: [x, 0, z]}. With head IK
// aiming the head at a target the aim already holds the direction: scale x by (1 - look weight) and keep z.
import { canonical, unwrap, type Pose } from "./pose";

const HZ = 60;
export const STEADY = { pitch: 0.6, roll: 0.4, hold: 0.5, tau: 0.3 }; // share of a fast forward tilt, of a fast and of a held sideways tilt; seconds

export function steady(poseAt: (t: number) => Pose, end: number, { chain = ["body", "chest"], pitch = STEADY.pitch, roll = STEADY.roll, hold = STEADY.hold, tau = STEADY.tau } = {}) {
  const n = Math.ceil(end * HZ) + 2, tilt = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    let x = p.root?.rx ?? 0, z = p.root?.rz ?? 0;
    for (const j of chain) { const a = p[j] as number[] | undefined; x += a?.[0] ?? 0; z += a?.[2] ?? 0; }
    tilt[i * 2] = i ? unwrap(x, tilt[(i - 1) * 2]) : x; tilt[i * 2 + 1] = i ? unwrap(z, tilt[(i - 1) * 2 + 1]) : z;
  }
  // the slow part: a critically damped follower `tau` behind; the fast part is the rest
  const out = new Float32Array(n * 2), w = 2 / tau, dt = 1 / HZ;
  for (let c = 0; c < 2; c++) {
    let y = tilt[c], v = 0;
    for (let i = 0; i < n; i++) {
      const x = tilt[i * 2 + c], fast = x - y;
      out[i * 2 + c] = c === 0 ? -pitch * fast : -(roll * fast + hold * x);
      for (let s = 0; s < 4; s++) { v += (w * w * (x - y) - 2 * w * v) * (dt / 4); y += v * (dt / 4); }
    }
  }
  return (t: number): Pose => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x), f = x - i;
    const at = (c: number) => out[i * 2 + c] + (out[(i + 1) * 2 + c] - out[i * 2 + c]) * f;
    return { head: [at(0), 0, at(1)] };
  };
}
