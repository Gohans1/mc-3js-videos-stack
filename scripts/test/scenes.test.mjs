import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const SCRIPT = fileURLToPath(new URL("../review/scenes.py", import.meta.url));
const python = (args, options = {}) =>
  spawnSync("python", args, { encoding: "utf8", timeout: 10_000, ...options });
const load = "import runpy,sys; m=runpy.run_path(sys.argv[1]); ";

test("scene CSV uses zero-based half-open frames and retains source-file seconds for a range", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scenes-csv-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const csv = join(dir, "scenes.csv");
  writeFileSync(
    csv,
    "Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)\n1,31,00:00:01.000,1.000,60,00:00:02.000,2.000,30,00:00:01.000,1.000\n2,61,00:00:02.000,2.000,90,00:00:03.000,3.000,30,00:00:01.000,1.000\n",
  );
  const r = python([
    "-c",
    load + "import json; print(json.dumps(m['read_scenes'](sys.argv[2])))",
    SCRIPT,
    csv,
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { scene: 1, startFrame: 30, endFrame: 60, startSeconds: 1, endSeconds: 2 },
    { scene: 2, startFrame: 60, endFrame: 90, startSeconds: 2, endSeconds: 3 },
  ]);
});

test("invalid ranges and a missing video fail before creating output", { timeout: 30_000 }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scenes-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "source.mp4");
  writeFileSync(file, "not decoded for an invalid range");
  for (const [args, message] of [
    [[file, "--from", "2", "--to", "1"], /--to must be after --from/],
    [[file, "--minutes", "nan"], /finite number/],
    [[file, "--method", "content", "--threshold", "256"], /--threshold.*255/],
    [[file, "--method", "threshold", "--threshold", "256"], /--threshold.*255/],
    [[file, "--threshold", "nan"], /--threshold.*finite/],
    [[file, "--thresh", "0.1"], /unrecognized arguments/],
    [[join(dir, "missing.mp4")], /not a local file/],
  ]) {
    const r = python([SCRIPT, ...args, "--out", join(dir, "out")]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(existsSync(join(dir, "out")), false);
  }
});

test("an upstream zero-frame boundary at the start is not a scene; native scene numbers stay tied to image names", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scenes-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const csv = join(dir, "scenes.csv");
  writeFileSync(
    csv,
    "Scene Number,Start Frame,End Frame,Start Time (seconds),End Time (seconds)\n1,1,0,0,0\n2,1,120,0,4\n",
  );
  const r = python([
    "-c",
    load + "import json; print(json.dumps(m['read_scenes'](sys.argv[2])))",
    SCRIPT,
    csv,
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { scene: 2, startFrame: 0, endFrame: 120, startSeconds: 0, endSeconds: 4 },
  ]);
});

