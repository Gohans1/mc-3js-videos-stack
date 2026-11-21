import assert from "node:assert/strict";
import { test } from "node:test";

import { renderCost } from "../src/render-cost.mjs";

test("render cost names the stretch between cuts that draws over twice the median a sample", () => {
  const cost = renderCost([2, 4, 6], 8);
  // 30 ms a sample everywhere but 4-6 s, where 45 jars cost 110 ms; a whip frame of 8 samples is no heavier a sample
  for (let f = 0; f < 240; f++) {
    const t = f / 30;
    const samples = f === 70 ? 8 : 1;
    cost.add(t, (t >= 4 && t < 6 ? 110 : 30) * samples, samples);
  }
  assert.equal(
    cost.line(),
    "cost: 30 ms a sample, the median of 4 stretches between cuts; 4.00-6.00 s draws 110 ms (x3.7): profile what it shows there",
  );
});

test("render cost says so when no stretch is heavy, and nothing when nothing was drawn", () => {
  const even = renderCost([], 4);
  for (let f = 0; f < 120; f++) even.add(f / 30, 25, 1);
  assert.equal(
    even.line(),
    "cost: 25 ms a sample, the median of 1 stretch between cuts; none past twice that",
  );
  assert.equal(renderCost([1], 2).line(), "");
});
