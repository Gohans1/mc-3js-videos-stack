import { expect, test } from "bun:test";

import { mapTimeline } from "../src/timing-data.mjs";
import { setTiming, timedDraw } from "../src/timing-state.mjs";
import { compileTiming } from "../src/timing.mjs";

test("overlay rows follow speed changes and keep their source coordinates on save", () => {
  const clock = compileTiming({ speeds: [{ from: 0, to: 10, rate: 2 }] }, 10);
  const source = { items: [{ id: "rain", asset: "effects/rain", from: 2, to: 4 }] };
  const view = mapTimeline("openfilm", source, clock);
  expect(view.items[0].from).toBe(1);
  expect(view.items[0].to).toBe(2);
  expect(mapTimeline("openfilm", view, clock, true, source)).toEqual(source);
});

test("cut preparation queries use source time after a speed change", () => {
  setTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 4);
  try {
    const draw = timedDraw(
      Object.assign(() => {}, { needsPreparation: (t) => t >= 1.5 && t < 2.5 }),
    );
    expect(draw.needsPreparation(1)).toBe(true);
    expect(draw.needsPreparation(0.25)).toBe(false);
  } finally {
    setTiming({}, 4);
  }
});
