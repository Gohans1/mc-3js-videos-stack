import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../media/ocr.py", import.meta.url));
const python = (args) => spawnSync("python", args, { encoding: "utf8", timeout: 15_000 });

test("OCR sample times cover a source range and explicit source seconds stay exact", () => {
  const result = python([
    "-c",
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps([m['frame_times'](10,20,2,[],30),m['frame_times'](0,None,3,[12.5,1,12.5],30)]))",
    SCRIPT,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [12.5, 17.5],
    [1, 12.5],
  ]);
});

test("OCR rejects impossible source times and bad options before writing evidence", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-ocr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "test.png");
  writeFileSync(source, "not decoded for invalid arguments");
  for (const args of [
    [source, "--frames", "0"],
    [source, "--at", "nan"],
    [source, "--score", "1.1"],
    [source, "--at", "1"],
    [source, "--bogus"],
    [source, "--crop", "0,0.7,1,0.5"],
    [source, "--crop", "0,0.7,1"],
  ]) {
    const r = python([SCRIPT, ...args, "--out", join(dir, "out")]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /error:/);
    assert.equal(existsSync(join(dir, "out")), false);
  }
});

test("OCR dry run does not override a native config's score unless explicitly requested", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "image.png"),
    config = join(dir, "config.yaml");
  writeFileSync(source, "not decoded by dry run");
  writeFileSync(config, "Global:\n  text_score: 0.9\n");
  const r = python([SCRIPT, source, "--config", config, "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).scoreThreshold, null);
});

test("OCR keeps a --crop band in its plan, as fractions of the picture", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-crop-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "image.png");
  writeFileSync(source, "not decoded by dry run");
  const r = python([SCRIPT, source, "--crop", "0,0.7,1,0.2", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).crop, [0, 0.7, 1, 0.2]);
});

test("a --crop band's offset is in the picture as shown: a phone video's rotation turns its coded size", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-rotated-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const coded = join(dir, "coded.mp4"),
    rotated = join(dir, "rotated.mp4");
  for (const args of [
    ["-f", "lavfi", "-i", "color=red:s=160x90:d=0.2", "-pix_fmt", "yuv420p", coded],
    ["-display_rotation", "90", "-i", coded, "-c", "copy", rotated],
  ]) {
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(made.status, 0, made.stderr);
  }
  const origin = (file) => {
    const r = python([
      "-c",
      "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['crop_origin'](sys.argv[2],[0.5,0.75,0.5,0.25])))",
      SCRIPT,
      file,
    ]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(origin(coded), [80, 67]);
  // shown 90 wide and 160 tall
  assert.deepEqual(origin(rotated), [45, 120]);
});
