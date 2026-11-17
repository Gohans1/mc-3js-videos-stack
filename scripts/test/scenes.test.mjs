import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
