import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  listCompareVideos,
  probeCompareVideo,
} from "../../packages/live-studio/src/compare-videos.mjs";
import { mediaPython } from "../media/home.mjs";
import { FPS, tableShot, testVideo } from "./pinhole.mjs";

const cli = fileURLToPath(new URL("../review/reference.mjs", import.meta.url));
const run = (cwd, args, env) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    ...(env ? { env } : {}),
  });
const reportFile = (result) => result.stdout.match(/next: read (.+?) and /)?.[1];

test("reference frames writes reusable batches at 15 fps and keeps earlier runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-frames-"));
  try {
    const video = join(dir, "source clip.mp4");
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x160:r=30:d=31",
        "-c:v",
        "libx264",
        video,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const out = join(dir, "review batches");
    const args = ["frames", video, video, "--out", out];

    const scene = run(dir, [...args, "--range", "3,23"]);
    expect(scene.status, scene.stdout + scene.stderr).toBe(0);
    const [sceneRun] = readdirSync(out);
    const sceneList = join(out, sceneRun, "list.txt");
    const sceneImages = readFileSync(sceneList, "utf8").trim().split("\n");
    expect(sceneImages).toHaveLength(300);
    expect(sceneImages[0]).toBe(join(out, sceneRun, "f000001.jpg"));
    expect(sceneImages.every((file) => existsSync(file))).toBe(true);

    const whole = run(dir, args);
    expect(whole.status, whole.stdout + whole.stderr).toBe(0);
    const [wholeRun] = readdirSync(out).filter((name) => name !== sceneRun);
    const readBatch = (name) =>
      readFileSync(join(out, wholeRun, name), "utf8")
        .trim()
        .split("\n");
    const first = readBatch("list-001.txt");
    const second = readBatch("list-002.txt");
    expect(first).toHaveLength(450);
    expect(second).toHaveLength(15);
    expect(second[0]).toBe(join(out, wholeRun, "f000451.jpg"));
    expect([...first, ...second].every((file) => existsSync(file))).toBe(true);
    expect(readFileSync(sceneList, "utf8").trim().split("\n")).toEqual(sceneImages);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference frames accepts a single video to export timecoded single-source JPEG batches and list.txt", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-single-frames-"));
  try {
    const video = join(dir, "ref.mp4");
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=navy:s=180x320:r=30:d=4",
        "-c:v",
        "libx264",
        video,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const out = join(dir, "single-batches");
    const res = run(dir, [
      "frames",
      video,
      "--range",
      "1,3",
      "--fps",
      "5",
      "--label",
      "REFERENCE",
      "--out",
      out,
    ]);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    const [runName] = readdirSync(out);
    const listFile = join(out, runName, "list.txt");
    const images = readFileSync(listFile, "utf8").trim().split("\n");
    expect(images).toHaveLength(10);
    expect(images.every((f) => existsSync(f))).toBe(true);

    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "single-draft", "live-studio": { ratio: "16:9" } }),
    );
    const draft = join(dir, "renders/draft_video.mp4");
    const draftMade = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=navy:s=320x220:r=30:d=2",
        "-c:v",
        "libx264",
        draft,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(draftMade.status, draftMade.stderr).toBe(0);
    const draftOut = join(dir, "draft-batches");
    const draftRes = run(dir, [
      "frames",
      draft,
      "--fps",
      "5",
      "--label",
      "OURS",
      "--out",
      draftOut,
    ]);
    expect(draftRes.status, draftRes.stdout + draftRes.stderr).toBe(0);
    const [draftRun] = readdirSync(draftOut);
    const draftImages = readFileSync(join(draftOut, draftRun, "list.txt"), "utf8")
      .trim()
      .split("\n");
    const dims = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", draftImages[0]],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(dims.stdout.trim()).toBe("320x208");

    const span = join(dir, "renders/span_10-12.mp4");
    const spanMade = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=navy:s=320x220:r=30:d=2",
        "-c:v",
        "libx264",
        span,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(spanMade.status, spanMade.stderr).toBe(0);
    const spanOut = join(dir, "span-batches");
    const spanRes = run(dir, [
      "frames",
      span,
      "--range",
      "10.5,11.5",
      "--fps",
      "5",
      "--label",
      "OURS",
      "--out",
      spanOut,
    ]);
    expect(spanRes.status, spanRes.stdout + spanRes.stderr).toBe(0);
    const [spanRun] = readdirSync(spanOut);
    const spanImages = readFileSync(join(spanOut, spanRun, "list.txt"), "utf8").trim().split("\n");
    expect(spanImages).toHaveLength(5);
    const spanBadRange = run(dir, ["frames", span, "--range", "0,1", "--fps", "5", "--out", spanOut]);
    expect(spanBadRange.status).toBe(2);
    expect(spanBadRange.stderr).toContain("outside the video window (10.00-12.00s)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference frames warns on stderr when a remake used --samples 1 without polluting stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-frames-samples-"));
  try {
    mkdirSync(join(dir, "references"), { recursive: true });
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "frames-samples-test", "live-studio": { ratio: "9:16" } }),
    );
    const ref = join(dir, "references/ref.mp4");
    const remake = join(dir, "renders/draft_video.mp4");
    for (const [file, color] of [
      [ref, "navy"],
      [remake, "green"],
    ]) {
      expect(
        spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=c=${color}:s=180x320:r=30:d=1`,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            file,
          ],
          { encoding: "utf8", timeout: 15000 },
        ).status,
      ).toBe(0);
    }
    const st = statSync(remake);
    const metaPath = `${remake}.review.json`;
    writeFileSync(
      metaPath,
      JSON.stringify({ size: st.size, mtimeMs: Math.trunc(st.mtimeMs), samples: 1, start: 0 }),
    );
    const out1 = join(dir, "renders/reference/s1");
    const r1 = run(dir, ["frames", ref, remake, "--fps", "5", "--out", out1]);
    expect(r1.status, r1.stdout + r1.stderr).toBe(0);
    expect(r1.stderr).toContain("rendered with --samples 1");
    expect(r1.stdout).not.toContain("rendered with --samples 1");
    const [run1] = readdirSync(out1);
    const list1 = join(out1, run1, "list.txt");
    expect(existsSync(list1)).toBe(true);
    expect(r1.stdout.trim().split(/\r?\n/).at(-1)).toBe(list1);

    const outSingle1 = join(dir, "renders/reference/single_s1");
    const rs1 = run(dir, ["frames", remake, "--fps", "5", "--label", "OURS", "--out", outSingle1]);
    expect(rs1.status, rs1.stdout + rs1.stderr).toBe(0);
    expect(rs1.stderr).toContain("rendered with --samples 1");
    expect(rs1.stdout).not.toContain("rendered with --samples 1");
    const [runSingle1] = readdirSync(outSingle1);
    expect(rs1.stdout.trim().split(/\r?\n/).at(-1)).toBe(join(outSingle1, runSingle1, "list.txt"));

    writeFileSync(
      metaPath,
      JSON.stringify({ size: st.size, mtimeMs: Math.trunc(st.mtimeMs), samples: 8, start: 0 }),
    );
    const out8 = join(dir, "renders/reference/s8");
    const r8 = run(dir, ["frames", ref, remake, "--fps", "5", "--out", out8]);
    expect(r8.status, r8.stdout + r8.stderr).toBe(0);
    expect(r8.stderr).not.toContain("rendered with --samples 1");

    const outSingle8 = join(dir, "renders/reference/single_s8");
    const rs8 = run(dir, ["frames", remake, "--fps", "5", "--label", "OURS", "--out", outSingle8]);
    expect(rs8.status, rs8.stdout + rs8.stderr).toBe(0);
    expect(rs8.stderr).not.toContain("rendered with --samples 1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test("reference compare measures a film draft without the strip under its picture", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-draft-"));
  try {
    mkdirSync(join(dir, "renders"));
    mkdirSync(join(dir, "references"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { ratio: "16:9" } }));
    const make = (file, filter) =>
      expect(
        spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            filter,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            file,
          ],
          {
            encoding: "utf8",
            timeout: 10000,
          },
        ).status,
      ).toBe(0);
    make(join(dir, "references/ref.mp4"), "testsrc2=s=128x72:r=30:d=2");
    make(join(dir, "renders/draft_video.mp4"), "testsrc2=s=128x80:r=30:d=2");
    const compare = run(dir, ["compare", "references/ref.mp4", "renders/draft_video.mp4"]);
    expect(compare.stderr).toMatch(
      /comparing renders\/draft_video\.mp4's picture \(128x72\), without the draft's strip under it/,
    );
    const report = JSON.parse(readFileSync(reportFile(compare), "utf8"));
    expect(report.remake).toBe(join(dir, "renders/draft_video.mp4"));
    expect(report.remakePicture).toEqual({ width: 128, height: 72 });
    expect(readdirSync(join(reportFile(compare), ".."))).not.toContain("remake-picture");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

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

test("reference add keeps the source under a plain name and makes an H.264 copy only when needed", () => {
  const film = mkdtempSync(join(tmpdir(), "reference-add-"));
  try {
    mkdirSync(join(film, "src"));
    writeFileSync(join(film, "src/scene.ts"), "");
    const make = (name, args) => {
      const plain = join(film, `made${extname(name)}`);
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1", ...args, plain],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(made.status, made.stderr).toBe(0);
      renameSync(plain, join(film, name));
      return join(film, name);
    };
    const frames = (file) =>
      spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,nb_read_frames",
          "-of",
          "csv=p=0",
          file,
        ],
        { encoding: "utf8" },
      ).stdout.trim();

    const audioPackets = (file) =>
      spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", file, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
        {
          encoding: "utf8",
        },
      ).stdout.trim();

    const lossless = make("cookie 🍪 clip.mkv", [
      "-f",
      "lavfi",
      "-i",
      "sine=d=1",
      "-c:v",
      "ffv1",
      "-c:a",
      "aac",
    ]);
    const added = run(film, ["add", lossless]);
    expect(added.status, added.stdout + added.stderr).toBe(0);
    expect(readFileSync(join(film, "references/ref-source.mkv"))).toEqual(readFileSync(lossless));
    expect(frames(join(film, "references/ref.mp4"))).toBe("h264,30");
    expect(audioPackets(lossless)).toMatch(/^MD5=/);
    expect(audioPackets(join(film, "references/ref.mp4"))).toBe(audioPackets(lossless));
    expect(added.stdout).toMatch(/bun run reference study references\/ref\.mp4/);

    const before = readFileSync(join(film, "references/ref.mp4"));
    expect(run(film, ["add", lossless]).status).toBe(2);
    expect(readFileSync(join(film, "references/ref.mp4"))).toEqual(before);

    const h264 = make("ready.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]);
    expect(run(film, ["add", h264, "--name", "second"]).status).toBe(0);
    expect(readFileSync(join(film, "references/second.mp4"))).toEqual(readFileSync(h264));
    expect(existsSync(join(film, "references/second-source.mp4"))).toBe(false);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
}, 60000);

test.skipIf(!existsSync(mediaPython("camera")))(
  "reference solve --write puts the solved keys in the camera timeline, replacing that span and the shot's earlier keys",
  () => {
    const film = mkdtempSync(join(tmpdir(), "reference-solve-"));
    try {
      mkdirSync(join(film, "src/timeline"), { recursive: true });
      mkdirSync(join(film, "references"));
      writeFileSync(join(film, "src/scene.ts"), "");
      writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 5 }));
      writeFileSync(
        join(film, "package.json"),
        JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
      );
      const cam = () =>
        JSON.parse(readFileSync(join(film, "src/timeline/cam.json"), "utf8")).keys.map((k) => k.id);
      writeFileSync(
        join(film, "src/timeline/cam.json"),
        JSON.stringify({
          keys: [
            { t: 0.2, id: "inside", p: [0, 1, 0], l: [0, 1, 1] },
            { t: 1, id: "mm-table-9", p: [0, 1, 0], l: [0, 1, 1] },
            { t: 2, id: "after", p: [0, 1, 0], l: [0, 1, 1] },
          ],
        }),
      );
      const made = spawnSync("ffmpeg", [...testVideo, join(film, "references/ref.mkv")], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(made.status, made.stderr).toBe(0);
      writeFileSync(join(film, "pour.json"), JSON.stringify(tableShot()));

      const looked = run(film, ["solve", "pour.json", "--video", "references/ref.mkv"]);
      expect(looked.status, looked.stdout + looked.stderr).toBe(0);
      expect(cam()).toEqual(["inside", "mm-table-9", "after"]);
      expect(looked.stdout).toMatch(/rerun with --write to put the 13 keys/);

      const camFile = join(film, "src/timeline/cam.json");
      const before = readFileSync(camFile, "utf8");
      writeFileSync(
        join(film, "late.json"),
        JSON.stringify({ ...tableShot({ frames: [0, 3, 6, 9, 12, 13] }), to: 13 / FPS }),
      );
      const next = { t: +(13 / FPS).toFixed(4), id: "next", cut: true, p: [0, 1, 0], l: [0, 1, 1] };
      writeFileSync(camFile, JSON.stringify({ keys: [...JSON.parse(before).keys, next] }));
      const ate = run(film, ["solve", "late.json", "--video", "references/ref.mkv", "--write"]);
      expect(ate.status).toBe(1);
      expect(ate.stderr).toMatch(/runs into the cut "next" at 0\.4333 s/);
      expect(cam()).toEqual(["inside", "mm-table-9", "after", "next"]);
      writeFileSync(camFile, before);

      const wrote = run(film, ["solve", "pour.json", "--video", "references/ref.mkv", "--write"]);
      expect(wrote.status, wrote.stdout + wrote.stderr).toBe(0);
      expect(cam()).toEqual([...Array.from({ length: 13 }, (_, n) => `mm-table-${n}`), "after"]);
      expect(wrote.stdout).toMatch(/wrote 13 keys .* replaced 2: inside, mm-table-9/);
      const runs = readdirSync(join(film, "renders/reference/solve/table"));
      expect(runs).toHaveLength(3);
      expect(existsSync(join(film, "renders/reference/solve/table", runs[2], "sheet.jpg"))).toBe(
        true,
      );
    } finally {
      rmSync(film, { recursive: true, force: true });
    }
  },
  120000,
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

test("reference timecode help and invalid arguments exit 2 without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-tc-usage-"));
  try {
    const src = join(dir, "clip.mp4");
    writeFileSync(src, "placeholder");
    const help = run(dir, ["timecode", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/timecode/i);
    expect(help.stdout).toMatch(/--label/);
    for (const args of [
      ["timecode"],
      ["timecode", join(dir, "missing.mp4")],
      ["timecode", src, "--typo"],
      ["timecode", src, "--minutes", "0"],
      ["timecode", src, "--short-edge", "10"],
      ["timecode", src, "--short-edge", "720.5"],
      ["timecode", src, "--full", "--short-edge", "720"],
      ["timecode", src, "--crf", "99"],
      ["timecode", src, "--crf", "22.5"],
      ["timecode", src, "--out", src],
      ["timecode", src, "--out", dir],
      ["timecode", src, "--out", join(dir, "bad.mkv")],
    ]) {
      expect(run(dir, args).status, args.join(" ")).toBe(2);
    }
    expect(existsSync(join(dir, "renders"))).toBe(false);
    expect(readFileSync(src, "utf8")).toBe("placeholder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("reference timecode writes an H.264 copy with a bottom black timecode bar and leaves the source untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-tc-real-"));
  try {
    mkdirSync(join(dir, "references"));
    const src = join(dir, "references/ref.mp4");
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=360x640:r=30000/1001:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=f=440:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        src,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const sourceBytes = readFileSync(src);
    const audioHash = (file) =>
      spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", file, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
        {
          encoding: "utf8",
        },
      ).stdout.trim();

    const result = run(dir, ["timecode", "references/ref.mp4"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/^next: /);
    expect(readFileSync(src)).toEqual(sourceBytes);
    expect(readdirSync(join(dir, "references"))).toEqual(["ref.mp4"]);

    const out = join(dir, "renders/reference/ref_timecode.mp4");
    expect(existsSync(out)).toBe(true);
    expect(readdirSync(join(dir, "renders/reference"))).toEqual(["ref_timecode.mp4"]);

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,nb_read_frames",
        "-of",
        "csv=p=0",
        out,
      ],
      { encoding: "utf8" },
    );
    expect(probe.stdout.trim()).toBe("h264,360,676,30");
    expect(audioHash(out)).toBe(audioHash(src));

    const raw = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        out,
        "-vf",
        "select=eq(n\\,15)",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
    );
    expect(raw.status).toBe(0);
    const buf = raw.stdout;
    expect(buf.length).toBe(360 * 676 * 3);
    let black = 0;
    let bright = 0;
    const barPixels = 360 * 36;
    for (let y = 640; y < 676; y++) {
      for (let x = 0; x < 360; x++) {
        const idx = (y * 360 + x) * 3;
        const r = buf[idx];
        const g = buf[idx + 1];
        const b = buf[idx + 2];
        if (r < 16 && g < 16 && b < 16) black++;
        if (r > 150 && g > 150 && b > 150) bright++;
      }
    }
    expect(black / barPixels).toBeGreaterThan(0.65);
    expect(bright / barPixels).toBeGreaterThan(0.01);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference timecode supports special-character and empty --label and keeps prior output on failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-tc-label-"));
  try {
    const src = join(dir, "in.mp4");
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=360x640:r=30:d=0.5",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        src,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);

    const labeled = join(dir, "custom.mp4");
    const r1 = run(dir, ["timecode", src, "--out", labeled, "--label", "REF 100%: it's ok"]);
    expect(r1.status, r1.stdout + r1.stderr).toBe(0);
    expect(existsSync(labeled)).toBe(true);

    const bare = join(dir, "bare.mp4");
    const r2 = run(dir, ["timecode", src, "--out", bare, "--label", ""]);
    expect(r2.status, r2.stdout + r2.stderr).toBe(0);
    expect(existsSync(bare)).toBe(true);

    const kept = readFileSync(labeled);
    const bad = join(dir, "corrupt.mp4");
    writeFileSync(bad, "not a video");
    const failed = run(dir, ["timecode", bad, "--out", labeled]);
    expect(failed.status).toBe(1);
    expect(readFileSync(labeled)).toEqual(kept);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference timecode downscales portrait 1080x1920 to 720 short-edge by default and preserves native size with --full", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-tc-scale-"));
  try {
    const src = join(dir, "portrait.mp4");
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=#203040:s=1080x1920:r=30:d=0.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        src,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(made.status, made.stderr).toBe(0);

    const probeDim = (file) =>
      spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "csv=p=0",
          file,
        ],
        { encoding: "utf8" },
      ).stdout.trim();

    const scaled = join(dir, "scaled.mp4");
    const rScaled = run(dir, ["timecode", src, "--out", scaled]);
    expect(rScaled.status, rScaled.stdout + rScaled.stderr).toBe(0);
    expect(probeDim(scaled)).toBe("720,1352");

    const native = join(dir, "native.mp4");
    const rNative = run(dir, ["timecode", src, "--out", native, "--full", "--crf", "18"]);
    expect(rNative.status, rNative.stdout + rNative.stderr).toBe(0);
    expect(probeDim(native)).toBe("1080,2028");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference sidebyside help and invalid arguments exit 2 without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-usage-"));
  try {
    const ref = join(dir, "ref.mp4");
    const ours = join(dir, "ours.mp4");
    writeFileSync(ref, "ref-placeholder");
    writeFileSync(ours, "ours-placeholder");
    const help = run(dir, ["sidebyside", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/sidebyside/i);
    expect(help.stdout).toMatch(/--audio/);
    expect(help.stdout).toMatch(/--layout/);
    for (const args of [
      ["sidebyside"],
      ["sidebyside", ref],
      ["sidebyside", ref, join(dir, "missing.mp4")],
      ["sidebyside", join(dir, "missing.mp4"), ours],
      ["sidebyside", ref, ours, "--typo"],
      ["sidebyside", ref, ours, "--audio", "both"],
      ["sidebyside", ref, ours, "--layout", "grid"],
      ["sidebyside", ref, ours, "--minutes", "0"],
      ["sidebyside", ref, ours, "--short-edge", "10"],
      ["sidebyside", ref, ours, "--full", "--short-edge", "720"],
      ["sidebyside", ref, ours, "--crf", "99"],
      ["sidebyside", ref, ours, "--out", ref],
      ["sidebyside", ref, ours, "--out", ours],
      ["sidebyside", ref, ours, "--out", dir],
      ["sidebyside", ref, ours, "--out", join(dir, "bad.mkv")],
    ]) {
      expect(run(dir, args).status, args.join(" ")).toBe(2);
    }
    expect(existsSync(join(dir, "renders"))).toBe(false);
    expect(readFileSync(ref, "utf8")).toBe("ref-placeholder");
    expect(readFileSync(ours, "utf8")).toBe("ours-placeholder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("reference sidebyside tiles portrait ref and draft horizontally, strips draft bar, and keeps remake audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-portrait-"));
  try {
    mkdirSync(join(dir, "references"));
    mkdirSync(join(dir, "renders"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { ratio: "9:16" } }));
    const ref = join(dir, "references/ref.mp4");
    const draft = join(dir, "renders/draft.mp4");
    const mk = (file, filter, tone) =>
      expect(
        spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            filter,
            "-f",
            "lavfi",
            "-i",
            `sine=f=${tone}:d=1`,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            file,
          ],
          { encoding: "utf8", timeout: 15000 },
        ).status,
      ).toBe(0);
    mk(ref, "color=c=#cc2020:s=360x640:r=30000/1001:d=1", 440);
    mk(
      draft,
      "color=c=#2040cc:s=360x676:r=30:d=1,drawbox=x=0:y=640:w=360:h=36:color=black:t=fill",
      880,
    );
    const refBytes = readFileSync(ref);
    const draftBytes = readFileSync(draft);
    const audioHash = (file) =>
      spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", file, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
        { encoding: "utf8" },
      ).stdout.trim();

    const result = run(dir, ["sidebyside", "references/ref.mp4", "renders/draft.mp4"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/stripped draft bar/);
    expect(result.stdout).toMatch(/hstack REF \| OURS/);
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/^next: /);
    expect(readFileSync(ref)).toEqual(refBytes);
    expect(readFileSync(draft)).toEqual(draftBytes);

    const out = join(dir, "renders/reference/ref_vs_draft.mp4");
    expect(existsSync(out)).toBe(true);
    expect(audioHash(out)).toBe(audioHash(draft));
    expect(audioHash(out)).not.toBe(audioHash(ref));

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,nb_read_frames",
        "-of",
        "csv=p=0",
        out,
      ],
      { encoding: "utf8" },
    );
    const [codec, wStr, hStr, framesStr] = probe.stdout.trim().split(",");
    const width = Number(wStr);
    const height = Number(hStr);
    expect(codec).toBe("h264");
    expect(width).toBe(724);
    expect(height).toBeGreaterThan(680);
    expect(height % 2).toBe(0);
    expect(Number(framesStr)).toBe(30);

    const raw = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        out,
        "-vf",
        "select=eq(n\\,15)",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
    );
    expect(raw.status).toBe(0);
    const buf = raw.stdout;
    const pixel = (x, y) => {
      const i = (y * width + x) * 3;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };
    const [lr, lg, lb] = pixel(180, Math.floor(height / 2));
    expect(lr).toBeGreaterThan(160);
    expect(lb).toBeLessThan(80);
    const [rr, rg, rb] = pixel(544, Math.floor(height / 2));
    expect(rb).toBeGreaterThan(160);
    expect(rr).toBeLessThan(80);
    const [rer, , reb] = pixel(368, Math.floor(height / 2));
    expect(reb).toBeGreaterThan(160);
    expect(rer).toBeLessThan(80);
    const [rbr, , rbb] = pixel(544, height - 45);
    expect(rbb).toBeGreaterThan(160);
    expect(rbr).toBeLessThan(80);
    const [sr, sg, sb] = pixel(362, Math.floor(height / 2));
    expect(Math.max(sr, sg, sb)).toBeLessThan(40);
    expect(lg + rg).toBeLessThan(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference sidebyside stacks landscape vertically, pads shorter clip with black, supports audio modes, and preserves prior output on error", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-land-"));
  try {
    const ref = join(dir, "ref.mp4");
    const ours = join(dir, "ours.mp4");
    const mk = (file, filter, dur, tone) =>
      expect(
        spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `${filter}:d=${dur}`,
            "-f",
            "lavfi",
            "-i",
            `sine=f=${tone}:d=${dur}`,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            file,
          ],
          { encoding: "utf8", timeout: 15000 },
        ).status,
      ).toBe(0);
    mk(ref, "color=c=#2050d0:s=640x360:r=30", "2.2", 440);
    mk(ours, "color=c=#20c040:s=640x360:r=30", "0.5", 880);
    const audioHash = (file) =>
      spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", file, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
        { encoding: "utf8" },
      ).stdout.trim();

    const outV = join(dir, "land_v.mp4");
    const rV = run(dir, ["sidebyside", ref, ours, "--out", outV, "--audio", "ref"]);
    expect(rV.status, rV.stdout + rV.stderr).toBe(0);
    expect(rV.stdout).toMatch(/vstack REF \/ OURS/);

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=codec_type,width,height,nb_read_frames",
        "-of",
        "json",
        outV,
      ],
      { encoding: "utf8" },
    );
    const streams = JSON.parse(probe.stdout).streams;
    const vs = streams.find((s) => s.codec_type === "video");
    const as = streams.find((s) => s.codec_type === "audio");
    expect(vs.width).toBe(640);
    expect(vs.height).toBeGreaterThan(760);
    expect(Number(vs.nb_read_frames)).toBe(66);
    expect(as).toBeTruthy();
    expect(audioHash(outV)).toBe(audioHash(ref));
    expect(audioHash(outV)).not.toBe(audioHash(ours));
    const keyframes = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-skip_frame",
        "nokey",
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "json",
        outV,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(keyframes.status, keyframes.stderr).toBe(0);
    const keyTimes = JSON.parse(keyframes.stdout).frames.map((frame) =>
      Number(frame.best_effort_timestamp_time),
    );
    expect(keyTimes[0]).toBe(0);
    const gaps = [...keyTimes.slice(1), 2.2].map((time, index) => time - keyTimes[index]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1.001);

    const decodeFrame = (frameIndex) => {
      const r = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          outV,
          "-vf",
          `select=eq(n\\,${frameIndex})`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
      );
      expect(r.status).toBe(0);
      return (x, y) => {
        const i = (y * vs.width + x) * 3;
        return [r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]];
      };
    };
    const pxEarly = decodeFrame(5);
    const [etr, , etb] = pxEarly(320, 200);
    expect(etb).toBeGreaterThan(150);
    expect(etr).toBeLessThan(80);
    const [ebr, ebg, ebb] = pxEarly(320, vs.height - 200);
    expect(ebg).toBeGreaterThan(150);
    expect(ebr).toBeLessThan(80);
    expect(ebb).toBeLessThan(90);

    const pxLate = decodeFrame(30);
    const [tr, , tb] = pxLate(320, 200);
    expect(tb).toBeGreaterThan(150);
    expect(tr).toBeLessThan(80);
    const [br, bg, bb] = pxLate(320, vs.height - 200);
    expect(Math.max(br, bg, bb)).toBeLessThan(20);

    const outSilent = join(dir, "land_h_silent.mp4");
    const rH = run(dir, [
      "sidebyside",
      ref,
      ours,
      "--out",
      outSilent,
      "--audio",
      "none",
      "--layout",
      "hstack",
    ]);
    expect(rH.status, rH.stdout + rH.stderr).toBe(0);
    expect(rH.stdout).toMatch(/hstack REF \| OURS/);
    const streamsH = JSON.parse(
      spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=codec_type,width", "-of", "json", outSilent],
        { encoding: "utf8" },
      ).stdout,
    ).streams;
    expect(streamsH.find((s) => s.codec_type === "video").width).toBe(1284);
    expect(streamsH.find((s) => s.codec_type === "audio")).toBeUndefined();

    const kept = readFileSync(outSilent);
    const corrupt = join(dir, "corrupt.mp4");
    writeFileSync(corrupt, "broken");
    const fail = run(dir, ["sidebyside", corrupt, ours, "--out", outSilent]);
    expect(fail.status).toBe(1);
    expect(readFileSync(outSilent)).toEqual(kept);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 40000);

test("reference sidebyside downscales to --short-edge, preserves native size with --full, and omits audio when remake is silent", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-scale-"));
  try {
    const ref = join(dir, "ref.mp4");
    const oursSilent = join(dir, "ours_silent.mp4");
    expect(
      spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=#cc2020:s=360x640:r=30:d=0.4",
          "-f",
          "lavfi",
          "-i",
          "sine=f=440:d=0.4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          ref,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=#2040cc:s=360x640:r=30:d=0.4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-an",
          oursSilent,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);

    const probeStreams = (file) =>
      JSON.parse(
        spawnSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", file],
          { encoding: "utf8" },
        ).stdout,
      ).streams;

    const scaled = join(dir, "scaled.mp4");
    const rScaled = run(dir, [
      "sidebyside",
      ref,
      oursSilent,
      "--out",
      scaled,
      "--short-edge",
      "180",
    ]);
    expect(rScaled.status, rScaled.stdout + rScaled.stderr).toBe(0);
    expect(rScaled.stdout).toMatch(/audio:none/);
    const scaledStreams = probeStreams(scaled);
    expect(scaledStreams.find((s) => s.codec_type === "video").width).toBe(364);
    expect(scaledStreams.find((s) => s.codec_type === "audio")).toBeUndefined();

    const native = join(dir, "native.mp4");
    const rNative = run(dir, ["sidebyside", ref, oursSilent, "--out", native, "--full"]);
    expect(rNative.status, rNative.stdout + rNative.stderr).toBe(0);
    expect(rNative.stdout).toMatch(/audio:none/);
    const nativeStreams = probeStreams(native);
    expect(nativeStreams.find((s) => s.codec_type === "video").width).toBe(724);
    expect(nativeStreams.find((s) => s.codec_type === "audio")).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference timecode and sidebyside clean up temp label directories and preserve prior output on ffmpeg timeout", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-ffmpeg-fail-"));
  const isolatedTmp = join(dir, "tmp");
  mkdirSync(isolatedTmp);
  try {
    const seed = join(dir, "seed.mp4");
    const longClip = join(dir, "long.mp4");
    expect(
      spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=s=1080x1920:r=30:d=1",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          seed,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        "ffmpeg",
        ["-v", "error", "-stream_loop", "59", "-i", seed, "-c", "copy", longClip],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);

    const env = { ...process.env, TEMP: isolatedTmp, TMP: isolatedTmp, TMPDIR: isolatedTmp };
    const tcOut = join(dir, "kept_tc.mp4");
    writeFileSync(tcOut, "prior-tc-bytes");
    const tcFail = run(dir, ["timecode", longClip, "--out", tcOut, "--minutes", "0.01"], env);
    expect(tcFail.status).toBe(1);
    expect(tcFail.stderr).toMatch(/stopped after 0\.01 minute/);
    expect(readFileSync(tcOut, "utf8")).toBe("prior-tc-bytes");
    expect(readdirSync(isolatedTmp)).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);

    const sbsOut = join(dir, "kept_sbs.mp4");
    writeFileSync(sbsOut, "prior-sbs-bytes");
    const sbsFail = run(
      dir,
      ["sidebyside", longClip, longClip, "--out", sbsOut, "--minutes", "0.01"],
      env,
    );
    expect(sbsFail.status).toBe(1);
    expect(sbsFail.stderr).toMatch(/stopped after 0\.01 minute/);
    expect(readFileSync(sbsOut, "utf8")).toBe("prior-sbs-bytes");
    expect(readdirSync(isolatedTmp)).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("reference sidebyside keeps the prior video when its metadata cannot be published", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-publication-"));
  try {
    const clip = join(dir, "input.mp4");
    const fixture = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "color=red:s=64x64:r=30:d=1", "-c:v", "libx264", clip],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(fixture.status, fixture.stderr).toBe(0);
    const out = join(dir, "out.mp4");
    const render = (range) => run(dir, ["sidebyside", clip, clip, "--range", range, "--out", out]);
    const first = render("0,0.5");
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const video = readFileSync(out);
    const sidecar = `${out}.review.json`;
    renameSync(sidecar, `${sidecar}.original`);
    mkdirSync(sidecar);
    const blocked = render("0.5,1");
    expect(blocked.status).toBe(1);
    expect(readFileSync(out).equals(video)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference sidebyside ranges use the file clock when audio precedes picture", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-clock-"));
  try {
    const delayed = join(dir, "delayed.mp4");
    const fixture = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-itsoffset",
        "1",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=64x64:r=24:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=f=440:d=4",
        "-fps_mode",
        "passthrough",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        delayed,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(fixture.status, fixture.stderr).toBe(0);
    const late = join(dir, "late.mp4");
    const lateRange = run(dir, [
      "sidebyside",
      delayed,
      delayed,
      "--range",
      "3.2,3.6",
      "--audio",
      "none",
      "--out",
      late,
    ]);
    expect(lateRange.status, lateRange.stdout + lateRange.stderr).toBe(0);
    expect(JSON.parse(readFileSync(`${late}.review.json`, "utf8")).start).toBe(3.2);
    const early = join(dir, "early.mp4");
    const earlyRange = run(dir, [
      "sidebyside",
      delayed,
      delayed,
      "--range",
      "0.25,0.75",
      "--audio",
      "none",
      "--out",
      early,
    ]);
    expect(earlyRange.status).toBe(2);
    expect(earlyRange.stderr).toContain("outside the shared video window (1.00-4.00s)");
    expect(existsSync(early)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test.each([
  { extension: "mp4", start: "0.7", duration: "2.4", range: "2.5,3.1", status: 0 },
  { extension: "mkv", start: "1", duration: "2", range: "2.5,3.5", status: 2 },
  { extension: "mkv", start: "0", duration: "2", fps: 24, range: "0,2", status: 0, frames: 48 },
])("reference sidebyside validates picture-track end in $extension", (sample) => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-end-"));
  try {
    const clip = join(dir, `delayed.${sample.extension}`);
    const fixture = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-itsoffset",
        sample.start,
        "-f",
        "lavfi",
        "-i",
        `color=red:s=64x64:r=${sample.fps ?? 30}:d=${sample.duration}`,
        "-f",
        "lavfi",
        "-i",
        "sine=f=440:d=4",
        "-fps_mode",
        "passthrough",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        clip,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(fixture.status, fixture.stderr).toBe(0);
    const out = join(dir, "out.mp4");
    const result = run(dir, [
      "sidebyside",
      clip,
      clip,
      "--range",
      sample.range,
      "--audio",
      "none",
      "--out",
      out,
    ]);
    expect(result.status, result.stdout + result.stderr).toBe(sample.status);
    expect(existsSync(out)).toBe(sample.status === 0);
    if (sample.frames !== undefined) {
      const picture = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "V:0",
          "-show_entries",
          "stream=nb_frames",
          "-of",
          "csv=p=0",
          out,
        ],
        { encoding: "utf8", timeout: 15_000 },
      );
      expect(picture.status, picture.stderr).toBe(0);
      expect(Number(picture.stdout.trim())).toBe(sample.frames);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference sidebyside auto-aligns film spans, exposes layout and start to Studio, and warns on --samples 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-sbs-span-"));
  try {
    mkdirSync(join(dir, "references"), { recursive: true });
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "span-test", "live-studio": { ratio: "9:16" } }),
    );
    const ref = join(dir, "references/ref.mp4");
    const span = join(dir, "renders/span_2-3.mp4");
    expect(
      spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=320x180:r=30:d=2",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=320x180:r=30:d=2",
          "-f",
          "lavfi",
          "-i",
          "sine=f=440:d=4",
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0[v]",
          "-map",
          "[v]",
          "-map",
          "2:a",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          ref,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=green:s=180x320:r=30:d=1",
          "-itsoffset",
          "0.2",
          "-f",
          "lavfi",
          "-i",
          "sine=f=440:d=0.3",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          span,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).status,
    ).toBe(0);
    const st = statSync(span);
    writeFileSync(
      `${span}.review.json`,
      JSON.stringify({ size: st.size, mtimeMs: Math.trunc(st.mtimeMs), samples: 1, start: 2 }),
    );

    const output = "renders/reference/auto_sbs.mp4";
    const autoOut = join(dir, output);
    const rAuto = run(dir, ["sidebyside", ref, span, "--audio", "ref", "--out", autoOut]);
    expect(rAuto.status, rAuto.stdout + rAuto.stderr).toBe(0);
    expect(rAuto.stdout).toContain("start 2.00s");
    expect(rAuto.stdout).toContain("rendered with --samples 1");
    expect(listCompareVideos(dir).videos.find((video) => video.path === output)).toMatchObject({
      startSec: 2,
      layout: "vstack",
      referencePath: "references/ref.mp4",
      studioStartSec: 2,
      embeddedAudio: "ref",
    });
    expect(await probeCompareVideo(dir, output)).toMatchObject({ ok: true, layout: "vstack" });
    const dur = Number(
      spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", autoOut],
        { encoding: "utf8" },
      ).stdout.trim(),
    );
    expect(dur).toBeGreaterThan(0.9);
    expect(dur).toBeLessThan(1.3);

    const px = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        "0.5",
        "-i",
        autoOut,
        "-vf",
        "format=rgb24,crop=1:1:90:180",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { timeout: 15000 },
    );
    expect(px.status, String(px.stderr)).toBe(0);
    expect(px.stdout[2]).toBeGreaterThan(180);
    expect(px.stdout[0]).toBeLessThan(60);

    const ranged = run(dir, [
      "sidebyside",
      ref,
      ref,
      "--range",
      "2.2,2.7",
      "--layout",
      "hstack",
      "--short-edge",
      "180",
    ]);
    expect(ranged.status, ranged.stdout + ranged.stderr).toBe(0);
    const rangeName = "renders/reference/ref_vs_ref_2.2-2.7.mp4";
    expect(listCompareVideos(dir).videos.find((video) => video.path === rangeName)).toMatchObject({
      startSec: 2.2,
      layout: "hstack",
    });
    const pic = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        join(dir, rangeName),
        "-vf",
        "format=rgb24,crop=325:1:90:80",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { timeout: 15_000 },
    );
    expect(pic.status, String(pic.stderr)).toBe(0);
    expect(pic.stdout[2]).toBeGreaterThan(180);
    expect(pic.stdout[324 * 3 + 2]).toBeGreaterThan(180);
    const rangeDuration = await probeCompareVideo(dir, rangeName);
    expect(rangeDuration.duration).toBeCloseTo(0.5, 1);
    const tailPath = join(dir, "empty-tail.mp4");
    const tail = run(dir, [
      "sidebyside",
      ref,
      span,
      "--range",
      "2.98,2.99",
      "--audio",
      "none",
      "--out",
      tailPath,
    ]);
    expect(tail.status, tail.stdout + tail.stderr).toBe(1);
    expect(existsSync(tailPath)).toBe(false);
    const pictureOnlyWindow = join(dir, "picture-window.mp4");
    const beyondAudio = run(dir, [
      "sidebyside",
      ref,
      span,
      "--range",
      "2.6,2.9",
      "--out",
      pictureOnlyWindow,
    ]);
    expect(beyondAudio.status, beyondAudio.stdout + beyondAudio.stderr).toBe(0);
    expect(existsSync(pictureOnlyWindow)).toBe(true);
    const beforeAudio = "renders/reference/before-audio.mp4";
    const subFrame = run(dir, [
      "sidebyside",
      ref,
      span,
      "--range",
      "2.16,2.17",
      "--out",
      beforeAudio,
    ]);
    expect(subFrame.status, subFrame.stdout + subFrame.stderr).toBe(0);
    expect(await probeCompareVideo(dir, beforeAudio)).toMatchObject({ ok: true, hasAudio: false });
    expect(run(dir, ["sidebyside", ref, span, "--range", "1,2.5"]).status).toBe(2);
    expect(run(dir, ["sidebyside", ref, span, "--range", "2.2,2.7", "--start", "2"]).status).toBe(
      2,
    );

    const badStart = run(dir, [
      "sidebyside",
      ref,
      span,
      "--start",
      "5",
      "--out",
      join(dir, "x.mp4"),
    ]);
    expect(badStart.status).toBe(2);
    expect(existsSync(join(dir, "x.mp4"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
