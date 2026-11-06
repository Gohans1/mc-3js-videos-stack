import { expect, test } from "bun:test";
import { arc } from "../src/arc";
import { attention } from "../src/attention";
import { effort, MOOD, phrase } from "../src/effort";
import { EYE, gaze, lidOpen } from "../src/gaze";
import { lean } from "../src/lean";
import { micro } from "../src/micro";
import { steady } from "../src/steady";

const x0 = (p: Record<string, unknown>, j: string, c = 0) => ((p[j] as number[] | undefined) ?? [0, 0, 0])[c];

test("attention: the trunk joins a big look late and partly, chest before waist; a small look stays in the head", () => {
  // from t 1 he needs his head 60 degrees to his left and 30 down
  const chain = attention((t) => (t < 1 ? null : { down: 30, yaw: 60, w: 1 }), 6);
  expect(x0(chain(0.5), "chest", 1)).toBe(0);
  expect(x0(chain(5), "chest", 1)).toBeCloseTo(0.25 * 50, 1);
  expect(x0(chain(5), "chest", 0)).toBeCloseTo(0.25 * 20, 1);
  expect(x0(chain(5), "body", 1)).toBeCloseTo(0.1 * 50, 1);
  // half way: the chest gets there first
  expect(x0(chain(1.2), "chest", 1) / 12.5).toBeGreaterThan(x0(chain(1.2), "body", 1) / 5);
  for (let t = 1; t < 6; t += 0.02) expect(x0(chain(t), "chest", 1)).toBeLessThanOrEqual(12.5 + 1e-3); // no overshoot
  expect(x0(attention(() => ({ down: 5, yaw: 8, w: 1 }), 3)(2), "chest", 1)).toBe(0);
  expect(x0(attention(() => ({ down: 0, yaw: 170, w: 1 }), 3)(2), "chest", 1)).toBeCloseTo(30, 3);
});

test("steady: the head counters a fast bend, keeps a held one; a held sideways tilt is half undone", () => {
  const bend = (t: number) => 20 * Math.min(1, Math.max(0, (t - 1) / 0.2));
  const head = steady((t) => ({ chest: [bend(t), 0, 0] }), 5);
  expect(x0(head(1.15), "head", 0)).toBeLessThan(-3);
  expect(Math.abs(x0(head(4), "head", 0))).toBeLessThan(0.1);
  const lean = steady((t) => ({ body: [0, 0, t > 1 ? 10 : 0] }), 5);
  expect(x0(lean(4), "head", 2)).toBeCloseTo(-5, 1);
  expect(x0(lean(1.05), "head", 2)).toBeLessThan(-5); // the fast part on top while it tips
});

test("lean: forward speeding up, back braking, into a turn, nothing at a steady straight walk", () => {
  // along +z: speeds up over 1-2 s to 1.4 m/s, walks, brakes over 5-5.6 s
  const v = (t: number) => (t < 1 ? 0 : t < 2 ? 1.4 * (t - 1) : t < 5 ? 1.4 : t < 5.6 ? 1.4 * (1 - (t - 5) / 0.6) : 0);
  const z = (t: number) => { let s = 0; for (let u = 0; u < t; u += 0.001) s += v(u) * 0.001; return s; };
  const zs = Array.from({ length: 501 }, (_, i) => z(i / 60));
  const walk = lean((t) => ({ x: 0, z: zs[Math.min(500, Math.round(t * 60))], yaw: 0 }), 8);
  expect(walk.forward(1.8)).toBeGreaterThan(2);
  expect(walk.forward(5.5)).toBeLessThan(-4);
  expect(Math.abs(walk.forward(4))).toBeLessThan(0.2);
  expect(x0(walk(1.8), "body", 0)).toBeGreaterThan(x0(walk(1.8), "chest", 0));
  // a circle to his left at 1.5 m/s, radius 1 m: v^2/r = 2.25 m/s^2, half of atan(a/g) is 6.5 degrees
  const circle = lean((t) => ({ x: 1 - Math.cos(1.5 * t), z: Math.sin(1.5 * t), yaw: (1.5 * t * 180) / Math.PI }), 6);
  expect(circle.left(4)).toBeCloseTo((0.5 * Math.atan2(2.25, 9.81) * 180) / Math.PI, 1);
  expect(x0(circle(4), "body", 2)).toBeLessThan(0); // the top tips to his left
});

