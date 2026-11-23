import type { Grade } from "./grade";
import { type CurveKey, type CurvePoint, HUES, NEUTRAL_CURVE } from "./grade-secondary";
import { WHEEL_KEYS, type WheelKey } from "./grade-wheels";

export type LookSpec = {
  title: string;
  tip: string;
  grade: Grade;
};

export const LOOK_IDS = [
  "docu-clean",
  "teal-amber",
  "noir-slate",
  "warm-film",
  "horror-cold",
  "neon-pop",
  "bleach-grit",
] as const;

export type LookId = (typeof LOOK_IDS)[number];

export const LOOKS: Record<string, LookSpec> = {
  "docu-clean": {
    title: "Docu Clean",
    tip: "Crisp neutral clarity for explainers and factual storytelling",
    grade: {
      basic: { contrast: 8, clarity: 12, sharpen: 10, dither: 25, particles: 6 },
    },
  },
  "teal-amber": {
    title: "Teal & Amber",
    tip: "Cool shadow separation against warm key highlights for cinematic 3D drama",
    grade: {
      basic: { temp: -6, saturation: 8, dither: 25, particles: 8 },
      curves: {
        luma: [
          [0, 0],
          [0.25, 0.21],
          [0.75, 0.81],
          [1, 1],
        ],
      },
      wheels: {
        mode: "log",
        shadows: { rgb: [-0.24, 0.04, 0.34] },
        highlights: { rgb: [0.18, 0.05, -0.14] },
      },
    },
  },
  "noir-slate": {
    title: "Noir Slate",
    tip: "Hard monochrome-leaning slate with deep blacks and stylized corner falloff",
    grade: {
      basic: {
        temp: -8,
        contrast: 12,
        saturation: -55,
        blacks: -6,
        vignette: 22,
        dither: 30,
        particles: 12,
      },
      wheels: {
        mode: "log",
        shadows: { rgb: [-0.08, -0.02, 0.1] },
      },
    },
  },
  "warm-film": {
    title: "Warm Film",
    tip: "Golden 35mm warmth with subtle halation and soft organic edge roll-off",
    grade: {
      basic: { temp: 14, shadow: 6, halation: 18, soften: 10, dither: 25, particles: 14 },
      curves: {
        luma: [
          [0, 0],
          [0.25, 0.23],
          [0.75, 0.78],
          [1, 1],
        ],
      },
      wheels: {
        mode: "log",
        midtones: { rgb: [0.06, 0.02, -0.04] },
        highlights: { rgb: [0.1, 0.04, -0.08] },
      },
    },
  },
  "horror-cold": {
    title: "Horror Cold",
    tip: "Desaturated steel shadows and crushed low-end tension",
    grade: {
      basic: { temp: -18, tint: -6, saturation: -28, shadow: -8, dither: 30, particles: 16 },
      curves: {
        luma: [
          [0, 0],
          [0.28, 0.2],
          [0.75, 0.79],
          [1, 1],
        ],
      },
      wheels: {
        mode: "log",
        shadows: { rgb: [-0.12, 0.04, 0.14] },
      },
    },
  },
  "neon-pop": {
    title: "Neon Pop",
    tip: "Punchy saturated contrast tuned for emissive blocks, redstone, and night scenes",
    grade: {
      basic: { saturation: 22, brilliance: 8, halation: 14, dither: 20 },
      curves: {
        luma: [
          [0, 0],
          [0.22, 0.18],
          [0.75, 0.83],
          [1, 1],
        ],
      },
      wheels: {
        mode: "log",
        shadows: { rgb: [-0.08, -0.04, 0.16] },
        highlights: { rgb: [0.08, -0.02, 0.06] },
      },
    },
  },
  "bleach-grit": {
    title: "Bleach Grit",
    tip: "High-contrast silver-retention grit with crisp micro-texture for action beats",
    grade: {
      basic: {
        contrast: 14,
        saturation: -42,
        highlight: 10,
        blacks: -8,
        clarity: 28,
        sharpen: 16,
        dither: 25,
        particles: 18,
      },
    },
  },
};

export function resolveGrade(grade?: Grade): Grade {
  if (!grade) return {};
  const preset = grade.look ? LOOKS[grade.look]?.grade : undefined;
  if (!preset) return grade;
  return {
    ...preset,
    ...grade,
    ...(preset.basic || grade.basic ? { basic: { ...preset.basic, ...grade.basic } } : {}),
    ...(preset.hsl || grade.hsl ? { hsl: { ...preset.hsl, ...grade.hsl } } : {}),
    ...(preset.curves || grade.curves ? { curves: { ...preset.curves, ...grade.curves } } : {}),
    ...(preset.wheels || grade.wheels ? { wheels: { ...preset.wheels, ...grade.wheels } } : {}),
  };
}

const lookPreset = (grade: Grade) => (grade.look ? LOOKS[grade.look]?.grade : undefined);
const flatCurve = (): CurvePoint[] => NEUTRAL_CURVE.map(([x, y]) => [x, y]);
const CURVE_KEYS: readonly CurveKey[] = ["luma", "red", "green", "blue"];

export function resetLookHsl(grade: Grade) {
  const preset = lookPreset(grade)?.hsl;
  const masked = preset ? HUES.filter(({ id }) => preset[id]) : [];
  if (!masked.length) {
    delete grade.hsl;
    return;
  }
  const next: NonNullable<Grade["hsl"]> = {};
  for (const { id } of masked) next[id] = { hue: 0, saturation: 0, brightness: 0 };
  grade.hsl = next;
}

export function resetLookCurveChannel(grade: Grade, id: CurveKey) {
  const preset = lookPreset(grade)?.curves;
  if (preset?.[id]) grade.curves = { ...grade.curves, [id]: flatCurve() };
  else if (grade.curves) delete grade.curves[id];
}

export function resetLookCurves(grade: Grade) {
  const preset = lookPreset(grade)?.curves;
  const masked = preset ? CURVE_KEYS.filter((k) => preset[k]) : [];
  if (!masked.length) {
    delete grade.curves;
    return;
  }
  const next: NonNullable<Grade["curves"]> = {};
  for (const k of masked) next[k] = flatCurve();
  grade.curves = next;
}

export function resetLookWheel(grade: Grade, id: WheelKey) {
  const preset = lookPreset(grade)?.wheels;
  if (preset?.[id]) grade.wheels = { ...grade.wheels, [id]: { rgb: [0, 0, 0], saturation: 100 } };
  else if (grade.wheels) delete grade.wheels[id];
}

export function resetLookWheels(grade: Grade) {
  const preset = lookPreset(grade)?.wheels;
  const masked = preset ? WHEEL_KEYS.filter((k) => preset[k]) : [];
  if (!masked.length && !preset?.mode) {
    delete grade.wheels;
    return;
  }
  const next: NonNullable<Grade["wheels"]> = { mode: "primary", amount: 100 };
  for (const k of masked) next[k] = { rgb: [0, 0, 0], saturation: 100 };
  grade.wheels = next;
}
