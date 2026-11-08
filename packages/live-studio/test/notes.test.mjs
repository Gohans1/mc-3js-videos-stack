// src/notes.mjs: a note keeps every picture sent with it, a retry is not a second note, and × can be undone
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createNotes } from "../src/notes.mjs";

const pic = (s) => `data:image/jpeg;base64,${Buffer.from(s).toString("base64")}`;
const sent = () => ({
  note: { id: "abc1", t: 20, time: "00:20.000", shot: 2, text: "two moments", done: true, fixes: [{ what: "forged" }], marks: [{ kind: "pen", t: 20, pts: [[0.1, 0.1]] }, { kind: "pen", t: 23, pts: [[0.2, 0.2]] }] },
  img: pic("main"), crop: pic("crop"), strip: pic("strip"), frames: [{ t: 20, img: pic("f20") }, { t: 23, img: pic("f23") }],
});

test("a note keeps its frame, the pin's close-up, the seconds around it and one picture per drawn moment", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const notes = createNotes(dir);
    notes.add(sent(), { version: "v1" });
    const [n] = notes.read();
    assert.equal(n.img, "notes/img/abc1.jpg");
    assert.equal(n.crop, "notes/img/abc1_crop.jpg");
    assert.equal(n.strip, "notes/img/abc1_strip.jpg");
    assert.deepEqual(n.frames, [{ t: 20, img: "notes/img/abc1_f0.jpg" }, { t: 23, img: "notes/img/abc1_f1.jpg" }]);
    for (const [file, words] of [["abc1", "main"], ["abc1_crop", "crop"], ["abc1_strip", "strip"], ["abc1_f0", "f20"], ["abc1_f1", "f23"]]) {
      assert.equal(readFileSync(join(dir, "notes/img", `${file}.jpg`), "utf8"), words);
      assert.equal(notes.picture(file).toString(), words);
    }
    assert.equal(n.marks.length, 2);
    assert.equal(n.version, "v1");
    assert.equal(n.done, undefined, "what was done to a note is the server's to say");
    assert.equal(n.fixes, undefined);

    notes.add(sent(), { version: "v1" });
    assert.equal(notes.read().length, 1, "a retry after a lost answer isn't a second note");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("× moves a note aside and undo brings it back with the words it had", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const notes = createNotes(dir);
    notes.add(sent(), {});
    notes.change("abc1", { remove: true });
    assert.equal(notes.read().length, 0);
    assert.ok(existsSync(join(dir, "notes/deleted.jsonl")));
    notes.change("abc1", { restore: true, text: "two moments, edited" });
    const [n] = notes.read();
    assert.equal(n.text, "two moments, edited");
    assert.equal(n.img, "notes/img/abc1.jpg");
    assert.equal(readFileSync(join(dir, "notes/deleted.jsonl"), "utf8"), "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
