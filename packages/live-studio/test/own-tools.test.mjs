// bun run check: a film's own scripts are commands the repo lacked, and bun run gap is how the next AI learns of them
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ownToolsWarning } from "../src/own-tools.mjs";

const film = (files) => {
  const dir = join(mkdtempSync(join(tmpdir(), "own-tools-")), "food");
  for (const f of ["src/scene.ts", "sound.py", "vite.config.ts", ...files]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  return dir;
};
const gaps = (dir, films) => {
  const file = join(dir, "..", "gaps.jsonl");
  writeFileSync(
    file,
    films
      .map((f) => JSON.stringify({ at: "2026-11-21", need: "n", did: "d", film: f }) + "\n")
      .join(""),
  );
  return file;
};

test("a film with the template's files only gets no warning", () => {
  const dir = film([]);
  assert.equal(ownToolsWarning(dir, gaps(dir, [])), "");
});

test("tools/ and loose scripts the film made are named when fewer gaps came from it", () => {
  const dir = film([
    "tools/compare.py",
    "tools/mm/solve.py",
    "tools/.venv/x",
    "tools/__pycache__/compare.cpython-313.pyc",
    "refstrip.sh",
  ]);
  const warning = ownToolsWarning(dir, gaps(dir, ["food", "other"]));
  assert.match(
    warning,
    /^⚠ the film runs 3 tools of its own \(refstrip\.sh, tools\/compare\.py, tools\/mm\)/,
  );
  assert.match(warning, /bun run gap holds 1 from it/);
  assert.match(warning, /bun run gap "<what you needed>" --did "<the tool>"/);
});

test("once each tool has a gap logged from the film, check is quiet", () => {
  const dir = film(["tools/compare.py"]);
  assert.equal(ownToolsWarning(dir, gaps(dir, ["food"])), "");
});
