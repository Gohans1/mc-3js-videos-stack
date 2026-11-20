import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { mediaFixture } from "./media-fixture.mjs";

const SHEET = resolve(import.meta.dirname, "../review/sheet.py");
const media = mediaFixture();
const fixture = (t, video = "renders/draft_video.mp4", size = "320x180") => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-view-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, video);
  mkdirSync(dirname(file), { recursive: true });
  media(file, [
    "-f",
    "lavfi",
    "-i",
    `color=red:s=${size}:r=30:d=1`,
    "-f",
    "lavfi",
    "-i",
    `color=blue:s=${size}:r=30:d=1`,
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-pix_fmt",
    "yuv420p",
  ]);
  const run = (...args) =>
    spawnSync("python", [SHEET, video, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
  return { dir, file, video, run };
};
const indexOf = (r) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const path = /^index: (.+)$/m.exec(r.stdout)?.[1].trim();
  assert.ok(path, r.stdout);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) };
};
const dimensions = (file) => {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout).streams[0];
  return [s.width, s.height];
};
const rgb = (file, filter = "scale=1:1") => {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      filter,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 10000 },
  );
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 3)];
};

test("native frames persist with batch/range mapping to the encoded source's actual pictures", (t) => {
  const f = fixture(t);
  const { data } = indexOf(f.run("frames", "0.5,1-2/2"));
  assert.equal(data.complete, true);
  assert.equal(data.source.path, f.file);
  assert.deepEqual(
    data.entries.map((e) => e.requestedTime),
    [0.5, 1.25, 1.75],
  );
  assert.deepEqual(
    data.entries.map((e) => e.sourceTime),
    [0.5, 37 / 30, 52 / 30],
  );
  for (const e of data.entries) {
    assert.ok(existsSync(e.frame));
    assert.deepEqual(dimensions(e.frame), [320, 180]);
  }
  assert.ok(rgb(data.entries[0].frame)[0] > 220);
  assert.ok(rgb(data.entries[1].frame)[2] > 220);
  assert.equal(data.context.status, "unavailable");
});

test("new range modes reject invalid or excessive requests before creating outputs", (t) => {
  const f = fixture(t);
  for (const args of [
    ["frames", "1-0/4"],
    ["frames", "0-3/4"],
    ["frames", "0-2/41"],
    ["frames", "0-2/40,0-2/40,0-2/40"],
    ["overview", "0-2/97"],
    ["overview", "1"],
    ["frames"],
    ["overview", "0-1/0"],
    ["frames", "0:75"],
  ]) {
    const r = f.run(...args);
    assert.equal(r.status, 2, args.join(" ") + r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /Traceback/);
    assert.deepEqual(readdirSync(join(f.dir, "renders")), ["draft_video.mp4"]);
  }
});

test("native frames use heard seconds for chunks and spans, preserving earlier runs", (t) => {
  for (const video of ["renders/chunks/c02.mp4", "renders/span_60-62.mp4"]) {
    const f = fixture(t, video);
    const first = indexOf(f.run("frames", "1:00.5"));
    assert.equal(first.data.source.start, 60);
    assert.equal(first.data.entries[0].time, 60.5);
    assert.equal(first.data.entries[0].sourceTime, 0.5);
    const second = indexOf(f.run("frames", "61.5"));
    assert.notEqual(first.path, second.path);
    assert.ok(existsSync(first.data.entries[0].frame));
    assert.ok(rgb(second.data.entries[0].frame)[2] > 220);
  }
});

