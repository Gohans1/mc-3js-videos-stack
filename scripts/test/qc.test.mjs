import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const QC = fileURLToPath(new URL("../review/qc.ts", import.meta.url));
const media = mediaFixture();

const runQc = (args, opts = {}) =>
  spawnSync("bun", [QC, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...opts.env },
  });

const makePng = (outPath, _width, _height, drawScript) => {
  const r = spawnSync(
    "python",
    [
      "-c",
      `from PIL import Image, ImageDraw; import sys\n${drawScript}\nimg.save(sys.argv[1])`,
      outPath,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(r.status).toBe(0);
};

test("qc --help exits 0 and bad usage exits 2", () => {
  const help = runQc(["--help"]);
  expect(help.status).toBe(0);
  expect(help.stdout).toMatch(/box/);
  expect(help.stdout).toMatch(/compare/);
  expect(help.stdout).toMatch(/motion/);

  const badFlag = runQc(["--bogus-flag"]);
  expect(badFlag.status).toBe(2);

  const badCheck = runQc(["--checks", "nope"]);
  expect(badCheck.status).toBe(2);

  const badBox = runQc(["box", "missing.png", "0,0,10,10"]);
  expect(badBox.status).toBe(2);
});

test("qc box computes exact RGB, sRGB & linear Rec.709 luma, and contrast on synthetic image", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-box-"));
  try {
    const imgPath = join(dir, "patch.png");
    // Left half black (0,0,0), right half mid-grey (128,128,128) in top; bottom-right white (255,255,255)
    makePng(
      imgPath,
      100,
      100,
      [
        "img = Image.new('RGB', (100, 100), (0, 0, 0))",
        "d = ImageDraw.Draw(img)",
        "d.rectangle([50, 0, 99, 49], fill=(128, 128, 128))",
        "d.rectangle([50, 50, 99, 99], fill=(255, 255, 255))",
      ].join("\n"),
    );

    const grayRes = runQc(["box", imgPath, "50,0,50,50", "--json"]);
    expect(grayRes.status).toBe(0);
    const gray = JSON.parse(grayRes.stdout);
    expect(gray.meanRgb).toEqual([128, 128, 128]);
    expect(Math.abs(gray.srgbLuma.mean - 128 / 255)).toBeLessThan(1e-4);
    expect(Math.abs(gray.linearLuma.mean - ((128 / 255 + 0.055) / 1.055) ** 2.4)).toBeLessThan(
      1e-4,
    );
    expect(gray.srgbLuma.std).toBe(0);

    // Normalized box covering whole right half (50% 128, 50% 255)
    const normRes = runQc(["box", imgPath, "0.5,0,0.5,1", "--norm", "--json"]);
    expect(normRes.status).toBe(0);
    const norm = JSON.parse(normRes.stdout);
    expect(norm.box.x).toBe(50);
    expect(norm.box.w).toBe(50);
    expect(norm.box.h).toBe(100);
    expect(Math.abs(norm.meanRgb[0] - 191.5)).toBeLessThan(0.05);
    expect(norm.dynamicRange.wcagContrastRatio).toBeGreaterThan(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("qc compare reports exact changed-pixel percentage, deltas, and writes labelled side-by-side image", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-cmp-"));
  try {
    const before = join(dir, "before.png");
    const after = join(dir, "after.png");
    const out = join(dir, "diff.png");
    makePng(before, 100, 100, "img = Image.new('RGB', (100, 100), (20, 40, 60))");
    makePng(
      after,
      100,
      100,
      [
        "img = Image.new('RGB', (100, 100), (20, 40, 60))",
        "d = ImageDraw.Draw(img)",
        // Change exactly 25x100 = 2500 of 10000 pixels (25.0%) by +100 on all 3 channels
        "d.rectangle([0, 0, 24, 99], fill=(120, 140, 160))",
      ].join("\n"),
    );

    const res = runQc(["compare", before, after, "--out", out, "--threshold", "4", "--json"]);
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.changedPixels).toBe(2500);
    expect(report.totalPixels).toBe(10000);
    expect(Math.abs(report.changedPct - 25)).toBeLessThan(1e-4);
    expect(Math.abs(report.meanAbsDelta - 25)).toBeLessThan(1e-4);
    expect(report.maxDelta).toBe(100);
    expect(existsSync(out)).toBe(true);

    const probe = spawnSync(
      "python",
      [
        "-c",
        "from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(im.width, im.height)",
        out,
      ],
      { encoding: "utf8" },
    );
    expect(probe.status).toBe(0);
    const [w, h] = probe.stdout.trim().split(" ").map(Number);
    expect(w).toBeGreaterThanOrEqual(200);
    expect(h).toBeGreaterThan(100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qc motion detects turn/FOV spikes with exact second and key row index without requiring MP4", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-motion-"));
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 10;");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
    );
    writeFileSync(
      join(dir, "src/timeline/cam.json"),
      JSON.stringify([
        { t: 0, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
        { t: 4, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
        { t: 5, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 60 },
        { t: 6, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 25 },
      ]),
    );

    const res = runQc(["motion", "--json"], { cwd: dir, env: { LIVE_PROJECT: dir } });
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.turnPeak.v).toBeGreaterThan(50);
    expect(report.turnPeak.span).toEqual([1, 2]);
    expect(report.fovPeak.v).toBeGreaterThan(25);
    expect(report.fovPeak.span).toEqual([2, 3]);
    expect(report.faults.length).toBeGreaterThan(0);

    // Unified qc --checks cam-motion works even without a rendered MP4!
    const unified = runQc(["--checks", "cam-motion", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: dir },
    });
    expect(unified.status).toBe(0);
    const u = JSON.parse(unified.stdout);
    expect(u.video).toBeNull();
    expect(u.checks).toHaveLength(1);
    expect(u.checks[0].id).toBe("cam-motion");
    expect(["warn", "fail"]).toContain(u.checks[0].status);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qc full run auto-detects video, runs probe/cam-motion, and cleanly skips missing optional python checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-full-"));
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 2;");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
    );
    writeFileSync(
      join(dir, "src/timeline/cam.json"),
      JSON.stringify([
        { t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: 60 },
        { t: 2, p: [0.5, 1, 5], l: [0, 1, 0], fov: 60 },
      ]),
    );
    // Create a valid 2s BT.709 H.264 MP4 with stereo 48kHz AAC
    media(join(dir, "renders/draft.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
    ]);

    const res = runQc(["--json"], { cwd: dir, env: { LIVE_PROJECT: dir } });
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.ok).toBe(true);
    expect(report.video).toMatch(/draft\.mp4$/);
    expect(report.checks.map((c) => c.id)).toEqual([
      "probe",
      "forensics",
      "sync",
      "audio",
      "look",
      "speed",
      "cam-motion",
    ]);
    const cam = report.checks.find((c) => c.id === "cam-motion");
    expect(cam.status).toBe("pass");
    const probe = report.checks.find((c) => c.id === "probe");
    expect(probe.status).toBe("pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
