import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mediaFixture } from "./media-fixture.mjs";

const make = mediaFixture();

test("generated media copies stay independent and respect both recipe and output format", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const red = ["-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1"];
  const first = join(dir, "first.png");
  make(first, red);
  const original = readFileSync(first);
  writeFileSync(first, "changed by one test");
  const second = join(dir, "second.png");
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = dir;
    make(second, red);
  } finally {
    process.env.PATH = oldPath;
  }
  assert.deepEqual(readFileSync(second), original);
  assert.equal(readFileSync(first, "utf8"), "changed by one test");

  const blue = join(dir, "blue.png");
  make(
    blue,
    red.map((arg) => arg.replace("color=red", "color=blue")),
  );
  assert.notDeepEqual(readFileSync(blue), original);
  const bitmap = join(dir, "red.bmp");
  make(bitmap, red);
  assert.equal(readFileSync(bitmap).subarray(0, 2).toString(), "BM");
});
