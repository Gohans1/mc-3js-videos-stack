import { Color, LinearSRGBColorSpace, MathUtils } from "three";

import { hasWheels, wheelGrade, type WheelsGrade } from "./grade-wheels";

export const HUES = [
  { id: "red", title: "Red", hue: 0, color: "#ed4247" },
  { id: "orange", title: "Orange", hue: 30, color: "#f49b42" },
  { id: "yellow", title: "Yellow", hue: 60, color: "#edef00" },
  { id: "green", title: "Green", hue: 120, color: "#39d443" },
  { id: "cyan", title: "Cyan", hue: 180, color: "#44dce1" },
  { id: "blue", title: "Blue", hue: 240, color: "#4197e8" },
  { id: "purple", title: "Purple", hue: 270, color: "#a64de8" },
  { id: "magenta", title: "Magenta", hue: 300, color: "#e448e6" },
] as const;
export type HueKey = (typeof HUES)[number]["id"];
export type HSLGrade = { enabled?: boolean } & Partial<
  Record<HueKey, { hue?: number; saturation?: number; brightness?: number }>
>;
export type CurvePoint = [number, number];
export type CurveKey = "luma" | "red" | "green" | "blue";
export type CurvesGrade = { enabled?: boolean } & Partial<Record<CurveKey, CurvePoint[]>>;
export type SecondaryGrade = { hsl?: HSLGrade; curves?: CurvesGrade; wheels?: WheelsGrade };
export const NEUTRAL_CURVE: CurvePoint[] = [
  [0, 0],
  [1, 1],
];
const clamp = (v: number) => MathUtils.clamp(v, 0, 1);

export function curveMap(points: CurvePoint[] = NEUTRAL_CURVE) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    n = xs.length - 1,
    m = n + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1)),
    ks = new Float64Array(m);
  for (let i = 1; i < n; i++) {
    const d0 = xs[i] - xs[i - 1],
      d1 = xs[i + 1] - xs[i];
    A[i][i - 1] = 1 / d0;
    A[i][i] = 2 * (1 / d0 + 1 / d1);
    A[i][i + 1] = 1 / d1;
    A[i][m] = 3 * ((ys[i] - ys[i - 1]) / (d0 * d0) + (ys[i + 1] - ys[i]) / (d1 * d1));
  }
  const dFirst = xs[1] - xs[0],
    dLast = xs[n] - xs[n - 1];
  A[0][0] = 2 / dFirst;
  A[0][1] = 1 / dFirst;
  A[0][m] = (3 * (ys[1] - ys[0])) / (dFirst * dFirst);
  A[n][n - 1] = 1 / dLast;
  A[n][n] = 2 / dLast;
  A[n][m] = (3 * (ys[n] - ys[n - 1])) / (dLast * dLast);
  for (let h = 0, k = 0; h < m && k <= m; k++) {
    let iMax = h;
    for (let i = h + 1; i < m; i++) if (Math.abs(A[i][k]) > Math.abs(A[iMax][k])) iMax = i;
    if (A[iMax][k] === 0) continue;
    [A[h], A[iMax]] = [A[iMax], A[h]];
    for (let i = h + 1; i < m; i++) {
      const f = A[i][k] / A[h][k];
      A[i][k] = 0;
      for (let j = k + 1; j <= m; j++) A[i][j] -= A[h][j] * f;
    }
    h++;
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = A[i][i] ? A[i][m] / A[i][i] : 0;
    ks[i] = v;
    for (let j = i - 1; j >= 0; j--) {
      A[j][m] -= A[j][i] * v;
      A[j][i] = 0;
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n]) return ys[n];
    let low = 0,
      high = m;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (xs[mid] < x && mid !== low) low = mid;
      else if (xs[mid] >= x && mid !== high) high = mid;
      else high = low;
    }
    const i = low + 1,
      dx = xs[i] - xs[i - 1],
      dy = ys[i] - ys[i - 1],
      t = (x - xs[i - 1]) / dx;
    const a = ks[i - 1] * dx - dy,
      b = -ks[i] * dx + dy;
    return clamp((1 - t) * ys[i - 1] + t * ys[i] + t * (1 - t) * (a * (1 - t) + b * t));
  };
}

export const hasSecondary = ({ hsl, curves, wheels }: SecondaryGrade) =>
  hasWheels(wheels) ||
  (hsl?.enabled !== false &&
    HUES.some(({ id }) => Object.values(hsl?.[id] ?? {}).some((x) => x !== 0))) ||
  (curves?.enabled !== false &&
    (["luma", "red", "green", "blue"] as const).some((id) =>
      curves?.[id]?.some(([x, y]) => x !== y),
    ));

export function secondaryGrade({ hsl, curves, wheels }: SecondaryGrade) {
  const wheel = wheelGrade(wheels);
  const ranges =
    hsl?.enabled === false
      ? []
      : HUES.flatMap(({ id, hue }) => {
          const v = hsl?.[id];
          return v && Object.values(v).some((x) => x !== 0) ? [{ center: hue, ...v }] : [];
        });
  const hs = { h: 0, s: 0, l: 0 };
  const maps = (["luma", "red", "green", "blue"] as const).map((id) =>
    curves?.enabled !== false && curves?.[id]?.some(([x, y]) => x !== y)
      ? curveMap(curves[id])
      : null,
  );
  return (c: Color) => {
    if (ranges.length) {
      // EffectCraft Hue/Saturation (MIT): membership uses the original hue, with a grey-safe falloff.
      c.getHSL(hs, LinearSRGBColorSpace);
      let h = hs.h,
        s = hs.s,
        l = hs.l,
        affected = false;
      for (const r of ranges) {
        const d = Math.abs(MathUtils.euclideanModulo(hs.h * 360 - r.center + 180, 360) - 180);
        const w = clamp((45 - d) / 30) * Math.min(hs.s * 20, 1),
          sat = ((r.saturation ?? 0) / 100) * w,
          light = ((r.brightness ?? 0) / 100) * w;
        if (!w) continue;
        affected = true;
        h += ((r.hue ?? 0) / 1200) * w;
        s = clamp(sat >= 0 ? s + (1 - s) * sat * s : s * (1 + sat));
        l = clamp(light >= 0 ? l + (1 - l) * light : l * (1 + light));
      }
      if (affected) c.setHSL(h, s, l, LinearSRGBColorSpace);
    }
    if (maps[0]) c.setRGB(maps[0](c.r), maps[0](c.g), maps[0](c.b));
    c.setRGB(maps[1]?.(c.r) ?? c.r, maps[2]?.(c.g) ?? c.g, maps[3]?.(c.b) ?? c.b);
    return wheel(c);
  };
}
