import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { countWarnings, findAutoVideo, summarizeFailure } from "../review/qc.ts";
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

const makePng = (outPath, drawScript) => {
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

test("a linked film outside the monorepo runs the starter QC script", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-linked-film-"));
  try {
    const template = new URL("../../templates/film/package.json", import.meta.url);
    const { scripts } = JSON.parse(readFileSync(template, "utf8"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { qc: scripts.qc } }));
    mkdirSync(join(dir, "node_modules"));
    const studio = fileURLToPath(new URL("../../packages/live-studio", import.meta.url));
    symlinkSync(
      studio,
      join(dir, "node_modules/live-studio"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = spawnSync("bun", ["run", "qc", "--help"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bun run qc motion");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qc box computes exact RGB, sRGB & linear Rec.709 luma, and contrast on synthetic image", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-box-"));
  try {
    const imgPath = join(dir, "patch.png");
    // Left half black (0,0,0), right half mid-grey (128,128,128) in top; bottom-right white (255,255,255)
    makePng(
      imgPath,
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
    makePng(before, "img = Image.new('RGB', (100, 100), (20, 40, 60))");
    makePng(
      after,
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

// a reference whose frame n is grey n*8, so the frame read back says which one it was; ffmpeg's -ss with fps= picked a
// neighbour (food-eat-more's refstrip.sh was a frame off)
const greyReference = (dir, draw = "") => {
  const frames = spawnSync(
    "python",
    [
      "-c",
      `from PIL import Image, ImageDraw; import sys\nfor n in range(30):\n  img = Image.new('RGB', (90, 160), (n * 8,) * 3)\n${draw.replace(/^/gm, "  ")}\n  img.save(f"{sys.argv[1]}/ref_{n:03d}.png")`,
      dir,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(frames.stderr).toBe("");
  const video = join(dir, "ref.mkv");
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-framerate",
      "30",
      "-i",
      join(dir, "ref_%03d.png"),
      "-c:v",
      "ffv1",
      video,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  expect(r.status).toBe(0);
  return video;
};
const checker =
  "d = ImageDraw.Draw(img)\nfor x in range(0, 90, 6):\n  for y in range(0, 160, 6):\n    if (x + y) // 6 % 2 == 0: d.rectangle([x, y, x + 2, y + 2], fill=(255, 255, 255))";

test("qc vs reads the reference frame at the exact index of the second and sets its tones beside ours", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-vs-"));
  try {
    const video = greyReference(dir);
    const ours = join(dir, "still_0.5s.jpg");
    // a draft still: 160 lines of picture over a 20-line strip that is not the film's
    makePng(
      ours,
      "img = Image.new('RGB', (90, 180), (100, 100, 100))\nImageDraw.Draw(img).rectangle([0, 160, 89, 179], fill=(255, 0, 0))",
    );
    const out = join(dir, "vs.png");
    const res = runQc([
      "vs",
      video,
      ours,
      "--at",
      "0.5",
      "--picture-height",
      "160",
      "--out",
      out,
      "--json",
    ]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    expect(report.reference.frame).toBe(15);
    expect(report.reference.metrics.lumaP50).toBe(120);
    expect(report.ours.metrics.lumaP50).toBeCloseTo(100, 0);
    expect(report.ours.metrics.satP95).toBe(0);
    expect(report.size).toEqual({ width: 90, height: 160 });
    expect(existsSync(out)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("qc vs measures sharpness on both at the same size, over the whole frame and a region", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-vs-"));
  try {
    const video = greyReference(dir, checker);
    const ours = join(dir, "poster_0.2s.png");
    makePng(
      ours,
      `img = Image.new('RGB', (180, 320), (0, 0, 0))\n${checker.replaceAll("90", "180").replaceAll("160", "320")}\nfrom PIL import ImageFilter\nimg = img.filter(ImageFilter.GaussianBlur(4))`,
    );
    const res = runQc([
      "vs",
      video,
      ours,
      "--at",
      "0.2",
      "--region",
      "0.25,0.25,0.5,0.5",
      "--json",
    ]);
    expect(res.status).toBe(0);
    const { reference, ours: o, sharpnessRatio, region } = JSON.parse(res.stdout);
    expect(o.metrics.sharpness).toBeLessThan(reference.metrics.sharpness * 0.5);
    expect(sharpnessRatio).toBeLessThan(0.5);
    expect(region.sharpnessRatio).toBeLessThan(0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

// a set lit or painted off the reference's: the same part of both, in numbers rather than by eye
test("qc vs --region gives that part's mean colour and brightness beside the reference's", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-vs-"));
  try {
    const video = greyReference(dir);
    const ours = join(dir, "still_0.5s.jpg");
    makePng(
      ours,
      "img = Image.new('RGB', (90, 160), (120, 120, 120))\nImageDraw.Draw(img).rectangle([0, 0, 44, 79], fill=(240, 120, 60))",
    );
    const res = runQc(["vs", video, ours, "--at", "0.5", "--region", "0,0,0.5,0.5", "--json"]);
    expect(res.status).toBe(0);
    const { region } = JSON.parse(res.stdout);
    expect(region.rgb.ours[0]).toBeGreaterThan(230);
    expect(region.rgb.ours[2]).toBeLessThan(70);
    for (const channel of region.rgb.reference) expect(Math.abs(channel - 120)).toBeLessThan(6);
    expect(region.lumaRatio).toBeGreaterThan(1.1);
    const said = runQc(["vs", video, ours, "--at", "0.5", "--region", "0,0,0.5,0.5"]);
    expect(said.stdout).toMatch(
      /in 0,0,0\.5,0\.5: rgb ours 2\d\d[.\d]*,1\d\d[.\d]*,\d+[.\d]* reference 1\d\d/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("qc vs refuses a second past the reference's end", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-vs-"));
  try {
    const video = greyReference(dir);
    const ours = join(dir, "still_5s.jpg");
    makePng(ours, "img = Image.new('RGB', (90, 160), (0, 0, 0))");
    const res = runQc(["vs", video, ours, "--at", "5"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/past the reference's last frame/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

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

test("qc motion measures FOV and identifies scene-resolved camera points", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-motion-target-"));
  try {
    const cam = join(dir, "cam.json");
    writeFileSync(
      cam,
      JSON.stringify([
        { t: 0, p: [0, 1, 0], l: { target: "elon" }, fov: 70 },
        { t: 1, p: [0, 1, 0], l: { target: "elon" }, fov: 25 },
      ]),
    );
    const result = runQc(["motion", "--cam", cam, "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ poseSource: "scene", posPeak: null, turnPeak: null });
    expect(report.fovPeak.v).toBeGreaterThan(40);
    expect(report.fovPeak.span).toEqual([0, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qc text checks visible title size and actual reading time without a render", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-text-"));
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        "live-studio": {
          textTimeline: "src/timeline/text.json",
          timingTimeline: "src/timeline/timing.json",
        },
      }),
    );
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 5 }));
    writeFileSync(
      join(dir, "src/timeline/timing.json"),
      JSON.stringify({
        speeds: [{ from: 0, to: 2, rate: 4 }],
      }),
    );
    writeFileSync(
      join(dir, "src/timeline/text.json"),
      JSON.stringify({
        items: [
          { kind: "text", from: 0, to: 2, size: 28, text: "Read this caption" },
          { kind: "text", from: 0, to: 2, size: 16, text: "A label", read: false },
          { kind: "text", from: 2, to: 3, size: 56, text: "Next" },
        ],
      }),
    );
    const result = runQc(["--checks", "text", "--json", "--strict"], { cwd: dir });
    expect(result.status).toBe(1);
    const [check] = JSON.parse(result.stdout).checks;
    expect(check).toMatchObject({ id: "text", status: "warn", metrics: { checked: 2 } });
    expect(check.details.faults).toHaveLength(1);
    const [fault] = check.details.faults;
    expect(fault).toMatchObject({ row: 0, from: 0, to: 0.5 });
    expect(fault.messages).toEqual([
      expect.stringContaining("0.50 s"),
      expect.stringContaining("size 28"),
    ]);
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
      "text",
    ]);
    expect(report.checks.find((c) => c.id === "text").status).toBe("skip");
    const cam = report.checks.find((c) => c.id === "cam-motion");
    expect(cam.status).toBe("pass");
    const probe = report.checks.find((c) => c.id === "probe");
    expect(probe.status).toBe("pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("qc --strict fails on warnings, bad video fails exit 1, and all-skipped exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-gates-"));
  try {
    // 1. All-skipped outside a film with no video -> exit 2 ("nothing done")
    const emptyRes = runQc(["--checks", "forensics,cam-motion", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: "" },
    });
    expect(emptyRes.status).toBe(2);
    const emptyJson = JSON.parse(emptyRes.stdout);
    expect(emptyJson.ok).toBe(false);
    expect(emptyJson.checks.every((c) => c.status === "skip")).toBe(true);

    // 2. --strict treats cam-motion warning as exit 1 (ok: false)
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
      ]),
    );
    const strictWarn = runQc(["--checks", "cam-motion", "--strict", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: dir },
    });
    expect(strictWarn.status).toBe(1);
    const strictJson = JSON.parse(strictWarn.stdout);
    expect(strictJson.ok).toBe(false);
    expect(strictJson.checks[0].status).toBe("warn");

    // 3. Probe failure on untagged BT.601 / silent MP4 -> exit 1
    const badMp4 = join(dir, "bad.mp4");
    media(badMp4, [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ]);
    const failProbe = runQc([badMp4, "--checks", "probe", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: dir },
    });
    expect(failProbe.status).toBe(1);
    const failJson = JSON.parse(failProbe.stdout);
    expect(failJson.ok).toBe(false);
    expect(failJson.checks[0].status).toBe("fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("countWarnings, summarizeFailure, findAutoVideo priority, and picture-only probe", () => {
  expect(countWarnings({ warnings: 3 })).toBe(3);
  expect(
    countWarnings({ flags: [{ severity: "fail" }, { severity: "warn" }, { severity: "warn" }] }),
  ).toBe(2);
  expect(countWarnings({ frames: { warnings: ["w1", "w2"] } })).toBe(2);
  expect(countWarnings({ too_fast: [] })).toBe(0);
  expect(
    summarizeFailure(
      {
        flags: [
          { severity: "warn", note: "w" },
          { severity: "fail", note: "clipped peak" },
        ],
      },
      "fb",
    ),
  ).toBe("failed: clipped peak");

  const dir = mkdtempSync(join(tmpdir(), "qc-auto-"));
  try {
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders/draft_video.mp4"), "x");
    expect(findAutoVideo(dir)).toMatch(/draft_video\.mp4$/);
    writeFileSync(join(dir, "renders/final_video.mp4"), "x");
    expect(findAutoVideo(dir)).toMatch(/final_video\.mp4$/);
    writeFileSync(join(dir, "renders/draft.mp4"), "x");
    expect(findAutoVideo(dir)).toMatch(/draft\.mp4$/);
    writeFileSync(join(dir, "renders/final.mp4"), "x");
    expect(findAutoVideo(dir)).toMatch(/final\.mp4$/);

    // Picture-only draft_video.mp4 uses --audio any for probe and skips audio/sync cleanly
    rmSync(join(dir, "renders/draft.mp4"));
    rmSync(join(dir, "renders/final.mp4"));
    rmSync(join(dir, "renders/final_video.mp4"));
    media(join(dir, "renders/draft_video.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30:d=1",
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ]);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    const picOnly = runQc(["--checks", "probe,audio,sync", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: dir },
    });
    expect(picOnly.status).toBe(0);
    const pj = JSON.parse(picOnly.stdout);
    expect(pj.checks.find((c) => c.id === "probe").status).toBe("pass");
    expect(pj.checks.find((c) => c.id === "audio").status).toBe("skip");
    expect(pj.checks.find((c) => c.id === "sync").status).toBe("skip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("qc box skips local .venv missing PIL", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-venv-"));
  try {
    const mkVenv = spawnSync(
      "python",
      ["-c", "import venv, sys; venv.create(sys.argv[1], with_pip=False)", join(dir, ".venv")],
      { encoding: "utf8", timeout: 20_000 },
    );
    expect(mkVenv.status).toBe(0);
    const imgPath = join(dir, "px.png");
    makePng(imgPath, "img = Image.new('RGB', (20, 20), (10, 20, 30))");
    const boxRes = runQc(["box", imgPath, "0,0,10,10", "--json"], {
      cwd: dir,
      env: { PYTHON: "", CINETIC_PYTHON: "", VIRTUAL_ENV: "" },
    });
    expect(boxRes.status).toBe(0);
    expect(JSON.parse(boxRes.stdout).meanRgb).toEqual([10, 20, 30]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("qc sync runs against sound/mix.wav", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-sync-"));
  try {
    mkdirSync(join(dir, "sound"), { recursive: true });
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    const wav = join(dir, "sound/mix.wav");
    media(wav, [
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=d=2:r=48000:color=pink:amplitude=0.15:seed=42",
      "-ac",
      "2",
      "-ar",
      "48000",
    ]);
    media(join(dir, "renders/draft.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30:d=2",
      "-i",
      wav,
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-shortest",
    ]);
    const syncRes = runQc(["--checks", "sync", "--json"], {
      cwd: dir,
      env: { LIVE_PROJECT: dir },
    });
    const sj = JSON.parse(syncRes.stdout);
    expect(sj.checks[0].id).toBe("sync");
    expect(sj.checks[0].status).not.toBe("skip");
    expect(syncRes.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("qc fails cleanly on malformed cam.json and resolves owning film on cross-film paths", () => {
  const root = mkdtempSync(join(tmpdir(), "qc-cross-"));
  try {
    const filmA = join(root, "film-a");
    const filmB = join(root, "film-b");
    mkdirSync(join(filmA, "src/timeline"), { recursive: true });
    mkdirSync(join(filmB, "src/timeline"), { recursive: true });
    mkdirSync(join(filmB, "renders"), { recursive: true });

    // filmA has malformed cam.json
    writeFileSync(join(filmA, "package.json"), JSON.stringify({ "live-studio": {} }));
    writeFileSync(join(filmA, "src/timeline/cam.json"), "{ not valid json");

    const badCmd = runQc(["motion"], { cwd: filmA, env: { LIVE_PROJECT: filmA } });
    expect(badCmd.status).toBe(2);
    expect(badCmd.stderr).toMatch(/invalid JSON/);

    const badUnified = runQc(["--checks", "cam-motion", "--json"], {
      cwd: filmA,
      env: { LIVE_PROJECT: filmA },
    });
    expect(badUnified.status).toBe(1);
    const badJson = JSON.parse(badUnified.stdout);
    expect(badJson.checks[0].status).toBe("fail");
    expect(badJson.checks[0].summary).toMatch(/invalid JSON/);

    // Invalid key row types ([null, {}] and non-numeric t) also fail cleanly without crashing
    for (const payload of [[null, {}], [{ t: "bad", p: [0, 0, 0] }]]) {
      writeFileSync(join(filmA, "src/timeline/cam.json"), JSON.stringify(payload));
      const badRowCmd = runQc(["motion"], { cwd: filmA, env: { LIVE_PROJECT: filmA } });
      expect(badRowCmd.status).toBe(2);
      const badRowQc = runQc(["--checks", "cam-motion", "--json"], {
        cwd: filmA,
        env: { LIVE_PROJECT: filmA },
      });
      expect(badRowQc.status).toBe(1);
      expect(JSON.parse(badRowQc.stdout).checks[0].status).toBe("fail");
    }

    // filmB has valid cam.json and draft.mp4; passing explicit filmB paths overrides LIVE_PROJECT=filmA
    writeFileSync(join(filmB, "package.json"), JSON.stringify({ "live-studio": {} }));
    writeFileSync(
      join(filmB, "src/timeline/cam.json"),
      JSON.stringify([
        { t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: 60 },
        { t: 2, p: [0, 1, 5], l: [0, 1, 0], fov: 60 },
      ]),
    );
    media(join(filmB, "renders/draft.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "48000",
    ]);

    const crossVideo = runQc(
      [join(filmB, "renders/draft.mp4"), "--checks", "cam-motion", "--json"],
      {
        cwd: filmA,
        env: { LIVE_PROJECT: filmA },
      },
    );
    expect(crossVideo.status).toBe(0);
    const crossJson = JSON.parse(crossVideo.stdout);
    expect(crossJson.film).toBe(filmB);
    expect(crossJson.checks[0].status).toBe("pass");

    const crossMotion = runQc(["motion", "--cam", join(filmB, "src/timeline/cam.json"), "--json"], {
      cwd: filmA,
      env: { LIVE_PROJECT: filmA },
    });
    expect(crossMotion.status).toBe(0);
    expect(JSON.parse(crossMotion.stdout).status).toBe("pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
