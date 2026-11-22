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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mediaPython } from "../media/home.mjs";
import { FPS, tableShot, testVideo } from "./pinhole.mjs";

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

// a draft is its picture over a strip naming the heard time and shot: compare measures the picture, and says the draft
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

// an emoji in a downloaded reference's name broke ffmpeg in Git Bash, and its AV1 4K had to be transcoded by hand
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

// a film hand-merged ~300 solved keys into cam.json; solve --write replaces the shot's span and its own earlier solve only
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

      // a shot whose to is the next shot's cut second would take that cut key with it
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
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/^next: /);
    expect(readFileSync(ref)).toEqual(refBytes);
    expect(readFileSync(draft)).toEqual(draftBytes);

    const out = join(dir, "renders/reference/ref_vs_draft.mp4");
    expect(existsSync(out)).toBe(true);
    expect(audioHash(out)).toBe(audioHash(draft));

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
    mk(ref, "color=c=#2050d0:s=640x360:r=30", "1.2", 440);
    mk(ours, "color=c=#20c040:s=640x360:r=30", "0.5", 880);

    const outV = join(dir, "land_v.mp4");
    const rV = run(dir, ["sidebyside", ref, ours, "--out", outV, "--audio", "ref"]);
    expect(rV.status, rV.stdout + rV.stderr).toBe(0);

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
    expect(Number(vs.nb_read_frames)).toBe(36);
    expect(as).toBeTruthy();

    const rawLate = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        outV,
        "-vf",
        "select=eq(n\\,30)",
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
    expect(rawLate.status).toBe(0);
    const buf = rawLate.stdout;
    const px = (x, y) => {
      const i = (y * vs.width + x) * 3;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };
    const [tr, , tb] = px(320, 200);
    expect(tb).toBeGreaterThan(150);
    expect(tr).toBeLessThan(80);
    const [br, bg, bb] = px(320, vs.height - 200);
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
