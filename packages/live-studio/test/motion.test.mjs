import assert from "node:assert/strict";
import { test } from "node:test";
import { measure, report } from "../checks/motion.mjs";

const DT = 1 / 60;
const track = (from, to, x) => { const out = []; for (let t = from; t <= to + 1e-9; t += DT) out.push({ t, p: [x(t), 1, 0] }); return out; };
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

test("a smoothstep move peaks in its middle and has no faults", () => {
  const m = measure(track(0, 2, (t) => smooth((t - 0.5) / 1) * 2));
  assert.equal(m.moves.length, 1);
  assert.ok(Math.abs(m.moves[0].peakAt - 0.5) < 0.06);
  assert.ok(Math.abs(m.peak.v - 3) < 0.05); // smoothstep peaks at 1.5x the mean speed, 2 m in 1 s
  assert.deepEqual([m.pops.length, m.stops.length], [0, 0]);
});

test("a fling that whips out and settles slowly peaks early", () => {
  const m = measure(track(0, 2, (t) => (t < 0.5 ? 0 : t > 1.5 ? 1 : 1 - (1 - (t - 0.5)) ** 3)));
  assert.ok(m.moves[0].peakAt < 0.35, `peak at ${m.moves[0].peakAt}`);
  assert.match(report("handR", track(0, 2, () => 0), m).join("\n"), /fast start, slow finish/);
});

test("a one-sample jump is a pop", () => {
  const m = measure(track(0, 1, (t) => t * 0.3 + (t > 0.5 ? 0.2 : 0)));
  assert.equal(m.pops.length, 1);
  assert.ok(Math.abs(m.pops[0].t - 0.5) < 0.02);
});

test("stopping from full speed in one sample is a dead stop, easing to rest is not", () => {
  assert.equal(measure(track(0, 1, (t) => Math.min(t, 0.5) * 2)).stops.filter((s) => s.kind === "stop").length, 1);
  assert.equal(measure(track(0, 1.5, (t) => smooth(t))).stops.length, 0);
});

test("standing still reports no move", () => {
  const m = measure(track(0, 1, () => 3));
  assert.deepEqual([m.moves.length, m.peak.v], [0, 0]);
});

test("a cut is the picture changing, not a pop", () => {
  const track2 = track(0, 1, (t) => t * 0.3 + (t > 0.5 ? 2 : 0));
  const m = measure(track2, [0.5]);
  assert.deepEqual([m.pops.length, m.stops.length, m.cuts.length], [0, 0, 1]);
  assert.ok(Math.max(...m.speed) < 0.31);
});