test("overview maps compact cells to the red and blue moments; a range narrows the search", (t) => {
  const f = fixture(t);
  const { data } = indexOf(f.run("overview"));
  assert.equal(data.entries.length, 16);
  assert.equal(new Set(data.entries.map((e) => e.sheet)).size, 1);
  assert.deepEqual(
    data.entries.map((e) => e.cell),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  assert.deepEqual(dimensions(data.entries[0].sheet), [1280, 720]);
  assert.ok(rgb(data.entries[0].sheet, "crop=320:180:0:0,scale=1:1")[0] > 220);
  assert.ok(rgb(data.entries[15].sheet, "crop=320:180:960:540,scale=1:1")[2] > 220);
  assert.ok(
    data.entries.every(
      (e) => !e.frame && e.commands.frames.argv.at(-1) === String(e.requestedTime),
    ),
  );
  const range = indexOf(f.run("overview", "1-2/32")).data;
  assert.equal(range.entries.length, 32);
  assert.ok(range.entries.every((e) => e.time >= 1 && e.time < 2));
  const sheets = [...new Set(range.entries.map((e) => e.sheet))];
  assert.equal(sheets.length, 2);
  assert.ok(sheets.every((path) => existsSync(path)));
  assert.equal(range.entries[16].cell, 1);
  assert.equal(range.entries[16].sheet, sheets[1]);
});

test("picture evidence preserves geometry across a change and previews a stable range", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-changing-shape-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, color, size] of [
    ["landscape.mkv", "red", "320x180"],
    ["portrait.mkv", "blue", "180x320"],
  ]) {
    media(join(dir, name), [
      "-f",
      "lavfi",
      "-i",
      "color=" + color + ":s=" + size + ":r=25:d=1",
      "-c:v",
      "libx264",
      "-g",
      "25",
      "-x264-params",
      "repeat-headers=1",
    ]);
  }
  const sequence = join(dir, "sequence.txt");
  writeFileSync(sequence, "file 'landscape.mkv'\nfile 'portrait.mkv'\n");
  const video = join(dir, "change.ts");
  media(video, ["-f", "concat", "-i", sequence, "-c", "copy"]);
  const reference = resolve(import.meta.dirname, "../review/reference.mjs");
  const run = (program, args) =>
    indexOf(spawnSync(program, args, { cwd: dir, encoding: "utf8", timeout: 20_000 })).data.entries;
  const [fromSheet] = run("python", [SHEET, video, "frames", "1.4"]);
  const [, fromReference] = run(process.execPath, [
    reference,
    "inspect",
    video,
    "--at",
    "0.5,1.4",
    "--frames",
    "2",
  ]);
  for (const proof of [fromSheet, fromReference]) {
    assert.deepEqual(dimensions(proof.frame), [180, 320]);
  }
  const [, overview] = run("python", [SHEET, video, "overview", "0-2/2"]);
  for (const [entry, cellHeight] of [
    [overview, 180],
    [fromReference, 320],
  ]) {
    assert.ok(rgb(entry.sheet, "crop=4:4:478:" + (cellHeight / 2 - 2) + ",scale=1:1")[2] > 220);
    assert.ok(
      rgb(entry.sheet, "crop=4:4:328:" + (cellHeight / 2 - 2) + ",scale=1:1").every((c) => c < 20),
    );
  }
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 2;\n");
  writeFileSync(join(dir, "package.json"), "{}");
  const framecheck = resolve(import.meta.dirname, "../../packages/live-studio/framecheck.mjs");
  const faults = spawnSync(process.execPath, [framecheck, video, "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(faults.status, 0, faults.stderr);
  const report = JSON.parse(faults.stdout);
  assert.deepEqual(report.artifactErrors, []);
  const strip = join(dir, report.findings.find((f) => f.kind === "JUMP").strip);
  assert.ok(rgb(strip, "crop=4:4:318:318,scale=1:1")[0] > 220);
  for (const x of [958, 1598]) {
    assert.ok(rgb(strip, "crop=4:4:" + x + ":318,scale=1:1")[2] > 220);
  }

  const deliver = resolve(import.meta.dirname, "../review/deliver.py");
  const preview = (range, source = video) =>
    spawnSync("python", [deliver, source, "--youtube", range], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
    });
  const crossing = preview("0.8-1.36");
  assert.equal(crossing.status, 1, crossing.stderr);
  assert.match(crossing.stderr, /picture-format change at 1 file seconds/);
  assert.doesNotMatch(crossing.stdout, /^preview:/m);
  const portrait = preview("1.08-1.84");
  assert.match(portrait.stdout, /bands \(Netflix CAMBI\)/, portrait.stderr);
  const path = /^preview: ([^;]+);/m.exec(portrait.stdout)?.[1];
  assert.ok(path);
  assert.deepEqual(dimensions(join(dir, path)), [180, 320]);
  const mp4 = join(dir, "change.mp4");
  media(mp4, ["-f", "concat", "-i", sequence, "-c", "copy"]);
  for (const source of [video, mp4]) {
    const before = preview("0.8-1", source);
    assert.match(before.stdout, /bands \(Netflix CAMBI\)/, before.stderr);
    const output = /^preview: ([^;]+);/m.exec(before.stdout)?.[1];
    assert.ok(output);
    const clip = join(dir, output);
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "V:0",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "json",
        clip,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(
      JSON.parse(probe.stdout).frames.map((f) => Number(f.best_effort_timestamp_time)),
      [0, 0.04, 0.08, 0.12, 0.16],
    );
    assert.ok(rgb(clip, "select=eq(n\\,4),scale=1:1")[0] > 220);
  }
});

