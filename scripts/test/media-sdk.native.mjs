import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const mediaHome = resolve(process.env.MC_MEDIA_HOME || join(ROOT, "vault/tools/media"));
const pythonFor = (id) =>
  join(mediaHome, id, "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const effectsPython = pythonFor("effects");
const separatorPython = pythonFor("separate");
const cli = join(ROOT, "scripts/media.mjs");
test(
  "native OTIO preserves frame ranges, names and metadata through a handoff",
  { timeout: 60000 },
  () => {
    const python = pythonFor("timeline");
    assert.ok(
      existsSync(python),
      "run bun run media setup timeline before this optional native check",
    );
    const folder = mkdtempSync(join(tmpdir(), "media-otio-native-"));
    const source = join(folder, "edit.json");
    writeFileSync(
      source,
      JSON.stringify({
        name: "handoff",
        fps: 24,
        metadata: { intent: "keep" },
        tracks: [
          {
            name: "audio",
            kind: "Audio",
            metadata: { track: "kept" },
            clips: [
              {
                name: "voice",
                url: "file:///voice.wav",
                start: 24,
                duration: 48,
                metadata: { clip: "kept" },
              },
              { gap: true, name: "pause", duration: 12, metadata: { gap: "kept" } },
            ],
          },
        ],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [cli, "timeline", source, "--out", join(folder, "jobs"), "--minutes", "1"],
      { cwd: ROOT, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const job = JSON.parse(result.stdout);
    const code =
      "import opentimelineio as o,sys,json; t=o.adapters.read_from_file(sys.argv[1]); track=t.tracks[0]; clip,gap=track; print(json.dumps({'name':t.name,'frames':t.duration().value,'rate':t.duration().rate,'start':clip.source_range.start_time.value,'duration':clip.source_range.duration.value,'gapName':gap.name,'gapFrames':gap.source_range.duration.value,'metadata':[dict(t.metadata),dict(track.metadata),dict(clip.metadata),dict(gap.metadata)]}))";
    const probe = spawnSync(python, ["-c", code, join(job.folder, "timeline.otio")], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(probe.status, 0, probe.stderr);
    const data = JSON.parse(probe.stdout);
    assert.deepEqual(data, {
      name: "handoff",
      frames: 60,
      rate: 24,
      start: 24,
      duration: 48,
      gapName: "pause",
      gapFrames: 12,
      metadata: [{ intent: "keep" }, { track: "kept" }, { clip: "kept" }, { gap: "kept" }],
    });
    writeFileSync(join(folder, "verification.json"), probe.stdout);
    console.log(`native OTIO evidence: ${folder}`);
  },
);
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "media-audio-native-"));
  const source = join(folder, "tone.wav");
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=8",
      "-c:a",
      "pcm_s16le",
      source,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return { folder, source, hash: createHash("sha256").update(readFileSync(source)).digest("hex") };
}
function invoke(tool, source, folder, config, extra = []) {
  const path = join(folder, "config.json");
  writeFileSync(path, JSON.stringify(config));
  const result = spawnSync(
    process.execPath,
    [
      cli,
      tool,
      source,
      "--config",
      path,
      "--out",
      join(folder, "jobs"),
      "--minutes",
      "2",
      ...extra,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 150000 },
  );
  writeFileSync(join(folder, "command.log"), result.stdout + result.stderr);
  const job = JSON.parse(result.stdout);
  return { result, job, data: JSON.parse(readFileSync(join(job.folder, "result.json"), "utf8")) };
}

test(
  "native PitchShift preserves the padded duration and shifts a real tone by three semitones",
  { timeout: 180000 },
  () => {
    assert.ok(
      existsSync(effectsPython),
      "run bun run media setup effects before this optional native check",
    );
    const { folder, source, hash } = fixture();
    const { result, job } = invoke("effects", source, folder, [
      { name: "PitchShift", parameters: { semitones: 3 } },
    ]);
    assert.equal(result.status, 0, result.stderr);
    const code =
      "import json,soundfile as sf,numpy as np,sys; a,sr=sf.read(sys.argv[1]); print(json.dumps({'frames':len(a),'rate':sr,'peak':float(np.abs(a).max()),'frequency':float(np.argmax(np.abs(np.fft.rfft(a)))*sr/len(a))}))";
    const probe = spawnSync(effectsPython, ["-c", code, join(job.folder, "effect.wav")], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(probe.status, 0, probe.stderr);
    const data = JSON.parse(probe.stdout);
    writeFileSync(join(folder, "verification.json"), JSON.stringify(data, null, 2));
    assert.equal(data.frames, 480000);
    assert.ok(data.peak > 0.01, `silent output: ${JSON.stringify(data)}`);
    assert.ok(Math.abs(data.frequency - 440 * 2 ** (3 / 12)) < 3, JSON.stringify(data));
    assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), hash);
    console.log(`native PitchShift evidence: ${folder}`);
  },
);

test(
  "native separation reports failure when its selected model has no requested stem",
  { timeout: 180000 },
  () => {
    assert.ok(
      existsSync(separatorPython),
      "run bun run media setup separate before this optional native check",
    );
    const { folder, source, hash } = fixture();
    const { result, job, data } = invoke(
      "separate",
      source,
      folder,
      { output_single_stem: "Drums" },
      ["--to", "1"],
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(job.status, "failed");
    assert.equal(data.status, "failed");
    assert.match(data.error, /no stems/i);
    assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), hash);
    console.log(`native separation evidence: ${folder}`);
  },
);
