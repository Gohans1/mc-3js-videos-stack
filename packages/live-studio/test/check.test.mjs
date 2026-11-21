import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STUDIO } from "../src/film.mjs";
import { compileLayerTiming } from "../src/layer-timing.mjs";
import {
  fallbackTimingDuration,
  readFaults,
  sizeFaults,
  textCheckSample,
} from "../src/readable.mjs";
import { frameVisible } from "../src/timing.mjs";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));

test("check finds what the studio would refuse, offline: a broken timeline file and a sound name no folder has", (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(dir);
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
  // the last line is next:, as every film command's (skill-data/core/references/cli.md)
  assert.match(
    good.stdout.trim().split("\n").at(-1),
    /^next: look at it: bun run render stills --at <seconds>/,
  );
  assert.match(
    bad.stderr.trim().split("\n").at(-1),
    /^next: fix each ✖ as it says, then bun run check/,
  );

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

  // a field of the film's own two letters off a mix key ("room", "from") is the film's, as on a camera key
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [{ name: "door_slam", from: 0, to: 2, gain: 0, fadeIn: 0, fadeOut: 0, room: "cell" }],
      sfx: [],
    }),
  );
  const own = check();
  assert.equal(own.status, 0, own.stdout + own.stderr);
});

test("a key one letter or a case off a camera key is a warning that names it; fog by fov and cute by cut are the film's", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
  );
  const cam = (extra) => {
    writeFileSync(
      join(dir, "src/timeline/cam.json"),
      JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0], ...extra }]),
    );
    return spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  };
  const own = cam({ fog: 0.4, cute: 1 });
  assert.equal(own.status, 0, own.stdout + own.stderr);
  assert.doesNotMatch(own.stdout, /"fog"|"cute"/);
  // a guess, never a fault: a key of the film's own that looks like a typo (waves) must not fail the film
  const typo = cam({ rlol: 5, Fov: 40, waves: 2 });
  assert.equal(typo.status, 0, typo.stdout + typo.stderr);
  assert.match(
    typo.stdout,
    /⚠ src\/timeline\/cam\.json \[0\] "rlol": no key the camera reads; did you mean "roll"\?/,
  );
  assert.match(typo.stdout, /\[0\] "Fov": no key the camera reads; did you mean "fov"\?/);
  assert.match(typo.stdout, /\[0\] "waves": .*did you mean "wave"\?/);
  assert.match(typo.stdout, /a key of the film's own is fine to leave/);
});

test("a timing file of the wrong shape is named as a fault, not a crash", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        timingTimeline: "src/timeline/timing.json",
        soundTimeline: "src/timeline/audio.json",
      },
    }),
  );
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({ speeds: "bad" }));
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: [], sfx: [] }));
  // a film whose length is in its data: check then reads timing.json for the heard seconds
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  const r = spawnSync("bun", [CHECK, "--json"], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).problems[0].where, "src/timeline/timing.json");
});

test("a key of the film's own near a studio key (uid by id, top by to, ot by to, laces by scale) is the film's", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "src/timeline/text.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        { kind: "text", text: "HI", from: 0, to: 3, uid: 1, top: 2, ot: 3, laces: 4, colr: "#fff" },
      ],
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /"colr": .*did you mean "color"\?/);
  assert.doesNotMatch(r.stdout, /"uid"|"top"|"ot"|"laces"/);
});

test("a misspelt package.json live-studio key is named as a warning: its file would be read by nothing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimline: "src/timeline/cam.json", myOwn: 1 } }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /"camTimline": .*did you mean "camTimeline"\?/);
  assert.doesNotMatch(r.stdout, /"myOwn"/);
});

// a film made before a command joined the template has no script for it: bun run says only "Script not found"
// a script runs a file next to the film (node_modules/live-studio, ../../scripts in films/<name>): one whose file a
// project outside the repo lacks is not offered
test("commands the template film has and this film's scripts lack are named on one line with what to add", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules/live-studio"), { recursive: true });
  for (const f of ["sweep.mjs", "framecheck.mjs"])
    writeFileSync(join(dir, "node_modules/live-studio", f), "");
  const { scripts } = JSON.parse(
    readFileSync(join(STUDIO, "../../templates/film/package.json"), "utf8"),
  );
  const { sweep, framecheck, pace, ...older } = scripts;
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      scripts: { ...older, studio: "bun node_modules/live-studio/src/live.mjs 4400" },
      "live-studio": {},
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const said = r.stdout.split("\n").filter((l) => l.includes("the template film has"));
  assert.deepEqual(said, [
    `⚠ package.json lacks scripts the template film has (bun run says only "Script not found"): add to its "scripts" ${JSON.stringify({ framecheck, sweep }).slice(1, -1)}`,
  ]);
  assert.match(
    pace,
    /\.\.\/\.\.\/scripts\//,
    "pace runs a file this folder has not, so it is left out",
  );
});

test("a file with faults from two checks is one problem, all its faults under it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx" },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "nothing_here", at: 1, gain: "loud" }] }),
  );
  const r = spawnSync("bun", [CHECK, "--json"], { cwd: dir, encoding: "utf8", timeout: 60000 });
  const { problems } = JSON.parse(r.stdout);
  assert.deepEqual(
    problems.map((p) => p.where),
    ["src/timeline/audio.json"],
  );
  assert.match(
    problems[0].issue,
    /gain[\s\S]*"nothing_here" \(sfx\[0\]\) is no sound the studio has/,
  );
});

test("a fault in the text file says the readability checks wait for it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "src/timeline/text.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "HI", from: 0, to: 3, track: "top" }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /on-screen text \(too brief, too small\) is checked once this is fixed/);
});

test("a sound folder outside the film is a fault in package.json, and --json stays one document", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": { soundTimeline: "src/timeline/audio.json", sfx: "../elsewhere" },
    }),
  );
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: [], sfx: [] }));
  const r = spawnSync("bun", [CHECK, "--json"], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const { problems } = JSON.parse(r.stdout);
  assert.match(
    JSON.stringify(problems),
    /package\.json.*SFX folder escapes film directory: \\"..\/elsewhere\\"/,
  );
});

