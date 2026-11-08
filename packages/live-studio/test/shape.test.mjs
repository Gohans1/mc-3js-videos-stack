// What a stroke drawn with the right mouse button becomes (app/notes/shape.ts): a straight one an arrow, a closed four-cornered
// one a box, anything else stays the pen stroke it was drawn as
import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeOf } from "../app/notes/shape.ts";

// A hand's stroke along the corners given, one point every 4 px, with a seeded wobble of up to `shake` px
const stroke = (corners, shake = 0, seed = 1) => {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * shake;
  const pts = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[i + 1], n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n + rand(), y0 + ((y1 - y0) * k) / n + rand()]);
  }
  pts.push(corners.at(-1));
  return pts;
};
const ring = (cx, cy, r, turns = 1, from = 0) => Array.from({ length: 90 }, (_, i) => { const a = from + (i / 89) * turns * 2 * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

test("a straight stroke, steady or shaky, is an arrow", () => {
  assert.equal(shapeOf(stroke([[0, 0], [300, 120]])), "arrow");
  assert.equal(shapeOf(stroke([[40, 200], [60, 20]], 5)), "arrow", "a shaky hand");
  assert.equal(shapeOf(stroke([[0, 0], [200, 0], [205, 4]], 2)), "arrow", "a little hook at the end where the mouse was let go");
});

test("a stroke that bends, turns back or scribbles stays a pen stroke", () => {
  assert.equal(shapeOf(stroke([[0, 0], [0, 150], [150, 150]], 2)), "pen", "an L");
  assert.equal(shapeOf(stroke([[0, 0], [300, 0], [150, 0]], 2)), "pen", "there and half way back along one line");
  assert.equal(shapeOf(stroke([[0, 0], [40, 80], [80, 0], [120, 80], [160, 0], [200, 80]], 3)), "pen", "a zigzag scribble");
  assert.equal(shapeOf(ring(100, 100, 80, 0.5)), "pen", "an arc");
  assert.equal(shapeOf(stroke([[0, 0], [0, 120], [160, 120], [160, 0]], 2)), "pen", "a box left open on one side");
});

test("a closed stroke with four corners is a box, wherever it starts", () => {
  assert.equal(shapeOf(stroke([[0, 0], [240, 0], [240, 150], [0, 150], [4, 6]], 3)), "box", "from a corner");
  assert.equal(shapeOf(stroke([[120, 0], [240, 0], [240, 150], [0, 150], [0, 0], [110, 4]], 3)), "box", "from the middle of an edge");
  assert.equal(shapeOf(stroke([[0, 0], [0, 150], [240, 150], [240, 0], [12, 10]], 3)), "box", "the other way round, not quite closed");
});

test("other closed shapes stay pen strokes: a circle, a diamond, a triangle", () => {
  assert.equal(shapeOf(ring(100, 100, 80, 1.02)), "pen", "a circle");
  assert.equal(shapeOf(stroke([[100, 0], [200, 100], [100, 200], [0, 100], [100, 4]], 2)), "pen", "a diamond");
  assert.equal(shapeOf(stroke([[0, 150], [90, 0], [180, 150], [4, 148]], 2)), "pen", "a triangle");
});
