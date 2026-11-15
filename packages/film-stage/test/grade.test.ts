import { expect, test } from "bun:test";

import { Color } from "three";

import { finishStrength, type Grade } from "../src/grade";
import { colorGrade } from "../src/grade-color";
import { hasSecondary, NEUTRAL_CURVE } from "../src/grade-secondary";
import { hasWheels } from "../src/grade-wheels";
import {
  LOOK_IDS,
  LOOKS,
  resetLookCurveChannel,
  resetLookCurves,
  resetLookHsl,
  resetLookWheel,
  resetLookWheels,
  resolveGrade,
} from "../src/looks";

test("neutral adjustment preserves display RGB, including black and white", () => {
  const grade = colorGrade({});
  for (let r = 0; r <= 8; r++)
    for (let g = 0; g <= 8; g++)
      for (let b = 0; b <= 8; b++) {
        const input = new Color(r / 8, g / 8, b / 8),
          output = grade(input.clone());
        expect(output.r).toBeCloseTo(input.r, 5);
        expect(output.g).toBeCloseTo(input.g, 5);
        expect(output.b).toBeCloseTo(input.b, 5);
      }
});

test("one stop doubles linear light, without doubling gamma-encoded RGB", () => {
  const input = new Color(0.18, 0.18, 0.18).convertLinearToSRGB();
  const output = colorGrade({ exposure: 25 })(input).convertSRGBToLinear();
  expect(output.r).toBeCloseTo(0.36, 4);
  expect(output.g).toBeCloseTo(0.36, 4);
  expect(output.b).toBeCloseTo(0.36, 4);
});

test("white balance follows temperature and tint, while black stays black", () => {
  const warm = colorGrade({ temp: 50 })(new Color(0.5, 0.5, 0.5));
  const cool = colorGrade({ temp: -50 })(new Color(0.5, 0.5, 0.5));
  const magenta = colorGrade({ tint: 50 })(new Color(0.5, 0.5, 0.5));
  expect(warm.r).toBeGreaterThan(warm.b);
  expect(cool.b).toBeGreaterThan(cool.r);
  expect(magenta.g).toBeLessThan((magenta.r + magenta.b) / 2);
  expect(colorGrade({ temp: 100, tint: -100 })(new Color(0, 0, 0)).toArray()).toEqual([0, 0, 0]);
});

test("desaturation makes neutral colors; tonal adjustments preserve their target ranges", () => {
  const bw = colorGrade({ saturation: -100 })(new Color(0.9, 0.1, 0.3));
  expect(bw.r).toBeCloseTo(bw.g, 6);
  expect(bw.g).toBeCloseTo(bw.b, 6);
  const shadows = colorGrade({ shadow: 50 });
  expect(shadows(new Color(0.15, 0.15, 0.15)).r).toBeGreaterThan(0.15);
  expect(shadows(new Color(0.9, 0.9, 0.9)).r).toBeCloseTo(0.9, 5);
  const highlights = colorGrade({ highlight: -50 });
  expect(highlights(new Color(0.85, 0.85, 0.85)).r).toBeLessThan(0.85);
  expect(highlights(new Color(0.05, 0.05, 0.05)).r).toBeCloseTo(0.05, 5);
});

test("HSL selects the original hue, wraps red and leaves grey and other colors unchanged", () => {
  const change = colorGrade({}, { hsl: { red: { hue: 100, saturation: -100 } } });
  expect(change(new Color(0.8, 0.2, 0.2)).toArray()).toEqual([0.5, 0.5, 0.5]);
  expect(change(new Color(0.2, 0.8, 0.2)).toArray()).toEqual([0.2, 0.8, 0.2]);
  expect(change(new Color(0.4, 0.4, 0.4)).toArray()).toEqual([0.4, 0.4, 0.4]);
  const brighten = colorGrade({}, { hsl: { red: { brightness: 50 } } });
  expect(brighten(new Color(0.8, 0.2, 0.21)).r).toBeCloseTo(
    brighten(new Color(0.8, 0.21, 0.2)).r,
    5,
  );
});

