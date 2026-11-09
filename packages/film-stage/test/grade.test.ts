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
