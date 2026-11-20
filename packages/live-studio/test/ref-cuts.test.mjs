// bun run check: a remake cuts where its reference cuts; a cut the reference lacks shows as a teleport mid-move
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { latestStudy, refCutsWarning } from "../src/ref-cuts.mjs";

const study = (dir, name, run, cuts, when) => {
  const folder = join(dir, "renders/reference", name, run);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "study.json");
  writeFileSync(
    file,
    JSON.stringify({ file: `references/${name}.mp4`, fps: 30, picture: { cuts } }),
  );
  utimesSync(file, when, when);
  return file;
};
const cut = (at) => ({ at, frame: Math.round(at * 30) });

test("the newest study of any reference is the one read", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  assert.equal(latestStudy(dir), null);
  study(dir, "orig", "run-1", [cut(1)], new Date(2026, 0, 1));
  const newest = study(dir, "ref", "run-2", [cut(4.071)], new Date(2026, 0, 2));
  assert.equal(latestStudy(dir)?.file, newest);
});

test("a camera cut away from every reference cut, and a reference cut the camera skips, are named", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  study(dir, "ref", "run-1", [cut(4.071), cut(5.839), cut(30.43)], new Date());
  const warning = refCutsWarning(dir, [2.62, 4.05], 10);
  assert.match(
    warning,
    /^⚠ src\/timeline\/cam\.json cuts at 2\.62 s, where the reference does not cut/,
  );
  assert.match(warning, /the reference cuts at 5\.84 s and the camera does not/);
  assert.doesNotMatch(warning, /30\.43/, "past the film's last camera key is not built yet");
  assert.match(warning, /renders\/reference\/ref\/run-1\/study\.json/);
});

test("cuts within a frame and a half of the reference's pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  study(dir, "ref", "run-1", [cut(4.071), cut(5.839)], new Date());
  assert.equal(refCutsWarning(dir, [4.05, 5.86], 10), "");
});

test("no study, no warning", () => {
  assert.equal(refCutsWarning(mkdtempSync(join(tmpdir(), "ref-cuts-")), [2.62], 10), "");
});
