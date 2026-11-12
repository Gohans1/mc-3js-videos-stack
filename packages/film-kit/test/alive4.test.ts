import { expect, test } from "bun:test";

import { BLINKS, blinks, lidShut } from "../src/blinks";
import { FREEZE, freeze } from "../src/freeze";
import { fixations } from "../src/gaze";
import { HANDEYE, handEye, reaches } from "../src/handeye";
import { idle } from "../src/idle";
import { NOTICE, notice } from "../src/notice";

test("blinks: ~17 a minute at rest, ~4.5 while the eyes are busy, never closer than the gap, at the breaks after", () => {
  const per = (rate: number) => blinks(600, { rate: () => rate }).times.length / 10;
  expect(per(BLINKS.rate.rest)).toBeGreaterThan(17 * 0.75);
  expect(per(BLINKS.rate.rest)).toBeLessThan(17 * 1.25);
  expect(per(BLINKS.rate.focus)).toBeLessThan(4.5 * 1.4);
  const b = blinks(600, { rate: () => 26 }).times;
  expect(Math.min(...b.slice(1).map((t, i) => t - b[i]))).toBeGreaterThanOrEqual(BLINKS.gap - 1e-9);
  // busy, then each break: most bring a blink 0.4-0.6 s after
  const breaks = Array.from({ length: 40 }, (_, i) => 10 + 12 * i);
  const t = blinks(500, { rate: () => BLINKS.rate.focus, breaks }).times;
  const hit = breaks.filter((x) =>
    t.some((y) => y - x >= 0.4 - 1e-9 && y - x <= 0.6 + 1 / 60),
  ).length;
  expect(hit / breaks.length).toBeGreaterThan(0.6);
});

test("blink shape: shut in ~0.1 s, held, open over ~0.22 s (closing about twice as fast as opening)", () => {
  expect(lidShut(0)).toBe(0);
  expect(lidShut(BLINKS.down)).toBeCloseTo(1, 5);
  expect(lidShut(BLINKS.down + BLINKS.shut / 2)).toBe(1);
  expect(lidShut(0.05)).toBeCloseTo(0.5, 1);
  // half shut on the way down after 50 ms, half open on the way up only ~110 ms after it starts opening
  expect(lidShut(BLINKS.down + BLINKS.shut + 0.11)).toBeCloseTo(0.5, 1);
  expect(lidShut(BLINKS.down + BLINKS.shut + BLINKS.up + 0.001)).toBe(0);
});

test("freeze: takes hold after the cue, lets go after; sway mostly gone and the eyes hold still meanwhile", () => {
  const still = freeze([{ t: 10, until: 20 }]);
  expect(still(10)).toBe(0);
  expect(still(15)).toBe(1);
  expect(still(22)).toBe(0);
  const free = idle(() => ({}), 30, { standing: () => 1, breath: 0, settle: 0 });
  const frozen = idle(() => ({}), 30, { standing: () => 1, breath: 0, settle: 0, freeze: still });
  let a = 0,
    b = 0;
  for (let t = 12; t < 20; t += 0.05) {
    a = Math.max(a, Math.abs(free(t).root!.x!));
    b = Math.max(b, Math.abs(frozen(t).root!.x!));
  }
  expect(a).toBeGreaterThan(0.01);
  expect(b).toBeLessThan(a * (1 - FREEZE.sway) * 1.05);
  const f = fixations([], 30, { freeze: still }).filter((t) => t > 12 && t < 20);
  expect(Math.min(...f.slice(1).map((t, i) => t - f[i]))).toBeGreaterThanOrEqual(FREEZE.look);
});

test("handeye: a reach found in a hand path; eyes land before the hand moves, leave just before it lands, never for the way back down", () => {
  const rest: [number, number, number] = [-0.3, 0.7, 0.1],
    shelf: [number, number, number] = [-0.25, 1.7, 0.45],
    table: [number, number, number] = [-0.4, 1, 0.52];
  const ease = (x: number) => {
    const u = Math.min(1, Math.max(0, x));
    return u * u * (3 - 2 * u);
  };
  const lerp = (a: number[], b: number[], k: number) =>
    a.map((v, i) => v + (b[i] - v) * ease(k)) as [number, number, number];
  // up to the shelf 2-3 s, to the table 3.5-4.5 s, back down 6-7 s
  const hand = (t: number) =>
    t < 3.2
      ? lerp(rest, shelf, t - 2)
      : t < 5.5
        ? lerp(shelf, table, t - 3.5)
        : lerp(table, rest, t - 6);
  const R = reaches(hand, 9, { rest });
  expect(R.length).toBe(2);
  expect(R[0].start).toBeCloseTo(2, 1);
  expect(R[0].arrive).toBeCloseTo(3, 1);
  const K = handEye(R);
  const lookAt = (t: number) => {
    let k = K[0];
    for (const x of K) if (x.t <= t) k = x;
    return k.at;
  };
  expect(lookAt(R[0].start - HANDEYE.lead + 0.01)).toEqual(R[0].at); // there before the hand starts
  expect(lookAt(R[0].start - HANDEYE.lead - HANDEYE.turn - 0.01)).toBe(null);
  // the next reach comes soon: the eyes go on to it just before the first hand lands
  const off = K.find((k, i) => i > 0 && K[i - 1].at === R[0].at && k.at === R[0].at)!;
  expect(off.t).toBeCloseTo(R[0].arrive - HANDEYE.leave, 5);
  // after the last one, a short dwell, then the look is let go; nothing while the hand goes back down
  expect(lookAt(R[1].arrive + HANDEYE.dwell + HANDEYE.turn + 0.01)).toBe(null);
  expect(lookAt(6.5)).toBe(null);
});

test("handeye: a press that only slows at the button is a reach; hands pulled to his own chest are not", () => {
  const rest: [number, number, number] = [-0.4, 0.7, 0.08],
    button: [number, number, number] = [-0.25, 0.93, 0.33],
    chest: [number, number, number] = [-0.41, 0.92, 0.18];
  const bell = (t: number, a: number) =>
    Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - a) / 1.6))));
  const at = (p: number[], k: number) =>
    rest.map((v, i) => v + (p[i] - v) * k) as [number, number, number];
  // out to the button and straight back (it never stops there), then hands to the chest and back
  const hand = (t: number) =>
    t < 4 ? at(button, bell(t, 1) ** 0.5) : at(chest, bell(t, 5) ** 0.5);
  const R = reaches(hand, 8, { rest });
  expect(R.length).toBe(1);
  expect(R[0].arrive).toBeCloseTo(1.8, 0);
  expect(Math.hypot(...R[0].at.map((v, i) => v - button[i]))).toBeLessThan(0.03);
});

test("notice: eyes go to a sudden thing ~0.2 s later, the head after, a short look, then back; less each repeat, nothing going away", () => {
  const at: [number, number, number] = [1, 1, 1];
  const g = notice([
    { t: 5, at },
    { t: 9, at, kind: "receding" },
    { t: 20, at },
    { t: 22, at },
    { t: 24, at },
  ]);
  expect(g(5.1)).toBe(null);
  expect(g.shifts[0]).toBeCloseTo(5 + NOTICE.latency + 0.06, 5);
  expect(g(5.9)!.w).toBe(1);
  expect(g(8)).toBe(null);
  expect(g.events[1].pull).toBe(0);
  expect(g(9.6)).toBe(null);
  // the same spot again: the pull drops each time (the receding one counts as seen too)
  expect(g.events[2].pull).toBeCloseTo(NOTICE.repeat ** 2, 5);
  expect(g.events[4].pull).toBeLessThan(g.events[3].pull);
});
