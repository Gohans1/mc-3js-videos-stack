import { expect, test } from "bun:test";
import { balance } from "../src/balance";
import { EYE, gaze } from "../src/gaze";
import { idle } from "../src/idle";
import { JOLT, startle } from "../src/startle";
import { steer } from "../src/steer";

const j = (p: Record<string, unknown>, k: string, c = 0) => ((p[k] as number[] | undefined) ?? [0, 0, 0])[c];

test("startle: blink, then head, arms, trunk, knees in that order; strength scales it; repeats fade the body, never the blink", () => {
  const jolt = startle([{ t: 1, k: 1 }, { t: 10, k: 1 }, { t: 20, k: 0.4 }]);
  const first = (f: (t: number) => number) => { for (let t = 1; t < 2; t += 0.001) if (f(t) > 0.05) return t; return 9; };
  const blink = first((t) => jolt(t).blink), head = first((t) => j(jolt(t).pose, "head") / JOLT.head[0]);
  const arms = first((t) => j(jolt(t).pose, "laR") / JOLT.laR[0]), trunk = first((t) => j(jolt(t).pose, "chest") / JOLT.chest[0]);
  const knees = first((t) => -(jolt(t).pose.root!.y ?? 0) / JOLT.sink);
  expect(blink).toBeLessThan(head);
  expect(head).toBeLessThan(arms);
  expect(arms).toBeLessThan(trunk);
  expect(trunk).toBeLessThan(knees);
  expect(blink - 1).toBeLessThan(0.05);
  const peak = (t0: number, k: string) => { let m = 0; for (let t = t0; t < t0 + 1; t += 0.002) m = Math.max(m, j(jolt(t).pose, k)); return m; };
  expect(peak(1, "head")).toBeCloseTo(JOLT.head[0], 0);
  // the repeat 9 s later: the body half as much, the head most of it, the blink all of it
  expect(peak(10, "chest") / peak(1, "chest")).toBeCloseTo(0.55, 1);
  expect(peak(10, "head") / peak(1, "head")).toBeGreaterThan(0.75);
  let b = 0;
  for (let t = 10; t < 10.5; t += 0.005) b = Math.max(b, jolt(t).blink);
  expect(b).toBe(1);
  expect(Math.abs(j(jolt(2.6).pose, "head"))).toBeLessThan(0.02 * JOLT.head[0]); // all but over 1.5 s after it starts
});

test("idle gasps: a sharp breath in, held flat, a long relief exhale below rest, then breathing again from empty", () => {
  const life = idle(() => ({}), 30, { sway: 0, settle: 0, gasps: [{ t: 10, k: 1 }] });
  let peak = 0;
  for (let t = 10; t < 10.4; t += 1 / 60) peak = Math.max(peak, life.lungs(t));
  expect(peak).toBeGreaterThan(1.5);
  expect(life.gasp(10.2)).toBe("in");
  expect(life.gasp(11.5)).toBe("held");
  // held: the chest barely moves for over two seconds
  expect(Math.abs(life.lungs(12.5) - life.lungs(10.5))).toBeLessThan(0.08);
  expect(life.gasp(13.5)).toBe("relief");
  let low = 9;
  for (let t = 13; t < 16; t += 1 / 60) low = Math.min(low, life.lungs(t));
  expect(low).toBeLessThan(-0.25);
  // back to breathing, a little faster than before the fright
  expect(life.gasp(16.5)).toBe(null);
  expect(life.effort(16.5)).toBeGreaterThan(0.25);
  expect(life.effort(9)).toBeLessThan(0.02);
});

