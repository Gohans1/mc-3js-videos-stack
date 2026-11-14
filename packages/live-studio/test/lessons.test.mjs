import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lessonsFor } from "../src/lessons.mjs";

const lessons = (files) => {
  const root = mkdtempSync(join(tmpdir(), "repo-")),
    dir = join(root, "lessons");
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, cache: join(root, "cache.json") };
};
const HANDS =
  "# Hands\n\n## Hands holding a prop follow the carry rig\nwhy\n\n## Fingers stay on the prop\nwhy\n";
const CUTS = "# Cuts\n\n## Transitions under 0.4 s, ease-out\nwhy\n";
const note = (id, text) => ({ id, text });
// a stand-in for Jev: votes and fits by the words each file shows it, as [vote, file, fit]
const judgeBy =
  (fits, calls = []) =>
  (text, pool, show) => {
    calls.push(text);
    const voted = pool.map((x) => [fits[x.path] ?? 0, x]).sort((a, b) => b[0] - a[0]);
    return Promise.resolve(
      voted.map(([p, x], i) => (i < show ? [p, x, fits[x.path] ?? 0] : [p, x])),
    );
  };

test("a note gets the paths of the lesson files Jev says it needs, best first, and never a misfit", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "cuts.md": CUTS,
    "sound.md": "# Sound\n\n## Doors\n",
  });
  const judge = judgeBy({
    "lessons/cuts.md": 0.6,
    "lessons/hands.md": 0.9,
    "lessons/sound.md": 0.1,
  });
  const got = await lessonsFor([note("a", "tay lệch, transition nhanh hơn")], {
    dir,
    cache,
    judge,
  });
  assert.deepEqual(got.get("a"), { paths: ["lessons/hands.md", "lessons/cuts.md"] });
});

test("Jev reads each file's path and words, however the file is written", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "free.md": "tay cầm đồ\n\n  phải bám   theo rig\n",
  });
  let seen;
  await lessonsFor([note("a", "x")], {
    dir,
    cache,
    judge: (_, pool) => ((seen = pool.map((x) => x.jev)), Promise.resolve([])),
  });
  assert.deepEqual(seen, [
    "lessons/free.md: tay cầm đồ phải bám theo rig",
    "lessons/hands.md: # Hands ## Hands holding a prop follow the carry rig why ## Fingers stay on the prop why",
  ]);
});

test("a note read again asks Jev nothing until its words or the lessons change", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  const again = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.deepEqual(again.get("a").paths, ["lessons/hands.md"]);
  assert.equal(calls.length, 1);
  await lessonsFor([note("a", "tay lệch quá")], { dir, cache, judge });
  assert.equal(calls.length, 2);
  writeFileSync(join(dir, "cuts.md"), CUTS);
  await lessonsFor([note("a", "tay lệch quá")], { dir, cache, judge });
  assert.equal(calls.length, 3);
});

test("Jev failing says why, keeps nothing, and asks again next time", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const fail = () =>
    Promise.reject(new Error("Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env"));
  const got = await lessonsFor([note("a", "x")], { dir, cache, judge: fail });
  assert.deepEqual(got.get("a"), {
    why: "Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env",
  });
  const calls = [];
  await lessonsFor([note("a", "x")], { dir, cache, judge: judgeBy({}, calls) });
  assert.equal(calls.length, 1);
});

test("no lesson files yet: nothing to say and no Jev call", async () => {
  const { dir, cache } = lessons({});
  const calls = [];
  const got = await lessonsFor([note("a", "x")], { dir, cache, judge: judgeBy({}, calls) });
  assert.equal(got.size, 0);
  assert.equal(calls.length, 0);
  assert.equal((await lessonsFor([note("a", "x")], { dir: join(dir, "none"), cache })).size, 0);
});
