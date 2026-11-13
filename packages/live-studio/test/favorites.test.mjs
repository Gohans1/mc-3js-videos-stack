// The creator's favorites (src/favorites.mjs): one file for every film, newest last, never wiped by a file that doesn't parse
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { favoriteLists, openFavorites } from "../src/favorites.mjs";

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "fav-"));
  return { dir, fav: openFavorites(join(dir, "sub", "favorites.json")) };
};

test("no file yet reads as no favorites", () => {
  const { dir, fav } = fresh();
  assert.deepEqual(fav.read(), { sounds: [], effects: [] });
  rmSync(dir, { recursive: true });
});

test("a star is added once, newest last, and taken off again", () => {
  const { dir, fav } = fresh();
  fav.set({ kind: "sounds", id: "door_kick", on: true });
  fav.set({ kind: "effects", id: "move:push", on: true });
  fav.set({ kind: "sounds", id: "room_hum", on: true });
  assert.deepEqual(fav.set({ kind: "sounds", id: "door_kick", on: true }).sounds, [
    "room_hum",
    "door_kick",
  ]);
  assert.deepEqual(fav.set({ kind: "sounds", id: "room_hum", on: false }), {
    sounds: ["door_kick"],
    effects: ["move:push"],
  });
  assert.deepEqual(JSON.parse(readFileSync(fav.file, "utf8")), {
    sounds: ["door_kick"],
    effects: ["move:push"],
  });
  rmSync(dir, { recursive: true });
});

test("another studio's star made meanwhile is kept", () => {
  const { dir, fav } = fresh();
  const other = openFavorites(fav.file);
  fav.set({ kind: "sounds", id: "a", on: true });
  other.set({ kind: "sounds", id: "b", on: true });
  assert.deepEqual(fav.set({ kind: "effects", id: "fade:dip", on: true }), {
    sounds: ["a", "b"],
    effects: ["fade:dip"],
  });
  rmSync(dir, { recursive: true });
});

test("a file that doesn't parse shows no stars, so the page still loads", (t) => {
  const { dir, fav } = fresh();
  fav.set({ kind: "sounds", id: "a", on: true });
  writeFileSync(fav.file, "{ broken");
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(fav.shown(), { sounds: [], effects: [] });
  rmSync(dir, { recursive: true });
});

test("a file that doesn't parse is left alone, not written over", () => {
  const { dir, fav } = fresh();
  fav.set({ kind: "sounds", id: "a", on: true });
  writeFileSync(fav.file, "{ broken");
  assert.throws(() => fav.set({ kind: "sounds", id: "b", on: true }));
  assert.equal(readFileSync(fav.file, "utf8"), "{ broken");
  rmSync(dir, { recursive: true });
});

test("the lists are default first, then every named list, each with its star count", () => {
  const dir = mkdtempSync(join(tmpdir(), "fav-"));
  const lists = favoriteLists(dir);
  assert.deepEqual(lists.lists(), [{ name: "default", count: 0 }]);
  lists.open("horror").set({ kind: "sounds", id: "a", on: true });
  lists.open("horror").set({ kind: "effects", id: "in:pop", on: true });
  writeFileSync(join(dir, "Not A List.json"), "{}");
  assert.deepEqual(lists.lists(), [
    { name: "default", count: 0 },
    { name: "horror", count: 2 },
  ]);
  rmSync(dir, { recursive: true });
});
