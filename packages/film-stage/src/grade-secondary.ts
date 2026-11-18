import { Color, LinearSRGBColorSpace, MathUtils } from "three";

import { curveMap, HUES, type SecondaryGrade } from "./grade-meta";
import { wheelGrade } from "./grade-wheels";

export {
  type CurveKey,
  curveMap,
  type CurvePoint,
  type CurvesGrade,
  hasSecondary,
  type HSLGrade,
  type HueKey,
  HUES,
  NEUTRAL_CURVE,
  type SecondaryGrade,
} from "./grade-meta";

const clamp = (v: number) => MathUtils.clamp(v, 0, 1);

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
