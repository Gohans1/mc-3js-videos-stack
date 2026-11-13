// bun run notes, what the AI reads before acting: notes come in the order the creator wrote them, since a later note
// often builds on or takes back an earlier one, and film order would hide that
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPORT = join(dirname(fileURLToPath(import.meta.url)), "../notes.mjs");
const note = (id, t, at, extra = {}) => ({
  id,
  t,
  at,
  time: `00:${String(t).padStart(2, "0")}.000`,
  shot: 1,
  text: `note at ${t}`,
  ...extra,
});
const film = (notes) => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    notes.map((n) => JSON.stringify(n) + "\n").join(""),
  );
  return dir;
};
const report = (dir, ...args) =>
  execFileSync("bun", [REPORT, ...args], { cwd: dir, encoding: "utf8" });
const written = [
  note("a", 5, "2026-11-06T10:00:00Z"),
  note("b", 10, "2026-11-06T10:01:00Z"),
  note("c", 8, "2026-11-06T10:02:00Z"),
];

test("the index lists notes in the order they were written, numbered", () => {
  const lines = report(film(written))
    .split("\n")
    .filter((l) => l.startsWith("#"));
  assert.deepEqual(
    lines.map((l) => l.split(" ").slice(0, 2).join(" ")),
    ["#1 a", "#2 b", "#3 c"],
  );
});

test("a note keeps its number once the notes before it are done", () => {
  const dir = film([{ ...written[0], done: true }, written[1], written[2]]);
  const lines = report(dir)
    .split("\n")
    .filter((l) => l.startsWith("#"));
  assert.deepEqual(
    lines.map((l) => l.split(" ")[0]),
    ["#2", "#3"],
  );
});

test("details come in the order written too, with the number", () => {
  const heads = report(film(written), "c", "a", "b")
    .split("\n")
    .filter((l) => l.startsWith("## "));
  assert.deepEqual(
    heads.map((l) => l.split(" ").slice(1, 3).join(" ")),
    ["#1 a", "#2 b", "#3 c"],
  );
});

test("a note's next step finds where it is heard now by its id, since a Speed edit after it moves its second", () => {
  const next = report(film(written), "b")
    .split("\n")
    .find((l) => l.startsWith("next:"));
  assert.match(next, /bun run at b\b/);
  assert.match(next, /bun run note done b /);
});

test("the index says how many fixed notes wait for the creator, and lists what they asked to be remembered with how to answer", () => {
  const dir = film([
    written[0],
    { ...written[1], state: "check", done: true, fixes: [{ what: "x", at: "t" }] },
    { ...written[2], remember: { scope: "film", at: "t" } },
  ]);
  const out = report(dir);
  assert.match(out, /^#1 a /m);
  assert.doesNotMatch(out, /^#2 b /m, "a note waiting for the creator is not the AI's");
  assert.match(out, /1 more wait for the creator's check/);
  assert.match(out, /remember these:.*bun run note learned ID/);
  assert.match(out, /^\[this film\] #3 c /m);
});

test("a note's detail spells out its tap, drawings, the edit around it, its rounds and, with --cam, its camera", () => {
  const rich = [
    note("n1", 4, "2026-11-06T10:00:00Z", {
      shot: 2,
      shotName: "corridor",
      frame: 120,
      done: true,
      pin: { x: 0.25, y: 0.75, what: "torch", world: [1.5, 2, -3] },
      marks: [
        {
          kind: "path",
          ts: [4, 5],
          pts: [
            [0.1, 0.2],
            [0.4, 0.6],
          ],
          hits: [{ what: "floor", world: [0, 0, 0] }, null],
        },
        {
          kind: "box",
          t: 4,
          pts: [
            [0.8, 0.7],
            [0.2, 0.3],
          ],
          hits: [{ what: "door" }],
        },
        {
          kind: "arrow",
          t: 4,
          pts: [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
          hits: [{ what: "steve" }, { what: "lever" }],
        },
      ],
      range: [3.5, 6],
      cam: { line: "{ t: 4, p: [0, 2, 5] }", warn: "free cam" },
      fixes: [{ what: "raised light", checkpoint: "abc1234" }],
      strip: "notes/img/n1_strip.jpg",
      img: "notes/img/n1.jpg",
      crop: "notes/img/n1_crop.jpg",
      frames: [{ t: 4, img: "notes/img/n1_f0.jpg" }],
    }),
    note("n2", 5, "2026-11-06T10:01:00Z", {
      shot: 3,
      text: "move\n  faster",
      fixes: [{ what: "sped up 20%", checkpoint: "abc1", at: "2026-11-06T11:00:00Z" }],
      asks: [{ text: "still slow, 20% more", at: "2026-11-06T12:00:00Z" }],
      remember: { scope: "all", at: "2026-11-06T12:00:01Z" },
    }),
    note("n3", 6, "2026-11-06T10:02:00Z", {
      shot: 3,
      state: "check",
      done: true,
      fixes: [
        { what: "iron or wooden door?", ask: true, checkpoint: "abc1", at: "2026-11-06T11:00:00Z" },
      ],
    }),
  ];
  const dir = film(rich);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      lines: [
        { s: 1, e: 2, text: "Earlier" },
        { s: 4.5, e: 5.5, text: "Right now" },
        { s: 7, e: 8, text: "After" },
      ],
    }),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      beats: { open_door: { title: "Open door", at: 4.8, dur: 1.0, sounds: ["creak"] } },
    }),
  );
  const one = report(dir, "n1", "--cam");
  for (const line of [
    'tap: 25% across, 75% down, on "torch", world [1.5, 2, -3]',
    'drawn: path 4s (10%, 20%) on "floor" world [0, 0, 0] -> 5s (40%, 60%) on "?"',
    'drawn: box at 4s: 20-80% across, 30-70% down, middle (50%, 50%) on "door"',
    'drawn: arrow at 4s: tail (10%, 10%) on "steve", head (90%, 90%) on "lever"',
    "next (today's edit): Right now",
    `action (today's edit): open_door "Open door" 4.8s +1s, sounds creak`,
    "tried: raised light (abc1234)",
    "camera: { t: 4, p: [0, 2, 5] } (free cam)",
  ])
    assert.ok(one.includes(line), `n1 --cam lacks: ${line}\n${one}`);
  assert.ok(!report(dir, "n1").includes("camera:"), "the camera only with --cam");
  const two = report(dir, "n2");
  assert.match(two, /^## #2 n2 00:05\.000 shot 3$/m);
  assert.ok(two.includes("creator answered: still slow, 20% more"));
  assert.ok(two.includes("the creator asked you to remember this (every film)"));
  assert.ok(report(dir, "n3").includes("you asked: iron or wooden door?"));
  assert.match(report(dir, "--done"), /^3 notes of 3,/);
  assert.match(report(dir), /^1 open notes of 3,/);
});
