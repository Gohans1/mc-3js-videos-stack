import assert from "node:assert/strict";
import { test } from "node:test";

import { measure, report, turnReport, turns } from "../checks/motion.mjs";

const DT = 1 / 60;
const track = (from, to, x) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += DT) out.push({ t, p: [x(t), 1, 0] });
  return out;
};
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
  assert.match(
    report(
      "handR",
      track(0, 2, () => 0),
      m,
    ).join("\n"),
    /fast start, slow finish/,
  );
});

test("a one-sample jump is a pop", () => {
  const m = measure(track(0, 1, (t) => t * 0.3 + (t > 0.5 ? 0.2 : 0)));
  assert.equal(m.pops.length, 1);
  assert.ok(Math.abs(m.pops[0].t - 0.5) < 0.02);
});

test("stopping from full speed in one sample is a dead stop, easing to rest is not", () => {
  assert.equal(
    measure(track(0, 1, (t) => Math.min(t, 0.5) * 2)).stops.filter((s) => s.kind === "stop").length,
    1,
  );
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

// a camera turning about the vertical axis: yaw(t) in degrees, a 60° tall view at 16:9 (about 91° wide)
const pan = (from, to, yaw, fov = () => 60) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += DT) {
    const h = (yaw(t) * Math.PI) / 360;
    out.push({ t, p: [0, 1, 0], q: [0, Math.sin(h), 0, Math.cos(h)], fov: fov(t), aspect: 16 / 9 });
  }
  return out;
};

test("a camera that only turns is measured in degrees a second and frame widths, not reported as still", () => {
  const m = turns(pan(0, 2, (t) => smooth((t - 0.5) / 1) * 50));
  assert.ok(Math.abs(m.peak.v - 75) < 1, `peak ${m.peak.v}`); // 50° in 1 s, smoothstep peaks at 1.5x
  const out = turnReport(m).join("\n");
  assert.match(out, /turns 75°\/s at 1\.00 s/);
  assert.match(out, /a frame width in 1\.2 s: faster than the 7-second rule/);
});

test("a slow pan keeps to the 7-second rule and says so", () => {
  const out = turnReport(turns(pan(0, 4, (t) => t * 10))).join("\n");
  assert.match(out, /a frame width in 9\.1 s, within the 7-second rule/);
});

test("a one-sample turn is a pop, and a zoom gives its field of view and how fast it changes", () => {
  const snap = turns(pan(0, 1, (t) => t * 5 + (t > 0.5 ? 8 : 0)));
  assert.equal(snap.pops.length, 1);
  assert.match(turnReport(snap).join("\n"), /POP 0\.5\d: turns 8\.\d° in one sample/);
  const zoom = turnReport(
    turns(
      pan(
        0,
        2,
        () => 0,
        (t) => 60 - smooth(t / 2) * 30,
      ),
    ),
  ).join("\n");
  assert.match(zoom, /field of view 60° to 30°, changing 22\.\d°\/s at its fastest \(1\.00 s\)/);
});

test("a camera whose turn pops is never also said to have no pops, and its other lines are kept", () => {
  const still = track(0, 1, (t) => t * 0.3);
  const out = report("cam", still, measure(still, [0.5]), 1);
  assert.ok(!out.includes("  no pops, no dead stops"), out.join("\n"));
  assert.match(out.at(-1), /cuts at 0\.5\d \(left out\)/);
});
