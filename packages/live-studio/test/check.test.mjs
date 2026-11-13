import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STUDIO } from "../src/film.mjs";
import { readFaults } from "../src/readable.mjs";

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

  // the keys every film's camera reads, typed and spelt (a probe's fov "wide" and "fvo" passed, a 2-number p said only "Invalid input")
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: "wide" },
      { t: 1, p: [0, 1], l: [0, 1, 0], fvo: 40 },
    ]),
  );
  const cam = check();
  assert.equal(cam.status, 1, cam.stdout + cam.stderr);
  assert.match(cam.stderr, /at \[0\]\.fov/);
  assert.match(cam.stderr, /\[x, y, z\][^\n]*\n\s*→ at \[1\]\.p/);
  assert.match(cam.stderr, /\[1\] "fvo": no key the camera reads; did you mean "fov"\?/);

  // a misspelt key named even while the row it belongs to is missing the right one
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0] }]),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "door_slam", at: 1, gian: -8 }] }),
  );
  const gian = check();
  assert.equal(gian.status, 1, gian.stdout + gian.stderr);
  assert.match(gian.stderr, /sfx\.0\.gain|sfx\[0\]\.gain/);
  assert.match(gian.stderr, /sfx\[0\] "gian": no key the mix reads; did you mean "gain"\?/);
});

test("check names a transition or anim one letter off a built-in, and leaves a film's own name alone", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { shotsTimeline: "src/timeline/shots.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "a" },
      { t: 2, name: "b", transition: { fx: "disolve", len: 0.5 }, anim: { in: { fx: "psuh" } } },
      { t: 4, name: "c", transition: { fx: "myWarp", len: 0.5 } },
    ]),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  // a typo plays a hard cut and no anim, silently: only a warning, since a film may name its own
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/shots\.json \[1\]\.transition "disolve"[^\n]*did you mean "dissolve"\?/,
  );
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/shots\.json \[1\]\.anim\.in "psuh"[^\n]*did you mean "push"\?/,
  );
  assert.doesNotMatch(r.stdout, /myWarp/);
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

// on-screen words have to be read before they go, and a line too small is mush on a phone: both warnings, never refusals
test("check warns of text shown too briefly to read and text too small for a phone, each with the seconds it plays", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "src/timeline/text.json" } }),
  );
  const fade = { fx: "fade", len: 0.5 };
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        {
          kind: "text",
          text: "THE VAULT WAS NEVER MEANT TO OPEN AGAIN",
          from: 2,
          to: 3.5,
          in: fade,
          out: fade,
        },
        { kind: "text", text: "Day 3", size: 24, from: 4, to: 7 },
        { kind: "text", text: "OK", size: 56, from: 7, to: 9 },
        { kind: "arrow", from: 1, to: 1.2 },
      ],
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/text\.json items\[0\] "THE VAULT WAS NEVER[^"]*" at 2\.00-3\.50 heard \("from": 2\): readable about 1\.00 s for 39 characters; a reader needs 1\.95 s/,
  );
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/text\.json items\[1\] "Day 3" at 4\.00-7\.00 heard \("from": 4\): size 24 is 2\.2% of the frame height/,
  );
  assert.doesNotMatch(r.stdout, /items\[2\]|items\[3\]/);
});

test("a size is a share of the frame's short side: its height in a 16:9 film, its width in a Short", () => {
  const day = { kind: "text", text: "Day 3", size: 24, from: 4, to: 7 };
  assert.match(readFaults(day, day).join("\n"), /2\.2% of the frame height/);
  assert.match(readFaults(day, day, "9:16").join("\n"), /2\.2% of the frame width/);
});
