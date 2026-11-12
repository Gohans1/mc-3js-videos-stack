// Counterbalance: a standing body keeps its centre of mass over its feet. Reach forward and the hips go back; bend over a
// desk and they go back further; hold the arms out to one side and the hips slide the other way (the weight-and-balance
// principle; Rosen, GDC 2014: "always keep the centre of mass over the skates"). Without it a keyed or IK reach tips
// the character over his toes and reads weightless.
//   const bal = balance((t) => comOffset(t), end, { standing });   pose = addPose(pose, bal(t)) before leg IK
// comAt(t): how far the body's centre of mass sits from where it sits in the rest pose, horizontally in his own axes
// [to his left, forward] metres, measured by the caller on the rig from the pose without this layer, each part weighted
// by WINTER. The hips move the other way by that over the share of the body they carry (head, arms and trunk, 0.678),
// clamped, following a critically damped spring of time constant tau (the ankles catch the weight a beat late, so a
// quick reach is not matched in the same frame). Planted feet need leg IK holding the soles, like idle's sway.
// Mocap clips are balanced already: fade this out over them (pose.ts mask).
import type { Pose } from "./pose";

// Dempster's segment masses as fractions of the body (Winter, Biomechanics and Motor Control of Human Movement, 2009)
export const WINTER = {
  head: 0.081,
  trunk: 0.497,
  upperArm: 0.028,
  forearmHand: 0.022,
  thigh: 0.1,
  legFoot: 0.061,
};
export const BALANCE = { carry: 0.678, tau: 0.15, max: 0.12 }; // share of the mass the hips move, s, m

const HZ = 60;

export function balance(
  comAt: (t: number) => [number, number],
  end: number,
  { standing = (_t: number): number => 1, tau = BALANCE.tau, max = BALANCE.max } = {},
) {
  const n = Math.ceil(end * HZ) + 2,
    x = new Float32Array(n),
    z = new Float32Array(n);
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));
  let px = 0,
    pz = 0,
    vx = 0,
    vz = 0;
  const w = 1 / tau;
  for (let i = 0; i < n; i++) {
    const t = i / HZ,
      s = Math.min(1, Math.max(0, standing(t))),
      [cx, cz] = comAt(t);
    const gx = clamp((-cx / BALANCE.carry) * s),
      gz = clamp((-cz / BALANCE.carry) * s);
    if (i === 0) {
      px = gx;
      pz = gz;
    }
    // a critically damped follower, in 4 substeps a sample
    for (let k = 0; k < 4; k++) {
      const h = 1 / HZ / 4;
      vx += (w * w * (gx - px) - 2 * w * vx) * h;
      px += vx * h;
      vz += (w * w * (gz - pz) - 2 * w * vz) * h;
      pz += vz * h;
    }
    x[i] = px;
    z[i] = pz;
  }
  const read = (a: Float32Array, t: number) => {
    const u = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(u);
    return a[i] + (a[i + 1] - a[i]) * (u - i);
  };
  return (t: number): Pose => ({ root: { x: read(x, t), z: read(z, t) } });
}
