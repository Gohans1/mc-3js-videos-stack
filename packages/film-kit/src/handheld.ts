import DATA from "../data/shakify.json";

export type ShakeName = keyof typeof DATA;
export const SHAKES = Object.keys(DATA) as ShakeName[];

const centred = (v?: number[]) => {
  if (!v) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.map((x) => x - m);
};

type CachedTrack = {
  fps: number;
  n: number;
  loc: (number[] | null)[];
  rot: (number[] | null)[];
};

const trackCache = new Map<ShakeName, CachedTrack>();

const loadTrack = (kind: ShakeName): CachedTrack => {
  const cached = trackCache.get(kind);
  if (cached) return cached;
  const s = DATA[kind] as Record<string, unknown> & { fps: number };
  if (!s) throw new Error(`handheld: no shake ${kind}; one of ${SHAKES.join(", ")}`);
  const loc = [0, 1, 2].map((i) => centred(s[`location${i}`] as number[] | undefined));
  const rot = [0, 1, 2].map((i) => centred(s[`rotation_euler${i}`] as number[] | undefined));
  const track: CachedTrack = { fps: s.fps, n: rot[0]!.length, loc, rot };
  trackCache.set(kind, track);
  return track;
};

export function handheld(
  kind: ShakeName = "THE_CLOSEUP",
  { amount = 1, move = 1, speed = 1, offset = 0 } = {},
) {
  const { fps, n, loc, rot } = loadTrack(kind);
  const sample = (v: number[] | null, f: number) => {
    if (!v) return 0;
    const i = Math.floor(f),
      u = f - i;
    const at = (k: number) => v[((k % n) + n) % n];
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    return (
      p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)))
    );
  };
  return (t: number) => {
    const f = (t * speed + offset) * fps;
    const r = rot.map((v) => sample(v, f) * amount);
    const pos = loc.map((v) => sample(v, f) * amount * move) as [number, number, number];
    // Blender XYZ euler: x first, then y, then z, about fixed axes = qz * qy * qx
    const h = r.map((a) => a / 2),
      c = h.map(Math.cos),
      sn = h.map(Math.sin);
    const quat: [number, number, number, number] = [
      sn[0] * c[1] * c[2] - c[0] * sn[1] * sn[2],
      c[0] * sn[1] * c[2] + sn[0] * c[1] * sn[2],
      c[0] * c[1] * sn[2] - sn[0] * sn[1] * c[2],
      c[0] * c[1] * c[2] + sn[0] * sn[1] * sn[2],
    ];
    return { pos, rot: r.map((a) => (a * 180) / Math.PI) as [number, number, number], quat };
  };
}