test("lids: they follow the eyes' pitch slower than the eyes, down a touch past, up without overshoot", () => {
  const down = gaze([5], 10), at = (f: number) => [0, f >= 4.9 ? -EYE.pitch : 0] as [number, number];
  const s = 4.94;
  expect(down(s + 0.06, at).look[1]).toBeCloseTo(-1, 9);
  expect(down(s + 0.06, at).lid).toBeGreaterThan(-0.8); // the eye is there, the lid not yet
  let low = 0;
  for (let u = 0; u < 0.6; u += 0.005) low = Math.min(low, down(s + u, at).lid);
  expect(low).toBeLessThan(-1);
  expect(low).toBeGreaterThan(-1.05);
  expect(down(s + 0.61, at).lid).toBeCloseTo(-1, 9);
  const up = gaze([5], 10), from = (f: number) => [0, f >= 4.9 ? 0 : -EYE.pitch] as [number, number];
  for (let u = 0; u < 0.7; u += 0.005) expect(up(s + u, from).lid).toBeLessThanOrEqual(1e-9);
  expect(up(s + 0.3, from).lid).toBeLessThan(-0.05);
  expect(lidOpen(-1)).toBeLessThan(-0.3);
  expect(lidOpen(1)).toBeGreaterThan(0);
});

test("micro: small, smooth, never the same twice; off at amount 0", () => {
  const drift = micro();
  let big = 0, step = 0, prev = x0(drift(0), "head");
  for (let t = 0; t < 120; t += 1 / 30) { const h = x0(drift(t), "head"); big = Math.max(big, Math.abs(h)); step = Math.max(step, Math.abs(h - prev)); prev = h; }
  expect(big).toBeLessThan(1);
  expect(big).toBeGreaterThan(0.2);
  expect(step).toBeLessThan(0.05); // degrees a frame
  expect(x0(drift(10), "head")).not.toBeCloseTo(x0(drift(10 + 2.5), "head"), 3);
  expect(x0(drift(10), "head", 0)).not.toBeCloseTo(x0(drift(10), "head", 1), 3);
  expect(Math.abs(x0(micro({ amount: 0 })(3), "head"))).toBe(0);
});

test("arc: same ends, the hand swings round the pivot instead of cutting across", () => {
  const P = [0, 1.4, 0], down = [0, 0.75, 0.05], front = [0, 1.45, 0.65];
  arc(P, down, front, 0).forEach((v, i) => expect(v).toBeCloseTo(down[i], 9));
  arc(P, down, front, 1).forEach((v, i) => expect(v).toBeCloseTo(front[i], 9));
  const mid = arc(P, down, front, 0.5), r = (p: number[]) => Math.hypot(p[0] - P[0], p[1] - P[1], p[2] - P[2]);
  expect(r(mid)).toBeCloseTo((r(down) + r(front)) / 2, 9);
  const line = down.map((v, i) => (v + front[i]) / 2);
  expect(r(mid) - r(line)).toBeGreaterThan(0.1); // the straight line passes 10 cm+ nearer the shoulder
  const opposite = arc(P, [0, 0.8, 0], [0, 2, 0], 0.5);
  expect(opposite[2]).toBeGreaterThan(0.5); // swings through the front, not through the head
  expect(arc(P, [0, 1, 0], [0, 0.8, 0], 0.5)[1]).toBeCloseTo(0.9, 9);
});

