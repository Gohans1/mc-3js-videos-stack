import { expect, test } from "bun:test";

import { reaches } from "../src/handeye";
import { hesitation, stretch } from "../src/hesitate";
import { fitts, minJerk, REACH, reachK, reachShape } from "../src/reach";
import { TREMOR, tremor } from "../src/tremor";

const speeds = (f: (u: number) => number, n = 600) =>
  Array.from({ length: n }, (_, i) => (f((i + 1) / n) - f(i / n)) * n);

test("reach: Fitts time grows with distance and shrinks with size; one main bell, a small second one, ends exactly", () => {
  expect(fitts(0.4)).toBeCloseTo(0.53, 2);
  expect(fitts(0.8)).toBeGreaterThan(fitts(0.4));
  expect(fitts(0.4, 0.02)).toBeGreaterThan(fitts(0.4));
  expect(minJerk(0.5)).toBeCloseTo(0.5, 6);
  expect(reachShape(0)).toBe(0);
  expect(reachShape(1)).toBeCloseTo(1, 9);
  const v = speeds((u) => reachShape(u));
  const peak = v.indexOf(Math.max(...v)) / v.length;
  expect(peak).toBeGreaterThan(0.35);
  expect(peak).toBeLessThan(0.5);
  // speed falls after the main bell, rises again for the correction, then stops: two local maxima
  const maxima = v.filter(
    (x, i) => i > 0 && i < v.length - 1 && x > v[i - 1] && x >= v[i + 1] && x > 0.01,
  );
  expect(maxima.length).toBe(2);
  expect(Math.min(...v)).toBeGreaterThanOrEqual(-1e-9); // never goes back
  // with the keys 2 s apart a 40 cm reach waits, then arrives on the second key
  expect(reachK(0.5, 0, 2, { dist: 0.4 })).toBe(0);
  expect(reachK(2 - fitts(0.4) / 2, 0, 2, { dist: 0.4 })).toBeGreaterThan(0.3);
  expect(reachK(2, 0, 2, { dist: 0.4 })).toBeCloseTo(1, 9);
  expect(REACH.first + REACH.second).toBeGreaterThan(1);
});

test("hesitation: starts late, stops part way, draws back when very unsure, then commits; a clip's reach gets longer", () => {
  const p = hesitation(2, 1);
  expect(p(0.2)).toBe(0);
  let first = 0,
    low = 1;
  for (let s = 0; s < 2; s += 0.01) {
    const x = p(s);
    if (x > 0.39) {
      first = s;
      break;
    }
  }
  expect(p(first + 0.25)).toBeLessThan(0.4 + 1e-9); // stopped part way, not on to the end
  for (let s = first; s < first + 0.6; s += 0.01) low = Math.min(low, p(s));
  expect(low).toBeLessThan(0.3); // drawn back
  expect(p(2)).toBeCloseTo(1, 9);
  expect(hesitation(2, 0.3)(1)).toBeGreaterThan(0.3);
  // no doubt: a plain bell
  expect(hesitation(1, 0)(0.5)).toBeCloseTo(0.5, 6);
  const s = stretch(10, 0.6, 1);
  expect(s.extra).toBeGreaterThan(1);
  expect(s.time(9)).toBe(9);
  expect(s.time(10 + 0.6 + s.extra)).toBeCloseTo(10.6, 6);
  expect(s.time(20)).toBeCloseTo(20 - s.extra, 6);
  expect(stretch(10, 0.6, 0).time(10.3)).toBe(10.3);
  // the clip never plays faster than it was made, and runs on without a jump
  let fastest = 0;
  for (let t = 9; t < 13; t += 0.001)
    fastest = Math.max(fastest, (s.time(t + 0.001) - s.time(t)) / 0.001);
  expect(fastest).toBeLessThan(1.01);
  let back = false;
  for (let t = 10; t < 12; t += 0.01) if (s.time(t + 0.01) < s.time(t) - 1e-6) back = true;
  expect(back).toBe(true);
});

test("tremor: nothing without fear, grows with it, mostly 6-12 Hz, the two hands not in step", () => {
  expect(tremor(() => 0)(1)).toEqual({});
  const amp = (f: number) => {
    const s = tremor(() => f);
    let m = 0;
    for (let t = 0; t < 4; t += 1 / 240) m = Math.max(m, Math.abs(s(t).laR![0]));
    return m;
  };
  expect(amp(1)).toBeGreaterThan(2 * amp(0.4));
  expect(amp(1)).toBeLessThan(2.5 * TREMOR.forearm);
  // zero crossings a second, about twice the main frequency
  const s = tremor(() => 1);
  let z = 0,
    prev = s(0).laR![0],
    same = 0,
    n = 0;
  for (let t = 1 / 240; t < 4; t += 1 / 240) {
    const p = s(t),
      x = p.laR![0];
    if (Math.sign(x) !== Math.sign(prev)) z++;
    prev = x;
    same += Math.sign(x) === Math.sign(p.laL![0]) ? 1 : 0;
    n++;
  }
  expect(z / 4 / 2).toBeGreaterThan(5);
  expect(z / 4 / 2).toBeLessThan(12);
  expect(same / n).toBeLessThan(0.7);
});

test("handeye: a reach in two goes (hesitant, drawn back) or with a corrective move is one reach to its end", () => {
  const to: [number, number, number] = [-0.3, 1.0, 0.6],
    from: [number, number, number] = [-0.2, 0.6, 0.1];
  const p = hesitation(2, 1);
  const hand = (t: number): [number, number, number] => {
    const k = t < 1 ? 0 : t > 3 ? 1 : p(t - 1);
    return from.map((x, i) => x + (to[i] - x) * k) as [number, number, number];
  };
  const R = reaches(hand, 5, { rest: from });
  expect(R.length).toBe(1);
  expect(R[0].start).toBeLessThan(1.4);
  expect(R[0].arrive).toBeGreaterThan(2.8);
  const plain = (t: number): [number, number, number] => {
    const k = reachShape((t - 1) / 0.6);
    return from.map((x, i) => x + (to[i] - x) * k) as [number, number, number];
  };
  expect(reaches(plain, 3, { rest: from }).length).toBe(1);
});