test("a two-letter key of the film's own (to by t) is the film's, on a camera key", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0], to: 3, up: [0, 1, 0] }]),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a misspelt key on a shot, a text item or an adjustment layer is named as a warning; the film's own keys are left alone", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        shotsTimeline: "src/timeline/shots.json",
        textTimeline: "src/timeline/text.json",
        adjustmentTimeline: "src/timeline/adjust.json",
      },
    }),
  );
  const put = (f, v) => writeFileSync(join(dir, "src/timeline", f), JSON.stringify(v));
  put("shots.json", [
    { t: 0, name: "a" },
    { t: 2, name: "b", tranistion: { fx: "dissolve", len: 0.5 }, mood: "calm" },
  ]);
  put("text.json", {
    items: [{ kind: "text", text: "HI", from: 0, to: 3, colr: "#fff", in: { fx: "fade", lne: 1 } }],
  });
  put("adjust.json", {
    items: [{ id: "a", name: "warm", from: 0, to: 3, track: 0, grade: {}, timbase: "scene" }],
  });
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[1\] "tranistion": .*did you mean "transition"\?/);
  assert.match(r.stdout, /items\[0\] "colr": .*did you mean "color"\?/);
  assert.match(r.stdout, /items\[0\]\.in "lne": .*did you mean "len"\?/);
  assert.match(r.stdout, /items\[0\] "timbase": .*did you mean "timebase"\?/);
  assert.doesNotMatch(r.stdout, /"mood"/);
});

test("a misspelt key at the top of edit.json or timing.json (taeks, speed) is named: the film plays as if it were not there", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { timingTimeline: "src/timeline/timing.json" } }),
  );
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, taeks: [], zoomRate: 1 }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speed: [{ from: 0, to: 2, rate: 2 }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /src\/edit\.json "taeks": .*did you mean "takes"\?/);
  assert.match(r.stdout, /src\/timeline\/timing\.json "speed": .*did you mean "speeds"\?/);
  assert.doesNotMatch(r.stdout, /"zoomRate"/);
});

// a film with the demo's scene, a 10 s reference study of these hits (none when hits is null) and these sound effects
// ("line" is its narration); refs(dir) adds files under references/
const coverageFilm = (t, hits, sfx, refs) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  for (const [name, hz] of [
    ["line", 440],
    ["door_slam", 880],
  ]) {
    const ff = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `sine=d=0.5:f=${hz}`, `sound/sfx/${name}.wav`],
      { cwd: dir },
    );
    assert.equal(ff.status, 0, String(ff.stderr));
  }
  if (hits) {
    mkdirSync(join(dir, "renders/reference/ref/run-1"), { recursive: true });
    writeFileSync(
      join(dir, "renders/reference/ref/run-1/study.json"),
      JSON.stringify({ fps: 30, duration: 10, picture: { cuts: [] }, sound: { hits } }),
    );
  }
  if (refs) {
    mkdirSync(join(dir, "references"));
    refs(dir);
  }
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], narration: "line", sfx }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 1, -3], l: [0, 1, 0] },
      { t: 5, p: [1, 1, -3], l: [0, 1, 0] },
    ]),
  );
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
  const r = spawnSync("bun", [CHECK, "--json"], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};

// coverage counts a reference's sound hits that have a sound effect: the narration starting at 0 is no effect
test("check --json gives the reference coverage, matching sound hits with effects only, and warns of a guide sound", (t) => {
  const { coverage, warnings } = coverageFilm(
    t,
    [{ at: 0 }, { at: 2 }, { at: 6 }],
    [
      { name: "line", at: 0, gain: 0, guide: true },
      { name: "door_slam", at: 2, gain: 0 },
    ],
  );
  assert.deepEqual(coverage.sounds, { matched: 1, of: 3 });
  assert.ok(
    warnings.some((w) => /guide sound "line": drafts play it; bun run mix refuses a final/.test(w)),
  );
  assert.ok(!warnings.some((w) => /"guide": no key the studio reads/.test(w)));
  assert.deepEqual(coverage.picture, { seconds: 5, share: 0.5 });
});

// a remake scratches with the reference's own narration: check names it until its rows are guides
test("check warns of an unstudied reference and of a sound that is a reference's file, until its rows are guides", (t) => {
  const film = (guide) =>
    coverageFilm(
      t,
      null,
      [
        { name: "line", at: 0, gain: 0, guide },
        { name: "line", at: 4, gain: 0, guide },
        { name: "door_slam", at: 2, gain: 0 },
      ],
      (dir) => {
        cpSync(join(dir, "sound/sfx/line.wav"), join(dir, "references/vox.wav"));
        writeFileSync(join(dir, "references/ref.mp4"), "not studied");
      },
    ).warnings;
  const scratch = film(false);
  assert.deepEqual(
    scratch.filter((w) => /byte for byte/.test(w)),
    [
      `⚠ src/timeline/audio.json "line" is references/vox.wav byte for byte, the reference's own recording: mark its rows "guide": true so bun run mix refuses to ship it`,
    ],
  );
  assert.ok(
    scratch.some((w) =>
      /^⚠ references\/ref\.mp4 has no study.*bun run reference study references\/ref\.mp4$/.test(w),
    ),
  );
  assert.ok(!film(true).some((w) => /byte for byte/.test(w)));
});

// a study hears every onset, the voice's syllables too: only its strong accents are the cues a remake must hit
test("coverage asks for the reference's strong hits only, met by an effect starting up to half a second early", (t) => {
  const { coverage } = coverageFilm(
    t,
    [
      { at: 2, strength: 0.9 },
      { at: 4, strength: 0.2 },
      { at: 6, strength: 0.7 },
      { at: 8, strength: 0.6 },
    ],
    [
      { name: "door_slam", at: 1.6, gain: 0 },
      { name: "door_slam", at: 4, gain: 0 },
      { name: "door_slam", at: 7.2, gain: 0 },
    ],
  );
  // a whoosh starts before the beat its peak lands on (1.6 for 2); 7.2 is too early for 8
  assert.deepEqual(coverage.sounds, { matched: 1, of: 3 });
});

// the build throws on an unknown tone map; check is where an AI looks after editing edit.json
test("a tone map name the film-stage does not have is a fault in edit.json, with the near name", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ ...edit, look: { ...edit.look, toneMapping: "Neutral" } }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /look\.toneMapping "Neutral": .*did you mean "neutral"\?/);
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
  const root = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(dir);
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

  // a muted track is left out of every mix (mix.py MUTED), as a hidden track's text is never drawn: neither is judged
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      tracks: [{ id: "m", name: "Muted", mute: true }],
      beds: [{ name: "door_slam", from: 0, to: 9, gain: 20, fadeIn: 0, fadeOut: 0, track: "m" }],
      sfx: [{ name: "door_slam", at: 12, gain: 0, track: "m" }],
    }),
  );
  const muted = check();
  assert.equal(muted.status, 0, muted.stdout + muted.stderr);
  assert.doesNotMatch(muted.stdout, /gain \+20/);

  // a misspelt key is read by nothing: the AI believes it changed the sound and nothing did; a warning, as a key of the film's own looks the same
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
  assert.equal(typo.status, 0, typo.stdout + typo.stderr);
  assert.match(typo.stdout, /sfx\[0\] "gian": no key the mix reads; did you mean "gain"\?/);
  assert.match(typo.stdout, /⚠ lufs -3/);
  assert.match(typo.stdout, /⚠ drive \+99 dB/);

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
  assert.ok(
    many.stderr.indexOf("door_slamm") < many.stderr.indexOf("once these are fixed"),
    `expected missing-sound error before footer:\n${many.stderr}`,
  );

  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "door_slamm", at: 4, gain: 99 }] }),
  );
  const named = check();
  assert.match(named.stderr, /"door_slamm" \(sfx\[0\]\) is no sound the studio has/);
  assert.match(named.stdout + named.stderr, /⚠ sfx\[0\] "door_slamm" gain \+99 dB/);
});

