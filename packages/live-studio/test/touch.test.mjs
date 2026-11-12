import assert from "node:assert/strict";
import { test } from "node:test";

import { summarize } from "../checks/touch.mjs";

const DT = 1 / 30;
const frames = (n, at) =>
  Array.from({ length: n }, (_, i) => ({
    t: i * DT,
    d: Infinity,
    part: "laR",
    surface: "desk",
    speed: 0,
    p: [0, 0, 0],
    ...at(i * DT),
  }));

test("one frame deep inside a surface is a sink, the deepest frame shown", () => {
  const s = summarize(
    "Steve",
    frames(30, (t) => (Math.abs(t - 0.5) < 0.02 ? { d: -0.08 } : { d: 0.2 })),
  );
  assert.deepEqual(
    s.worst.map((w) => w.kind),
    ["SINK"],
  );
  assert.match(s.lines.join("\n"), /laR 8\.0 cm inside desk/);
});

test("a touch sinking 2 cm (mc-actor's own) or a 4 cm clip is a touch, not a fault", () => {
  const s = summarize(
    "Steve",
    frames(30, () => ({ d: -0.04 })),
  );
  assert.equal(s.worst.length, 0);
  assert.match(s.lines.join("\n"), /touch 0\.00-0\.97: laR on desk/);
});

test("a still hand held 3 cm off the desk for half a second hovers; a moving one passes", () => {
  assert.deepEqual(
    summarize(
      "Steve",
      frames(30, (t) => (t < 0.5 ? { d: 0.03 } : {})),
    ).worst.map((w) => w.kind),
    ["HOVER"],
  );
  assert.equal(
    summarize(
      "Steve",
      frames(30, (t) => (t < 0.5 ? { d: 0.03, speed: 1 } : {})),
    ).worst.length,
    0,
  );
});

test("a sink the film camera does not show says so", () => {
  const s = summarize(
    "Steve",
    frames(30, (t) => (Math.abs(t - 0.5) < 0.02 ? { d: -0.08, inFrame: false } : { d: 0.2 })),
  );
  assert.match(s.lines.join(" "), /1 more off screen/);
});
