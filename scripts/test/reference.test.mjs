import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mediaPython } from "../media/home.mjs";

const cli = fileURLToPath(new URL("../review/reference.mjs", import.meta.url));
const run = (cwd, args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 30000 });
const reportFile = (result) => result.stdout.match(/next: read (.+?) and /)?.[1];

test("reference help and usage failures do no analysis or writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-cli-"));
  try {
    expect(run(dir, ["--help"]).status).toBe(0);
    for (const args of [
      [],
      ["study"],
      ["compare", "a.mp4"],
      ["study", "missing.mp4"],
      ["study", "a.mp4", "--minutes", "0"],
      ["study", "a.mp4", "--typo"],
    ]) {
      expect(run(dir, args).status).toBe(2);
    }
    expect(existsSync(join(dir, "renders"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference studies a real cut and compares with reference first without claiming a quality pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-real-"));
  try {
    const video = join(dir, "clip with spaces.mkv");
    const ff = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=black:s=128x72:r=30:d=2,drawbox=color=white:t=fill:enable='gte(t,1)'",
        "-c:v",
        "ffv1",
        video,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(ff.status, ff.stderr).toBe(0);
    const study = run(dir, ["study", video]);
    expect(study.status, study.stdout + study.stderr).toBe(0);
    const studied = JSON.parse(readFileSync(reportFile(study), "utf8"));
    expect(studied.picture.cuts).toEqual([{ at: 1, frame: 30 }]);
    expect(study.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/^next: /);
    const again = run(dir, ["study", video]);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    expect(reportFile(again)).not.toBe(reportFile(study));
    expect(existsSync(reportFile(study))).toBe(true);

    const out = join(dir, "comparison output");
    const pattern = join(dir, "pattern.mkv");
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=30:d=4", "-c:v", "ffv1", pattern],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const compare = run(dir, ["compare", pattern, pattern, "--out", out]);
    expect(compare.status, compare.stdout + compare.stderr).toBe(1);
    const report = JSON.parse(readFileSync(reportFile(compare), "utf8"));
    expect(report.reference).toBe(pattern);
    expect(report.remake).toBe(pattern);
    expect(report.leaks.pictures.length).toBeGreaterThan(0);
    expect(compare.stdout + compare.stderr).toMatch(/not a quality gate/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

// bun run scenes found 0 cuts in a reference with about 30 whip pans: study now follows the camera's motion
test.skipIf(!existsSync(mediaPython("camera")))(
  "reference study measures the camera's motion each frame and marks a whip pan",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "reference-whip-"));
    try {
      const still = join(dir, "texture.png");
      const made = spawnSync(
        "python",
        [
          "-c",
          "import numpy as np, sys\nfrom PIL import Image\nrng = np.random.default_rng(7)\nblocks = rng.integers(0, 255, (45, 80, 3), dtype=np.uint8)\nImage.fromarray(blocks).resize((640, 360), Image.NEAREST).save(sys.argv[1])",
          still,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      expect(made.status, made.stderr).toBe(0);
      // a slow pan of 2 px a frame, a whip of 30 px a frame for frames 30-35, then a hold
      const video = join(dir, "pan.mkv");
      const ff = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-loop",
          "1",
          "-framerate",
          "30",
          "-i",
          still,
          "-vf",
          "crop=320:180:x='if(lt(n,30),n*2,if(lt(n,36),58+(n-29)*30,238))':y=60",
          "-frames:v",
          "60",
          "-c:v",
          "ffv1",
          video,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(ff.status, ff.stderr).toBe(0);
      const study = run(dir, ["study", video]);
      expect(study.status, study.stdout + study.stderr).toBe(0);
      const studied = JSON.parse(readFileSync(reportFile(study), "utf8"));
      const { frames, whips } = studied.motion;
      expect(frames[10].dx).toBeCloseTo(-2 / 320, 3);
      expect(Math.abs(frames[10].dy)).toBeLessThan(0.002);
      expect(frames[33].dx).toBeCloseTo(-30 / 320, 2);
      expect(frames[45].dx).toBeCloseTo(0, 3);
      expect(whips).toEqual([{ from: 1, to: 1.2, camera: "pans right", lostFrames: 0 }]);
      const md = readFileSync(reportFile(study).replace(/json$/, "md"), "utf8");
      expect(md).toMatch(/## Whips \(1\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000,
);

test("failed analysis never recommends a previous report and each completed run keeps its own evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-fresh-"));
  try {
    const out = join(dir, "reports");
    mkdirSync(out);
    writeFileSync(join(out, "study.json"), '{"old_report":true}');
    writeFileSync(join(out, "study.md"), "old report");
    const bad = join(dir, "bad.mp4");
    writeFileSync(bad, "not a video");
    const result = run(dir, ["study", bad, "--out", out]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/next: read/);
    expect(result.stdout).toMatch(/next: fix/);
    expect(readFileSync(join(out, "study.json"), "utf8")).toBe('{"old_report":true}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
