// notes_report.py, what the AI reads before acting: notes come in the order the creator wrote them, since a later note
// often builds on or takes back an earlier one, and film order would hide that
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PY_REPORT = join(dirname(fileURLToPath(import.meta.url)), "../notes_report.py");
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
const pyReport = (dir, ...args) =>
  execFileSync("python", [PY_REPORT, ...args], { cwd: dir, encoding: "utf8" });
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

test("notes.mjs matches notes_report.py across pins, marks, --shot, --done, --cam and worked-out voice/beats", () => {
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
  for (const args of [
    [],
    ["--done"],
    ["--done", "--shot", "2", "--cam"],
    ["n2", "n1", "--cam"],
    ["n3", "--shot", "3"],
  ]) {
    assert.equal(
      report(dir, ...args),
      pyReport(dir, ...args).replaceAll("\r\n", "\n"),
      `mismatch for args: ${args.join(" ")}`,
    );
  }
});