test(
  "a bounded VFR gallery uses actual frame indices and keeps each image on its side of a cut",
  { timeout: 30_000 },
  (t) => {
    const localPython = fileURLToPath(
      new URL(
        process.platform === "win32" ? "../../.venv/Scripts/python.exe" : "../../.venv/bin/python",
        import.meta.url,
      ),
    );
    const detector =
      process.env.SCENEDETECT_PYTHON ?? (existsSync(localPython) ? localPython : "python");
    if (spawnSync(detector, ["-c", "import scenedetect"], { timeout: 10_000 }).status !== 0) {
      t.skip("optional PySceneDetect is unavailable");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "scenes-gallery-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const video = join(dir, "VFR gallery.mkv");
    const ffmpeg = (args) => spawnSync("ffmpeg", ["-v", "error", ...args], { timeout: 10_000 });
    const render = ffmpeg([
      ...["yellow", "cyan", "white", "black"].flatMap((color) => [
        "-f",
        "lavfi",
        "-i",
        "color=" + color + ":s=192x108:r=25:d=1",
      ]),
      "-filter_complex",
      "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,select='not(between(t,1.6,2.63))'[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-g",
      "100",
      "-bf",
      "3",
      "-fps_mode",
      "vfr",
      video,
    ]);
    assert.equal(render.status, 0, render.stderr.toString());
    const output = join(dir, "t\u1ea3i l\u00ean \ud83c\udfac");
    const inspect = python(
      [
        SCRIPT,
        video,
        "--method",
        "content",
        "--threshold",
        "5",
        "--min-scene",
        "0.05",
        "--from",
        "1.1",
        "--to",
        "2.641",
        "--out",
        output,
      ],
      { env: { ...process.env, PYTHONUTF8: "0", PYTHONIOENCODING: "cp1252" } },
    );
    assert.equal(inspect.status, 0, inspect.stdout + inspect.stderr);
    const run = join(output, readdirSync(output)[0]);
    const report = JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
    assert.deepEqual(report.cutsSeconds, [2.64]);
    const [before, after] = report.scenes;
    assert.equal(before.endFrame, 41);
    assert.equal(after.startFrame, 41);
    for (const [scene, redMinimum] of [
      [before, false],
      [after, true],
    ]) {
      assert.ok(scene.images.length);
      for (const image of scene.images) {
        assert.ok(image.sourceTime >= scene.startSeconds && image.sourceTime < scene.endSeconds);
        assert.ok(image.requestedTime >= 1.1 && image.requestedTime < 2.641);
        const pixels = ffmpeg([
          "-i",
          join(run, image.file),
          "-vf",
          "scale=1:1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ]);
        assert.equal(pixels.status, 0, pixels.stderr.toString());
        const [red, green, blue] = pixels.stdout;
        assert.equal(red > 230, redMinimum);
        assert.ok(green > 230 && blue > 230);
      }
    }
  },
);

test(
  "a truncated picture fails scene detection and keeps the source diagnostic",
  { timeout: 30_000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "scenes-truncated-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const video = join(dir, "partial.mp4");
    mediaFixture()(video, [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x90:r=25:d=5",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
    ]);
    const full = readFileSync(video);
    writeFileSync(video, full.subarray(0, Math.floor(full.length * 0.66)));
    const out = join(dir, "out");
    const inspect = python([SCRIPT, video, "--out", out, "--no-images"]);
    assert.equal(inspect.status, 1, inspect.stdout + inspect.stderr);
    const report = JSON.parse(readFileSync(join(out, readdirSync(out)[0], "result.json"), "utf8"));
    assert.equal(report.status, "failed");
    assert.match(report.error, /source picture validation/);
    assert.equal(report.cutsSeconds, undefined);
  },
);

test(
  "scene detection rejects a corrupt decoded picture with intact packet timestamps",
  { timeout: 30_000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "scenes-packet-valid-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const video = join(dir, "broken frame.mp4");
    const render = mediaFixture();
    const original = join(dir, "source.mp4");
    render(original, [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x240:r=25:d=4",
      "-c:v",
      "libx264",
      "-g",
      "25",
    ]);
    render(video, ["-i", original, "-c", "copy", "-bsf:v", "noise=amount='if(eq(n,40),1000,0)'"]);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "V:0", "-show_entries", "packet=pts", "-of", "csv", video],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stderr, "");
    assert.equal(probe.stdout.trim().split(/\r?\n/).length, 100);
    const out = join(dir, "out");
    const inspect = python([SCRIPT, video, "--out", out, "--no-images"]);
    assert.equal(inspect.status, 1, inspect.stdout + inspect.stderr);
    const report = JSON.parse(readFileSync(join(out, readdirSync(out)[0], "result.json"), "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.stage, "source-decode");
    assert.match(report.error, /source picture validation/);
    assert.equal(report.cutsSeconds, undefined);
  },
);

test("a detector deadline keeps prior log evidence", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scenes-deadline-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "detector.log");
  writeFileSync(log, "earlier evidence\n");
  const code =
    load + "m['run_detector']([sys.executable,'-c','import time; time.sleep(60)'],sys.argv[2],0.5)";
  const r = python(["-c", code, SCRIPT, log]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /TimeoutExpired/);
  assert.match(readFileSync(log, "utf8"), /earlier evidence/);
});
