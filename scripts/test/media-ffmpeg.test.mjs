import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const fixture = mediaFixture();

const CLI = fileURLToPath(new URL("../media.mjs", import.meta.url));
const run = (args) =>
  spawnSync(process.execPath, [CLI, "ffmpeg", ...args], {
    encoding: "utf8",
    timeout: 75_000,
    maxBuffer: 8 * 1024 * 1024,
  });

test("focused schema avoids global contract noise and matches native parser fields", () => {
  const result = run(["schema", "cut"]);
  assert.equal(result.status, 0, result.stderr);
  const spec = JSON.parse(result.stdout);
  assert.equal(spec.name, "cut");
  assert.ok(spec.input_schema.properties.smart);
  assert.ok(spec.unverified_properties.includes("picture_content"));
  assert.equal(Object.hasOwn(spec, "tools"), false);
});

test("legitimate native listing text is classified without a transport error", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-text-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const result = run(["export", "--out", folder, "--", "--list"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.nativeFormat, "text");
  assert.equal(Object.hasOwn(report, "nativeParseError"), false);
  assert.match(readFileSync(join(report.folder, "native.json"), "utf8"), /prores/);
});

test("multi-input dotted fields keep native JSONL and source bytes", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-jsonl-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "a clip.wav");
  fixture(source, ["-f", "lavfi", "-i", "sine=r=16000:d=0.25", "-c:a", "pcm_s16le"]);
  const before = readFileSync(source);
  const result = run([
    "probe",
    "--out",
    join(folder, "runs"),
    "--",
    source,
    source,
    "--field",
    "duration",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.nativeFormat, "jsonl");
  assert.deepEqual(report.native, [0.25, 0.25]);
  assert.deepEqual(readFileSync(source), before);
});

test("a written file's identity round-trips without loss through the JSON wrapper", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-identity-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "source.mp4");
  fixture(source, ["-f", "lavfi", "-i", "testsrc2=s=160x90:d=2", "-c:v", "libx264"]);
  const output = join(folder, "output.mp4");
  const cut = run([
    "cut",
    "--out",
    folder,
    "--",
    source,
    "--start",
    "0",
    "--end",
    "1",
    "-o",
    output,
  ]);
  assert.equal(cut.status, 0, cut.stdout + cut.stderr);
  const { size, mtime_ns } = JSON.parse(cut.stdout).native.output_identity;
  assert.equal(String(mtime_ns), String(statSync(output, { bigint: true }).mtimeNs));
  const checked = run([
    "check",
    "--out",
    folder,
    "--",
    output,
    "--expect-identity",
    `${size}:${mtime_ns}`,
    "--no-loudness",
  ]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test("accurate cuts retain in-range audio ahead of the first picture", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-audio-lead-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "delayed.mp4");
  fixture(source, [
    "-itsoffset",
    "0.52",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x96:r=25:d=1.36",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(between(t\\,0.35\\,0.42)+between(t\\,0.8\\,0.95)\\,0.5*sin(2*PI*700*t)\\,0):s=48000:d=3",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
  ]);
  for (const [extension, end] of [
    ["mp4", "1.3"],
    ["wav", "1.3"],
    ["wav", "0.49"],
  ]) {
    const output = join(folder, `cut-${end}.${extension}`);
    const cut = run([
      "cut",
      "--minutes",
      "1",
      "--out",
      folder,
      "--",
      source,
      "--start",
      "0.3",
      "--end",
      end,
      "--accurate",
      "-o",
      output,
    ]);
    assert.equal(cut.status, 0, cut.stdout + cut.stderr);
    const pcm = spawnSync(
      "ffmpeg",
      ["-v", "error", "-i", output, "-map", "0:a:0", "-t", "0.14", "-f", "s16le", "-"],
      { timeout: 10000 },
    );
    assert.equal(pcm.status, 0, String(pcm.stderr));
    const samples = pcm.stdout;
    assert.ok(samples.length >= 4800 * 2);
    const peak = Math.max(
      ...Array.from({ length: 2880 }, (_, i) => Math.abs(samples.readInt16LE((1920 + i) * 2))),
    );
    assert.ok(peak > 4000, `missing the early audio hit in ${extension}`);
  }
});

