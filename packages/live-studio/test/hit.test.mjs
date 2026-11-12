// The moments Sound at the cut lines up with the cut (app/sound/hit.ts): a riser's end, a whoosh's loudest point, an impact's and a downlifter's start
import assert from "node:assert/strict";
import { test } from "node:test";

import { hitOf } from "../app/sound/hit.ts";

const RATE = 48000;
// Noise whose level (0..1) follows shape(t) over secs
const shaped = (secs, shape) =>
  Float32Array.from(
    { length: Math.round(secs * RATE) },
    (_, i) => shape(i / RATE) * ((Math.sin(i * 12.9898) * 43758.5453) % 1),
  );
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("a riser's moment is where its build stops, not where its tail ends", () => {
  const x = shaped(3, (t) => (t < 2 ? (t / 2) ** 2 : t < 2.05 ? 0.002 : 0));
  near(hitOf("riser", [x], RATE).at, 2.0);
});

test("a whoosh's moment is its loudest point", () => {
  const x = shaped(1, (t) => Math.exp(-(((t - 0.3) / 0.08) ** 2)));
  near(hitOf("whoosh", [x], RATE).at, 0.3, 0.02); // within a frame
});

test("an impact's and a downlifter's moment is their start, past any lead-in far under them", () => {
  const x = shaped(2, (t) => (t < 0.2 ? 0.01 : Math.exp(-(t - 0.2) * 2)));
  near(hitOf("impact", [x], RATE).at, 0.2);
  near(hitOf("downlifter", [x, x], RATE).at, 0.2);
  assert.ok(hitOf("impact", [x], RATE).loudest > -12);
});
