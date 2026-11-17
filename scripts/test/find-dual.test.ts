import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { type Entry, run } from "../find";
import type { OpenFilmLookup } from "../search/openfilm";

const pool: Entry[] = [
  {
    id: "mc-step-stone",
    kind: "mc",
    cat: "blocks",
    title: "Stone step",
    about: "footsteps",
    secs: 0.5,
    src: "minecraft",
    data: { license: "Minecraft 26.3 Assets", source: "minecraft" },
  },
  {
    id: "of-step",
    kind: "sfx",
    cat: "foley",
    title: "Footsteps on stone",
    about: "",
    src: "openfilm",
    secs: 1,
    data: { upstreamId: "audio/step.mp3", license: "CC0 1.0" },
  },
  {
    id: "of-theme",
    kind: "bgm",
    cat: "calm",
    title: "Gentle strings",
    about: "",
    src: "openfilm",
    secs: 60,
    data: { upstreamId: "audio/theme.mp3", license: "CC0 1.0" },
  },
];
const noJev = async (): Promise<never> => {
  throw new Error("Jev must not run");
};
const favorites = favoriteLists(join(tmpdir(), "find-hybrid-no-stars"));
const lookup: OpenFilmLookup = async (_query, eligible) => ({
  hits: eligible
    .filter((entry) => entry.src === "openfilm")
    .map((entry) => ({ entry, score: 0.8 })),
  categories: ["sound", "music"],
  notes: [],
});

type OutputHit = Partial<Entry> & { key: string; alsoKeyword?: boolean };
const semanticEntries = (output: {
  keyword: { results: OutputHit[] };
  semantic: { results: OutputHit[] };
}) =>
  output.semantic.results.map((hit) =>
    hit.alsoKeyword ? output.keyword.results.find((word) => word.key === hit.key)! : hit,
  );

