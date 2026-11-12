import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STUDIO } from "../src/film.mjs";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));

test("check finds what the studio would refuse, offline: a broken timeline file and a sound name no folder has", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.5", "sound/sfx/door_slam.wav"],
    {
      cwd: dir,
    },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
        camTimeline: "src/timeline/cam.json",
      },
    }),
  );
  const audio = (name) =>
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ beds: [], sfx: [{ name, at: 1, gain: 0 }] }),
    );
  const check = (...args) =>
    spawnSync("bun", [CHECK, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });

  audio("door_slamm");
  writeFileSync(join(dir, "src/timeline/cam.json"), "[]");
  const bad = check();
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /src\/timeline\/cam\.json/);
  assert.match(bad.stderr, /"door_slamm" \(sfx\[0\]\) is no sound the studio has.*door_slam/);
  const json = JSON.parse(check("--json").stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(
    json.problems.map((p) => p.where),
    ["src/timeline/cam.json", "src/timeline/audio.json"],
  );

  audio("door_slam");
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0] }]),
  );
  const good = check();
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /^ok/);
});

test("check refuses a sound placed after the film ends, and only warns of a gain far over the file's own level", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.5", "sound/sfx/door_slam.wav"],
    {
      cwd: dir,
    },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx" },
    }),
  );
  const audio = (sfxAt, bedGain) =>
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({
        beds: [{ name: "door_slam", from: 0, to: 9, gain: bedGain, fadeIn: 0, fadeOut: 0 }],
        sfx: [{ name: "door_slam", at: sfxAt, gain: 0 }],
      }),
    );
  const check = () => spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });

  audio(12, 0);
  const late = check();
  assert.equal(late.status, 1, late.stdout + late.stderr);
  assert.match(
    late.stderr,
    /sfx\[0\] "door_slam" at 12: after the film ends \(10\.00 s heard\), so never heard/,
  );

  audio(4, 20);
  const loud = check();
  assert.equal(loud.status, 0, loud.stdout + loud.stderr);
  assert.match(loud.stdout, /⚠ beds\[0\] "door_slam" gain \+20 dB/);

  // a misspelt key is read by nothing: the AI believes it changed the sound and nothing did
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [{ name: "door_slam", at: 4, gain: 0, gian: -6 }],
      lufs: -3,
      drive: 99,
    }),
  );
  const typo = check();
  assert.equal(typo.status, 1, typo.stdout + typo.stderr);
  assert.match(typo.stderr, /sfx\[0\] "gian": no key the mix reads; did you mean "gain"\?/);
  assert.match(typo.stderr, /⚠ lufs -3/);
  assert.match(typo.stderr, /⚠ drive \+99 dB/);

  // one fault must not hide the others: an AI fixes what it is shown, runs check again and meets the next only then
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [
        { name: "door_slamm", at: 4, gain: 99 },
        { name: "door_slam", at: -2, gain: 0 },
      ],
    }),
  );
  const many = check();
  assert.equal(many.status, 1, many.stdout + many.stderr);
  assert.match(many.stderr, /sfx\.1\.at|sfx\[1\]\.at/);
  assert.match(many.stderr, /"door_slamm" \(sfx\[0\]\) is no sound the studio has/);
  assert.match(many.stderr, /once these are fixed/);

  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "door_slamm", at: 4, gain: 99 }] }),
  );
  const named = check();
  assert.match(named.stderr, /"door_slamm" \(sfx\[0\]\) is no sound the studio has/);
  assert.match(named.stdout + named.stderr, /⚠ sfx\[0\] "door_slamm" gain \+99 dB/);
});
