import assert from "node:assert/strict";
import { test } from "node:test";

import { measure, report, turnReport, turns } from "../checks/motion.mjs";
import { compileTiming } from "../src/timing.mjs";

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
  assert.ok(Math.abs(m.peak.v - 3) < 0.05);
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
  assert.ok(Math.abs(m.peak.v - 75) < 1, `peak ${m.peak.v}`);
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

test("explicit impulse windows exempt deliberate trauma shakes while still catching pops outside them", () => {
  const shakeCam = [];
  for (let t = 0; t <= 1.5 + 1e-9; t += DT) {
    const inHit = t >= 0.4 && t <= 0.6;
    const x = t * 0.2 + (inHit ? Math.sin(t * 90) * 0.15 : 0) + (t > 1.2 ? 0.25 : 0);
    const yaw = t * 8 + (inHit ? Math.cos(t * 80) * 6 : 0);
    const h = (yaw * Math.PI) / 360;
    shakeCam.push({
      t,
      p: [x, 1, 0],
      q: [0, Math.sin(h), 0, Math.cos(h)],
      fov: 60,
      aspect: 16 / 9,
    });
  }
  const impulses = [{ from: 0.4, to: 0.6, kind: "hit" }];
  const m = measure(shakeCam, [], impulses);
  const tm = turns(shakeCam, [], impulses);
  assert.equal(m.pops.length, 1);
  assert.ok(Math.abs(m.pops[0].t - 1.2) < 0.03, `expected pop near 1.2, got ${m.pops[0].t}`);
  assert.equal(tm.pops.length, 0);
  assert.ok(
    tm.widthSeconds > 7,
    `expected panning outside hit within 7s rule, got ${tm.widthSeconds}`,
  );
  const lines = [...report("cam", shakeCam, m, tm.pops.length), ...turnReport(tm)].join("\n");
  assert.match(lines, /impulse.*0\.40-0\.60.*hit.*left out/);

  const parkedBeforeHit = [];
  for (let t = 0; t <= 1.0 + 1e-9; t += DT) {
    const inHit = t >= 0.4 && t <= 0.6;
    parkedBeforeHit.push({
      t,
      p: [inHit ? 0.5 : 0, 1, 0],
      q: [0, 0, 0, 1],
      fov: 60,
      aspect: 16 / 9,
    });
  }
  const mParked = measure(parkedBeforeHit, [], [{ from: 0.4, to: 0.6, kind: "hit" }]);
  assert.equal(mParked.peak.v, 0);
  const preIdx = parkedBeforeHit.findIndex((s) => Math.abs(s.t - 0.36) < 0.02);
  assert.equal(mParked.speed[preIdx], 0);
});

test("FOV snaps and p->l vector turns are detected and attributed without printing 'no pops'", () => {
  const fovSnap = turns(
    pan(
      0,
      1,
      () => 0,
      (t) => (t > 0.5 ? 28 : 60),
    ),
  );
  assert.equal(fovSnap.fovPops.length, 1);
  assert.equal(fovSnap.fastFov, true);
  assert.match(turnReport(fovSnap).join("\n"), /field of view jumps 32\.\d° in one sample/);

  const camKeys = [
    { t: 0, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
    { t: 0.5, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
    { t: 1, p: [0, 1, 0], l: [4, 1, -3], fov: 28 },
  ];
  const lookSamples = [];
  for (let t = 0; t <= 1 + 1e-9; t += DT) {
    const u = Math.max(0, (t - 0.5) / 0.5);
    lookSamples.push({
      t,
      p: [0, 1, 0],
      l: [4 * u, 1, -5 + 2 * u],
      fov: 60 - 32 * u,
      aspect: 16 / 9,
    });
  }
  const tm = turns(lookSamples);
  assert.equal(tm.fastPan, true);
  assert.equal(tm.fastFov, true);
  const m = measure(lookSamples);
  const faults = tm.pops.length + tm.fovPops.length + (tm.fastPan ? 1 : 0) + (tm.fastFov ? 1 : 0);
  const lines = [
    ...report("cam", lookSamples, m, faults, { worldPos: true, camKeys }),
    ...turnReport(tm, { worldPos: true, camKeys, samples: lookSamples }),
  ].join("\n");
  assert.ok(!lines.includes("  no pops, no dead stops"), lines);
  assert.match(lines, /at \[0\.00, 1\.00, 0\.00\]/);
  assert.match(lines, /cam keys \[1->2\] row /);

  const clock = compileTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 4);
  const camTimed = [
    { t: 0, p: [1, 2, 3], l: [1, 2, -2], fov: 60 },
    { t: 2, p: [1, 2, 3], l: [1, 2, -2], fov: 60 },
    { t: 4, p: [1, 2, 3], l: [6, 2, -2], fov: 30 },
  ];
  const timedSamples = [];
  for (let t = 0; t <= 2 + 1e-9; t += DT) {
    const src = clock.sourceAt(t);
    const u = Math.max(0, (src - 2) / 2);
    timedSamples.push({
      t,
      p: [1, 2, 3],
      l: [1 + 5 * u, 2, -2],
      fov: 60 - 30 * u,
      aspect: 16 / 9,
    });
  }
  const timedTurns = turns(timedSamples);
  const timedLines = turnReport(timedTurns, {
    worldPos: true,
    samples: timedSamples,
    camKeys: camTimed,
    timing: clock,
  }).join("\n");
  assert.match(
    timedLines,
    /turns \d+°\/s at .* \(at \[1\.00, 2\.00, 3\.00\], cam keys \[1->2\] row \d\)/,
  );
  assert.match(
    timedLines,
    /field of view 60° to 30°.* \(at \[1\.00, 2\.00, 3\.00\], cam keys \[1->2\] row \d\)/,
  );
});
