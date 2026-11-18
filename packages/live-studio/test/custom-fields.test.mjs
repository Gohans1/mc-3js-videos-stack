import { expect, test } from "bun:test";

import { editableFields, replaceField } from "../app/own/custom-fields";

test("custom fields respect known slots and exclude timing internals without losing nested data", () => {
  const row = {
    t: 2,
    anim: { in: { fx: "own", glow: { color: "#abc", strength: 0.4 } } },
    timebase: { sourceDuration: 4 },
    __timing: { source: {} },
    "color.mode": "warm",
  };
  const fields = editableFields(row, ["t", "anim.in.fx"]);
  expect(fields.map((f) => f.path)).toEqual([["anim", "in", "glow"], ["color.mode"]]);
  replaceField(row, ["anim", "in", "glow", "strength"], 0.8);
  expect(row.anim.in).toEqual({ fx: "own", glow: { color: "#abc", strength: 0.8 } });
  replaceField(row, ["color.mode"], "cool");
  expect(row["color.mode"]).toBe("cool");
});

test("nested array edits preserve neighbours and cannot create missing or inherited paths", () => {
  const row = {
    data: [
      { id: "one", visible: true },
      { id: "two", visible: false },
    ],
  };
  replaceField(row, ["data", 0, "visible"], false);
  expect(row.data).toEqual([
    { id: "one", visible: false },
    { id: "two", visible: false },
  ]);
  expect(() => replaceField(row, ["data", 4, "visible"], true)).toThrow();
  expect(() => replaceField(row, ["toString"], "bad")).toThrow();
});
