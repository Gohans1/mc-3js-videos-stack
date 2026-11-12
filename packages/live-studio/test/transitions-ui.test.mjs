import assert from "node:assert/strict";
import { test } from "node:test";

import { TRANSITIONS } from "film-stage/transitions";

import {
  freshTransition,
  tidyTransition,
  transitionCategories,
  transitionEaseChoices,
  transitionPreviewKind,
  transitionSupportsFeather,
  transitionSupportsFlip,
} from "../app/camera/transition-math.ts";

test("Reverse shows for shaders that read uFlip and for a film's own transition unless it says flip: false", () => {
  assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === "irisOpen")), true);
  assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === "lightIris")), true);
  assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === "windowExpand")), true);
  assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === "dissolve")), false);
  assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === "exposureBloom")), false);
  for (const id of ["tornPaper", "frameCollapse", "crossOver", "topDip"])
    assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === id)), true, id);
  for (const id of ["glitchBreak", "heatBleach", "snapMorph"])
    assert.equal(transitionSupportsFlip(TRANSITIONS.find((x) => x.id === id)), false, id);
  assert.equal(transitionSupportsFlip({ id: "aiPortal", title: "Portal", tip: "Custom" }), true);
  assert.equal(
    transitionSupportsFlip({ id: "aiFade", title: "Fade", tip: "Custom", flip: false }),
    false,
  );
});

test("Softness shows only for shaders that read uFeather, or when the film says so", () => {
  assert.equal(transitionSupportsFeather(TRANSITIONS.find((x) => x.id === "dissolve")), false);
  assert.equal(transitionSupportsFeather(TRANSITIONS.find((x) => x.id === "wipe")), true);
  assert.equal(transitionSupportsFeather({ id: "aiPortal", title: "Portal", tip: "Custom" }), true);
  assert.equal(
    transitionSupportsFeather({ id: "aiCut", title: "Cut", tip: "Custom", feather: false }),
    false,
  );
});

test("the Curve menu lists Linear apart from Natural only when the transition has its own curve", () => {
  const ids = (fx, cur) => transitionEaseChoices(fx, cur).map((e) => e.id);
  assert.equal(ids(TRANSITIONS.find((x) => x.id === "wipe")).includes("linear"), false);
  assert.equal(
    ids(
      TRANSITIONS.find((x) => x.id === "wipe"),
      "linear",
    ).includes("linear"),
    true,
  );
  assert.equal(ids({ id: "ai", title: "AI", tip: "", ease: "snapOut" }).includes("linear"), true);
  assert.equal(ids(TRANSITIONS.find((x) => x.id === "wipe"))[0], "auto");
});

test("tidyTransition strips default ease, 0.5 feather and false flip while clamping feather to [0, 1]", () => {
  assert.deepEqual(
    tidyTransition({ fx: "lumaMelt", len: 0.6, ease: "auto", feather: 0.5, flip: false }),
    { fx: "lumaMelt", len: 0.6 },
  );
  assert.deepEqual(
    tidyTransition({ fx: "lumaMelt", len: 0.6, ease: "glide", feather: 0.25, flip: true }),
    { fx: "lumaMelt", len: 0.6, ease: "glide", feather: 0.25, flip: true },
  );
  assert.deepEqual(tidyTransition({ fx: "wipe", len: 0.5, feather: -0.2 }), {
    fx: "wipe",
    len: 0.5,
    feather: 0,
  });
  assert.deepEqual(tidyTransition({ fx: "wipe", len: 0.5, feather: 1.4 }), {
    fx: "wipe",
    len: 0.5,
    feather: 1,
  });
});

test("freshTransition preserves customized ease, feather and flip across real TRANSITIONS ids, and every built-in has its own preview icon", () => {
  const prev = { fx: "wipe", len: 0.8, ease: "snap", feather: 0.2, flip: true };
  assert.deepEqual(freshTransition(prev, "irisOpen", 0.8), {
    fx: "irisOpen",
    len: 0.8,
    ease: "snap",
    feather: 0.2,
    flip: true,
  });
  assert.deepEqual(freshTransition(undefined, "dissolve", 0.5), { fx: "dissolve", len: 0.5 });

  const kinds = TRANSITIONS.map((fx) => transitionPreviewKind(fx));
  assert.equal(new Set(kinds).size, TRANSITIONS.length);
  for (const id of [
    "softWipe",
    "irisOpen",
    "irisClose",
    "lightIris",
    "blobRing",
    "mosaicCut",
    "mosaicIris",
  ]) {
    assert.equal(transitionPreviewKind(TRANSITIONS.find((x) => x.id === id)), id);
  }
});

test("transitionCategories orders canonical Cinetic categories and appends custom film categories", () => {
  assert.deepEqual(transitionCategories(TRANSITIONS), [
    "All",
    "Favorites",
    "Basic",
    "Wipe & Split",
    "Mask & Iris",
    "Light & Focus",
    "Speed & Glitch",
  ]);
  assert.deepEqual(
    transitionCategories([
      ...TRANSITIONS,
      { id: "portal", title: "Portal", tip: "Custom", cat: "Sci-Fi" },
    ]),
    [
      "All",
      "Favorites",
      "Basic",
      "Wipe & Split",
      "Mask & Iris",
      "Light & Focus",
      "Speed & Glitch",
      "Sci-Fi",
    ],
  );
});
