import { expect, test } from "bun:test";
import { keywordSearch, kindFilter, presetEntries, run } from "../find";

test("find distinguishes stock faces, intensity ramps, and procedural manga marks", async () => {
  const faces = presetEntries().filter((entry) => entry.kind === "face");
  expect(faces.map((entry) => entry.id)).toContain("face/angry");
  expect(faces.map((entry) => entry.id)).toContain("face/ramp/anger");
  expect(faces.map((entry) => entry.id)).toContain("face/mark/question");
  const scope = kindFilter(["face/anger"], faces);
  expect(scope.bad).toEqual([]);
  expect(faces.filter(scope.test).map((entry) => entry.id)).toContain("face/pouty");
  const show = await run(["--show", "face/angry", "--offline"], faces);
  expect(show).toContain('wear.set("angry")');
  expect(show).toContain("anger");
  expect(show).toContain("medium");
  const deadpan = await run(["--show", "face/deadpan", "--offline"], faces);
  expect(deadpan).toContain("marks:");
  expect(deadpan).toContain("wearToonFace(player, { marks: false })");
});

test("intent and alias searches put native expressions and marks above emoji lookalikes", () => {
  const pool = [
    ...presetEntries(),
    { kind: "asset", id: "emoji-angry", title: "Angry emoji face", cat: "sticker", about: "mad pissed" },
    { kind: "asset", id: "emoji-question", title: "question mark above head", cat: "sticker", about: "question mark above head" },
  ];
  for (const query of ["mad", "pissed", "giận"]) {
    const hits = keywordSearch(pool, query).matches.slice(0, 4).map(({ id }) => id);
    expect(hits[0]).toBe("face/angry");
    expect(hits.toSorted()).toEqual(["face/angry", "face/furious", "face/pouty", "face/tantrum"]);
  }
  expect(keywordSearch(pool, "angry cartoon face expression").matches[0]?.id).toBe("face/angry");
  expect(keywordSearch(pool, "question mark above head").matches[0]?.id).toBe("face/mark/question");
});

test("recognized Vietnamese face aliases keep ranking and help on the same words", async () => {
  const faces = presetEntries().filter((entry) => entry.kind === "face");
  for (const query of ["giận", "tức giận"]) {
    const result = await run([query, "--kind", "face", "-n", "4", "--offline"], faces);
    expect(result).toContain("face/angry");
    expect(result).not.toContain("top hit lacks");
  }
});

test("foreign words without a supported alias do not match incidental English face terms", () => {
  const faces = presetEntries().filter((entry) => entry.kind === "face");
  const search = keywordSearch(faces, "une expression en colère");
  expect(search.foreign).toBe(true);
  expect(search.matches).toEqual([]);
});