test("one sound query returns independent keyword and semantic blocks without displacing Minecraft", async () => {
  const output = JSON.parse(
    await run(["stone", "--kind", "sound", "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(output.mode).toBe("dual");
  expect(output.keyword.results.map((x: Entry) => x.id)).toEqual(["mc-step-stone", "of-step"]);
  expect(semanticEntries(output).map((x) => x.id)).toEqual(["of-step", "of-theme"]);
  expect(output.semantic.results[0].alsoKeyword).toBe(true);
  expect(output.semantic.results[1].alsoKeyword).toBe(false);
});

test("source filters remain restrictive and Minecraft-only searches do not contact the service", async () => {
  const only = JSON.parse(
    await run(
      ["stone", "--source", "openfilm", "--json"],
      pool,
      noJev,
      undefined,
      favorites,
      lookup,
    ),
  );
  expect(only.keyword.results.every((entry: Entry) => entry.src === "openfilm")).toBe(true);
  expect(semanticEntries(only).every((entry) => entry.src === "openfilm")).toBe(true);
  const mc = JSON.parse(
    await run(["stone", "--kind", "mc", "--json"], pool, noJev, undefined, favorites, async () => {
      throw new Error("unexpected network");
    }),
  );
  expect(mc.keyword.results.map((x: Entry) => x.id)).toEqual(["mc-step-stone"]);
  expect(mc.semantic.results).toEqual([]);
  expect(mc.notes).toEqual([]);
});

test("a failed service retains keyword order and reports fallback without calling Jev", async () => {
  const failed: OpenFilmLookup = async () => ({
    hits: [],
    categories: ["sound"],
    notes: ["OpenFilm unavailable"],
  });
  const output = JSON.parse(
    await run(["stone", "--json"], pool, noJev, undefined, favorites, failed),
  );
  expect(output.mode).toBe("keyword-fallback");
  expect(output.keyword.results.map((x: Entry) => x.id)).toEqual(["mc-step-stone", "of-step"]);
  expect(output.semantic.results).toEqual([]);
  expect(output.notes.join(" ")).toContain("unavailable");
});

test("each block has its own limit and text labels distinguish similarity from confidence", async () => {
  const output = JSON.parse(
    await run(["stone", "-n", "1", "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(output.keyword.results.map((x: Entry) => x.id)).toEqual(["mc-step-stone"]);
  expect(semanticEntries(output).map((x) => x.id)).toEqual(["of-step"]);
  const text = await run(["stone", "-n", "1"], pool, noJev, undefined, favorites, lookup);
  expect(text.indexOf("BM25")).toBeLessThan(text.indexOf("OpenFilm semantic"));
  expect(text).toContain("not confidence");
});

test("dual text gives shared placement instructions once after both result blocks", async () => {
  const text = await run(["stone"], pool, noJev, undefined, favorites, lookup);
  expect(text.match(/where \(in /g)).toHaveLength(1);
  expect(text.indexOf("where (in ")).toBeGreaterThan(text.indexOf("OpenFilm semantic"));
  expect(text).toContain("audio.json sfx[]");
});

test("JSON repeats a shared asset's rank but references its complete keyword record", async () => {
  const output = JSON.parse(
    await run(["stone", "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(output.schemaVersion).toBe(2);
  const repeated = output.semantic.results.find((hit: { alsoKeyword: boolean }) => hit.alsoKeyword);
  expect(Object.keys(repeated).sort()).toEqual(["alsoKeyword", "key", "rank", "similarity"]);
  const complete = output.keyword.results.find((hit: { key: string }) => hit.key === repeated.key);
  expect(complete).toMatchObject({
    id: "of-step",
    title: "Footsteps on stone",
    license: "CC0 1.0",
  });
  expect(
    output.semantic.results.find((hit: { alsoKeyword: boolean }) => !hit.alsoKeyword),
  ).toMatchObject({ id: "of-theme", title: "Gentle strings" });
});

test("a semantic result outside the displayed keyword limit keeps its complete metadata", async () => {
  const output = JSON.parse(
    await run(["stone", "-n", "1", "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(output.semantic.results[0]).toMatchObject({
    id: "of-step",
    title: "Footsteps on stone",
    alsoKeyword: false,
  });
});

test("matching IDs from different sources keep distinct complete records", async () => {
  const local = {
    ...pool[1]!,
    id: "shared",
    src: "kenney",
    title: "Stone step",
    data: { license: "CC0" },
  };
  const remote = { ...pool[1]!, id: "shared", title: "Air whoosh" };
  const output = JSON.parse(
    await run(["stone", "--json"], [local, remote], noJev, undefined, favorites, lookup),
  );
  expect(output.keyword.results.map((hit: Entry) => hit.src)).toEqual(["kenney"]);
  expect(output.semantic.results[0]).toMatchObject({
    id: "shared",
    src: "openfilm",
    title: "Air whoosh",
    alsoKeyword: false,
  });
});

test("shared placement instructions retain lanes needed by either branch", async () => {
  const transition: Entry = {
    id: "cut",
    kind: "transition",
    cat: "Basic",
    title: "Cut",
    about: "",
    src: "film-stage/transitions.ts",
  };
  const text = await run(
    ["cut", "-n", "1"],
    [...pool, transition],
    noJev,
    undefined,
    favorites,
    lookup,
  );
  expect(text.match(/where \(in /g)).toHaveLength(1);
  expect(text).toContain("shots.json shot.transition");
  expect(text).toContain("audio.json sfx[]");
});

test("display removes repeated description tags without changing the catalog text", async () => {
  const music: Entry = { ...pool[2]!, about: "emotional; sad; emotional; piano; sad" };
  const text = await run(["piano"], [music], noJev, undefined, favorites, lookup);
  expect(text).toContain("emotional; sad; piano");
  expect(text).not.toContain("emotional; sad; emotional");
  const shown = await run(["--show", music.id], [music], noJev, undefined, favorites, lookup);
  expect(shown).not.toContain("emotional; sad; emotional");
  const output = JSON.parse(
    await run(["piano", "--json"], [music], noJev, undefined, favorites, lookup),
  );
  expect(output.keyword.results[0].about).toBe("emotional; sad; piano");
  expect(music.about).toBe("emotional; sad; emotional; piano; sad");
});

test("unknown option hints include the supported offline flag", async () => {
  await expect(
    run(["stone", "--qzxraw"], pool, noJev, undefined, favorites, lookup),
  ).rejects.toThrow(/Options:.*--offline/);
});

test("dual text and JSON retain explanations of normalized kind aliases", async () => {
  const args = ["strings", "--kind", "music"];
  const text = await run(args, pool, noJev, undefined, favorites, lookup);
  const output = JSON.parse(
    await run([...args, "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(text).toContain("--kind music read as bgm");
  expect(output.notes.join(" ")).toContain("--kind music read as bgm");
  expect(output.keyword.results.map((entry: Entry) => entry.id)).toEqual(["of-theme"]);
});

test("duration and license filters constrain both blocks before semantic lookup", async () => {
  const duration = JSON.parse(
    await run(
      ["stone", "--kind", "sound", "--dur", "0-2", "--json"],
      pool,
      noJev,
      undefined,
      favorites,
      lookup,
    ),
  );
  expect(semanticEntries(duration).map((entry) => entry.id)).toEqual(["of-step"]);
  expect(duration.keyword.results.map((entry: Entry) => entry.id)).toEqual([
    "mc-step-stone",
    "of-step",
  ]);
  const license = JSON.parse(
    await run(["stone", "--license", "free", "--json"], pool, noJev, undefined, favorites, lookup),
  );
  expect(license.keyword.results.every((entry: Entry) => entry.src === "openfilm")).toBe(true);
  expect(semanticEntries(license).map((entry) => entry.id)).toEqual(["of-step", "of-theme"]);
});

test("an explicit vector-index failure keeps its existing keyword fallback instead of switching services", async () => {
  const text = await run(
    ["stone", "--semantic", "--db", join(tmpdir(), `missing-vector-${process.pid}.sqlite`)],
    pool,
    noJev,
    undefined,
    favorites,
    async () => {
      throw new Error("OpenFilm must not replace explicit vector search");
    },
  );
  expect(text).toContain("semantic unavailable");
  expect(text).toContain("mc-step-stone");
  expect(text).not.toContain("OpenFilm semantic");
});