// on-screen words have to be read before they go, and a line too small is mush on a phone: both warnings, never refusals
// captions cut per spoken phrase, as a Short's are, run faster than a subtitle: one line for them all, not one each,
// so the warnings under them still get read
test("check says many captions too brief to read in one line, naming the first three; --json lists each", (t) => {
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
  const brief = (count) => {
    const items = Array.from({ length: count }, (_, n) => ({
      kind: "text",
      text: `word ${n + 1}`,
      from: n + 1,
      to: n + 1.4,
    }));
    items.push({ kind: "text", text: "tiny", size: 24, from: 8, to: 9.5 });
    writeFileSync(join(dir, "src/timeline/text.json"), JSON.stringify({ items }));
    const run = (args) =>
      spawnSync("bun", [CHECK, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });
    const text = run([]),
      json = run(["--json"]);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    const pace = (lines) => lines.filter((w) => /Netflix's subtitle pace/.test(w));
    return {
      said: pace(text.stdout.split("\n")),
      listed: pace(JSON.parse(json.stdout).warnings),
      text,
    };
  };
  const many = brief(5);
  assert.equal(many.said.length, 1, many.said.join("\n"));
  assert.match(
    many.said[0],
    /^⚠ src\/timeline\/text\.json 5 items show for less than a reader needs .*: items\[0\] "word 1" at 1\.00 heard, 0\.40 s of 0\.83; items\[1\] "word 2" at 2\.00 heard, 0\.40 s of 0\.83; items\[2\] "word 3" at 3\.00 heard, 0\.40 s of 0\.83; and 2 more/,
  );
  assert.match(many.text.stdout, /items\[5\] "tiny" .*size 24/);
  // a reader of --json fixes each one: every item keeps its own line there
  assert.equal(many.listed.length, 5);
  // three are said one by one
  assert.equal(brief(3).said.length, 3);
});

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
  // --json warnings are the warnings, without the advice printed under them
  const asJson = JSON.parse(
    spawnSync("bun", [CHECK, "--json"], { cwd: dir, encoding: "utf8", timeout: 60000 }).stdout,
  );
  assert.ok(
    asJson.warnings.every((w) => w.startsWith("⚠")),
    asJson.warnings.join("\n"),
  );
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/text\.json items\[1\] "Day 3" at 4\.00-7\.00 heard \("from": 4\): size 24 is 2\.2% of the frame height/,
  );
  assert.doesNotMatch(r.stdout, /items\[2\]|items\[3\]/);
});

test("text hidden, or on a hidden track, is never judged for reading", (t) => {
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
  const tiny = (more) => ({ kind: "text", text: "Day 3", size: 24, from: 4, to: 7, ...more });
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      tracks: { 1: { hidden: true } },
      items: [tiny({ hidden: true }), tiny({ track: 1 }), tiny({ track: 0 })],
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /items\[2\] "Day 3"/);
  assert.doesNotMatch(r.stdout, /items\[[01]\]/);
});

test("a size is a share of the frame's short side: its height in a 16:9 film, its width in a Short", () => {
  const day = { kind: "text", text: "Day 3", size: 24, from: 4, to: 7 };
  assert.match(readFaults(day, day).join("\n"), /2\.2% of the frame height/);
  assert.match(readFaults(day, day, "9:16").join("\n"), /2\.2% of the frame width/);
});

test("a size or scale that is no number is named, never passed as big enough", () => {
  const day = { kind: "text", text: "Day 3", from: 4, to: 7 };
  assert.match(sizeFaults({ ...day, size: "big" }).join("\n"), /"size" is "big", not a number/);
  assert.match(sizeFaults({ ...day, scale: "2" }).join("\n"), /"scale" is "2", not a number/);
  assert.deepEqual(sizeFaults({ ...day, size: 56 }), []);
  assert.deepEqual(sizeFaults({ ...day, size: null }), []);
  assert.match(sizeFaults({ ...day, size: 0 }).join("\n"), /size 0 draws no text: a size above 0/);
  assert.match(sizeFaults({ ...day, scale: -2 }).join("\n"), /size -112 draws no text/);
});

test("a missing sound another film of the repo has is pointed to there, and every missing name says how to replace it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const film = (name) => {
    const dir = join(root, "films", name);
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        "live-studio": { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx" },
      }),
    );
    return dir;
  };
  const here = film("one"),
    other = film("two");
  cpSync(join(STUDIO, "demo/src"), join(here, "src"), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.5", "sound/sfx/bgm_drone.wav"],
    {
      cwd: other,
    },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(
    join(here, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [{ name: "bgm_drone", from: 0, to: 4, gain: 0, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    }),
  );
  const out = spawnSync("bun", [CHECK], { cwd: here, encoding: "utf8", timeout: 60000 });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(
    out.stderr,
    /"bgm_drone" \(beds\[0\]\) is no sound the studio has: \.\.\/two\/sound\/sfx\/bgm_drone\.wav has it \(another film's own: copy the file and its SOURCES\.json row into sound\/sfx\/\)/,
  );
  assert.match(out.stderr, /replace a name: its "name" in src\/timeline\/audio\.json/);
});

test("an import of a gone JSON file in a comment is no missing file: the build never reads it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  writeFileSync(
    join(dir, "src/extra.ts"),
    [
      '// import old from "./old.json";',
      '/* import gone from "./gone.json"; */',
      'import lost from "./lost.json";',
    ].join("\n"),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/lost\.json\n✖ missing: src\/extra\.ts imports it/);
  assert.doesNotMatch(r.stderr, /old\.json|gone\.json/);
});

test("a timeline named by a folder is a package.json fault that names the key, not a crash", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "src/timeline" } }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /^package\.json\n✖ "textTimeline": "src\/timeline" is a folder; it names one JSON file/,
  );
  assert.doesNotMatch(r.stderr, /EISDIR/);
});

