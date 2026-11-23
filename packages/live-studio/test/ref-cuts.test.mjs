import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  cutItems,
  latestStudy,
  refCutsWarning,
  referenceCopy,
  referenceVideo,
  unstudiedWarning,
} from "../src/ref-cuts.mjs";

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
  const warning = refCutsWarning(dir, "src/timeline/shots/cam.json", [2.62, 4.05], 10);
  assert.match(
    warning,
    /^⚠ src\/timeline\/shots\/cam\.json cuts at 2\.62 s, where the reference does not cut/,
  );
  assert.match(warning, /the reference cuts at 5\.84 s and the camera does not/);
  assert.doesNotMatch(warning, /30\.43/, "past the film's last camera key is not built yet");
  assert.match(warning, /renders\/reference\/ref\/run-1\/study\.json/);
});

test("a camera cut inside a reference whip, and a reference cut inside its own whip, are looks", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  const file = study(dir, "ref", "run-1", [cut(5.839)], new Date());
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.motion = {
    whips: [
      { from: 2.536, to: 3.07, camera: "pulls out" },
      { from: 5.706, to: 5.873, camera: "pans right", cut: 5.839 },
    ],
  };
  writeFileSync(file, JSON.stringify(data));
  const warning = refCutsWarning(dir, "src/timeline/cam.json", [2.62], 10);
  assert.match(
    warning,
    /cuts inside the reference's whips at 2\.62 s \(pulls out 2\.54-3\.07\), where/,
  );
  assert.match(
    warning,
    /the reference cuts inside its own whips at 5\.84 s \(pans right 5\.71-5\.87\) and/,
  );
  assert.doesNotMatch(warning, /where the reference does not cut/);
});

test("cuts within a frame and a half of the reference's pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  study(dir, "ref", "run-1", [cut(4.071), cut(5.839)], new Date());
  assert.equal(refCutsWarning(dir, "src/timeline/cam.json", [4.05, 5.86], 10), "");
});

test("no study, no warning", () => {
  assert.equal(
    refCutsWarning(mkdtempSync(join(tmpdir(), "ref-cuts-")), "src/timeline/cam.json", [2.62], 10),
    "",
  );
});

test("a reference with no study is named, since the cut check and the coverage are silent without one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  assert.equal(unstudiedWarning(dir), "");
  mkdirSync(join(dir, "references"));
  writeFileSync(join(dir, "references/ref.mp4"), "");
  writeFileSync(join(dir, "references/vox.wav"), "");
  assert.equal(
    unstudiedWarning(dir),
    "⚠ references/ref.mp4 has no study, so check can neither match its cuts nor count coverage: bun run reference study references/ref.mp4",
  );
  study(dir, "ref", "run-1", [cut(1)], new Date());
  assert.equal(unstudiedWarning(dir), "");
});

test("the film's reference video is the one its newest study measured, else ref.*, never a download", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  assert.equal(referenceVideo(dir), null);
  mkdirSync(join(dir, "references"));
  writeFileSync(join(dir, "references/orig.mp4"), "");
  assert.equal(referenceVideo(dir), null);
  for (const f of ["ref.mp4", "clip-source.mp4", "vox.wav"])
    writeFileSync(join(dir, "references", f), "");
  assert.equal(referenceVideo(dir), "references/ref.mp4");
  study(dir, "orig", "run-1", [cut(1)], new Date());
  assert.equal(referenceVideo(dir), "references/orig.mp4");
});

test("a sound file that is a reference's own audio, byte for byte, is named by the reference file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ref-cuts-"));
  mkdirSync(join(dir, "references"));
  mkdirSync(join(dir, "sound"));
  writeFileSync(join(dir, "references/vox.wav"), "RIFF voice");
  writeFileSync(join(dir, "sound/ref-vox.wav"), "RIFF voice");
  writeFileSync(join(dir, "sound/door.wav"), "RIFF door!");
  assert.equal(referenceCopy(dir, join(dir, "sound/ref-vox.wav")), "references/vox.wav");
  assert.equal(referenceCopy(dir, join(dir, "sound/door.wav")), null, "same size, other bytes");
  assert.equal(
    referenceCopy(join(dir, "sound"), join(dir, "sound/door.wav")),
    null,
    "no references/",
  );
});

test("cuts are matched to the reference's, and one inside a whip of it is a look, not a fault", () => {
  const study = {
    fps: 30,
    cuts: [3, 7, 9, 20],
    whips: [
      { from: 4.9, to: 5.1, camera: "pans right" },
      { from: 6.9, to: 7.1, camera: "pans left", cut: 7 },
    ],
  };
  const items = cutItems(study, [2, 3.01, 5], 12);
  const at = (t) => items.find((x) => Math.abs(x.from - t) < 1e-9);
  assert.equal(at(2).kind, "extra cut");
  assert.equal(at(9).kind, "missing cut");
  assert.equal(at(5).kind, "cut in a whip");
  assert.match(at(5).say, /pans right 4\.9-5\.1/);
  assert.equal(at(7).kind, "cut in a whip");
  assert.equal(at(3), undefined, "within a frame and a half");
  assert.equal(at(20), undefined, "past the draft's end");
  assert.ok(at(2).weight > at(9).weight && at(9).weight > at(5).weight);
});
