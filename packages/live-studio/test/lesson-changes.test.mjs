// app/lessons/changes.ts: what changed in a lesson file since the creator last read it, as md-phone shows a review
import assert from "node:assert/strict";
import { test } from "node:test";

import { lessonChanges } from "../app/lessons/changes.ts";

const lines = (n, at = {}) =>
  Array.from({ length: n }, (_, i) => at[i + 1] ?? `line ${i + 1}`).join("\n");

test("a changed line shows what was there and what is now, the changed words marked, with two lines around it", () => {
  const before = lines(10, { 5: "## Feet stay on the ground" }),
    after = lines(10, { 5: "## Feet stay planted on the ground" });
  const { hunks, added, removed } = lessonChanges(before, after);
  assert.deepEqual([added, removed], [1, 1]);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].line, 3);
  assert.deepEqual(
    hunks[0].rows.map((r) => [r.kind, r.text]),
    [
      ["same", "line 3"],
      ["same", "line 4"],
      ["removed", "## Feet stay on the ground"],
      ["added", "## Feet stay planted on the ground"],
      ["same", "line 6"],
      ["same", "line 7"],
    ],
  );
  assert.deepEqual(
    hunks[0].rows[3].parts.filter((p) => p.changed).map((p) => p.text.trim()),
    ["planted"],
  );
});

test("changes far apart are separate places to go to; nothing changed is no hunk", () => {
  const before = lines(30),
    after = lines(30, { 2: "first fix", 28: "second fix" });
  assert.deepEqual(
    lessonChanges(before, after).hunks.map((h) => h.line),
    [1, 26],
  );
  assert.deepEqual(lessonChanges(before, before), { hunks: [], added: 0, removed: 0 });
});

test("a line rewritten beyond recognition is shown replaced whole, not as a scatter of words", () => {
  const { hunks } = lessonChanges("a\nthe camera never rolls\nb", "a\nvoices sit at -16 LUFS\nb");
  assert.equal(hunks[0].rows.find((r) => r.kind === "added").parts, undefined);
});