test("effort: neutral is every layer's default; tense holds then snaps, tired sinks and wanders", () => {
  const n = effort();
  expect(n.hold).toBe(0);
  expect(n.overlap).toEqual({ damping: 0.6, amount: 1 });
  expect(n.cartoon.amount).toBeCloseTo(0.25, 12);
  expect(n.gaze).toEqual({ mean: 0.75, wander: 1 });
  expect(n.micro.amount).toBe(1);
  const tense = effort(MOOD.tense), tired = effort(MOOD.tired);
  expect(tense.hold).toBeGreaterThan(0.25);
  expect(tense.overlap.damping).toBeGreaterThan(0.75);
  expect(tired.gaze.wander).toBeGreaterThan(1.2);
  expect((tired.posture.chest as number[])[0]).toBeGreaterThan(4);
  const keys = phrase([{ t: 0, p: "a" }, { t: 1, p: "b" }, { t: 2, p: "c" }], 0.4);
  expect(keys.map((k) => [k.t, k.p])).toEqual([[0, "a"], [0.4, "a"], [1, "b"], [1.4, "b"], [2, "c"]]);
  expect(phrase([{ t: 0 }, { t: 1 }], 0)).toEqual([{ t: 0 }, { t: 1 }]);
  expect(phrase([{ t: 0 }, { t: 1, clip: "a" }, { t: 2 }], 0.4).length).toBe(3);
});

test("mocap-safe: layers follow an angle through the 180 wrap; mask fades a layer out over a clip and back", async () => {
  const { overlap } = await import("../src/overlap");
  const { mask, scalePose, unwrap } = await import("../src/pose");
  // a mocap chest yaw turning steadily through 180 (read from quaternions: 170, 179, -172, ...)
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const lag = overlap((t) => ({ chest: [0, wrap(150 + 40 * t), 0] }), 3);
  for (let t = 0.5; t < 2.5; t += 0.01) expect(Math.abs(x0(lag(t), "chest", 1))).toBeLessThan(5);
  expect(unwrap(-179, 179)).toBe(181);
  const w = mask([[3, 6]], 0.3);
  expect(w(2)).toBe(1);
  expect(w(2.85)).toBeGreaterThan(0);
  expect(w(2.85)).toBeLessThan(1);
  expect(w(3)).toBe(0);
  expect(w(6.2)).toBeLessThan(1);
  expect(w(6.3)).toBe(1);
  expect(scalePose({ chest: [2, 4, 6], root: { y: 1 } }, 0.5)).toEqual({ chest: [1, 2, 3], root: { y: 0.5 } });
});

test("canonical: an arm raised past horizontal keeps one spelling, so layers see no 180-degree leap", async () => {
  const { canonical } = await import("../src/pose");
  const { overlap } = await import("../src/overlap");
  // a forearm read from quaternions: x stays within +-90, y and z flip by 180 as it passes -90
  const read = (t: number) => { const x = -80 - 20 * t; return x < -90 ? [-180 - x, 180, 180] : [x, 0, 0]; };
  expect(canonical({ laR: read(0.4) }).laR).toEqual([-88, 0, 0]);
  expect((canonical({ laR: read(0.6) }).laR as number[])[0]).toBeCloseTo(-92, 9);
  expect(canonical({ root: { y: 1, rx: 10, ry: 170, rz: 0 } }).root).toEqual({ y: 1, rx: 170, ry: -10, rz: -180 });
  const lag = overlap((t) => ({ laR: read(t) }), 2);
  for (let t = 0.1; t < 1.9; t += 0.01) for (const c of [1, 2]) expect(Math.abs((lag(t).laR as number[])[c])).toBeLessThan(1);
});

test("idle effort: a steady walk's arm swing breathes a little faster and holds; it never piles up to panting", async () => {
  const { idle } = await import("../src/idle");
  // a walk's upper body: arms swing 24 degrees each way and the chest twists 8, 1.3 strides a second, for 30 s
  const w = (t: number) => 2 * Math.PI * 1.3 * t;
  const life = idle((t) => ({ uaL: [24 * Math.sin(w(t)), 0, 0], uaR: [-24 * Math.sin(w(t)), 0, 0], chest: [0, 8 * Math.sin(w(t)), 0] }), 32, { sway: 0, settle: 0 });
  expect(life.effort(30)).toBeGreaterThan(0.15);
  expect(life.effort(30)).toBeLessThan(0.5);
  expect(Math.abs(life.effort(30) - life.effort(15))).toBeLessThan(0.05); // holds
  expect(idle((t) => ({ uaL: [24 * Math.sin(w(t)), 0, 0], uaR: [-24 * Math.sin(w(t)), 0, 0] }), 12).stops.length).toBe(0); // swings turning back are not stops
});
