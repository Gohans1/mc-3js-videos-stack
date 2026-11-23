import assert from "node:assert/strict";
import { test } from "node:test";

import { renderCost } from "../src/render-cost.mjs";

test("render cost names the stretch between cuts that draws over twice the median a sample", () => {
  const cost = renderCost([2, 4, 6]);
  for (let f = 0; f < 240; f++) {
    const t = f / 30;
    const samples = f === 70 ? 8 : 1;
    cost.add(t, (t >= 4 && t < 6 ? 110 : 30) * samples, samples);
  }
  assert.equal(
    cost.line(),
    "cost: 30 ms a sample, the median of 3 of 4 stretches between cuts, the ones not named here; 4.00-5.97 s draws 110 ms (x3.7): bun run render stills --at 4.00 --list shows what is in view there",
  );
});

test("render cost is not swayed by a slow first frame, and names no stretch too short to judge", () => {
  const cost = renderCost([2, 4, 4.2]);
  for (let f = 0; f < 180; f++) {
    const t = f / 30;
    const first = f === 0 || f === 60;
    cost.add(t, first ? 1000 : t >= 4 && t < 4.2 ? 200 : 30, 1);
  }
  assert.equal(
    cost.line(),
    "cost: 30 ms a sample, the median of 3 stretches between cuts; none past twice that and 33 ms",
  );
});

test("render cost over one stretch says its ms alone, and nothing when nothing was drawn", () => {
  const even = renderCost([]);
  for (let f = 0; f < 120; f++) even.add(f / 30, 25, 1);
  assert.equal(even.line(), "cost: 25 ms a sample");
  assert.equal(renderCost([1]).line(), "");
});

test("render cost names the heavy one of two stretches, and weighs a whip's stretch a sample", () => {
  const two = renderCost([3]);
  for (let f = 0; f < 180; f++) two.add(f / 30, f < 90 ? 30 : 110, 1);
  assert.equal(
    two.line(),
    "cost: 30 ms a sample, the median of 1 of 2 stretches between cuts, the ones not named here; 3.00-5.97 s draws 110 ms (x3.7): bun run render stills --at 3.00 --list shows what is in view there",
  );
  const whip = renderCost([3]);
  for (let f = 0; f < 180; f++) whip.add(f / 30, f < 90 ? 30 : 240, f < 90 ? 1 : 8);
  assert.equal(
    whip.line(),
    "cost: 30 ms a sample, the median of 2 stretches between cuts; none past twice that and 33 ms",
  );
});

test("render cost names every heavy stretch when they outnumber the light ones", () => {
  const cost = renderCost([2, 4]);
  for (let f = 0; f < 180; f++) cost.add(f / 30, f < 60 ? 30 : 110, 1);
  assert.equal(
    cost.line(),
    "cost: 30 ms a sample, the median of 1 of 3 stretches between cuts, the ones not named here; 2.00-3.97 s draws 110 ms (x3.7), 4.00-5.97 s draws 110 ms (x3.7): bun run render stills --at 2.00 --list shows what is in view there",
  );
});

test("render cost names no stretch that still draws within a frame's time", () => {
  const cost = renderCost([2]);
  for (let f = 0; f < 120; f++) cost.add(f / 30, f < 60 ? 10 : 25, 1);
  assert.equal(
    cost.line(),
    "cost: 10 ms a sample, the median of 2 stretches between cuts; none past twice that and 33 ms",
  );
});
