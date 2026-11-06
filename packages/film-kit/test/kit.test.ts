import { expect, test } from "bun:test";
import { spring } from "math/time";
import { curve } from "../src/curve";
import { shake } from "../src/shake";
import { follow, springTrack } from "../src/spring";
import { chain, quintic } from "../src/transition";

const E = 1e-4;

test("curve passes through its keys and keeps its speed through an inner key", () => {
  const c = curve([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 3, v: 4 }, { t: 4, v: 5 }]);
  for (const k of c.keys) expect(c(k.t) as number).toBeCloseTo(k.v as number, 9);
  const left = ((c(1) as number) - (c(1 - E) as number)) / E, right = ((c(1 + E) as number) - (c(1) as number)) / E;
  expect(left).toBeGreaterThan(0.5);
  expect(Math.abs(left - right)).toBeLessThan(1e-3);
  expect(c.vel(1) as number).toBeCloseTo(left, 2);
});

test("curve never overshoots a keyed value and is flat at a peak", () => {
  const c = curve([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 1.2, v: 1.01 }, { t: 3, v: 0 }]);
  for (let t = 0; t <= 3; t += 0.001) expect(c(t) as number).toBeLessThanOrEqual(1.01 + 1e-9);
  expect(c.vel(1.2) as number).toBeCloseTo(0, 9);
});

test("curve stop, hold, linear, arrays and angles", () => {
  expect(curve([{ t: 0, v: 0 }, { t: 1, v: 1, stop: true }, { t: 2, v: 2 }]).vel(1) as number).toBeCloseTo(0, 9);
  const h = curve([{ t: 0, v: 0, hold: true }, { t: 1, v: 5 }]);
  expect(h(0.99)).toBe(0);
  expect(h(1)).toBe(5);
  expect(curve([{ t: 0, v: 0, linear: true }, { t: 2, v: 4 }])(0.5)).toBeCloseTo(1, 9);
  expect(curve([{ t: 0, v: [0, 10] }, { t: 1, v: [2, 20] }])(1)).toEqual([2, 20]);
  expect(curve([{ t: 0, v: 350 }, { t: 1, v: 10 }], { angle: true })(1)).toBeCloseTo(370, 9);
});

test("springTrack equals stepping the spring frame by frame, whatever order frames are asked in", () => {
  const s = springTrack([{ t: 1, to: 0 }, { t: 2, to: 1 }, { t: 2.5, kick: 3 }, { t: 3, to: -1 }], { smooth: 0.3, ratio: 0.5 });
  const ref = spring.create(0);
  let target = 0, kicked = false;
  const dt = 1 / 1000, want: number[] = [];
  for (let i = 1000; i <= 4000; i++) {
    const t = i * dt;
    if (i > 1000) spring.update(ref, target, 0.3, 0.5, dt);
    if (i === 2000) target = 1;
    if (i === 2500 && !kicked) { ref.velocity += 3; kicked = true; }
    if (i === 3000) target = -1;
    if (i % 250 === 0) want.push(ref.value);
  }
  const ts = want.map((_, j) => 1 + j * 0.25);
  for (const j of [...ts.keys()].reverse()) expect(s(ts[j])).toBeCloseTo(want[j], 6);
});

test("follow lags a moving target and settles on it", () => {
  const target = (t: number) => (t < 1 ? 0 : 1);
  const f = follow(target, { from: 0, to: 4, smooth: 0.2 });
  expect(f(1.05)).toBeLessThan(0.5);
  expect(f(3.5)).toBeCloseTo(1, 3);
});

test("quintic starts at the gap with the given speed and is zero from dur on", () => {
  expect(quintic(1, -2, 0.5, 0)).toBeCloseTo(1, 12);
  expect((quintic(1, -2, 0.5, E) - quintic(1, -2, 0.5, 0)) / E).toBeCloseTo(-2, 2);
  expect(quintic(1, -2, 0.5, 0.5)).toBe(0);
  for (let t = 0; t < 0.5; t += 0.001) expect(quintic(1, -2, 0.5, t)).toBeGreaterThanOrEqual(-1e-12);
});

test("chain switches without a jump in place or speed, then plays the new motion as is", () => {
  const a = (t: number) => 2 * t, b = (t: number) => 5 - t;
  const out = chain([{ t: 0, f: a }, { t: 1, f: b }], 0.4);
  expect(out(1) as number).toBeCloseTo(2, 6);
  const vBefore = ((out(1 - E) as number) - (out(1 - 2 * E) as number)) / E;
  const vAfter = ((out(1 + 2 * E) as number) - (out(1 + E) as number)) / E;
  expect(Math.abs(vBefore - vAfter)).toBeLessThan(0.01);
  expect(out(1.4)).toBeCloseTo(b(1.4), 12);
  const three = chain([{ t: 0, f: a }, { t: 1, f: b }, { t: 1.2, f: () => 0 }], 0.4);
  expect(three(1.2) as number).toBeCloseTo(out(1.2) as number, 6);
});

test("shake is still before the first hit, bounded, repeatable and gone once trauma runs out", () => {
  const s = shake([{ t: 1, amount: 0.8 }, { t: 1.3, amount: 0.5 }], { decay: 1, max: [2, 2, 1] });
  expect(s(0.9)).toEqual([0, 0, 0]);
  expect(s.trauma(1.3)).toBeCloseTo(1, 9);
  let moved = 0;
  for (let t = 1; t < 2.3; t += 0.01) {
    const [y, p, r] = s(t);
    expect(Math.abs(y)).toBeLessThanOrEqual(2);
    expect(Math.abs(p)).toBeLessThanOrEqual(2);
    expect(Math.abs(r)).toBeLessThanOrEqual(1);
    moved += Math.abs(y);
  }
  expect(moved).toBeGreaterThan(0.5);
  expect(s(1.5)).toEqual(s(1.5));
  expect(s(2.31)).toEqual([0, 0, 0]);
});