test("a sample-aspect-only splice retains the aspect of each requested frame", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-changing-sar-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, color, sar] of [
    ["square", "red", "1/1"],
    ["wide", "blue", "2/1"],
  ]) {
    media(join(dir, name + ".mkv"), [
      "-f",
      "lavfi",
      "-i",
      "color=" + color + ":s=320x180:r=25:d=1",
      "-vf",
      "setsar=" + sar,
      "-c:v",
      "libx264",
      "-g",
      "25",
      "-x264-params",
      "repeat-headers=1",
    ]);
  }
  const order = join(dir, "sequence.txt");
  writeFileSync(order, "file 'square.mkv'\nfile 'wide.mkv'\n");
  const source = join(dir, "changing-sar.ts");
  media(source, ["-f", "concat", "-i", order, "-c", "copy"]);
  const r = spawnSync("python", [SHEET, source, "frames", "0.96,1"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20000,
  });
  const { entries } = indexOf(r).data;
  assert.deepEqual(
    entries.map((entry) => entry.sampleAspectRatio),
    ["1", "2"],
  );
  assert.deepEqual(dimensions(entries[1].frame), [320, 180]);
  const jpeg = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V:0",
      "-show_entries",
      "stream=sample_aspect_ratio",
      "-of",
      "csv=p=0",
      entries[1].frame,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(jpeg.status, 0, jpeg.stderr);
  assert.equal(jpeg.stdout.trim(), "2:1");
});

test("portrait overview preserves shape, while native frames keep the source dimensions", (t) => {
  const f = fixture(t, "renders/draft_video.mp4", "180x320");
  const { data } = indexOf(f.run("overview", "0-2/1"));
  assert.deepEqual(dimensions(data.entries[0].sheet), [720, 1280]);
  const native = indexOf(f.run("frames", "0.5")).data;
  assert.deepEqual(dimensions(native.entries[0].frame), [180, 320]);
});

