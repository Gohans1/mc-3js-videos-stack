import assert from "node:assert/strict";
import { test } from "node:test";
import { meter } from "../src/frames.mjs";

const W = 16, H = 9;
// frame(i): a grey picture, with a gradient that slides one pixel per frame so frames always differ a little
const frame = (level, i, at = () => null) => {
  const f = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) { const v = at(p) ?? Math.min(255, Math.max(0, level + (((p + i) % W) * 2))); f.fill(v, p * 3, p * 3 + 3); }
  return f;
};
const run = (n, make, cuts = []) => { const m = meter(W, H); for (let i = 0; i < n; i++) m.push(make(i)); return m.report(30, cuts).faults; };
const kinds = (fs) => fs.map((x) => x.kind);

test("a steady moving picture has no faults", () => {
  assert.deepEqual(run(60, (i) => frame(100, i)), []);
});

test("a single black frame, a one-frame flash and a held still are found", () => {
  assert.deepEqual(kinds(run(60, (i) => frame(i === 20 ? 0 : 100, i, i === 20 ? () => 0 : undefined))).filter((k) => k === "BLACK"), ["BLACK"]);
  assert.ok(kinds(run(60, (i) => frame(i === 20 ? 150 : 100, i))).includes("FLASH"));
  assert.deepEqual(kinds(run(90, (i) => frame(100, i < 30 ? i : 30))), ["FROZEN"]);
});

test("a jump away from a cut is a JUMP, the same change on a cut is not", () => {
  const make = (i) => frame(i < 30 ? 80 : 160, i);
  assert.ok(kinds(run(60, make)).includes("JUMP"));
  assert.ok(!kinds(run(60, make, [1])).includes("JUMP"));
  assert.ok(!kinds(run(60, make, [1.0])).includes("FLASH"));
});

test("pixels flipping every frame for a while shimmer", () => {
  const fs = run(60, (i) => frame(100, 0, (p) => (p < 20 && i > 10 && i < 40 ? (i % 2 ? 140 : 100) : null)));
  assert.ok(kinds(fs).includes("SHIMMER"));
});