test("text the edit cuts out whole is never on screen, so it is no text too brief to read", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        textTimeline: "src/timeline/text.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        { kind: "text", text: "CUT AWAY", from: 2, to: 4 },
        { kind: "text", text: "HALF OF ME IS CUT AWAY", from: 4.5, to: 6 },
      ],
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [], freezes: [], cuts: [{ from: 1, to: 5.5 }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /"CUT AWAY"/);
  assert.match(r.stdout, /items\[1\] "HALF OF ME IS CUT AWAY" .*readable about/);
});

test("an import in a block comment or a string is never built, so it is no missing file", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  writeFileSync(
    join(dir, "src/extra.ts"),
    [
      "/*",
      'import old from "./old.json";',
      "*/",
      `export const how = "import x from './said.json'";`,
    ].join("\n"),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a package.json value of the wrong type is named as its fault, not a crash", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  const check = (conf) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": conf }));
    return spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  };
  const num = check({ soundTimeline: 123 });
  assert.equal(num.status, 1, num.stdout + num.stderr);
  assert.match(num.stderr, /^package\.json\n[\s\S]*soundTimeline/);
  assert.doesNotMatch(num.stderr, /TypeError|ERR_INVALID_ARG_TYPE/);
  const rows = check({
    keyFiles: { "src/timeline/steve.json": "steve" },
    requiredKeyRows: { steve: ["moves"] },
  });
  assert.equal(rows.status, 1, rows.stdout + rows.stderr);
  assert.match(rows.stderr, /requiredKeyRows/);
  assert.doesNotMatch(rows.stderr, /TypeError|is not a function/);
});

test("sound names are said to go unchecked when package.json names no sfx folder", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { soundTimeline: "src/timeline/audio.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "no_such_sound", at: 1, gain: 0 }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /⚠ package\.json "live-studio" names no "sfx" folder, so no sound name in src\/timeline\/audio\.json is checked/,
  );
});

test("a key whose t is not a number is named on its own row, not lost with the row", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { keyFiles: { "src/timeline/steve.json": "steve" } } }),
  );
  writeFileSync(
    join(dir, "src/timeline/steve.json"),
    JSON.stringify({
      moves: [
        { t: 0, x: 0 },
        { t: "5", x: 1 },
      ],
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /src\/timeline\/steve\.json\n[\s\S]*"t" is a number of seconds[\s\S]*moves\[1\]\.t/,
  );
});

test("text too small for a phone is named even when the film's length is not in its data", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  delete edit.end;
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "src/timeline/text.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "Day 3", size: 24, from: 4, to: 7 }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /⚠ src\/timeline\/text\.json items\[0\] "Day 3" \("from": 4\): size 24 is/,
  );
});

test("a timeline outside the film is a package.json fault, as the studio refuses to open it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "outside.json"), JSON.stringify({ items: [] }));
  mkdirSync(join(dir, "film"));
  cpSync(join(dir, "src"), join(dir, "film/src"), { recursive: true });
  writeFileSync(
    join(dir, "film/package.json"),
    JSON.stringify({ "live-studio": { textTimeline: "../outside.json" } }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: join(dir, "film"), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /^package\.json\n✖ "textTimeline": Timeline file escapes film directory: "\.\.\/outside\.json"/,
  );
});

test("LIVE_PROJECT spelt one letter off stops check, never checking the folder it stands in", () => {
  const r = spawnSync("bun", [CHECK], {
    cwd: tmpdir(),
    env: { ...process.env, LIVE_PROJCT: "films/x" },
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /LIVE_PROJCT is set in the environment, one letter off LIVE_PROJECT that this command reads: did you mean LIVE_PROJECT\?/,
  );
});

test("text placed after the film ends is named, as a sound there is: never on screen", (t) => {
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
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        { kind: "text", text: "Day 3", size: 56, from: 2, to: 5 },
        { kind: "text", text: "THE END", size: 56, from: 20, to: 23 },
      ],
    }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /✖ items\[1\] "THE END" at 20: after the film ends \(10\.00 s heard\), so never on screen/,
  );
  assert.doesNotMatch(r.stderr, /items\[0\]/);
  // a hidden track's item is off screen anyway: no fault, as a hidden item
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      tracks: { 1: { hidden: true } },
      items: [{ kind: "text", text: "THE END", size: 56, from: 20, to: 23, track: 1 }],
    }),
  );
  const hidden = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(hidden.status, 0, hidden.stdout + hidden.stderr);
});

test("text the film's end cuts off is read only until the end, its Out as far as it plays", (t) => {
  const it = { kind: "text", text: "HELLO THERE", size: 56, from: 9.6, to: 13 };
  assert.deepEqual(readFaults(it, { from: 9.6, to: 13 }), []);
  assert.match(readFaults(it, { from: 9.6, to: 13 }, "16:9", 10)[0], /readable about 0\.40 s/);
  // an Out takes half of what of it plays: 0.1 s of it before an end at 10.5 leaves 0.85 s read, enough for 11 letters
  const fading = { ...it, to: 11.4, out: { fx: "fade", len: 1 } };
  assert.deepEqual(readFaults(fading, { from: 9.6, to: 11.4 }, "16:9", 10.5), []);
  // an In cut short by the film's end counts only the portion before the end, never negative readable time
  const cutIn = {
    kind: "text",
    text: "HELLO THERE",
    size: 56,
    from: 9,
    to: 12,
    in: { fx: "fade", len: 3 },
  };
  assert.match(readFaults(cutIn, { from: 9, to: 12 }, "16:9", 9.5)[0], /readable about 0\.25 s/);
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
  writeFileSync(join(dir, "src/timeline/text.json"), JSON.stringify({ items: [it] }));
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /items\[0\] "HELLO THERE" at 9\.60-10\.00 heard, cut by the film's end .*readable about 0\.40 s/,
  );
});

test('a film that shuts the vault out ("soundVault": false) is told so, not to move into the repo', (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(dir);
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
        soundVault: false,
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "door", at: 1, gain: 0 }] }),
  );
  const r = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /"soundVault": false in package\.json shuts the vault out/);
  assert.doesNotMatch(r.stderr, /Keep films in the repo's films/);
  // five names, all missing: one block that names all five, and says so once
  const five = ["a1", "b2", "c3", "d4", "e5"].map((name, i) => ({ name, at: i, gain: 0 }));
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: [], sfx: five }));
  const all = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.match(all.stderr, /\(a1, b2, c3, d4, e5\): most of the sound files/);
  assert.equal(all.stderr.match(/soundVault/g)?.length, 1, all.stderr);
});