test("curves interpolate their points, hold endpoints and apply master before RGB", () => {
  const grade = colorGrade(
    {},
    {
      curves: {
        luma: [
          [0, 0],
          [0.5, 0.75],
          [1, 1],
        ],
        red: [
          [0, 1],
          [1, 0],
        ],
      },
    },
  );
  expect(grade(new Color(0.5, 0.5, 0.5)).toArray()).toEqual([0.25, 0.75, 0.75]);
  expect(grade(new Color(1, 1, 1)).toArray()).toEqual([0, 1, 1]);
  const identity = colorGrade(
    {},
    {
      curves: {
        luma: [
          [0, 0],
          [0.23, 0.23],
          [1, 1],
        ],
      },
    },
  );
  expect(identity(new Color(0.4, 0.8, 1)).toArray()).toEqual([0.4, 0.8, 1]);
});

test("primary wheels target black, mid-grey and white with a reversible intensity", () => {
  const shadows = {
    mode: "primary" as const,
    shadows: { rgb: [0.2, 0.2, 0.2] as [number, number, number] },
  };
  const grade = colorGrade({}, { wheels: shadows });
  expect(grade(new Color(0, 0, 0)).convertSRGBToLinear().r).toBeCloseTo(0.2, 4);
  expect(grade(new Color(1, 1, 1)).r).toBeCloseTo(1, 6);
  const sample = new Color(0.4, 0.5, 0.6),
    full = grade(sample.clone());
  expect(colorGrade({}, { wheels: { ...shadows, amount: 0 } })(sample.clone()).toArray()).toEqual(
    sample.toArray(),
  );
  const half = colorGrade({}, { wheels: { ...shadows, amount: 50 } })(sample.clone());
  expect(half.r).toBeCloseTo((full.r + sample.r) / 2, 5);
  const mid = colorGrade({}, { wheels: { midtones: { rgb: [0.5, 0.5, 0.5] } } });
  expect(mid(new Color(0.4, 0.4, 0.4)).r).toBeGreaterThan(0.4);
  expect(mid(new Color(0, 0, 0)).r).toBe(0);
  expect(mid(new Color(1, 1, 1)).r).toBeCloseTo(1, 6);
});

test("log wheels isolate tonal ranges; offset saturation removes chroma and limits stay finite", () => {
  const log = colorGrade({}, { wheels: { mode: "log", shadows: { rgb: [0.5, 0, 0] } } });
  const shadow = log(new Color(0.2, 0.2, 0.2));
  expect(shadow.r).toBeGreaterThan(shadow.g);
  expect(log(new Color(0.95, 0.95, 0.95)).r).toBeCloseTo(0.95, 5);
  const grey = colorGrade({}, { wheels: { offset: { saturation: 0 } } })(new Color(0.8, 0.3, 0.6));
  expect(grey.r).toBeCloseTo(grey.g, 6);
  expect(grey.g).toBeCloseTo(grey.b, 6);
  const extreme = colorGrade(
    {},
    { wheels: { midtones: { rgb: [-1, -1, -1] }, shadows: { rgb: [1, 1, 1] } } },
  );
  for (const x of [0, 0.01, 0.5, 1])
    expect(
      extreme(new Color(x, x, x))
        .toArray()
        .every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
    ).toBe(true);
});

test("Soften, Lens fringe and Fisheye sliders map into Cinetic's ranges", () => {
  const none = finishStrength({});
  expect(none).toMatchObject({ soften: 0, fringe: 0, fisheye: 0 });
  const full = finishStrength({ soften: 100, fringe: 100, fisheye: 100, sharpen: 50 });
  expect(full.soften).toBeLessThanOrEqual(0.8);
  expect(full.fisheye).toBeCloseTo(0.18, 6);
  expect(full.sharpen).toBe(1);
});

