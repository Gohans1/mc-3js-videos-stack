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