test("camera lens/fov conflict, hits timing, nested typos, and unknown look presets are reported", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        shotsTimeline: "src/timeline/shots.json",
        adjustmentTimeline: "src/timeline/adjustment.json",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      {
        t: 0,
        p: [0, 1.5, 4],
        l: [0, 1, 0],
        mm: 35,
        fov: 50,
        focs: 2.5,
        fstp: 2,
        hanhdeld: "THE_CLOSEUP",
      },
    ]),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(STUDIO, "demo/src/edit.json"), "utf8")),
      end: 8,
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      {
        t: 0,
        adjust: { look: "teal-amber", loko: "noir-slate" },
        htis: [],
        hits: [{ t: 5.5, amount: 0.7 }],
      },
      { t: 4, hits: [{ t: 8.5, amount: 0.4 }] },
    ]),
  );
  writeFileSync(
    join(dir, "src/timeline/adjustment.json"),
    JSON.stringify({
      items: [{ id: "a1", name: "Look", from: 0, to: 3, track: 0, grade: { loook: "teal-amber" } }],
    }),
  );

  const warn = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(warn.status, 0, warn.stdout + warn.stderr);
  assert.match(warn.stdout, /sets both "mm" \(35\) and "fov" \(50\)/);
  assert.match(warn.stdout, /"focs".*did you mean "focus"/);
  assert.match(warn.stdout, /"fstp".*did you mean "fstop"/);
  assert.match(warn.stdout, /"hanhdeld".*did you mean "handheld"/);
  assert.match(warn.stdout, /"htis".*did you mean "hits"/);
  assert.match(warn.stdout, /"loko".*did you mean "look"/);
  assert.match(warn.stdout, /"loook".*did you mean "look"/);
  assert.match(warn.stdout, /hits\[0\]\.t.*outside shot \[0\]/);
  assert.match(warn.stdout, /\[1\]\.hits\[0\]\.t.*outside shot \[1\] \(4s\.\.8s\)/);

  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([{ t: 0, adjust: { look: "teal-ambr" } }, { t: 4 }]),
  );
  writeFileSync(
    join(dir, "src/timeline/adjustment.json"),
    JSON.stringify({
      items: [{ id: "a1", name: "Look", from: 0, to: 3, track: 0, grade: { look: "neon-void" } }],
    }),
  );
  const badLook = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badLook.status, 1, badLook.stdout + badLook.stderr);
  assert.match(badLook.stderr, /"teal-ambr".*did you mean "teal-amber"/);
  assert.match(badLook.stderr, /"neon-void".*known looks:/);
});

test("cam.json flags unknown handheld shake presets and suggests the closest SHAKES id", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 1, 3], l: [0, 1, 0], handheld: "the_closeupp" },
      { t: 1, p: [0, 1, 3], l: [0, 1, 0], handheld: { kind: "THE_WEDING", amount: 0.5 } },
      { t: 2, p: [0, 1, 3], l: [0, 1, 0], handheld: "off" },
      { t: 3, p: [0, 1, 3], l: [0, 1, 0], handheld: "walk_to_the_store" },
    ]),
  );
  const res = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /\[0\]\.handheld "the_closeupp".*did you mean "THE_CLOSEUP"/);
  assert.match(res.stderr, /\[1\]\.handheld\.kind "THE_WEDING".*did you mean "THE_WEDDING"/);
  assert.doesNotMatch(res.stderr, /"off"/);
  assert.doesNotMatch(res.stderr, /"walk_to_the_store"/);
});

test("whitespace-padded look fails check as runtime looks.ts drops it, and camera bob key is valid while bbo warns", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        shotsTimeline: "src/timeline/shots.json",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 1, 3], l: [0, 1, 0], bob: 0.4 },
      { t: 1, p: [0, 1, 3], l: [0, 1, 0], bbo: 0.2 },
    ]),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([{ t: 0, adjust: { look: " teal-amber " } }]),
  );
  const res = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /" teal-amber ".*did you mean "teal-amber"/);
  assert.match(res.stdout + res.stderr, /"bbo".*did you mean "bob"/);
  assert.doesNotMatch(res.stdout + res.stderr, /"bob".*did you mean/);
});

test("Round 15: handheld matches normHandheld trim/precedence; mix.py defaults missing lufs and rejects missing edit.end without KeyError", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "studio-check-r15-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.5", "sound/sfx/beep.wav"],
    { cwd: dir },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 1, 3], l: [0, 1, 0], handheld: " off " },
      { t: 1, p: [0, 1, 3], l: [0, 1, 0], handheld: " THE_CLOSEUP " },
      { t: 2, p: [0, 1, 3], l: [0, 1, 0], handheld: { preset: " THE_CLOSEUP " } },
      {
        t: 3,
        p: [0, 1, 3],
        l: [0, 1, 0],
        handheld: { preset: "THE_CLOSEUP", kind: "NOT_A_SHAKE" },
      },
    ]),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [{ name: "beep", at: 0.2, gain: 0 }] }),
  );
  const baseEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...baseEdit, end: 2 }));

  const chk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(chk.status, 0, chk.stdout + chk.stderr);

  // mix.py with lufs omitted should default to -14 LUFS and succeed (no KeyError: 'lufs')
  const mixOk = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixOk.status, 0, mixOk.stdout + mixOk.stderr);

  // mix.py without edit.end should exit cleanly with an actionable message, never KeyError traceback
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(baseEdit));
  const mixNoEnd = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixNoEnd.status, 1, mixNoEnd.stdout + mixNoEnd.stderr);
  assert.doesNotMatch(mixNoEnd.stderr, /Traceback|KeyError/);
  assert.match(mixNoEnd.stderr, /src\/edit\.json.*end/);
});

