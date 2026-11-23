import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const scripts = (rel) =>
  JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8")).scripts;

test("every repo command has a stub in a new film, and every film command one at the root", () => {
  const root = scripts("package.json"),
    film = scripts("templates/film/package.json");
  expect(Object.keys(root).filter((k) => !(k in film))).toEqual([]);
  expect(Object.keys(film).filter((k) => !(k in root) && k !== "postinstall")).toEqual([]);
});
