import { expect, test } from "bun:test";
import { EXPRESSIONS, listToonExpressions, resolveFace } from "mc-actor/toon-face";

test("every stock expression is discoverable by its name and has a description and aliases", () => {
  const entries = listToonExpressions();
  expect(entries.map(({ name }) => name).sort()).toEqual(Object.keys(EXPRESSIONS).sort());
  for (const entry of entries) {
    expect(entry.description.trim()).not.toBe("");
    expect(entry.aliases.every((alias) => alias.trim().length > 0)).toBe(true);
    expect(entry.aliases.length).toBeGreaterThan(0);
    expect(listToonExpressions({ query: entry.name })[0]).toEqual(entry);
  }
});

test("alias search handles case and punctuation and returns an expression the renderer can use", () => {
  const results = listToonExpressions({ query: "  HOLD-BREATH! " });
  expect(results[0]).toMatchObject({ name: "holding-breath", group: "pain" });
  expect(resolveFace(results[0]!.name).mouth.open).toBe(0);
});

test("a group filter composes with both exact aliases and descriptive keywords", () => {
  expect(listToonExpressions({ group: "anger", query: "mad" })[0]?.name).toBe("angry");
  expect(listToonExpressions({ group: "joy", query: "mad" })).toEqual([]);
  const hits = listToonExpressions({ group: "pain", query: "cheeks sealed" });
  expect(hits.map(({ name }) => name)).toEqual(["holding-breath"]);
});
