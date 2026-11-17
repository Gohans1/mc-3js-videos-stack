import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const worker = resolve("scripts/media/tracking.py");
test("tracking rejects invalid sampling and point coordinates without loading models or writing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tracking-validation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source.mp4"),
    out = join(dir, "jobs");
  writeFileSync(source, "original");
  for (const [flags, message] of [
    [["--point", "nan,2"], /finite nonnegative/],
    [["--point=-1,2"], /finite nonnegative/],
    [["--point", "1,2", "--fps", "0"], /positive and finite/],
    [["--point", "1,2", "--frames", "0"], /positive and finite/],
    [["--point", "1,2", "--threads", "0"], /positive and finite/],
    [["--point", "1,2", "--query-frame", "16"], /query-frame must index/],
    [[], /required: --point/],
  ]) {
    const result = spawnSync(
      "python",
      [worker, "tapir", source, ...flags, "--out", out, "--dry-run"],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(existsSync(out), false);
    assert.equal(readFileSync(source, "utf8"), "original");
  }
});

test("sampled frame evidence keeps actual source timestamps across irregular frame intervals", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tracking-pts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "vfr.mkv"),
    out = join(dir, "frames");
  const encode = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x48:rate=10:duration=1",
      "-vf",
      "setpts=if(lt(N\\,5)\\,N\\,N+5)/10/TB",
      "-fps_mode",
      "vfr",
      "-c:v",
      "ffv1",
      source,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(encode.status, 0, encode.stderr);
  const code =
    "import sys,json; from pathlib import Path; sys.path.insert(0,'scripts/media'); from tracking import extract_frames; print(json.dumps(extract_frames(Path(sys.argv[1]),Path(sys.argv[2]),0.3,1.5,5,10)))";
  const result = spawnSync("python", ["-c", code, source, out], {
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.deepEqual(
    rows.map((r) => r.sourceSecond),
    [0.3, 1, 1.2, 1.4],
  );
  for (const row of rows) assert.ok(existsSync(join(out, row.file)));
});