test("Round 16: choices.json precedence & validation, mix.py sound_choices fallback, and readFaults under Freeze/piecewise Speed", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "check-r16-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export default () => ({});");
  const editBase = { voice: { take: 0, edits: {}, warp: [] }, beats: {} };
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", "sound/sfx/beep.wav"],
    { cwd: dir },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        textTimeline: "src/timeline/text.json",
        timingTimeline: "src/timeline/timing.json",
        sfx: "sound/sfx",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [{ name: "beep", at: 0.2, gain: 0 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 0.5, duration: 5.0 }] }),
  );
  // Freeze holding the middle of a 1.0s clip for 5.0s: true In/Out are 0.4s each (5.60s readable >= 4.00s for 80 chars); uniform k=6 falsely stretched In/Out to 2.4s (3.60s -> warning!)
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...editBase, end: 1.0 }));
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        {
          kind: "text",
          text: "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
          from: 0,
          to: 1.0,
          in: { fx: "fadeIn", len: 0.4 },
          out: { fx: "fadeOut", len: 0.4 },
        },
      ],
    }),
  );
  const freezeChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(freezeChk.status, 0, freezeChk.stdout + freezeChk.stderr);
  assert.doesNotMatch(freezeChk.stdout + freezeChk.stderr, /readable about/);

  // Slow edges (0.25x for In/Out -> 1.0s each) + fast middle (5x -> 0.25s) on 30 chars (needs 1.50s, true readable 1.25s): must warn!
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...editBase, end: 4 }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      speeds: [
        { from: 0, to: 0.25, rate: 0.25 },
        { from: 0.25, to: 1.5, rate: 5 },
        { from: 1.5, to: 1.75, rate: 0.25 },
      ],
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        {
          kind: "text",
          text: "Exactly thirty chars rightnow!",
          from: 0,
          to: 1.75,
          in: { fx: "fadeIn", len: 0.25 },
          out: { fx: "fadeOut", len: 0.25 },
        },
      ],
    }),
  );
  const rampChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(rampChk.status, 0, rampChk.stdout + rampChk.stderr);
  assert.match(rampChk.stdout, /readable about 1\.25 s for 30 characters/);

  // Valid sound_choices.json must NOT hide a corrupt choices.json from check, and mix.py falls back to sound_choices.json
  writeFileSync(join(dir, "sound_choices.json"), JSON.stringify({ beep: { set: "off" } }));
  writeFileSync(join(dir, "choices.json"), "{ broken");
  const badChoices = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badChoices.status, 1, badChoices.stdout + badChoices.stderr);
  assert.match(badChoices.stderr, /choices\.json/);

  rmSync(join(dir, "choices.json"));
  const mixFallback = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixFallback.status, 0, mixFallback.stdout + mixFallback.stderr);
  assert.doesNotMatch(mixFallback.stdout + mixFallback.stderr, /-14\.0 LUFS/);
});

test("Round 17: textCheckSample skips zero-span cuts and clamps inside [from, to), and mix.py reports unfit() cleanly with timingTimeline", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  assert.equal(textCheckSample({ from: 5, to: 5 }, { in: 0, out: 0 }, 0, 10, 30), null);
  const clamped = textCheckSample({ from: 0, to: 10.5 }, { in: 0.2, out: 0.2 }, 9, 10, 30);
  assert.ok(clamped !== null && clamped >= 9 && clamped < 10, `expected [9, 10), got ${clamped}`);
  const tinyEnd = textCheckSample({ from: 9.99, to: 10 }, { in: 0, out: 0 }, 0, 10, 30);
  assert.ok(
    tinyEnd !== null && tinyEnd >= 9.99 && tinyEnd < 10,
    `expected [9.99, 10), got ${tinyEnd}`,
  );

  const root = mkdtempSync(join(tmpdir(), "studio-mix-unfit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "mix-unfit-test",
      "live-studio": {
        edit: "src/edit.json",
        audioTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 5, voice: { lines: [] } }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 5, rate: 1 }] }),
  );
  // Missing sfx[0].name must fail via unfit(), not KeyError traceback inside prepare_timing()
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ at: 1, gain: 0 }] }),
  );
  const badSfx = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badSfx.status, 1, badSfx.stdout + badSfx.stderr);
  assert.match(badSfx.stderr, /sfx\[0\] has no name/);
  assert.doesNotMatch(badSfx.stderr, /Traceback|KeyError|TypeError|AttributeError/);

  // Missing beds list must also fail via unfit(), not KeyError on module import
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ sfx: [] }));
  const noBeds = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(noBeds.status, 1, noBeds.stdout + noBeds.stderr);
  assert.match(noBeds.stderr, /no beds list/);
  assert.doesNotMatch(noBeds.stderr, /Traceback|KeyError|TypeError|AttributeError/);
});

test("Round 18: text checks respect unlinked textClock.duration, blank freeze gaps, fallbackTimingDuration, and non-finite sourceAt", (t) => {
  // 1) Unlinked textClock shorter than ends.layers rejects text after textClock.duration
  const root = mkdtempSync(join(tmpdir(), "studio-text-clock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "text-clock-test",
      "live-studio": {
        edit: "src/edit.json",
        textTimeline: "src/timeline/text.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 6 }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      speeds: [{ from: 0, to: 6, rate: 0.5 }],
      layerKinds: { text: { base: {}, changes: [] } },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "Late text", size: 56, from: 6.5, to: 8 }] }),
  );
  const shortTextCheck = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(shortTextCheck.status, 1, shortTextCheck.stdout + shortTextCheck.stderr);
  assert.match(shortTextCheck.stderr, /after the film ends \(6\.00 s heard\)/);

  // 2) blank:true freeze does not count toward readable duration and textCheckSample avoids blank intervals
  const timingBlank = { freezes: [{ at: 2, duration: 2, blank: true }] };
  const blankClock = compileLayerTiming(timingBlank, 6, "text");
  const blankAt25 = textCheckSample(
    { from: 1.5, to: 4.5 },
    { in: 0, out: 0 },
    0,
    8,
    30,
    blankClock,
  );
  assert.ok(
    blankAt25 !== null && frameVisible(blankClock, blankAt25),
    `expected visible sample, got ${blankAt25}`,
  );
  assert.equal(
    textCheckSample({ from: 2.2, to: 3.8 }, { in: 0, out: 0 }, 0, 8, 30, blankClock),
    null,
  );

  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify(timingBlank));
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({
      items: [
        {
          kind: "text",
          text: "Readable long sentence that needs more than one second",
          size: 56,
          from: 1.5,
          to: 2.5,
        },
      ],
    }),
  );
  const blankCheck = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(blankCheck.status, 0, blankCheck.stdout + blankCheck.stderr);
  assert.match(blankCheck.stdout, /readable about 1\.00 s/);

  // 3) fallbackTimingDuration covers timing.gaps/layers/layerKinds/items when edit.end is omitted, and sourceAt guards non-finite t
  const fbDur = fallbackTimingDuration([{ from: 0, to: 4 }], {
    gaps: [{ from: 1, to: 3 }],
    freezes: [],
    speeds: [],
    layers: { base: { cuts: [{ from: 2, to: 5 }] }, changes: [] },
    layerKinds: { text: { base: {}, changes: [] } },
  });
  assert.ok(fbDur >= 5);
  assert.ok(Number.isNaN(blankClock.sourceAt(Number.NaN)));
});