test("native cut decodes each output stream's first window with a delayed VFR picture", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-decode-head-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "delayed.mkv");
  fixture(source, [
    "-itsoffset",
    "0.5",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x96:r=2:d=2,setpts='if(gte(N,2),PTS+1/TB,PTS)'",
    "-f",
    "lavfi",
    "-i",
    "sine=f=730:r=44100:d=4",
    "-c:v",
    "ffv1",
    "-g",
    "1",
    "-fps_mode",
    "vfr",
    "-c:a",
    "pcm_s16le",
  ]);
  const output = join(folder, "cut.mp4");
  const cut = run([
    "cut",
    "--minutes",
    "1",
    "--out",
    folder,
    "--",
    source,
    "--start",
    "1.75",
    "--end",
    "3.15",
    "--accurate",
    "-o",
    output,
  ]);
  assert.equal(cut.status, 0, cut.stdout + cut.stderr);
  const { native } = JSON.parse(cut.stdout);
  const decode = native.verification.find((step) => step.step === "decode");
  assert.ok(decode.frames.audio.head > 0, JSON.stringify(decode));
});

test("native check rejects picture retiming with identical ordered frames", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-retimed-picture-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const original = join(folder, "original.mkv");
  fixture(original, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=10:d=2,drawbox=color=lime:t=fill:enable='gte(t,0.5)'",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=48000:d=3",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-bf",
    "0",
    "-c:a",
    "pcm_s16le",
  ]);
  const delayed = join(folder, "delayed.mkv");
  fixture(delayed, [
    "-copyts",
    "-itsoffset",
    "0.4",
    "-i",
    original,
    "-i",
    original,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
  ]);
  const check = (input) =>
    run([
      "check",
      "--minutes",
      "1",
      "--out",
      folder,
      "--",
      input,
      "--compare",
      original,
      "--expect-changed",
      "none",
      "--change-floor",
      "1",
      "--no-loudness",
    ]);
  const same = check(original);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  const retimed = check(delayed);
  assert.equal(retimed.status, 1, retimed.stdout + retimed.stderr);
  assert.match(retimed.stdout, /picture presentation time/i);
  const longerHold = join(folder, "longer-hold.mp4");
  fixture(longerHold, [
    "-i",
    original,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-bsf:v",
    "setts=duration=if(eq(N\\,19)\\,5*DURATION\\,DURATION)",
  ]);
  const extended = check(longerHold);
  assert.equal(extended.status, 1, extended.stdout + extended.stderr);
  assert.match(extended.stdout, /picture end time differs/i);
});

test("bundled FFmpeg contract comes from native parsers without environments or model downloads", () => {
  const result = run(["contract", "--", "--static", "--tool", "cut"]);
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout);
  assert.equal(contract.skill.version, "3.10.1");
  assert.equal(contract.tools.length, 1);
  assert.ok(contract.tools[0].input_schema.properties.smart);
});

test("FFmpeg discovery explains overlap and preserves native help", () => {
  const list = run(["list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  const tools = JSON.parse(list.stdout);
  assert.equal(tools.length, 42);
  assert.ok(tools.find((row) => row.name === "sync").adoption);
  const help = run(["cut", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--smart/);
});

test("invalid wrapper controls and native tool names never create evidence", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-invalid-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const out = join(folder, "evidence");
  for (const args of [
    ["../probe"],
    ["probe", "--minutes", "NaN"],
    ["probe", "--out"],
    ["probe", "--unexpected"],
  ]) {
    const result = run([...args, "--out", out]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(existsSync(out), false);
  }
});

test("native JSON failures stay distinct from process success and preserve all evidence", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "ffmpeg-evidence-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, "bad.wav");
  writeFileSync(source, "invalid media, must stay intact");
  const result = run(["probe", "--out", join(folder, "runs"), "--", source]);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "failed");
  assert.equal(report.native.status, "failed");
  assert.ok(report.native.error);
  assert.ok(existsSync(join(report.folder, "native.json")));
  assert.ok(existsSync(join(report.folder, "process.log")));
  assert.equal(readFileSync(source, "utf8"), "invalid media, must stay intact");
});