test("curated LOOKS cover all locked IDs cleanly and avoid double vignette except noir", () => {
  expect(LOOK_IDS).toEqual([
    "docu-clean",
    "teal-amber",
    "noir-slate",
    "warm-film",
    "horror-cold",
    "neon-pop",
    "bleach-grit",
  ]);
  for (const id of LOOK_IDS) {
    const entry = LOOKS[id];
    expect(entry.title.length).toBeGreaterThan(0);
    expect(entry.tip.length).toBeGreaterThan(0);
    expect(entry.grade).toBeTruthy();
    if (id !== "noir-slate") expect(entry.grade.basic?.vignette ?? 0).toBe(0);
  }
});

test("resolveGrade merges look defaults beneath shot overrides and handles unknown or empty inputs", () => {
  expect(resolveGrade(undefined)).toEqual({});
  expect(resolveGrade({})).toEqual({});

  const overridden: Grade = resolveGrade({
    look: "teal-amber",
    basic: { exposure: 12 },
    wheels: { shadows: { rgb: [0, 0, 0] } },
  });
  expect(overridden.basic?.exposure).toBe(12);
  expect(overridden.basic?.saturation).toBe(LOOKS["teal-amber"].grade.basic?.saturation);
  expect(overridden.wheels?.shadows).toEqual({ rgb: [0, 0, 0] });
  expect(overridden.wheels?.highlights).toEqual(LOOKS["teal-amber"].grade.wheels?.highlights);
  expect(overridden.wheels?.mode).toBe(LOOKS["teal-amber"].grade.wheels?.mode);

  const disabled = resolveGrade({ look: "teal-amber", enabled: false });
  expect(disabled.enabled).toBe(false);

  const unknown = resolveGrade({ look: "does-not-exist", basic: { contrast: 15 } });
  expect(unknown.basic?.contrast).toBe(15);
});

test("partial reset helpers neutralize look-supplied curves, wheels, and HSL while keeping g.look intact", () => {
  const g: Grade = {
    look: "teal-amber",
    curves: {
      red: [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
    },
    wheels: { mode: "log", midtones: { rgb: [0.1, 0, -0.1] } },
    hsl: { red: { saturation: 20 } },
  };
  resetLookCurveChannel(g, "red");
  expect(g.curves?.red).toBeUndefined();
  expect(resolveGrade(g).curves?.luma).toEqual(LOOKS["teal-amber"].grade.curves?.luma);

  resetLookCurveChannel(g, "luma");
  expect(resolveGrade(g).curves?.luma).toEqual(NEUTRAL_CURVE);
  expect(g.look).toBe("teal-amber");

  const gAllCurves: Grade = {
    look: "teal-amber",
    curves: {
      red: [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
    },
  };
  resetLookCurves(gAllCurves);
  expect(resolveGrade(gAllCurves).curves?.luma).toEqual(NEUTRAL_CURVE);
  expect(resolveGrade(gAllCurves).curves?.red).toBeUndefined();

  resetLookWheel(g, "shadows");
  expect(resolveGrade(g).wheels?.shadows).toEqual({ rgb: [0, 0, 0], saturation: 100 });
  expect(resolveGrade(g).wheels?.highlights).toEqual(LOOKS["teal-amber"].grade.wheels?.highlights);

  resetLookWheels(g);
  expect(hasWheels(resolveGrade(g).wheels)).toBe(false);
  expect(hasSecondary({ curves: resolveGrade(g).curves, wheels: resolveGrade(g).wheels })).toBe(
    false,
  );

  resetLookHsl(g);
  expect(g.hsl).toBeUndefined();
  const customWithHsl: Grade = { look: "teal-amber", hsl: { cyan: { saturation: 15 } } };
  resetLookHsl(customWithHsl);
  expect(resolveGrade(customWithHsl).hsl).toBeUndefined();
});