test("Round 19: check handles tail cuts without false fails, catches post-cut sounds, corrupt wavs, custom soundTimeline in mix.py, shots/adjust bounds, and sfx path escape", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "studio-r19-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  const ffWav = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", "sound/sfx/beep.wav"],
    { cwd: dir },
  );
  assert.equal(ffWav.status, 0, String(ffWav.stderr));

  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r19-check-test",
      "live-studio": {
        sfx: "sound/sfx",
        soundTimeline: "src/timeline/custom_audio.json",
        textTimeline: "src/timeline/text.json",
        timingTimeline: "src/timeline/timing.json",
        shotsTimeline: "src/timeline/shots.json",
        adjustmentTimeline: "src/timeline/adjust.json",
      },
    }),
  );
  // 1) Tail cut removing text & sound whole must pass check (matches mix.py & render.mjs)
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 2, duration: 2 }], cuts: [{ from: 8, to: 10 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "CUT WHOLE", size: 56, from: 8.5, to: 9.5 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/custom_audio.json"),
    JSON.stringify({
      voice: false,
      beds: [{ name: "beep", track: "bgm", from: 8.5, to: 9.5, gain: -6, fadeIn: 0, fadeOut: 0 }],
      sfx: [{ name: "beep", track: "sfx", at: 8.5, length: 0.5, gain: 0 }],
    }),
  );
  writeFileSync(join(dir, "src/timeline/shots.json"), JSON.stringify([{ t: 0 }, { t: 5 }]));
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [{ id: "a1", name: "Warm", from: 0, to: 5, track: 0, grade: { warmth: 10 } }],
    }),
  );
  const tailOk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(tailOk.status, 0, tailOk.stdout + tailOk.stderr);

  // mix.py also honors custom soundTimeline and renders sound/mix.wav
  const mixCustom = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixCustom.status, 0, mixCustom.stdout + mixCustom.stderr);

  // 2) Tail cut on sound + unlinked long textClock catches sound placed at 11..13 (after soundEnd=6, below ends.layers=14)
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      cuts: [{ from: 6, to: 10 }],
      layerKinds: { text: { base: { freezes: [{ at: 2, duration: 4 }] }, changes: [] } },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/custom_audio.json"),
    JSON.stringify({
      beds: [{ name: "beep", track: "bgm", from: 11, to: 13, gain: -6, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    }),
  );
  const soundLate = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(soundLate.status, 1, soundLate.stdout + soundLate.stderr);

  // 3) Corrupt .wav referenced in soundTimeline fails check
  writeFileSync(join(dir, "sound/sfx/badwav.wav"), "not a wav");
  writeFileSync(
    join(dir, "src/timeline/custom_audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [{ name: "badwav", track: "sfx", at: 1, length: 0.5, gain: 0 }],
    }),
  );
  const badWavCheck = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badWavCheck.status, 1, badWavCheck.stdout + badWavCheck.stderr);

  // 4) Negative shot.t rejected, shot past edit.end warned without inverted bounds, late adjustment rejected
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  writeFileSync(join(dir, "src/timeline/custom_audio.json"), JSON.stringify({ beds: [], sfx: [] }));
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([{ t: -1 }, { t: 15, hits: [{ t: 16, amount: 0.5 }] }]),
  );
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [{ id: "a1", name: "Late", from: 20, to: 25, track: 0, grade: { warmth: 10 } }],
    }),
  );
  const boundsCheck = spawnSync("bun", [CHECK, "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(boundsCheck.status, 1, boundsCheck.stdout + boundsCheck.stderr);
  assert.doesNotMatch(boundsCheck.stdout, /15s\.\.10s/);

  // 5) Escaping sfx path caught even without soundTimeline
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r19-escape-test",
      "live-studio": { sfx: "../../outside" },
    }),
  );
  const escCheck = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(escCheck.status, 1, escCheck.stdout + escCheck.stderr);
});

test("Round 20: check uses per-clip clocks for beds vs sfx, rejects escaping soundVault without soundTimeline, missing timingTimeline, and file path for sfx", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-r20-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const wav = join(dir, "sound/sfx/beep.wav");
  const hdr = Buffer.alloc(44 + 800 * 2);
  hdr.write("RIFF", 0);
  hdr.writeUInt32LE(36 + 1600, 4);
  hdr.write("WAVEfmt ", 8);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(8000, 24);
  hdr.writeUInt32LE(16000, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36);
  hdr.writeUInt32LE(1600, 40);
  writeFileSync(wav, hdr);
  const demoEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...demoEdit, end: 10 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r20-check-test",
      "live-studio": {
        sfx: "sound/sfx",
        soundVault: false,
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );

  // 1a) sfx cut at 6..10 while audio bed track stays 10s: valid bed 7..9 must pass
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ layerKinds: { sfx: { base: { cuts: [{ from: 6, to: 10 }] }, changes: [] } } }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [{ name: "beep", track: "bgm", from: 7, to: 9, gain: -6, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    }),
  );
  const bedPass = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(bedPass.status, 0, bedPass.stdout + bedPass.stderr);

  // 1b) sfx freeze extends layerDuration to 14s while audio bed track stays 10s: bed 11..13 is past audio end (10s) and must fail
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      layerKinds: { sfx: { base: { freezes: [{ at: 2, duration: 4 }] }, changes: [] } },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [{ name: "beep", track: "bgm", from: 11, to: 13, gain: -6, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    }),
  );
  const bedLate = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(bedLate.status, 1, bedLate.stdout + bedLate.stderr);

  // 2) Configured timingTimeline missing on disk must fail
  rmSync(join(dir, "src/timeline/timing.json"));
  const missingTiming = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(missingTiming.status, 1, missingTiming.stdout + missingTiming.stderr);
  assert.match(missingTiming.stderr, /timing\.json/);

  // 3) Escaping soundVault caught even without soundTimeline or sfx
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r20-escape",
      "live-studio": { soundVault: "../../../outside-escape" },
    }),
  );
  const escVault = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(escVault.status, 1, escVault.stdout + escVault.stderr);
  assert.match(escVault.stderr, /soundVault/);

  // 4) Regular file for sfx rejected in pathFaults
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "r20-file-sfx", "live-studio": { sfx: "package.json" } }),
  );
  const fileSfx = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(fileSfx.status, 1, fileSfx.stdout + fileSfx.stderr);
  assert.match(fileSfx.stderr, /sfx.*file/i);
});