const withNarration = (f, { muted = false, missing = false } = {}) => {
  const put = (path, value) => {
    mkdirSync(dirname(join(f.dir, path)), { recursive: true });
    writeFileSync(join(f.dir, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  put("package.json", {
    "live-studio": {
      soundTimeline: "src/timeline/audio.json",
      soundVault: false,
      timingTimeline: "src/timeline/timing.json",
      sfx: "sound/sfx",
    },
  });
  put("src/scene.ts", "export const scene = {};\n");
  put("src/edit.json", { end: 4 });
  put("src/timeline/timing.json", { speeds: [{ from: 0, to: 4, rate: 2 }] });
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    tracks: [{ id: "voice", mute: muted }],
    sfx: [{ name: "narr", at: 0, length: 4, track: "voice" }],
  });
  mkdirSync(join(f.dir, "sound/sfx"), { recursive: true });
  if (!missing) media(join(f.dir, "sound/sfx/narr.wav"), ["-f", "lavfi", "-i", "sine=duration=4"]);
  put("renders/live/voice_map.json", {
    lines: [
      { text: "first", s: 0, e: 2, words: [{ w: "first", s: 0, e: 2 }] },
      { text: "second", s: 2, e: 4, words: [{ w: "second", s: 2, e: 4 }] },
    ],
  });
  put("renders/cuts.json", [1]);
  const fresh = new Date(Date.now() + 2000);
  utimesSync(f.file, fresh, fresh);
  return put;
};

test("index reuses heard narration timing and rendered cuts, labelled as timeline context", (t) => {
  const f = fixture(t);
  withNarration(f);
  const { data } = indexOf(f.run("frames", "0.5,1.5"));
  assert.equal(data.context.status, "ready");
  assert.match(data.context.basis, /timeline.*not.*verified.*audio/);
  assert.deepEqual(
    data.entries.map((e) => e.narration.text),
    ["first", "second"],
  );
  assert.deepEqual(
    data.entries.map((e) => e.shot),
    [0, 1],
  );
  assert.deepEqual(data.entries[1].narration, { text: "second", s: 1, e: 2 });
});

test("muted, missing, stale and foreign context never asserts speech or invented shot associations", (t) => {
  for (const kind of ["muted", "missing", "stale", "foreign"]) {
    const f = fixture(t, kind === "foreign" ? "reference.mp4" : undefined);
    const put = withNarration(f, { muted: kind === "muted", missing: kind === "missing" });
    if (kind === "stale") {
      put("src/scene.ts", "export const scene = { changed: true };\n");
      const future = new Date(Date.now() + 5000);
      utimesSync(join(f.dir, "src/scene.ts"), future, future);
    }
    const { data } = indexOf(f.run("frames", "0.5"));
    assert.equal(data.context.status, kind === "missing" ? "unavailable" : kind);
    assert.ok(data.context.reason);
    assert.ok(data.entries.every((e) => !e.narration));
    if (kind === "stale" || kind === "foreign")
      assert.ok(data.entries.every((e) => e.shot === undefined));
    assert.ok(existsSync(data.entries[0].frame));
  }
});

test("generated follow-up carries START into a clean shell", (t) => {
  const f = fixture(t, "renders/custom.mp4");
  writeFileSync(
    join(f.dir, "package.json"),
    JSON.stringify({ scripts: { sheet: `python "${SHEET}"` } }),
  );
  const first = indexOf(
    spawnSync("python", [SHEET, f.video, "overview", "60-61/1"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25000,
      env: { ...process.env, START: "60" },
    }),
  );
  const cmd = first.data.entries[0].commands.frames;
  const env = { ...process.env };
  delete env.START;
  Object.assign(env, cmd.env);
  const next = indexOf(
    spawnSync(cmd.argv[0], cmd.argv.slice(1), {
      cwd: f.dir,
      env,
      encoding: "utf8",
      timeout: 25000,
    }),
  );
  assert.equal(next.data.source.start, 60);
  assert.equal(next.data.entries[0].time, 60.5);
  assert.ok(rgb(next.data.entries[0].frame)[0] > 220);
});

test("actual decoded timestamp, shot and narration follow the returned frame across a cut", (t) => {
  const f = fixture(t);
  withNarration(f);
  const { data } = indexOf(f.run("frames", "0.99"));
  const e = data.entries[0];
  assert.ok(rgb(e.frame)[0] > 220);
  assert.equal(e.requestedTime, 0.99);
  assert.ok(e.sourceTime < 1);
  assert.equal(e.time, e.sourceTime);
  assert.equal(e.shot, 0);
  assert.equal(e.narration.text, "first");
});

test("frame lookup follows VFR presentation and a delayed video track", (t) => {
  const f = fixture(t, "delayed.mp4");
  media(f.file, [
    "-itsoffset",
    "1",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=4:d=1,drawbox=c=blue:t=fill:enable='gte(t,0.5)',select='not(mod(n,2))',setpts=4*PTS",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=d=4",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
  ]);
  const { data } = indexOf(f.run("frames", "2.8,3"));
  assert.equal(data.source.pictureFrom, 1);
  assert.equal(data.entries[0].sourceTime, 1);
  assert.ok(rgb(data.entries[0].frame)[0] > 220);
  assert.equal(data.entries[1].sourceTime, 3);
  assert.ok(rgb(data.entries[1].frame)[2] > 220);
  const sheet = f.run("2.8,3");
  assert.equal(sheet.status, 0, sheet.stdout + sheet.stderr);
  const classic = join(f.dir, "renders/sheet_delayed_0.jpg");
  assert.ok(rgb(classic, "crop=620:340:10:10,scale=1:1")[0] > 220);
});

test("frame lookup recovers decoded timestamps when an AVI packet has no PTS", (t) => {
  const f = fixture(t, "legacy.avi");
  media(f.file, [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=r=25:s=160x90:d=2",
    "-c:v",
    "mpeg4",
    "-bf",
    "2",
    "-g",
    "12",
  ]);
  const { data } = indexOf(f.run("frames", "0.52,1.995,2.02"));
  assert.equal(data.source.pictureFrom, 0.04);
  assert.deepEqual(
    data.entries.map((entry) => entry.sourceTime),
    [0.52, 1.96, 2],
  );
});

test("a Matroska audio tail does not extend the picture's time range", (t) => {
  const f = fixture(t, "audio-tail.mkv");
  media(f.file, [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=d=4",
    "-c:v",
    "ffv1",
    "-c:a",
    "aac",
  ]);
  const { data } = indexOf(f.run("frames", "1.9"));
  assert.ok(Math.abs(data.source.pictureTo - 2) < 0.05);
  const tail = f.run("frames", "3.5");
  assert.equal(tail.status, 2, tail.stdout + tail.stderr);
});

test("Matroska VFR picture ends at its packets even when audio extends the reported video duration", (t) => {
  const f = fixture(t, "sparse.mkv");
  media(f.file, [
    "-itsoffset",
    "0.6",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x96:r=4:d=1.5,select='not(eq(n,2))',setpts='if(gte(N,2),PTS+0.5/TB,PTS)'",
    "-f",
    "lavfi",
    "-i",
    "sine=f=310:r=48000:d=3",
    "-c:v",
    "libx264",
    "-bf",
    "0",
    "-fps_mode",
    "vfr",
    "-c:a",
    "pcm_s16le",
  ]);
  const { data } = indexOf(f.run("frames", "2.4"));
  assert.equal(data.source.pictureTo, 2.5);
  const tail = f.run("frames", "2.9");
  assert.equal(tail.status, 2, tail.stdout + tail.stderr);
});

test("overview respects display rotation", (t) => {
  const f = fixture(t, "plain.mp4");
  const rotated = join(f.dir, "rotated.mp4");
  media(rotated, ["-display_rotation", "90", "-i", f.file, "-c", "copy"]);
  const rotation = indexOf(
    spawnSync("python", [SHEET, rotated, "overview", "0-1/1"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25000,
    }),
  );
  const { width, height } = rotation.data.source;
  assert.deepEqual([width, height], [180, 320]);
  assert.deepEqual(dimensions(rotation.data.entries[0].sheet), [720, 1280]);
});

test("frames select the same first video stream as the probe", (t) => {
  const f = fixture(t);
  const tracks = join(f.dir, "two-tracks.mp4");
  media(tracks, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:r=30:d=1",
    "-map",
    "0:v:0",
    "-map",
    "1:v:0",
    "-disposition:v:0",
    "0",
    "-disposition:v:1",
    "default",
    "-pix_fmt",
    "yuv420p",
  ]);
  const chosen = indexOf(
    spawnSync("python", [SHEET, tracks, "frames", "0.5"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25000,
    }),
  ).data;
  assert.deepEqual(dimensions(chosen.entries[0].frame), [160, 90]);
  assert.ok(rgb(chosen.entries[0].frame)[0] > 220);
});

