// src/lesson-files.mjs: the studio's Lessons tab reads and writes the repo's lessons/*.md without writing over the AI's edits
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openLessonFiles } from "../src/lesson-files.mjs";

const shelf = (files) => {
  const dir = join(mkdtempSync(join(tmpdir(), "repo-")), "lessons");
  mkdirSync(join(dir, "craft"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

test("every lesson file is listed by its path with its words, in path order", () => {
  const dir = shelf({ "walk.md": "# Walk\n", "craft/hands.md": "# Hands\n", "notes.txt": "x" });
  assert.deepEqual(
    openLessonFiles(dir)
      .list()
      .map((f) => [f.path, f.text]),
    [
      ["craft/hands.md", "# Hands\n"],
      ["walk.md", "# Walk\n"],
    ],
  );
  assert.deepEqual(openLessonFiles(join(dir, "none")).list(), []);
});

test("a save on the version read writes it; a save on an older one is refused with what is there now", () => {
  const dir = shelf({ "walk.md": "# Walk\n" });
  const files = openLessonFiles(dir),
    [read] = files.list();
  const saved = files.write("walk.md", "# Walk\n\n## Feet stay planted\n", read.tag);
  assert.ok(saved.tag && saved.tag !== read.tag);
  assert.equal(readFileSync(join(dir, "walk.md"), "utf8"), "# Walk\n\n## Feet stay planted\n");
  const late = files.write("walk.md", "# Walk, mine\n", read.tag);
  assert.deepEqual(late, {
    conflict: true,
    tag: saved.tag,
    text: "# Walk\n\n## Feet stay planted\n",
  });
  assert.equal(readFileSync(join(dir, "walk.md"), "utf8"), "# Walk\n\n## Feet stay planted\n");
});

test("a file with a byte-order mark and CRLF lines keeps both, though the page edits plain lines", () => {
  const dir = shelf({ "cam.md": "\uFEFF# Camera\r\nno roll\r\n" });
  const files = openLessonFiles(dir),
    [read] = files.list();
  assert.equal(read.text, "# Camera\nno roll\n");
  files.write("cam.md", "# Camera\nno roll\nno dutch\n", read.tag);
  assert.equal(
    readFileSync(join(dir, "cam.md"), "utf8"),
    "\uFEFF# Camera\r\nno roll\r\nno dutch\r\n",
  );
});

test("a new file is made only where none is, and only inside the lessons folder as .md", () => {
  const dir = shelf({ "walk.md": "# Walk\n" });
  const files = openLessonFiles(dir);
  assert.ok(files.write("craft/light.md", "# Light\n", null).tag);
  assert.equal(readFileSync(join(dir, "craft/light.md"), "utf8"), "# Light\n");
  assert.equal(files.write("walk.md", "# Mine\n", null).conflict, true);
  for (const bad of ["../out.md", "walk.txt", "/etc/x.md", "a/../../b.md", "C:/x.md", ""])
    assert.ok(files.write(bad, "x", null).error, bad);
});

test("edits made outside the studio are told together once they settle; the studio's own save is not", async () => {
  const dir = shelf({ "walk.md": "# Walk\n" });
  const files = openLessonFiles(dir),
    seen = [];
  const stop = files.watch((paths) => seen.push(paths.toSorted()));
  try {
    files.write("walk.md", "# Walk, mine\n", files.list()[0].tag);
    writeFileSync(join(dir, "craft/hands.md"), "# Hands\n");
    writeFileSync(join(dir, "craft/hands.md"), "# Hands\n\n## Grip\n");
    writeFileSync(join(dir, "feet.md"), "# Feet\n");
    for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(seen, [["craft/hands.md", "feet.md"]]);
  } finally {
    stop();
  }
});

test("an edit back to the studio's own save is told; a rewrite of the same words is not", async () => {
  const dir = shelf({ "walk.md": "# Walk\n" });
  const files = openLessonFiles(dir),
    seen = [];
  const stop = files.watch((paths) => seen.push(paths));
  const settle = async (n) => {
    for (let i = 0; i < 40 && seen.length < n; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
  };
  try {
    writeFileSync(join(dir, "walk.md"), "# Walk\n");
    files.write("walk.md", "# Walk, mine\n", files.list()[0].tag);
    await settle(0);
    writeFileSync(join(dir, "walk.md"), "# Walk, the AI's\n");
    await settle(1);
    writeFileSync(join(dir, "walk.md"), "# Walk, mine\n");
    await settle(2);
    writeFileSync(join(dir, "walk.md"), "# Walk, mine\n");
    await settle(0);
    assert.deepEqual(seen, [["walk.md"], ["walk.md"]]);
  } finally {
    stop();
  }
}, 10e3);

test("remove deletes matching lesson files cleanly, guards stale versions, prunes empty dirs, and skips watch echo", async () => {
  const dir = shelf({ "walk.md": "# Walk\n", "craft/hands.md": "# Hands\n" });
  const files = openLessonFiles(dir),
    seen = [];
  const list = files.list(),
    hands = list.find((f) => f.path === "craft/hands.md"),
    walk = list.find((f) => f.path === "walk.md");

  for (const bad of ["../out.md", "walk.txt", "/etc/x.md", ""])
    assert.ok(files.remove(bad, walk.tag).error, bad);

  assert.deepEqual(files.remove("walk.md", "stale"), {
    conflict: true,
    tag: walk.tag,
    text: "# Walk\n",
  });
  assert.equal(existsSync(join(dir, "walk.md")), true);

  const stop = files.watch((paths) => seen.push(paths));
  try {
    assert.deepEqual(files.remove("craft/hands.md", hands.tag), { removed: true });
    assert.equal(existsSync(join(dir, "craft/hands.md")), false);
    assert.equal(existsSync(join(dir, "craft")), false);
    assert.deepEqual(files.remove("craft/hands.md", hands.tag), { removed: false, missing: true });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(seen, []);
  } finally {
    stop();
  }
});

test("watch starts reporting even when the lessons folder is created later by the AI", async () => {
  const root = mkdtempSync(join(tmpdir(), "late-lessons-"));
  const dir = join(root, "lessons");
  const files = openLessonFiles(dir);
  const seen = [];
  const stop = files.watch((paths) => seen.push(paths));
  try {
    assert.deepEqual(files.list(), []);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cam.md"), "# Cam\n");
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !seen.length) await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(seen, [["cam.md"]]);

    const saved = files.write("local.md", "# Local\n", null);
    assert.ok(saved.tag);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(seen, [["cam.md"]]);
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});