test("Round 21: check catches sfx start >= file length, missing edit.json with soundTimeline, explicit voice:true without full_voice.wav, and folder soundSources; mix.py skips impossible start/absent optional files safely", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "studio-check-r21-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", "sound/sfx/beep.wav"],
    { cwd: dir },
  );
  assert.equal(ff.status, 0, String(ff.stderr));
  const demoEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...demoEdit, end: 5 }));
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r21-check-test",
      "live-studio": {
        sfx: "sound/sfx",
        soundVault: false,
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );

  // 1) sfx[].start >= fileDur with length omitted must fail check (and mix.py must not crash)
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ name: "beep", at: 0, start: 5, gain: 0, reverse: true }],
    }),
  );
  const badStartChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badStartChk.status, 1, badStartChk.stdout + badStartChk.stderr);
  assert.match(badStartChk.stderr, /start/);

  // 2) mix.py handles omitted voice without full_voice.wav AND skips sfx start >= fileDur (even under timing) without crashing
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 5, rate: 1 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [{ name: "beep", at: 0, start: 5, gain: 0, reverse: true }],
    }),
  );
  const mixSafe = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixSafe.status, 0, mixSafe.stdout + mixSafe.stderr);

  // 3) Explicit voice:true without narration and missing full_voice.wav must fail check
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: true, beds: [], sfx: [] }),
  );
  const voiceTrueChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(voiceTrueChk.status, 1, voiceTrueChk.stdout + voiceTrueChk.stderr);
  assert.match(voiceTrueChk.stderr, /full_voice\.wav/);

  // 4) Missing src/edit.json when soundTimeline is configured fails check and mix.py reports unfit cleanly (no Traceback)
  rmSync(join(dir, "src/edit.json"));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [] }),
  );
  const noEditChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(noEditChk.status, 1, noEditChk.stdout + noEditChk.stderr);
  assert.match(noEditChk.stderr, /edit\.json/);
  const noEditMix = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(noEditMix.status, 1, noEditMix.stdout + noEditMix.stderr);
  assert.doesNotMatch(noEditMix.stderr, /Traceback/);

  // 5) Directory passed to soundSources rejected in pathFaults
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "r21-src-dir", "live-studio": { soundSources: { ok: "sound" } } }),
  );
  const srcDirChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(srcDirChk.status, 1, srcDirChk.stdout + srcDirChk.stderr);
  assert.match(srcDirChk.stderr, /soundSources.*folder/i);
});

test("Round 22: mix.py creates missing sound/ folder on custom-sfx film, and check catches sfx start >= file length even when length is set", (t) => {
  const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "studio-check-r22-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sfx"), { recursive: true });
  const ff = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", "sfx/beep.wav"], {
    cwd: dir,
  });
  assert.equal(ff.status, 0, String(ff.stderr));
  const demoEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...demoEdit, end: 3 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r22-check-test",
      "live-studio": { sfx: "sfx", soundVault: false, soundTimeline: "src/timeline/audio.json" },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [{ name: "beep", at: 0, gain: 0 }] }),
  );
  // 1) Custom sfx folder without sound/ dir passes check and mix.py creates sound/ without FileNotFoundError
  const okChk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(okChk.status, 0, okChk.stdout + okChk.stderr);
  const mixOut = spawnSync("python", [MIX], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(mixOut.status, 0, mixOut.stdout + mixOut.stderr);
  assert.doesNotMatch(mixOut.stderr, /Traceback|FileNotFoundError/);

  // 2) sfx[].start >= fileDur with explicit length set must fail check
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ name: "beep", at: 0, start: 5, length: 0.5, gain: 0 }],
    }),
  );
  const badStartWithLen = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(badStartWithLen.status, 1, badStartWithLen.stdout + badStartWithLen.stderr);
  assert.match(badStartWithLen.stderr, /start/);
});

test("Round 23: check rejects valid-header zero-second audio files that ffprobe/mix.py cannot read", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-check-r23-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const zeroWav = Buffer.alloc(44);
  zeroWav.write("RIFF", 0);
  zeroWav.writeUInt32LE(36, 4);
  zeroWav.write("WAVEfmt ", 8);
  zeroWav.writeUInt32LE(16, 16);
  zeroWav.writeUInt16LE(1, 20);
  zeroWav.writeUInt16LE(1, 22);
  zeroWav.writeUInt32LE(44100, 24);
  zeroWav.writeUInt32LE(88200, 28);
  zeroWav.writeUInt16LE(2, 32);
  zeroWav.writeUInt16LE(16, 34);
  zeroWav.write("data", 36);
  zeroWav.writeUInt32LE(0, 40);
  writeFileSync(join(dir, "sound/sfx/empty.wav"), zeroWav);
  const demoEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...demoEdit, end: 3 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "r23-check-test",
      "live-studio": {
        sfx: "sound/sfx",
        soundVault: false,
        soundTimeline: "src/timeline/audio.json",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [{ name: "empty", at: 0, gain: 0 }] }),
  );
  const chk = spawnSync("bun", [CHECK], { cwd: dir, encoding: "utf8", timeout: 60000 });
  assert.equal(chk.status, 1, chk.stdout + chk.stderr);
  assert.match(chk.stderr, /empty/);
});

test("a shared camera and key-file path keeps every applicable schema", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-shared-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  const file = "src/timeline/cam.json";
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": { camTimeline: file, keyFiles: { [file]: "cam" }, soundVault: false },
    }),
  );
  for (const fov of ["wide", 50]) {
    writeFileSync(join(dir, file), JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0], fov }]));
    const checked = spawnSync("bun", [CHECK, "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, typeof fov === "string" ? 1 : 0, checked.stdout + checked.stderr);
    const report = JSON.parse(checked.stdout);
    if (typeof fov === "string") assert.match(JSON.stringify(report.problems), /cam\.json.*fov/);
  }
});

test("an existing choices directory is reported as a file problem", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-choices-directory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { soundVault: false } }),
  );
  mkdirSync(join(dir, "choices.json"));
  const checked = spawnSync("bun", [CHECK, "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(JSON.stringify(JSON.parse(checked.stdout).problems), /choices\.json.*folder/);
});

test("invalid ancestor vault paths produce a named JSON problem instead of crashing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "check-vault-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "film");
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(join(root, "vault.json"), JSON.stringify({ root: 123 }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [] }),
  );
  for (const soundVault of [undefined, false]) {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        "live-studio": { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx", soundVault },
      }),
    );
    const checked = spawnSync("bun", [CHECK, "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, soundVault === false ? 0 : 1);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, soundVault === false);
    if (soundVault !== false)
      assert.match(JSON.stringify(report.problems), /vault\.json.*root.*folder path/);
  }
});

test("check probes the default narration whenever the mixer will play it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-default-voice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
        soundVault: false,
      },
    }),
  );
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 3 }));
  writeFileSync(join(dir, "assets/public/agent/full_voice.wav"), "truncated voice file");
  for (const voice of [true, undefined, false]) {
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ voice, beds: [], sfx: [] }),
    );
    const checked = spawnSync("bun", [CHECK, "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, voice === false ? 0 : 1, checked.stdout + checked.stderr);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, voice === false);
    if (voice !== false)
      assert.match(
        JSON.stringify(report.problems),
        /full_voice\.wav.*corrupt|corrupt.*full_voice\.wav/,
      );
  }
});