test("--vs pairs the reference's frame at the same heard second beside ours, black where the reference has ended", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "references"));
  media(join(f.dir, "references/ref.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=lime:s=160x90:r=25:d=1",
    "-pix_fmt",
    "yuv420p",
  ]);
  const r = f.run("frames", "0.5,1.5", "--vs", "references/ref.mp4");
  const { data } = indexOf(r);
  const [inside, after] = data.entries;
  assert.equal(inside.reference.sourceTime, 0.48);
  assert.equal(after.reference, null);
  assert.deepEqual(dimensions(inside.vs), [640, 180]);
  const [refHalf, ourHalf] = ["crop=320:180:0:0,scale=1:1", "crop=320:180:320:0,scale=1:1"];
  assert.ok(rgb(inside.vs, refHalf)[1] > 220 && rgb(inside.vs, refHalf)[0] < 40);
  assert.ok(rgb(inside.vs, ourHalf)[0] > 220);
  assert.ok(rgb(after.vs, refHalf).every((c) => c < 30));
  assert.ok(rgb(after.vs, ourHalf)[2] > 220);
  assert.match(r.stdout, /reference \| ours/);

  const overview = indexOf(f.run("overview", "0-2/4", "--vs", "references/ref.mp4")).data;
  assert.deepEqual(dimensions(overview.entries[0].sheet), [2560, 720]);
  assert.ok(rgb(overview.entries[0].sheet, "crop=320:180:0:0,scale=1:1")[1] > 220);
  assert.ok(rgb(overview.entries[0].sheet, "crop=320:180:320:0,scale=1:1")[0] > 220);

  for (const [args, why] of [
    [["0.5", "--vs", "references/ref.mp4"], /--vs goes with frames or overview/],
    [["frames", "0.5", "--vs", "references/none.mp4"], /no references\/none\.mp4/],
    [["frames", "0.5", "--vs"], /--vs needs the reference video/],
  ]) {
    const bad = f.run(...args);
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, why);
  }
});
