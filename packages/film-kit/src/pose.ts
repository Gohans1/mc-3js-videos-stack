import { through } from "./curve";

export type Pose = {
  root?: Record<string, number>;
  head?: number[];
  chest?: number[];
  body?: number[];
  uaL?: number[];
  uaR?: number[];
  laL?: number[];
  laR?: number[];
  ulL?: number[];
  ulR?: number[];
  llL?: number[];
  llR?: number[];
  [joint: string]: number[] | Record<string, number> | undefined;
};

const joints = (...ps: (Pose | null)[]) =>
  new Set(ps.flatMap((p) => (p ? Object.keys(p).filter((k) => k !== "root") : [])));
const rootKeys = (...ps: (Pose | null)[]) => new Set(ps.flatMap((p) => Object.keys(p?.root ?? {})));
const at = (p: Pose | null, j: string, i: number) =>
  p ? ((p[j] as number[] | undefined)?.[i] ?? 0) : null;
const atRoot = (p: Pose | null, r: string) => (p ? (p.root?.[r] ?? 0) : null);

export function throughPose(
  prev: Pose | null,
  a: Pose,
  b: Pose,
  next: Pose | null,
  [tp, ta, tb, tn]: number[],
  t: number,
): Pose {
  const out: Pose = { root: {} };
  for (const r of rootKeys(a, b))
    out.root![r] = through(
      atRoot(prev, r),
      atRoot(a, r)!,
      atRoot(b, r)!,
      atRoot(next, r),
      tp,
      ta,
      tb,
      tn,
      t,
    );
  for (const j of joints(a, b))
    out[j] = [0, 1, 2].map((i) =>
      through(at(prev, j, i), at(a, j, i)!, at(b, j, i)!, at(next, j, i), tp, ta, tb, tn, t),
    );
  return out;
}

export function addPose(a: Pose, b: Pose): Pose {
  const out: Pose = { ...a, root: { ...a.root } };
  for (const [k, v] of Object.entries(b)) {
    if (k === "root") {
      for (const [r, x] of Object.entries(v as Record<string, number>))
        out.root![r] = (out.root![r] ?? 0) + x;
      continue;
    }
    const base = (a[k] as number[] | undefined) ?? [0, 0, 0];
    out[k] = (v as number[]).map((x, i) => (base[i] ?? 0) + x);
  }
  return out;
}

export function scalePose(p: Pose, k: number): Pose {
  const out: Pose = {};
  for (const [j, v] of Object.entries(p)) {
    if (j === "root")
      out.root = Object.fromEntries(
        Object.entries(v as Record<string, number>).map(([r, x]) => [r, k * x]),
      );
    else out[j] = (v as number[]).map((x) => k * x);
  }
  return out;
}

export const mask =
  (spans: [number, number][], ramp = 0.3) =>
  (t: number) => {
    let w = 1;
    for (const [a, b] of spans) {
      const u = t < a ? (a - t) / ramp : t > b ? (t - b) / ramp : 0;
      const k = Math.min(1, u),
        s = k * k * (3 - 2 * k);
      w = Math.min(w, s);
    }
    return w;
  };

export const unwrap = (deg: number, near: number) => deg - 360 * Math.round((deg - near) / 360);

const wrap = (d: number) => d - 360 * Math.round(d / 360);
const spell = (x: number, y: number, z: number): [number, number, number] =>
  Math.abs(wrap(y)) <= 90
    ? [wrap(x), wrap(y), wrap(z)]
    : [wrap(180 - x), wrap(y + 180), wrap(z + 180)];
export function canonical(p: Pose): Pose {
  const out: Pose = {};
  for (const [j, v] of Object.entries(p)) {
    if (j !== "root") {
      const a = v as number[];
      out[j] = spell(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
      continue;
    }
    const r = { ...(v as Record<string, number>) };
    if (r.rx != null || r.ry != null || r.rz != null)
      [r.rx, r.ry, r.rz] = spell(r.rx ?? 0, r.ry ?? 0, r.rz ?? 0);
    out.root = r;
  }
  return out;
}
