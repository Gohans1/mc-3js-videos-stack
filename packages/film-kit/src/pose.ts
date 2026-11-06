// Character poses as plain numbers: {joint: [x, y, z] degrees, root?: {field: value}}, the format an FK rig is posed from
// (MCprep's Minecraft player in the films). A joint or root field a pose leaves out is at rest (0).
// throughPose blends pose keys the way curve() blends values: a smoothstep per key pair brakes every joint to a stop at
// every key (move, freeze, move: the robot look); here a joint keeps its speed through a key that lies on its way and
// still stops where it turns back or is held. Each key's pose may be a function of time (breathing), so the keys either
// side are evaluated by the caller at the same t.
//   pose = throughPose(prev, a, b, next, [tPrev, ta, tb, tNext], t)   (prev/next null at the ends)
import { through } from "./curve";

export type Pose = { [joint: string]: number[] | Record<string, number> | undefined; root?: Record<string, number> };

const joints = (...ps: (Pose | null)[]) => new Set(ps.flatMap((p) => (p ? Object.keys(p).filter((k) => k !== "root") : [])));
const rootKeys = (...ps: (Pose | null)[]) => new Set(ps.flatMap((p) => Object.keys(p?.root ?? {})));
const at = (p: Pose | null, j: string, i: number) => (p ? ((p[j] as number[] | undefined)?.[i] ?? 0) : null);
const atRoot = (p: Pose | null, r: string) => (p ? (p.root?.[r] ?? 0) : null);

export function throughPose(prev: Pose | null, a: Pose, b: Pose, next: Pose | null, [tp, ta, tb, tn]: number[], t: number): Pose {
  const out: Pose = { root: {} };
  for (const r of rootKeys(a, b)) out.root![r] = through(atRoot(prev, r), atRoot(a, r)!, atRoot(b, r)!, atRoot(next, r), tp, ta, tb, tn, t);
  for (const j of joints(a, b)) out[j] = [0, 1, 2].map((i) => through(at(prev, j, i), at(a, j, i)!, at(b, j, i)!, at(next, j, i), tp, ta, tb, tn, t));
  return out;
}

// b on top of a, joint by joint (degrees and root fields add)
export function addPose(a: Pose, b: Pose): Pose {
  const out: Pose = { ...a, root: { ...(a.root ?? {}) } };
  for (const [k, v] of Object.entries(b)) {
    if (k === "root") { for (const [r, x] of Object.entries(v as Record<string, number>)) out.root![r] = (out.root![r] ?? 0) + x; continue; }
    const base = (a[k] as number[] | undefined) ?? [0, 0, 0];
    out[k] = (v as number[]).map((x, i) => (base[i] ?? 0) + x);
  }
  return out;
}

// p scaled by k (joints and root fields): a layer's offset faded in or out
export function scalePose(p: Pose, k: number): Pose {
  const out: Pose = {};
  for (const [j, v] of Object.entries(p)) {
    if (j === "root") out.root = Object.fromEntries(Object.entries(v as Record<string, number>).map(([r, x]) => [r, k * x]));
    else out[j] = (v as number[]).map((x) => k * x);
  }
  return out;
}

// A layer weight that is 1 except over spans [from, to] (mocap clips, or anything that brings its own life), where it is
// 0, easing out over `ramp` seconds before each span and back in over `ramp` after it. Mocap already holds breathing,
// sway, overlap and its own head; the procedural layers on top of it would double them (Player Motion's layer rule: give
// every procedural effect a weight and fade it out where a clip must stay exact).
//   const w = mask([[3, 6.5]]);   pose = addPose(pose, scalePose(lagOf(t), w(t)))
export const mask = (spans: [number, number][], ramp = 0.3) => (t: number) => {
  let w = 1;
  for (const [a, b] of spans) {
    const u = t < a ? (a - t) / ramp : t > b ? (t - b) / ramp : 0;
    const k = Math.min(1, u), s = k * k * (3 - 2 * k);
    w = Math.min(w, s);
  }
  return w;
};

// An angle in degrees brought within 180 of `near` (a joint read from a quaternion, as mocap poses are, jumps from 179 to
// -179 between frames; every baked layer follows each angle continuously instead of spinning round)
export const unwrap = (deg: number, near: number) => deg - 360 * Math.round((deg - near) / 360);

// One spelling per turn. The rig's Euler order is YXZ, where (x, y, z) and (180 - x, y + 180, z + 180) are the same turn;
// a pose read from quaternions (mocap, slerp blends) keeps x within +-90 and so jumps between the two spellings as a raised
// arm passes horizontal (-89, 180, 180 one frame, -88, 0, 0 the next). Anything that adds to or filters angles then sees a
// 180-degree leap that never happened. canonical() spells every joint (and the root's turn) with its twist y within +-90,
// so arms and trunks move continuously through any raise; only a twist past 90 (rare on a body) changes spelling.
// Every baked layer reads its input through it; a pose a layer's offset is added to must be canonical too.
const wrap = (d: number) => d - 360 * Math.round(d / 360);
const spell = (x: number, y: number, z: number): [number, number, number] =>
  Math.abs(wrap(y)) <= 90 ? [wrap(x), wrap(y), wrap(z)] : [wrap(180 - x), wrap(y + 180), wrap(z + 180)];
export function canonical(p: Pose): Pose {
  const out: Pose = {};
  for (const [j, v] of Object.entries(p)) {
    if (j !== "root") { const a = v as number[]; out[j] = spell(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0); continue; }
    const r = { ...(v as Record<string, number>) };
    if (r.rx != null || r.ry != null || r.rz != null) [r.rx, r.ry, r.rz] = spell(r.rx ?? 0, r.ry ?? 0, r.rz ?? 0);
    out.root = r;
  }
  return out;
}
