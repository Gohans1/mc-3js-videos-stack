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
    'cost: 30 ms a sample, the median of 4 stretches between cuts; 4.00-5.97 s draws 110 ms (x3.7): CHECK="probe:*,4.00" bun run render stills lists what it draws',
  );
});

// the first frame a set is drawn compiles its shaders, and a cold run starts slow: neither is what the set costs
test("render cost is not swayed by a slow first frame, and names no stretch too short to judge", () => {
  const cost = renderCost([2, 4, 4.2], 6);
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
  const even = renderCost([], 4);
  for (let f = 0; f < 120; f++) even.add(f / 30, 25, 1);
  assert.equal(even.line(), "cost: 25 ms a sample");
  assert.equal(renderCost([1], 2).line(), "");
});

// a SPAN across one cut draws two stretches: the heavy one is judged against the other, not against itself
test("render cost names the heavy one of two stretches, and weighs a whip's stretch a sample", () => {
  const two = renderCost([3], 6);
  for (let f = 0; f < 180; f++) two.add(f / 30, f < 90 ? 30 : 110, 1);
  assert.equal(
    two.line(),
    'cost: 30 ms a sample, the median of 2 stretches between cuts; 3.00-5.97 s draws 110 ms (x3.7): CHECK="probe:*,3.00" bun run render stills lists what it draws',
  );
  // a whip stretch drawn at 8 samples a frame costs 8 times a frame, and the same a sample
  const whip = renderCost([3], 6);
  for (let f = 0; f < 180; f++) whip.add(f / 30, f < 90 ? 30 : 240, f < 90 ? 1 : 8);
  assert.equal(
    whip.line(),
    "cost: 30 ms a sample, the median of 2 stretches between cuts; none past twice that and 33 ms",
  );
});

// two heavy sets out of three: each is judged against the others, and the light one stays the typical cost
test("render cost names every heavy stretch when they outnumber the light ones", () => {
  const cost = renderCost([2, 4], 6);
  for (let f = 0; f < 180; f++) cost.add(f / 30, f < 60 ? 30 : 110, 1);
  assert.equal(
    cost.line(),
    'cost: 30 ms a sample, the median of 3 stretches between cuts; 2.00-3.97 s draws 110 ms (x3.7), 4.00-5.97 s draws 110 ms (x3.7): CHECK="probe:*,2.00" bun run render stills lists what it draws',
  );
});

// a studio frame has 33 ms at 30 fps: a stretch twice as dear as 10 ms ones still plays smoothly, and is no news
test("render cost names no stretch that still draws within a frame's time", () => {
  const cost = renderCost([2], 4);
  for (let f = 0; f < 120; f++) cost.add(f / 30, f < 60 ? 10 : 25, 1);
  assert.equal(
    cost.line(),
    "cost: 10 ms a sample, the median of 2 stretches between cuts; none past twice that and 33 ms",
  );
});
