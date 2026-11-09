import { expect, test } from "bun:test";
import { Color } from "three";
import { colorGrade } from "../src/grade-color";

test("neutral adjustment preserves display RGB, including black and white", () => {
  const grade = colorGrade({});
  for (let r = 0; r <= 8; r++) for (let g = 0; g <= 8; g++) for (let b = 0; b <= 8; b++) {
    const input = new Color(r / 8, g / 8, b / 8), output = grade(input.clone());
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
  const warm = colorGrade({ temp: 50 })(new Color(.5, .5, .5));
  const cool = colorGrade({ temp: -50 })(new Color(.5, .5, .5));
  const magenta = colorGrade({ tint: 50 })(new Color(.5, .5, .5));
  expect(warm.r).toBeGreaterThan(warm.b);
  expect(cool.b).toBeGreaterThan(cool.r);
  expect(magenta.g).toBeLessThan((magenta.r + magenta.b) / 2);
  expect(colorGrade({ temp: 100, tint: -100 })(new Color(0, 0, 0)).toArray()).toEqual([0, 0, 0]);
});

test("desaturation makes neutral colors; tonal adjustments preserve their target ranges", () => {
  const bw = colorGrade({ saturation: -100 })(new Color(.9, .1, .3));
  expect(bw.r).toBeCloseTo(bw.g, 6);
  expect(bw.g).toBeCloseTo(bw.b, 6);
  const shadows = colorGrade({ shadow: 50 });
  expect(shadows(new Color(.15, .15, .15)).r).toBeGreaterThan(.15);
  expect(shadows(new Color(.9, .9, .9)).r).toBeCloseTo(.9, 5);
  const highlights = colorGrade({ highlight: -50 });
  expect(highlights(new Color(.85, .85, .85)).r).toBeLessThan(.85);
  expect(highlights(new Color(.05, .05, .05)).r).toBeCloseTo(.05, 5);
});

test("HSL selects the original hue, wraps red and leaves grey and other colors unchanged", () => {
  const change = colorGrade({}, { hsl: { red: { hue: 100, saturation: -100 } } });
  expect(change(new Color(.8, .2, .2)).toArray()).toEqual([.5, .5, .5]);
  expect(change(new Color(.2, .8, .2)).toArray()).toEqual([.2, .8, .2]);
  expect(change(new Color(.4, .4, .4)).toArray()).toEqual([.4, .4, .4]);
  const brighten = colorGrade({}, { hsl: { red: { brightness: 50 } } });
  expect(brighten(new Color(.8, .2, .21)).r).toBeCloseTo(brighten(new Color(.8, .21, .2)).r, 5);
});

test("curves interpolate their points, hold endpoints and apply master before RGB", () => {
  const grade = colorGrade({}, { curves: { luma: [[0, 0], [.5, .75], [1, 1]], red: [[0, 1], [1, 0]] } });
  expect(grade(new Color(.5, .5, .5)).toArray()).toEqual([.25, .75, .75]);
  expect(grade(new Color(1, 1, 1)).toArray()).toEqual([0, 1, 1]);
  const identity = colorGrade({}, { curves: { luma: [[0, 0], [.23, .23], [1, 1]] } });
  expect(identity(new Color(.4, .8, 1)).toArray()).toEqual([.4, .8, 1]);
});

test("primary wheels target black, mid-grey and white with a reversible intensity", () => {
  const shadows = { mode: "primary" as const, shadows: { rgb: [.2, .2, .2] as [number, number, number] } };
  const grade = colorGrade({}, { wheels: shadows });
  expect(grade(new Color(0, 0, 0)).convertSRGBToLinear().r).toBeCloseTo(.2, 4);
  expect(grade(new Color(1, 1, 1)).r).toBeCloseTo(1, 6);
  const sample = new Color(.4, .5, .6), full = grade(sample.clone());
  expect(colorGrade({}, { wheels: { ...shadows, amount: 0 } })(sample.clone()).toArray()).toEqual(sample.toArray());
  const half = colorGrade({}, { wheels: { ...shadows, amount: 50 } })(sample.clone());
  expect(half.r).toBeCloseTo((full.r + sample.r) / 2, 5);
  const mid = colorGrade({}, { wheels: { midtones: { rgb: [.5, .5, .5] } } });
  expect(mid(new Color(.4, .4, .4)).r).toBeGreaterThan(.4);
  expect(mid(new Color(0, 0, 0)).r).toBe(0);
  expect(mid(new Color(1, 1, 1)).r).toBeCloseTo(1, 6);
});

test("log wheels isolate tonal ranges; offset saturation removes chroma and limits stay finite", () => {
  const log = colorGrade({}, { wheels: { mode: "log", shadows: { rgb: [.5, 0, 0] } } });
  const shadow = log(new Color(.2, .2, .2));
  expect(shadow.r).toBeGreaterThan(shadow.g);
  expect(log(new Color(.95, .95, .95)).r).toBeCloseTo(.95, 5);
  const grey = colorGrade({}, { wheels: { offset: { saturation: 0 } } })(new Color(.8, .3, .6));
  expect(grey.r).toBeCloseTo(grey.g, 6); expect(grey.g).toBeCloseTo(grey.b, 6);
  const extreme = colorGrade({}, { wheels: { midtones: { rgb: [-1, -1, -1] }, shadows: { rgb: [1, 1, 1] } } });
  for (const x of [0, .01, .5, 1]) expect(extreme(new Color(x, x, x)).toArray().every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
});
