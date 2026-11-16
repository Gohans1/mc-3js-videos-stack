import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
// a stand-in for Jev: votes and fits each file by its path, as [vote, file, fit]
const judgeBy =
  (fits, calls = []) =>
  (text, pool, show) => {
    calls.push(text);
    const fit = (x) => fits[x.path] ?? 0;
    const voted = pool.map((x) => [fit(x), x]).sort((a, b) => b[0] - a[0]);
    return Promise.resolve(voted.map(([p, x], i) => (i < show ? [p, x, fit(x)] : [p, x])));
  };

test("a note gets the lesson files Jev says it needs, best first, sure or maybe, each with its headings and their lines", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "cuts.md": CUTS,
    "sound.md": "# Sound\n\n## Doors\n",
  });
  const judge = judgeBy({
    "lessons/hands.md": 0.9,
    "lessons/cuts.md": 0.5,
    "lessons/sound.md": 0.1,
  });
  const got = await lessonsFor([note("a", "tay lệch, transition nhanh hơn")], {
    dir,
    cache,
    judge,
  });
  assert.deepEqual(got.get("a"), {
    picks: [
      {
        path: "lessons/hands.md",
        sure: true,
        heads: [
          { line: 1, head: "# Hands" },
          { line: 3, head: "## Hands holding a prop follow the carry rig" },
          { line: 6, head: "## Fingers stay on the prop" },
        ],
      },
      {
        path: "lessons/cuts.md",
        sure: false,
        heads: [
          { line: 1, head: "# Cuts" },
          { line: 3, head: "## Transitions under 0.4 s, ease-out" },
        ],
      },
    ],
  });
  const none = await lessonsFor([note("b", "đẹp")], { dir, cache, judge: judgeBy({}) });
  assert.deepEqual(none.get("b"), { picks: [] });
});

test("Jev reads each file's path, frontmatter and every heading, never the words under them", async () => {
  const { dir, cache } = lessons({
    "hands.md": HANDS,
    "free.md": "tay cầm đồ\n\n  phải bám   theo rig\n",
    "cam.md":
      "---\r\nwhen: camera   moves\r\n---\r\n# Camera\r\nbody\r\n```sh\r\n# not a heading\r\n```\r\n  ### No roll ###\r\n#nospace\r\n",
  });
  let seen;
  await lessonsFor([note("a", "x")], {
    dir,
    cache,
    judge: (_, pool) => ((seen = pool.map((x) => x.jev)), Promise.resolve([])),
  });
  assert.deepEqual(seen, [
    "lessons/cam.md: when: camera moves | # Camera ### No roll ###",
    "lessons/free.md",
    "lessons/hands.md: # Hands ## Hands holding a prop follow the carry rig ## Fingers stay on the prop",
  ]);
});

test("a change under a heading asks Jev nothing again and the heading lines follow the file; a heading's change asks again", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  writeFileSync(join(dir, "hands.md"), HANDS.replace("why", "because\nthe rig says so"));
  const moved = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.equal(calls.length, 1);
  assert.equal(moved.get("a").picks[0].heads[2].line, 7);
  writeFileSync(join(dir, "hands.md"), `${HANDS}\n## Knuckles face out\n`);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.equal(calls.length, 2);
});

test("Jev reads the creator's answers on a note too, and asks again when a new one comes", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({}, calls),
    door = note("a", "the door is too fast");
  await lessonsFor([door], { dir, cache, judge });
  await lessonsFor([{ ...door, asks: [{ text: "and the hinge squeak is missing", at: "t" }] }], {
    dir,
    cache,
    judge,
  });
  assert.deepEqual(calls, [
    "the door is too fast",
    "the door is too fast\nand the hinge squeak is missing",
  ]);
});

test("a cache entry kept in an older shape is asked again, never read as picks", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  const kept = JSON.parse(readFileSync(cache, "utf8"));
  writeFileSync(cache, JSON.stringify({ a: { key: kept.a.key, paths: ["lessons/hands.md"] } }));
  const again = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.deepEqual(
    again.get("a").picks.map((p) => p.path),
    ["lessons/hands.md"],
  );
  assert.equal(calls.length, 2);
});

test("a note read again asks Jev nothing until its words or the lessons change", async () => {
  const { dir, cache } = lessons({ "hands.md": HANDS });
  const calls = [],
    judge = judgeBy({ "lessons/hands.md": 0.9 }, calls);
  await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  const again = await lessonsFor([note("a", "tay lệch")], { dir, cache, judge });
  assert.deepEqual(
    again.get("a").picks.map((p) => p.path),
    ["lessons/hands.md"],
  );
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
