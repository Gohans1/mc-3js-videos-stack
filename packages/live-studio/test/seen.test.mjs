import assert from "node:assert/strict";
import { test } from "node:test";

import { BLUR, stretches, summarize } from "../checks/seen.mjs";

const DT = 1 / 30;
const frames = (n, at) =>
  Array.from({ length: n }, (_, i) => ({
    t: i * DT,
    share: 0.1,
    hidden: 0,
    cut: 0,
    luma: 0.3,
    frameLuma: 0.25,
    alone: 1,
    by: {},
    ...at(i * DT),
  }));

test("a fault shorter than 0.2 s goes by, a longer one is a stretch", () => {
  assert.equal(
    stretches(
      frames(30, (t) => (t > 0.4 && t < 0.5 ? { hidden: 0.9 } : {})),
      (x) => x.hidden > 0.5,
    ).length,
    0,
  );
  const runs = stretches(
    frames(30, (t) => (t > 0.3 && t < 0.7 ? { hidden: 0.9 } : {})),
    (x) => x.hidden > 0.5,
  );
  assert.equal(runs.length, 1);
});

test("hidden behind a prop names it, with its worst frame", () => {
  const s = summarize(
    "Steve",
    frames(60, (t) =>
      t >= 1 && t < 1.5 ? { hidden: t < 1.2 ? 0.6 : 0.8, by: { desk: t < 1.2 ? 0.6 : 0.8 } } : {},
    ),
  );
  const line = s.lines.find((l) => l.includes("HIDDEN"));
  assert.match(line, /80% hidden, behind desk 80%/);
  assert.deepEqual(
    s.worst.map((w) => w.kind),
    ["HIDDEN"],
  );
});

test("off screen, cut off and dark are told apart", () => {
  const s = summarize(
    "Steve",
    frames(90, (t) => (t < 0.5 ? { share: 0, alone: 0 } : t < 1.5 ? { cut: 0.4 } : { luma: 0.02 })),
  );
  assert.deepEqual(
    s.worst.map((w) => w.kind),
    ["GONE", "CUT", "DARK"],
  );
  assert.match(s.lines.join("\n"), /not in the frame/);
});

test("nothing wrong says so", () => {
  assert.match(
    summarize(
      "Steve",
      frames(30, () => ({})),
    ).lines[1],
    /always in view.*out of focus/,
  );
});

test("an out-of-focus stretch (> BLUR px) flags BLURRED while sharp or brief racks stay clean", () => {
  const blurred = summarize(
    "Steve",
    frames(60, (t) =>
      t >= 0.5 && t <= 0.9 ? { blurPx: BLUR + 1.8, focusM: 2.0, targetM: 6.5 } : { blurPx: 0.4 },
    ),
  );
  assert.deepEqual(
    blurred.worst.map((w) => w.kind),
    ["BLURRED"],
  );
  assert.match(blurred.lines.join("\n"), /BLURRED.*out of focus.*3\.8 px.*6\.5 m vs focus 2\.0 m/);

  const briefRack = summarize(
    "Steve",
    frames(60, (t) => (t >= 0.5 && t <= 0.6 ? { blurPx: BLUR + 2, focusM: 2, targetM: 5 } : {})),
  );
  assert.equal(briefRack.worst.length, 0);
});
