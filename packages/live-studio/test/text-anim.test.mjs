import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_TINT, SHAPE_IN, TEXT_IN, TEXT_OUT } from "film-stage/titles";

import {
  freshTitleFx,
  orderedTitleCategories,
  shapeLabel,
  shapeUsesLength,
  tidyTitleFx,
  TINT_SWATCHES,
  voiceDefaultStagger,
  voiceDefaultTint,
  voiceSupportsStagger,
  voiceSupportsTint,
} from "../app/text/text-anim.ts";

test("voice capability flags and defaults match Cinetic word-stagger, OKLab-tint, and open custom AI voices", () => {
  for (const id of ["wordRise", "staggerWords", "inkIn", "wordDropOut"])
    assert.equal(voiceSupportsStagger(id), true);
  for (const id of ["fade", "type", "scramble"]) assert.equal(voiceSupportsStagger(id), false);
  for (const id of ["inkIn", "hueSweepIn"]) assert.equal(voiceSupportsTint(id), true);
  assert.equal(voiceSupportsTint("wordRise"), false);

  assert.equal(TINT_SWATCHES[0], DEFAULT_TINT);
  assert.equal(voiceDefaultTint("inkIn"), DEFAULT_TINT);
  for (const v of [...TEXT_IN, ...TEXT_OUT].filter((x) => x.stagger))
    assert.equal(voiceDefaultStagger(v.id), v.defaultStagger ?? 0.4, v.id);

  const customVoice = {
    id: "aiPrism",
    title: "AI Prism",
    len: 0.6,
    stagger: true,
    defaultStagger: 0.25,
    tint: true,
    defaultTint: "#22D3EE",
  };
  assert.equal(voiceSupportsStagger(customVoice), true);
  assert.equal(voiceSupportsTint(customVoice), true);
  assert.equal(voiceDefaultStagger(customVoice), 0.25);
  assert.equal(voiceDefaultTint(customVoice), "#22D3EE");
  assert.deepEqual(
    tidyTitleFx({ fx: "aiPrism", len: 0.6, stagger: 0.3, tint: "cyan" }, customVoice),
    { fx: "aiPrism", len: 0.6, stagger: 0.3, tint: "cyan" },
  );
  // Unknown AI voice without explicit stagger:false / tint:false never strips AI-authored stagger or tint
  const bareCustom = { id: "aiBare", title: "AI Bare", len: 0.5 };
  assert.deepEqual(
    tidyTitleFx({ fx: "aiBare", len: 0.5, stagger: 0.2, tint: "#ff6b2c" }, bareCustom),
    { fx: "aiBare", len: 0.5, stagger: 0.2, tint: "#FF6B2C" },
  );
});

test("tidyTitleFx and freshTitleFx strip default auto ease, clamp stagger, and drop unsupported options across voice switches", () => {
  const inkMeta = TEXT_IN.find((x) => x.id === "inkIn");
  const fadeMeta = TEXT_IN.find((x) => x.id === "fade");
  assert.deepEqual(tidyTitleFx({ fx: "inkIn", len: 0.55, ease: "auto" }, inkMeta), {
    fx: "inkIn",
    len: 0.55,
  });
  assert.deepEqual(
    tidyTitleFx({ fx: "inkIn", len: 0.7, ease: "glide", stagger: 1.4, tint: "#38bdf8" }, inkMeta),
    { fx: "inkIn", len: 0.7, ease: "glide", stagger: 1, tint: "#38BDF8" },
  );
  const switched = freshTitleFx(
    { fx: "inkIn", len: 0.7, ease: "glide", stagger: 0.4, tint: "#38BDF8" },
    fadeMeta,
  );
  assert.deepEqual(switched, { fx: "fade", len: 0.7, ease: "glide" });
});

test("shape helpers and title categories cover all Cinetic annotation shapes and custom AI kinds", () => {
  assert.equal(shapeUsesLength("arrow"), true);
  assert.equal(shapeUsesLength("underline"), true);
  assert.equal(shapeUsesLength("box"), false);
  assert.equal(shapeUsesLength("bracket"), false);
  assert.equal(shapeLabel("callout"), "Callout", "a film's own shape kind gets a readable label");
  assert.deepEqual(orderedTitleCategories(TEXT_IN), [
    "All",
    "Favorites",
    "Clean",
    "Build & Mask",
    "Pop & Scale",
    "Colour & Ink",
    "Decode & Split",
  ]);
  assert.deepEqual(orderedTitleCategories(TEXT_OUT), [
    "All",
    "Favorites",
    "Clean",
    "Build & Mask",
    "Pop & Scale",
    "Decode & Split",
  ]);
  assert.deepEqual(orderedTitleCategories(SHAPE_IN, true), [
    "All",
    "Favorites",
    "Draw",
    "Pop & Scale",
    "Clean",
  ]);
});

test("hold keeps on-twos or on-threes stepping through tidy and voice switches, and drops smooth or bad values", () => {
  const fadeMeta = TEXT_IN.find((x) => x.id === "fade");
  const typeMeta = TEXT_IN.find((x) => x.id === "type");
  assert.deepEqual(tidyTitleFx({ fx: "fade", len: 0.5, hold: 2 }, fadeMeta), {
    fx: "fade",
    len: 0.5,
    hold: 2,
  });
  assert.deepEqual(tidyTitleFx({ fx: "fade", len: 0.5, hold: 1 }, fadeMeta), {
    fx: "fade",
    len: 0.5,
  });
  assert.deepEqual(tidyTitleFx({ fx: "fade", len: 0.5, hold: 2.6 }, fadeMeta), {
    fx: "fade",
    len: 0.5,
    hold: 3,
  });
  assert.deepEqual(freshTitleFx({ fx: "fade", len: 0.5, hold: 3 }, typeMeta), {
    fx: "type",
    len: 0.5,
    hold: 3,
  });
});