test("gaze pursuit: eyes stay put ~0.15 s, jump on, then glide after the target a little behind, with small catch-ups", () => {
  // target sweeps 20 deg/s to his left from 1 to 3 s, from 0; held at 40 after
  const yawAt = (x: number) => (x < 1 ? 0 : x < 3 ? 20 * (x - 1) : 40);
  const eyes = gaze([], 6, { pursuit: [[1, 3]] });
  const aim = (f: number, off: [number, number], mode?: string): [number, number] => (mode === "pursue" ? [yawAt(f), 0] : [yawAt(f + 0.06) + off[0] / 3, off[1] / 3]);
  const yaw = (t: number) => eyes(t, aim).look[0] * EYE.yaw;
  expect(eyes(2, aim).pursuing).toBe(true);
  expect(Math.abs(yaw(1.1) - yaw(1.0))).toBeLessThan(1);
  let worst = 0, behind = 0, n = 0;
  for (let t = 1.4; t < 2.9; t += 1 / 30) { worst = Math.max(worst, Math.abs(yaw(t + 1 / 30) - yaw(t) - 20 / 30)); behind += yawAt(t) - yaw(t); n++; }
  expect(worst).toBeLessThan(1.5); // every frame moves about as much as the target: a glide, catch-ups under a degree or two
  expect(behind / n).toBeGreaterThan(1); // a little behind it
  expect(behind / n).toBeLessThan(6);
});

test("gaze think: the eyes look away, mostly up or down, while thinking", () => {
  const eyes = gaze([], 60, { think: (t) => (t > 5 && t < 55 ? 1 : 0) });
  const modes = new Map<number, [number, number]>();
  const aim = (f: number, off: [number, number], mode?: string): [number, number] => { if (mode === "avert") modes.set(f, off); return [off[0], off[1]]; };
  for (let t = 5.5; t < 55; t += 0.05) eyes(t, aim);
  const all = [...modes.values()], away = all.filter(([a, b]) => a !== 0 || b !== 0);
  expect(all.length).toBeGreaterThan(30);
  expect(away.length / all.length).toBeGreaterThan(0.65);
  expect(away.filter(([, b]) => b > 8).length / away.length).toBeGreaterThan(0.25);
  expect(eyes(30, aim).thinking).toBe(true);
});

test("steer: looks ahead on the path, ~20 deg down, into a bend before the body turns; nothing standing", () => {
  // walks +x at 1.3 m/s; from t 3 the path bends to +z
  const path = (t: number) => (t < 3 ? { x: 1.3 * t, z: 0, speed: 1.3 } : { x: 3.9 + 1.3 * Math.sin(t - 3), z: 1.3 * (1 - Math.cos(t - 3)), speed: 1.3 });
  const look = steer(path);
  const a = look(1)!;
  expect(a.at[2]).toBeCloseTo(0, 5);
  expect(a.at[0] - 1.3).toBeCloseTo(1.95, 2);
  expect((Math.atan2(1.5 - a.at[1], 1.95) * 180) / Math.PI).toBeCloseTo(20, 0);
  expect((Math.atan2(1.5 - a.head[1], 1.95) * 180) / Math.PI).toBeCloseTo(5, 0); // the eyes drop, the head stays near level
  // 0.3 s before the bend the look already points into it while he still walks straight
  expect(look(2.7)!.at[2]).toBeGreaterThan(0.1);
  expect(steer(() => ({ x: 0, z: 0, speed: 0 }))(1)).toBe(null);
});

test("balance: hips go the other way from the mass, scaled by what they carry, a beat late, only standing", () => {
  const bal = balance((t) => (t < 1 ? [0, 0] : [0, 0.05]), 4);
  expect(bal(0.5).root!.z).toBeCloseTo(0, 5);
  expect(bal(1.05).root!.z).toBeGreaterThan(-0.03); // not there yet
  expect(bal(3).root!.z).toBeCloseTo(-0.05 / 0.678, 3);
  expect(balance(() => [0.5, 0], 2)(1.5).root!.x).toBeCloseTo(-0.12, 3); // clamped
  expect(balance(() => [0, 0.05], 2, { standing: () => 0 })(1.5).root!.z).toBeCloseTo(0, 5);
});
