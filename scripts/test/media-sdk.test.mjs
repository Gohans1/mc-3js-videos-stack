import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../media/sdk.py", import.meta.url));
test("melody debug output cannot target source media or previous evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-debug-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    old = join(root, "result.json"),
    config = join(root, "config.json"),
    out = join(root, "jobs");
  writeFileSync(source, "source bytes retained");
  writeFileSync(old, "previous evidence retained");
  for (const target of [source, old]) {
    writeFileSync(config, JSON.stringify({ debug_file: target }));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../media.mjs", import.meta.url)),
        "melody",
        source,
        "--config",
        config,
        "--out",
        out,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, MC_MEDIA_HOME: join(root, "empty-home") },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /debug_file/);
    assert.equal(readFileSync(source, "utf8"), "source bytes retained");
    assert.equal(readFileSync(old, "utf8"), "previous evidence retained");
    assert.equal(existsSync(out), false);
  }
});
test("separation refuses an unsupported thread promise before inference", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-separate-threads-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  writeFileSync(source, "not decoded");
  const result = spawnSync("python", [script, "separate", source, "--threads", "2", "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /unrecognized arguments/);
});

test("separation output format cannot escape its evidence folder", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-format-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    old = join(root, "old.json"),
    config = join(root, "config.json"),
    out = join(root, "jobs");
  writeFileSync(source, "original source");
  writeFileSync(old, "old evidence");
  for (const format of ["wav/../../../source.wav", "wav\\..\\..\\old.json", "C:source.wav"]) {
    writeFileSync(config, JSON.stringify({ output_format: format }));
    const r = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../media.mjs", import.meta.url)),
        "separate",
        source,
        "--config",
        config,
        "--out",
        out,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, MC_MEDIA_HOME: join(root, "empty") },
      },
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /output_format/);
    assert.equal(existsSync(out), false);
    assert.equal(readFileSync(source, "utf8"), "original source");
    assert.equal(readFileSync(old, "utf8"), "old evidence");
  }
});

test("invalid timeline objects and metadata fail before any output is created", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-timeline-shape-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "edit.json"),
    out = join(root, "evidence");
  const clip = { url: "file:///clip.mp4", duration: 24 };
  for (const value of [
    [],
    { fps: 24, tracks: [null] },
    { fps: 24, tracks: [{ clips: [null] }] },
    { fps: 24, tracks: [], metadata: [] },
    { fps: 24, tracks: [{ clips: [], metadata: "bad" }] },
    { fps: 24, tracks: [{ clips: [{ ...clip, metadata: ["bad"] }] }] },
  ]) {
    writeFileSync(source, JSON.stringify(value));
    const r = spawnSync("python", [script, "timeline", source, "--out", out, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /must be an object/);
    assert.equal(existsSync(out), false);
  }
});

test("timeline gaps require a boolean to preserve media references", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-gap-type-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "timeline.json");
  for (const gap of ["false", 0, null]) {
    writeFileSync(
      source,
      JSON.stringify({
        fps: 24,
        tracks: [{ clips: [{ url: "file:///clip.mp4", duration: 24, gap }] }],
      }),
    );
    const result = spawnSync("python", [script, "timeline", source, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /gap must be a boolean/);
  }
  writeFileSync(
    source,
    JSON.stringify({
      fps: 24,
      tracks: [{ clips: [{ url: "file:///clip.mp4", duration: 24, gap: false }] }],
    }),
  );
  const valid = spawnSync("python", [script, "timeline", source, "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(valid.status, 0, valid.stderr);
});

test("timeline names must be strings at every authored level", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-name-type-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "timeline.json");
  const clip = { url: "file:///clip.mp4", duration: 24 };
  for (const value of [
    { fps: 24, name: [], tracks: [] },
    { fps: 24, tracks: [{ name: null, clips: [] }] },
    { fps: 24, tracks: [{ clips: [{ ...clip, name: 7 }] }] },
  ]) {
    writeFileSync(source, JSON.stringify(value));
    const result = spawnSync("python", [script, "timeline", source, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /name must be a string/);
  }
});
test("melody notes normalize typed pitch bends and retain the source-file clock", () => {
  const backend = fileURLToPath(new URL("../media/audio_sdk.py", import.meta.url));
  const code =
    "import runpy,sys,json; from decimal import Decimal; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['note_rows']([(0.1,0.5,60,0.7,[Decimal(0),Decimal(1),Decimal(-1)])],10)))";
  const r = spawnSync("python", ["-c", code, backend], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { start: 10.1, end: 10.5, midiPitch: 60, amplitude: 0.7, pitchBends: [0, 1, -1] },
  ]);
});
test("event curves keep input-file offsets and clip spans at the decoded duration", () => {
  const code =
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['event_spans']([-1,2,3,-2,4],10,0.04,0,0.18)))";
  const r = spawnSync("python", ["-c", code, script], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { start: 10.04, end: 10.12 },
    { start: 10.16, end: 10.18 },
  ]);
});
test("SDK validation needs no optional environment and refuses bad input before writing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-sdk-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    config = join(root, "config.json"),
    out = join(root, "evidence");
  writeFileSync(source, "not decoded during validation");
  writeFileSync(config, JSON.stringify({ output_dir: "escaped" }));
  for (const args of [
    ["vad", source, "--from", "3", "--to", "1"],
    ["locate", source],
    ["effects", source],
    ["separate", source, "--config", config],
  ]) {
    const r = spawnSync("python", [script, ...args, "--out", out, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /error:/);
    assert.equal(existsSync(out), false);
  }
  const r = spawnSync(
    "python",
    [script, "beat", source, "--from", "1:02", "--to", "1:05", "--dry-run"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).fromSeconds, 62);
  assert.equal(JSON.parse(r.stdout).toSeconds, 65);
});
test("timeline input rejects negative ranges before loading OTIO or creating output", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-otio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "edit.json"),
    out = join(root, "evidence");
  writeFileSync(
    source,
    JSON.stringify({
      fps: 24,
      tracks: [{ clips: [{ url: "file:///clip.mp4", start: 0, duration: -1 }] }],
    }),
  );
  const r = spawnSync("python", [script, "timeline", source, "--out", out, "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /duration/);
  assert.equal(existsSync(out), false);
  writeFileSync(source, JSON.stringify({ fps: 24, tracks: [] }));
  const ignored = spawnSync("python", [script, "timeline", source, "--from", "1", "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(ignored.status, 2, ignored.stderr);
  assert.match(ignored.stderr, /unrecognized arguments/);
});
