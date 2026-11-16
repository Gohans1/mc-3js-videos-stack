// src/lesson-template.ts: a new lesson file starts in the shape Jev finds files by (lessons.mjs: its path, its "when:"
// frontmatter line and its headings), with the rule's heading picked so the creator's first words replace it
import assert from "node:assert/strict";
import { test } from "node:test";

import { lessonTemplate } from "../src/lesson-template.ts";
import { mdHeads } from "../src/md-heads.ts";

test("a new lesson file has a when: line, the topic as its title and one rule heading, as Jev reads them", () => {
  const { text } = lessonTemplate("craft/walk-cycle.md");
  const { front, heads } = mdHeads(text);
  assert.deepEqual(front, ["when: walk cycle"]);
  assert.deepEqual(
    heads.map((h) => [h.depth, h.head]),
    [
      [1, "# Walk cycle"],
      [2, "## A rule, said as one line"],
    ],
  );
});

test("the rule's heading words are picked, so typing replaces them", () => {
  const { text, pick } = lessonTemplate("doors.md");
  assert.equal(text.slice(pick[0], pick[1]), "A rule, said as one line");
});
