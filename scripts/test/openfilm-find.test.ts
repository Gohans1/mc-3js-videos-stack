import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { run } from "../find";
import { assetEntries } from "../openfilm/catalog.mjs";

const favorites = favoriteLists(join(tmpdir(), "openfilm-find-no-favorites"));
const entries = assetEntries(
  [
    {
      id: "transitions/page-turn",
      cat: "transition",
      kind: "page",
      group: "paper",
      src: "page-turn.html",
      name: { en: "Page turn" },
    },
  ],
  "C:/vault/openfilm/library",
);

test("source assets use source/category filters and show the editable path and OpenFilm commands", async () => {
  const result = await run(
    ["--kind", "asset/transition", "--source", "openfilm"],
    entries,
    undefined,
    undefined,
    favorites,
  );
  expect(result).toContain("of-transitions-page-turn");
  const detail = await run(
    ["--show", "of-transitions-page-turn"],
    entries,
    undefined,
    undefined,
    favorites,
  );
  expect(detail).toContain("openfilm-page");
  expect(detail).toContain("page-turn.html");
  expect(detail).toContain("bun run asset use openfilm:transitions/page-turn --film films/<name>");
  expect(detail).not.toContain("asset info");
  expect(detail).not.toContain("shot.transition");
  expect(detail).not.toContain("render stills");
});

test("CLI keeps unknown provenance separate from real recordings", async () => {
  const sounds = [
    {
      kind: "sfx",
      id: "of-sfx-whoosh",
      cat: "transitions",
      title: "Whoosh",
      about: "",
      src: "openfilm",
      data: { origin: "unknown" },
    },
  ];
  const result = await run(
    ["--origin", "unknown", "--source", "openfilm"],
    sounds,
    undefined,
    undefined,
    favorites,
  );
  expect(result).toContain("of-sfx-whoosh");
});
