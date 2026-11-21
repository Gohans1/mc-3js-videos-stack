import { expect, test } from "bun:test";

import { ToneMappingMode } from "postprocessing";

import { TONE_MAPS, toneMappingMode } from "../src/tone";

test("a film without a tone map keeps AgX, so films made before the choice look the same", () => {
  expect(toneMappingMode(undefined)).toBe(ToneMappingMode.AGX);
});

test("edit.json look.toneMapping picks the curve by name", () => {
  expect(toneMappingMode("neutral")).toBe(ToneMappingMode.NEUTRAL);
  expect(toneMappingMode("aces")).toBe(ToneMappingMode.ACES_FILMIC);
  expect(toneMappingMode("agx")).toBe(ToneMappingMode.AGX);
  expect(TONE_MAPS).toEqual(["agx", "neutral", "aces"]);
});

test("an unknown name stops the build with the names it takes, not a silent AgX", () => {
  expect(() => toneMappingMode("Neutral ")).toThrow(/agx, neutral, aces/);
  expect(() => toneMappingMode(3)).toThrow(/look.toneMapping/);
});
