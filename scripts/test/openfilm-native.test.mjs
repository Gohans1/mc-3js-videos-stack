import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCatalog } from "../openfilm/catalog.mjs";
import { gradePixel, makeCube, nativeCatalog } from "../openfilm/native.mjs";

test("every imported visual has a render recipe, including text variants and template contents", () => {
  const items = readCatalog("vault/openfilm/library");
  const recipes = nativeCatalog("vault/openfilm/library", items);
  expect(recipes).toHaveLength(2066);
  expect(new Set(recipes.map((r) => r.id)).size).toBe(2066);
  for (const r of recipes) {
    expect(["page", "image", "motion", "fade", "look", "group"]).toContain(r.render);
    if (r.render === "page") expect(r.path).toEndWith(".html");
    if (r.render === "group") expect(r.clips.length).toBeGreaterThan(0);
  }
  expect(recipes.find((r) => r.id === "text/looks/title").path).toBe("text/text/files/text.html");
});

test("the LUT follows sRGB SVG matrix, saturation and sampled channel curves", () => {
  expect(gradePixel({}, [0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
  expect(
    gradePixel({ mix: [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0] }, [0.2, 0.4, 0.6])[0],
  ).toBeCloseTo(0.3);
  const gray = gradePixel({ sat: 0 }, [1, 0, 0]);
  for (const c of gray) expect(c).toBeCloseTo(0.213);
  const rows = makeCube({}, "identity", 2)
    .split("\n")
    .filter((s) => /^\d/.test(s));
  expect(rows).toEqual(["0 0 0", "1 0 0", "0 1 0", "1 1 0", "0 0 1", "1 0 1", "0 1 1", "1 1 1"]);
});

test("editable definitions override imported motion values without changing their IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "mc-openfilm-definition-"));
  const item = { id: "motions/custom", cat: "effect", kind: "motion", name: { en: "Original" } };
  try {
    mkdirSync(join(root, "_definitions/motions"), { recursive: true });
    writeFileSync(
      join(root, "_definitions/motions/custom.json"),
      JSON.stringify({ ...item, name: { en: "My motion" }, motion: { loop: { secs: 2 } } }),
    );
    expect(nativeCatalog(root, [item])[0]).toMatchObject({
      title: "My motion",
      motion: { loop: { secs: 2 } },
    });
    writeFileSync(
      join(root, "_definitions/motions/custom.json"),
      JSON.stringify({ ...item, id: "another/id" }),
    );
    expect(() => nativeCatalog(root, [item])).toThrow(/Definition ID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
