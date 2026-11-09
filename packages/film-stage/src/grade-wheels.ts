import { Color, MathUtils } from "three";

export const WHEEL_KEYS = ["shadows", "midtones", "highlights", "offset"] as const;
export type WheelKey = typeof WHEEL_KEYS[number];
export type WheelValue = { rgb?: [number, number, number]; saturation?: number };
export type WheelsGrade = { enabled?: boolean; mode?: "primary" | "log"; amount?: number } & Partial<Record<WheelKey, WheelValue>>;
const clamp = (x: number) => MathUtils.clamp(x, 0, 1);
export const hasWheels = (w?: WheelsGrade) => !!w && w.enabled !== false && (w.amount ?? 100) > 0 &&
  WHEEL_KEYS.some((k) => w[k]?.rgb?.some((v) => v !== 0) || (w[k]?.saturation ?? 100) !== 100);

export function wheelGrade(w?: WheelsGrade) {
  if (!hasWheels(w)) return (c: Color) => c;
  const values = WHEEL_KEYS.map((k) => w![k]?.rgb ?? [0, 0, 0]), saturation = WHEEL_KEYS.map((k) => (w![k]?.saturation ?? 100) / 100 - 1);
  const amount = (w!.amount ?? 100) / 100, original = new Color();
  return (c: Color) => {
    original.copy(c); c.convertSRGBToLinear();
    const y = c.r * .212673 + c.g * .715152 + c.b * .072175;
    const s = 1 - MathUtils.smoothstep(y, 0, .333), h = MathUtils.smoothstep(y, .55, 1), weights = [s, 1 - s - h, h, 1];
    const channel = (x: number, i: number) => {
      if (w!.mode === "log") {
        // Filament tonalRanges (Apache-2.0), with neutral multipliers at RGB zero.
        x *= s * (1 + values[0][i]) + (1 - s - h) * (1 + values[1][i]) + h * (1 + values[2][i]);
      } else {
        // enhancer applyLiftGammaGainEffect (MIT), remapped from neutral 1 to neutral 0.
        x = Math.max(0, x + values[0][i] * (1 - x)) * (1 + values[2][i]);
        x = x ** (1 / Math.max(.001, 1 + values[1][i]));
      }
      return x + values[3][i];
    };
    c.setRGB(channel(c.r, 0), channel(c.g, 1), channel(c.b, 2));
    const grey = c.r * .212673 + c.g * .715152 + c.b * .072175;
    const sat = Math.max(0, 1 + saturation.reduce((sum, v, i) => sum + v * weights[i], 0));
    c.setRGB(clamp(grey + (c.r - grey) * sat), clamp(grey + (c.g - grey) * sat), clamp(grey + (c.b - grey) * sat));
    return c.convertLinearToSRGB().lerp(original, 1 - amount);
  };
}
