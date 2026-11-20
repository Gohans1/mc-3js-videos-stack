// A remake said "polish later" for hours while 0 of the reference's sounds had a cue: bun run check now counts how much
// of the reference the film has matched, per track, so a goal or a stop hook can read it
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatCoverage, refCoverage } from "../src/ref-coverage.mjs";

const film = () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-coverage-"));
  const folder = join(dir, "renders/reference/ref/run-1");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "study.json"),
    JSON.stringify({
      fps: 30,
      duration: 20,
      picture: { cuts: [{ at: 4 }, { at: 8 }, { at: 15 }] },
      sound: { hits: [{ at: 1 }, { at: 2 }, { at: 5 }, { at: 12 }] },
    }),
  );
  return dir;
};

test("each track's share of the reference: picture keyed, cuts and sound hits matched, on-screen text", () => {
  const c = refCoverage(film(), {
    cameraUntil: 10,
    cameraCuts: [4.02, 9],
    sfx: [0.95, 2.3, 12.05],
    text: [
      [0, 3],
      [2, 5],
      [18, 25],
    ],
  });
  assert.deepEqual(c, {
    study: "renders/reference/ref/run-1/study.json",
    seconds: 20,
    picture: { seconds: 10, share: 0.5 },
    cuts: { matched: 1, of: 3 },
    sounds: { matched: 2, of: 4 },
    text: { seconds: 7, share: 0.35 },
  });
  assert.equal(
    formatCoverage(c),
    "coverage of the reference (renders/reference/ref/run-1/study.json, 20 s): picture keyed 10 s (50%), cuts 1 of 3, sound hits with an sfx 2 of 4 (50%), on-screen text 7 s (35%)",
  );
});

test("no study, no coverage", () => {
  assert.equal(
    refCoverage(mkdtempSync(join(tmpdir(), "ref-coverage-")), {
      cameraUntil: 1,
      cameraCuts: [],
      sfx: [],
      text: [],
    }),
    null,
  );
});
