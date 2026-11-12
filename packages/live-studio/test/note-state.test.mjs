// src/note-state.mjs: what each side may do to a note, and where that leaves it
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyChange, noteState, noteThread } from "../src/note-state.mjs";

const note = (extra = {}) => ({ id: "a", text: "the door slam is late", ...extra });

test("a fix from the AI waits for the creator's check, and only the check closes it", () => {
  const n = note();
  assert.equal(noteState(n), "open");
  assert.deepEqual(applyChange(n, { fix: { what: "slam 0.3 s earlier" } }, "t1"), { ok: true });
  assert.equal(noteState(n), "check");
  assert.equal(n.done, true, "scripts that only know done leave it alone while it waits");
  assert.deepEqual(applyChange(n, { approve: true }, "t2"), { ok: true });
  assert.equal(noteState(n), "done");
  assert.equal(n.approved, "t2");
});

test("approving a note nobody has answered yet is refused with the reason", () => {
  const n = note();
  const r = applyChange(n, { approve: true }, "t1");
  assert.equal(r.ok, false);
  assert.match(r.why, /nothing to approve/);
  assert.equal(noteState(n), "open");
});

test("needs work: the creator's words join the thread and the note is the AI's again, its first words kept", () => {
  const n = note();
  applyChange(n, { fix: { what: "slam 0.3 s earlier" } }, "t1");
  applyChange(n, { again: "better, still a hair late" }, "t2");
  assert.equal(noteState(n), "open");
  assert.equal(n.done, false);
  assert.equal(n.text, "the door slam is late");
  assert.deepEqual(
    noteThread(n).map((m) => [m.by, m.text]),
    [
      ["creator", "the door slam is late"],
      ["ai", "slam 0.3 s earlier"],
      ["creator", "better, still a hair late"],
    ],
  );
});

test("a question from the AI waits for the creator's answer, which cannot be an approval", () => {
  const n = note();
  applyChange(n, { fix: { what: "the iron door or the wooden one?", ask: true } }, "t1");
  assert.equal(noteState(n), "check");
  assert.equal(applyChange(n, { approve: true }, "t2").ok, false);
  applyChange(n, { again: "the iron one" }, "t3");
  assert.equal(noteState(n), "open");
});

test("a note the creator closed takes no answer from the AI until they reopen it", () => {
  const n = note({ done: true, fixes: [{ what: "slam 0.3 s earlier", at: "t0" }] });
  const r = applyChange(n, { fix: { what: "slam louder too" } }, "t1");
  assert.equal(r.ok, false);
  assert.match(r.why, /done/);
  assert.equal(n.fixes.length, 1);
  assert.deepEqual(
    applyChange(n, { done: true }, "t2"),
    { ok: true },
    "an old script marking it done again changes nothing",
  );
  assert.equal(n.fixes.length, 1);
  applyChange(n, { done: false }, "t3");
  assert.equal(applyChange(n, { fix: { what: "slam louder too" } }, "t4").ok, true);
});

test("notes written before states keep their meaning", () => {
  assert.equal(noteState(note({ done: true, fixes: [{ what: "x" }] })), "done");
  assert.equal(noteState(note({ done: false })), "open");
  const old = note({ done: true });
  applyChange(old, { done: false }, "t1");
  assert.equal(noteState(old), "open", "Reopen from a page loaded before states");
});

test("remember is the creator's to ask and the AI's to answer with what it kept and where", () => {
  const n = note();
  assert.match(applyChange(n, { learned: { what: "x" } }, "t0").why, /never asked/);
  applyChange(n, { remember: "all" }, "t1");
  assert.deepEqual(n.remember, { scope: "all", at: "t1" });
  applyChange(n, { learned: { what: "slams land on the frame the door shuts: check.mjs" } }, "t2");
  assert.equal(n.learned.what, "slams land on the frame the door shuts: check.mjs");
  applyChange(n, { remember: null }, "t3");
  assert.equal(n.remember, undefined);
});

test("changed words reopen the note and keep the old ones on record", () => {
  const n = note({ state: "done", done: true });
  applyChange(n, { text: "the slam AND the creak are late" }, "t1");
  assert.equal(noteState(n), "open");
  assert.deepEqual(n.edits, [{ at: "t1", was: "the door slam is late" }]);
});

test("a change the machine does not know is refused, not guessed at", () => {
  assert.equal(applyChange(note(), { frobnicate: 1 }, "t1").ok, false);
});
