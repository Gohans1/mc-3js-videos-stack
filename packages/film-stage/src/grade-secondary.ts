import rawSpline from "typescript-cubic-spline";
import { Color, LinearSRGBColorSpace, MathUtils } from "three";
import { hasWheels, wheelGrade, type WheelsGrade } from "./grade-wheels";

// Rolldown's Node/Babel CJS interop differs: https://rolldown.rs/in-depth/bundling-cjs
const splineModule = rawSpline as typeof rawSpline | { __esModule: true; default: typeof rawSpline };
const Spline = typeof splineModule === "function" ? splineModule : splineModule.default;

export const HUES = [
  { id: "red", title: "Red", hue: 0, color: "#ed4247" }, { id: "orange", title: "Orange", hue: 30, color: "#f49b42" },
  { id: "yellow", title: "Yellow", hue: 60, color: "#edef00" }, { id: "green", title: "Green", hue: 120, color: "#39d443" },
  { id: "cyan", title: "Cyan", hue: 180, color: "#44dce1" }, { id: "blue", title: "Blue", hue: 240, color: "#4197e8" },
  { id: "purple", title: "Purple", hue: 270, color: "#a64de8" }, { id: "magenta", title: "Magenta", hue: 300, color: "#e448e6" },
] as const;
export type HueKey = typeof HUES[number]["id"];
export type HSLGrade = { enabled?: boolean } & Partial<Record<HueKey, { hue?: number; saturation?: number; brightness?: number }>>;
export type CurvePoint = [number, number];
export type CurveKey = "luma" | "red" | "green" | "blue";
export type CurvesGrade = { enabled?: boolean } & Partial<Record<CurveKey, CurvePoint[]>>;
export type SecondaryGrade = { hsl?: HSLGrade; curves?: CurvesGrade; wheels?: WheelsGrade };
export const NEUTRAL_CURVE: CurvePoint[] = [[0, 0], [1, 1]];
const clamp = (v: number) => MathUtils.clamp(v, 0, 1);

export function curveMap(points: CurvePoint[] = NEUTRAL_CURVE) {
  const spline = new Spline(points.map((p) => p[0]), points.map((p) => p[1]));
  return (x: number) => x <= points[0][0] ? points[0][1] : x >= points.at(-1)![0] ? points.at(-1)![1] : clamp(spline.at(x));
}

export const hasSecondary = ({ hsl, curves, wheels }: SecondaryGrade) => hasWheels(wheels) ||
  (hsl?.enabled !== false && HUES.some(({ id }) => Object.values(hsl?.[id] ?? {}).some((x) => x !== 0))) ||
  (curves?.enabled !== false && (["luma", "red", "green", "blue"] as const).some((id) => curves?.[id]?.some(([x, y]) => x !== y)));

export function secondaryGrade({ hsl, curves, wheels }: SecondaryGrade) {
  const wheel = wheelGrade(wheels);
  const ranges = hsl?.enabled === false ? [] : HUES.flatMap(({ id, hue }) => {
    const v = hsl?.[id]; return v && Object.values(v).some((x) => x !== 0) ? [{ center: hue, ...v }] : [];
  });
  const hs = { h: 0, s: 0, l: 0 };
  const maps = (["luma", "red", "green", "blue"] as const).map((id) => curves?.enabled !== false && curves?.[id]?.some(([x, y]) => x !== y) ? curveMap(curves[id]) : null);
  return (c: Color) => {
    if (ranges.length) {
      // EffectCraft Hue/Saturation (MIT): membership uses the original hue, with a grey-safe falloff.
      c.getHSL(hs, LinearSRGBColorSpace);
      let h = hs.h, s = hs.s, l = hs.l, affected = false;
      for (const r of ranges) {
        const d = Math.abs(MathUtils.euclideanModulo(hs.h * 360 - r.center + 180, 360) - 180);
        const w = clamp((45 - d) / 30) * Math.min(hs.s * 20, 1), sat = (r.saturation ?? 0) / 100 * w, light = (r.brightness ?? 0) / 100 * w;
        if (!w) continue;
        affected = true;
        h += (r.hue ?? 0) / 1200 * w;
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
