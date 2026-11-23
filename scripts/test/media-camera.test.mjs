import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mediaPython } from "../media/home.mjs";
import { cameraAt, FPS, markerFrames, markerVideo, tableShot, testVideo } from "./pinhole.mjs";

const worker = fileURLToPath(new URL("../media/camera.py", import.meta.url));

test.skipIf(!existsSync(mediaPython("camera")))(
  "camera solve recovers a known camera path and lens from surveyed points, with reprojection error",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "camera-solve-"));
    try {
      const video = join(dir, "ref.mkv");
      const made = spawnSync("ffmpeg", [...testVideo, video], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(made.status, made.stderr).toBe(0);
      const shot = tableShot();
      writeFileSync(join(dir, "shot.json"), JSON.stringify(shot));
      const out = join(dir, "out");
      const run = spawnSync(
        mediaPython("camera"),
        ["-B", worker, "solve", video, "--shot", join(dir, "shot.json"), "--out", out],
        { encoding: "utf8", timeout: 120000 },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const report = JSON.parse(readFileSync(join(out, "solve.json"), "utf8"));
      expect(report.fov).toBeCloseTo(40, 0);
      expect(report.summary.solved).toBe(13);
      expect(report.frames.find((r) => r.frame === 6).err).toBeLessThan(0.5);
      const key = report.keys.find((k) => k.t === +(6 / FPS).toFixed(4));
      expect(key.p[0]).toBeCloseTo(cameraAt(6).c[0], 1);
      expect(key.p[1]).toBeCloseTo(1.6, 1);
      expect(key.p[2]).toBeCloseTo(-2.5, 1);
      expect(report.keys[0]).toMatchObject({ t: 0, cut: true, id: "mm-table-0", ease: "linear" });
      expect(existsSync(join(out, "sheet.jpg"))).toBe(true);
      expect(run.stdout).toMatch(/table: lens 40\.\d+ deg, 13 of 13 frames solved/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  150000,
);

test.skipIf(!existsSync(mediaPython("camera")))(
  "camera solve follows the points through the frames between two keyed seconds, where a straight line would miss",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "camera-solve-track-"));
    try {
      const video = join(dir, "dots.mkv");
      const made = spawnSync("ffmpeg", [...markerVideo, video], {
        input: markerFrames(0.08),
        encoding: "utf8",
        timeout: 20000,
      });
      expect(made.status, made.stderr).toBe(0);
      writeFileSync(
        join(dir, "shot.json"),
        JSON.stringify(tableShot({ frames: [0, 12], track: true, shake: 0.08 })),
      );
      const out = join(dir, "out");
      const run = spawnSync(
        mediaPython("camera"),
        ["-B", worker, "solve", video, "--shot", join(dir, "shot.json"), "--out", out],
        { encoding: "utf8", timeout: 120000 },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const report = JSON.parse(readFileSync(join(out, "solve.json"), "utf8"));
      expect(report.summary.solved).toBe(13);
      const off = report.keys.map((k, frame) =>
        Math.hypot(...k.p.map((v, i) => v - cameraAt(frame, 0.08).c[i])),
      );
      expect(Math.max(...off)).toBeLessThan(0.01);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  150000,
);

test.skipIf(!existsSync(mediaPython("camera")))(
  "camera solve refuses a shot file without points before reading the video",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "camera-solve-bad-"));
    try {
      writeFileSync(join(dir, "v.mp4"), "x");
      writeFileSync(join(dir, "shot.json"), JSON.stringify({ name: "a", from: 0, to: 1 }));
      const run = spawnSync(
        mediaPython("camera"),
        ["-B", worker, "solve", join(dir, "v.mp4"), "--shot", join(dir, "shot.json"), "--dry-run"],
        { encoding: "utf8", timeout: 30000 },
      );
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/lacks points/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
