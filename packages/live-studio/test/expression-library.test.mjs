import { expect, test } from "bun:test";

import { EXPRESSION_GROUPS, EXPRESSIONS, FEELINGS } from "mc-actor/toon-face";

import { buildExpressionGroups, filterExpressionGroups } from "../app/objects/expression-library";

test("the expression library includes each registered preset and intensity ramp", () => {
  const groups = buildExpressionGroups(EXPRESSIONS, EXPRESSION_GROUPS, FEELINGS);
  const entries = groups.flatMap((group) => group.entries);
  expect(
    entries
      .filter((entry) => entry.kind === "preset")
      .map((entry) => entry.name)
      .sort(),
  ).toEqual(Object.keys(EXPRESSIONS).sort());
  expect(
    entries
      .filter((entry) => entry.kind === "ramp")
      .map((entry) => entry.name)
      .sort(),
  ).toEqual(Object.keys(FEELINGS).sort());
});

test("new presets without a category stay discoverable and ramp stops are searchable", () => {
  const groups = buildExpressionGroups(
    { neutral: {}, "wide-eyes": {}, "side-eye": {} },
    { surprise: ["wide-eyes", "removed"] },
    { surprise: ["neutral", "wide-eyes", "side-eye"] },
  );
  expect(
    filterExpressionGroups(groups, "side eye").flatMap((group) =>
      group.entries.map((entry) => entry.kind),
    ),
  ).toEqual(["ramp", "preset"]);
  expect(
    filterExpressionGroups(groups, "side eye", "surprise")[0].entries.map((entry) => entry.name),
  ).toEqual(["surprise"]);
  expect(filterExpressionGroups(groups, "removed")).toEqual([]);
});
