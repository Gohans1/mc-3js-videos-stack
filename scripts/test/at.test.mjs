import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { voiceFileOf } from "../../packages/live-studio/src/voice-map.mjs";
import { whatsAt } from "../at.ts";

const AT = resolve(dirname(fileURLToPath(import.meta.url)), "../at.ts");

const makeAudio = (file, seconds) => {
  mkdirSync(dirname(file), { recursive: true });
  const made = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", `sine=d=${seconds}`, file],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(made.status, 0, made.stderr);
};

// A film whose first 10 scene seconds play at 2x: the heard second 4.1 shows scene second 8.2
const film = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "at-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  const put = (f, v) => writeFileSync(join(dir, f), JSON.stringify(v));
  put("package.json", {
    "live-studio": {
      soundTimeline: "src/timeline/audio.json",
      camTimeline: "src/timeline/cam.json",
      textTimeline: "src/timeline/text.json",
      timingTimeline: "src/timeline/timing.json",
      keyFiles: { "src/timeline/steve.json": "steve" },
    },
  });
  writeFileSync(join(dir, "src/scene.ts"), "");
  put("src/edit.json", { end: 20 });
  put("src/timeline/timing.json", { speeds: [{ from: 0, to: 10, rate: 2 }] });
  put("src/timeline/cam.json", [
    { t: 0, cut: true, what: "the room", size: "wide (WS)" },
    { t: 8, cut: true, what: "his hand", size: "close-up (CU)" },
    { t: 12 },
  ]);
  put("src/timeline/audio.json", {
    beds: [{ name: "hum", from: 0, to: 20, gain: -6, fadeIn: 1, fadeOut: 1 }],
    sfx: [
      { name: "door", at: 8, length: 1, gain: 0 },
      { name: "late", at: 15, length: 1, gain: 0 },
    ],
  });
  put("src/timeline/text.json", {
    items: [
      { kind: "text", text: "LATER", from: 8, to: 9, track: 0 },
      { kind: "text", text: "NEVER", from: 15, to: 16, track: 0 },
    ],
  });
  // moves walks from 7 to 9; chair holds still from 0 to 20 (two keys, one value)
  put("src/timeline/steve.json", {
    moves: [
      { t: 0, x: 0 },
      { t: 7, x: 0 },
      { t: 9, x: 2 },
    ],
    chair: [
      { t: 0, dx: 0 },
      { t: 20, dx: 0 },
    ],
  });
  return dir;
};

test("at reads every timeline through its own clock: a 2x Speed puts scene second 8.2 at the heard second 4.1", (t) => {
  const got = whatsAt(film(t), 4.1);
  assert.ok(Math.abs(got.scene - 8.2) < 1e-6, `scene second ${got.scene}`);
  assert.equal(got.shot?.index, 1);
  assert.equal(got.shot?.name, "his hand");
  assert.deepEqual(
    got.sounds.map((s) => s.name),
    ["hum", "door"],
  );
  assert.deepEqual(
    got.texts.map((x) => x.text),
    ["LATER"],
  );
  assert.deepEqual(
    got.keys.map((k) => [k.path, k.before, k.after]),
    [["moves", 1, 2]],
  );
});

test("at reads camera-clock optics and authored keys while a Freeze holds the picture", (t) => {
  const dir = film(t);
  const p = (name) => join(dir, name);
  const put = (name, value) => writeFileSync(p(name), JSON.stringify(value));
  const pkg = JSON.parse(readFileSync(p("package.json"), "utf8"));
  pkg["live-studio"].shotsTimeline = "src/timeline/shots.json";
  put("package.json", pkg);
  put("src/edit.json", { end: 8 });
  put("src/timeline/timing.json", { freezes: [{ at: 2, duration: 3 }] });
  const key = (t, extra = {}) => ({
    t,
    p: [t, 2, 6],
    l: [0, 1, 0],
    fov: 30 * 2 ** (t / 8),
    motion: "linear",
    ease: "linear",
    ...extra,
  });
  put("src/timeline/cam.json", [key(0), key(2.5), key(2.7, { fov: 90, muted: true }), key(8)]);
  put("src/timeline/shots.json", [{ t: 0, name: "Camera still moves", cameraClock: "output" }]);

  const output = whatsAt(dir, 4);
  assert.equal(output.scene, 2);
  assert.equal(output.cam.clock, "output");
  assert.ok(Math.abs(output.cam.time - 32 / 11) < 1e-7);
  assert.deepEqual([output.cam.before, output.cam.after, output.cam.fov], [1, 3, 38.6]);

  put("src/timeline/shots.json", [{ t: 0, name: "Camera holds too" }]);
  const scene = whatsAt(dir, 4);
  assert.deepEqual(
    [
      scene.cam.clock,
      scene.scene,
      scene.cam.time,
      scene.cam.before,
      scene.cam.after,
      scene.cam.fov,
    ],
    ["scene", 2, 2, 0, 1, 35.7],
  );
});

test("at samples independent focus and focal length through a Freeze on the output camera clock", (t) => {
  const dir = film(t);
  const put = (path, value) => writeFileSync(join(dir, path), JSON.stringify(value));
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  pkg["live-studio"].shotsTimeline = "src/timeline/shots.json";
  put("package.json", pkg);
  put("src/edit.json", { end: 8 });
  put("src/timeline/timing.json", { freezes: [{ at: 2, duration: 3 }] });
  put("src/timeline/cam.json", [{ t: 0, p: [0, 0, 10], l: [0, 0, 0], fov: 50, focus: 4 }]);
  const focus = { here: { t: 32 / 11, value: 9 } };
  const focalLength = {
    wide: { t: 0, value: 24 },
    long: { t: 64 / 11, value: 50, ease: "linear" },
  };
  put("src/timeline/shots.json", [{ t: 0, cameraClock: "output", optics: { focus, focalLength } }]);
  const result = whatsAt(dir, 4);
  assert.equal(result.scene, 2);
  assert.ok(Math.abs(result.cam.time - 32 / 11) < 1e-7);
  assert.equal(result.cam.mm, 37);
  assert.equal(result.cam.focus, "9m");
});

test("at estimates the authored rig lens and uses camera anchor fallbacks for dolly zoom", (t) => {
  const dir = film(t);
  const put = (path, value) => writeFileSync(join(dir, path), JSON.stringify(value));
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  pkg["live-studio"].shotsTimeline = "src/timeline/shots.json";
  put("package.json", pkg);
  put("src/timeline/timing.json", {});
  const cam = [{ t: 0, p: [0, 0, 10], l: [0, 0, 0], fov: 50 }];
  put("src/timeline/cam.json", cam);
  put("src/timeline/shots.json", [
    { t: 0, camera: { fovAxis: { mode: "horizontal", aspect: 1 } } },
  ]);
  const rig = whatsAt(dir, 2).cam;
  assert.equal(rig.fov, 29.4);
  assert.equal(rig.evaluation, "authored");

  put("src/timeline/shots.json", [{ t: 0 }]);
  const dolly = { ...cam[0], t: 4, dollyZoomScale: 2, motion: "linear", ease: "linear" };
  const anchor = { target: "Actor", fallback: [0, 0, 10] };
  put("src/timeline/cam.json", [
    { ...cam[0], p: anchor },
    { ...dolly, p: anchor },
  ]);
  assert.equal(whatsAt(dir, 2).cam.fov, 22.6);
  const unknown = { target: "Actor", offset: [0, 0, 0] };
  put("src/timeline/cam.json", [
    { ...cam[0], p: unknown },
    { ...dolly, p: unknown },
  ]);
  assert.equal(whatsAt(dir, 2).cam.fov, null);
  put("src/timeline/cam.json", [...cam, dolly, { ...dolly, t: 8, p: { target: "Other actor" } }]);
  assert.equal(whatsAt(dir, 2).cam.fov, 22.6);
  put("src/timeline/cam.json", [
    cam[0],
    {
      ...dolly,
      motion: "orbit",
      p: unknown,
      l: [10, 0, 0],
      easeChannels: { position: [0, 0, 1, -1 / 3], aim: "linear" },
    },
  ]);
  assert.equal(whatsAt(dir, 2).cam.fov, null);
  put("src/timeline/cam.json", [
    { ...cam[0], t: 0 },
    { ...dolly, t: 2, p: [15, 0, 0], motion: "orbit", matchSpeed: true },
    { ...dolly, t: 4, p: unknown, motion: "orbit" },
  ]);
  assert.equal(whatsAt(dir, 1).cam.fov, null);
});

test("at #N finds a note's moment after a Speed edit moved it: by its scene second, or by its place in its shot", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  // both written at 8.2 heard before the 2x Speed went in: the hand 0.2 s into its shot. The second is the studio's newer
  // kind, which keeps its scene second too
  const note = {
    t: 8.2,
    text: "the hand",
    time: "00:08.200",
    shot: 1,
    shotName: "his hand",
    context: { shot: { into: 0.2 } },
    done: false,
  };
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    [
      { ...note, id: "old", at: "2026-11-01T00:00:00Z" },
      { ...note, id: "new", at: "2026-11-02T00:00:00Z", scene: 8.2 },
      {
        ...note,
        id: "renamed",
        at: "2026-11-03T00:00:00Z",
        shotName: "a shot renamed since",
        srcT: 8.2,
      },
    ]
      .map((n) => JSON.stringify(n))
      .join("\n"),
  );
  for (const ref of ["#1", "new"]) {
    const r = spawnSync("bun", [AT, ref], {
      env: { ...process.env, LIVE_PROJECT: dir },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /written at 00:08\.200 heard; that moment is heard at 00:04\.100 now/);
    // one numbering everywhere: notes, the studio, the draft's strip and the shots file's row
    assert.match(r.stdout, /shot 1 \(shots 0-1\): "his hand"/);
  }
  // its shot renamed since: its narration second through today's Speed, the second the studio's note list shows it at
  const r = spawnSync("bun", [AT, "renamed"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /that moment is heard at 00:04\.100 now \(its narration second/);
});

test("the open notes near a second are those heard near it now, not those written near it before a Speed edit", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = {
    id: "hand",
    t: 8.2,
    scene: 8.2,
    text: "the hand",
    shot: 1,
    time: "00:08.200",
    done: false,
    at: "2026-11-02T00:00:00Z",
  };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const near = whatsAt(dir, 4.1).notes;
  assert.deepEqual(
    near.map((n) => n.id),
    ["hand"],
  );
  assert.ok(Math.abs(near[0].heard - 4.1) < 1e-6, `heard at ${near[0].heard}`);
  assert.deepEqual(whatsAt(dir, 8.2).notes, []);
});

test("a note written just before a cut is in the shot it names, on every line", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  // scene 7.9996, 0.0004 s before the cut into shot 1 at scene 8
  const note = {
    id: "edge",
    t: 7.9996,
    scene: 7.9996,
    text: "the edge",
    time: "00:08.000",
    shot: 0,
    context: { shot: { into: 7.9996 } },
  };
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    JSON.stringify({ ...note, at: "2026-11-02T00:00:00Z" }),
  );
  const r = spawnSync("bun", [AT, "edge"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^shot 0 \(shots 0-1\)/m);
});

test("a note's moment lists the other notes near it, not itself", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = (id, t) => ({ id, t, scene: t, text: id, shot: 1, time: "", at: `2026-11-0${t}` });
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    [note("self", 4.1), note("other", 5)].map((n) => JSON.stringify(n)).join("\n"),
  );
  const r = spawnSync("bun", [AT, "self"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notes heard within 3 s: other \(open\) at/);
  assert.doesNotMatch(r.stdout, /self \(open\) at/);
});

test("a note whose moment a moved cut has put in the next shot says it is there now", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  // written 8.5 s into "the room" when it ran to 9; its cut into "his hand" sits at 8 now
  const note = {
    id: "late",
    t: 8.5,
    srcT: 8.5,
    text: "late",
    time: "00:08.500",
    shot: 0,
    shotName: "the room",
    context: { shot: { into: 8.5 } },
  };
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    JSON.stringify({ ...note, at: "2026-11-02T00:00:00Z" }),
  );
  const r = spawnSync("bun", [AT, "late"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /into shot 0 "the room".*past its end now: shot 1/);
});

test("a note's moment as --json is one JSON document, the note inside it", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = {
    id: "hand",
    t: 8.2,
    scene: 8.2,
    text: "the hand",
    shot: 1,
    time: "00:08.200",
    at: "2026-11-02T00:00:00Z",
  };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const r = spawnSync("bun", [AT, "hand", "--json"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.note.id, "hand");
  assert.ok(Math.abs(got.note.heard - 4.1) < 1e-6, `heard at ${got.note.heard}`);
});

test("a sound on a muted track and a second inside a gap say what is really heard and seen", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      tracks: [{ id: "t1", mute: true }],
      beds: [{ name: "hum", from: 0, to: 20, gain: -6, track: "t1" }],
      sfx: [],
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ gaps: [{ from: 2, to: 3 }] }),
  );
  const got = whatsAt(dir, 2.5);
  assert.equal(got.blank, true);
  assert.deepEqual(got.sounds, []);
  const after = whatsAt(dir, 5);
  assert.equal(after.blank, false);
  assert.equal(after.sounds[0]?.muted, true);
});

test("a sound whose file's length cannot be read is still heard, its end unknown", (t) => {
  const dir = film(t);
  const pkg = join(dir, "package.json");
  const conf = JSON.parse(readFileSync(pkg, "utf8"));
  conf["live-studio"].sfx = "sound/sfx";
  writeFileSync(pkg, JSON.stringify(conf));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(join(dir, "sound/sfx/door.wav"), "not a wav header");
  // no "length": it lasts as long as its file
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "door", at: 8, gain: 0 }] }),
  );
  const door = whatsAt(dir, 4.2).sounds.find((s) => s.name === "door");
  assert.ok(door, "door is playing");
  assert.equal(door.to, null);
});

test("a timeline the studio cannot read is named with check, never a stack trace", (t) => {
  const dir = film(t);
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: "bad", sfx: [] }));
  const r = spawnSync("bun", [AT, "2"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /src\/timeline\/audio\.json.*bun run check names the fault/);
});

test("a film without an end in edit.json ends at its last camera key, a scene second the voice edit does not move", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      voice: {
        warp: [
          [0, 0],
          [10, 20],
        ],
      },
    }),
  );
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  assert.equal(whatsAt(dir, 1).length, 12);
});

test("#N numbers the notes as bun run notes does: a line missing its fields is no note", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const whole = { t: 8.2, scene: 8.2, text: "the hand", shot: 1, time: "00:08.200" };
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    [
      { id: "half", t: 1, at: "2026-11-01T00:00:00Z" },
      { ...whole, id: "hand", at: "2026-11-02T00:00:00Z" },
    ]
      .map((n) => JSON.stringify(n))
      .join("\n"),
  );
  const r = spawnSync("bun", [AT, "#1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #1 \(hand, open\)/m);
});

test("#N counts a note the creator deleted, as bun run notes does, so the numbers after it never move", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const whole = { t: 8.2, scene: 8.2, text: "the hand", shot: 1, time: "00:08.200" };
  writeFileSync(
    join(dir, "notes/deleted.jsonl"),
    JSON.stringify({ ...whole, id: "gone", at: "2026-11-01T00:00:00Z" }) + "\n",
  );
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    JSON.stringify({ ...whole, id: "hand", at: "2026-11-02T00:00:00Z" }) + "\n",
  );
  const r = spawnSync("bun", [AT, "#2"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #2 \(hand, open\)/m);
  const gone = spawnSync("bun", [AT, "#1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(gone.status, 2);
  assert.match(gone.stderr, /note #1 \(gone\) was deleted by the creator/);
});

test("a second inside a gap names no shot, camera key or moving row: the picture is black", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ gaps: [{ from: 2, to: 3 }] }),
  );
  const got = whatsAt(dir, 2.5);
  assert.deepEqual([got.shot, got.cam, got.cuts, got.keys], [null, null, [], []]);
  // a draft rendered before the gap went in has a cut there
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify([2.5]));
  const r = spawnSync("bun", [AT, "2.5"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^00:02\.500 heard \(2\.5 s\); black here, a gap in src\/timeline\/timing\.json gaps\[\]/,
  );
  assert.doesNotMatch(r.stdout, /^(shot|camera|moving|cut)/m);
});

test("a note whose moment is past the film's end now says where it was, not only how long the film is", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = { id: "gone", t: 30, scene: 30, text: "gone", shot: 1, time: "", at: "2026-11-01" };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const r = spawnSync("bun", [AT, "gone"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #1 \(gone, open\) "gone" was written at 00:30\.000 heard/);
  assert.match(r.stdout, /past the film's end now \(15\.000 s\)/);
});

test("a narration on a muted track is said to be muted, not silent", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [{ name: "voice", at: 0, length: 15, gain: 0, track: "v" }],
    }),
  );
  const r = spawnSync("bun", [AT, "5"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^narration: muted, its clip sits on track v, muted in src\/timeline\/audio\.json tracks\[\]/m,
  );
});

test("at with no keyFiles says the moving rows are not read, and a note says what it asks", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
  );
  mkdirSync(join(dir, "notes"));
  const note = { id: "n1", t: 4, scene: 8.2, text: "the hand shakes", shot: 1, time: "", at: "1" };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const r = spawnSync("bun", [AT, "#1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #1 \(n1, open\) "the hand shakes" was written at/);
  assert.match(
    r.stdout,
    /^moving: package\.json "live-studio" names no keyFiles, so no key rows are read/m,
  );
});

test("text inside a gap is not on screen, as the render hides it", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ gaps: [{ from: 2, to: 3 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "ALWAYS", from: 0, to: 15, track: 0 }] }),
  );
  assert.deepEqual(whatsAt(dir, 2.5).texts, []);
  assert.equal(whatsAt(dir, 5).texts[0]?.text, "ALWAYS");
});

test("a negative second, -.5 too, is said to be before the film, not taken for a note", (t) => {
  const r = spawnSync("bun", [AT, "-.5"], {
    env: { ...process.env, LIVE_PROJECT: film(t) },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the film starts at 0/);
});

test("at refuses a second past the film's end and says how long it is", (t) => {
  const r = spawnSync("bun", [AT, "99"], {
    env: { ...process.env, LIVE_PROJECT: film(t) },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /15\.000 s long/);
});

test("a hidden text item is not on screen, as the render hides it", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/text.json"),
    JSON.stringify({ items: [{ kind: "text", text: "LATER", from: 8, to: 9, hidden: true }] }),
  );
  assert.deepEqual(whatsAt(dir, 4.1).texts, []);
});

test("a narration split in clips is muted where the clip playing sits on a muted track", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [
        { name: "voice", at: 0, length: 5, gain: 0, track: "a" },
        { name: "voice", at: 6, length: 9, gain: 0, track: "v" },
      ],
    }),
  );
  assert.equal(whatsAt(dir, 2).narrationMuted, null);
  assert.equal(whatsAt(dir, 8).narrationMuted, "v");
});

test("a Freeze is said where it holds the picture, from its first heard second", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 0, duration: 3 }] }),
  );
  const r = spawnSync("bun", [AT, "0"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /scene second 0\.00 \(a Freeze holds it, heard 0\.00-3\.00: src\/timeline\/timing\.json freezes\[0\]\)/,
  );
});

test("a velocity effect playing is named with its row", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      velocity: [
        {
          effect: "retroZoom",
          from: 1,
          to: 3,
          music: "hum",
          beats: [1.5, 2],
          frequency: 2,
          speed: "fast",
          intensity: 45,
        },
      ],
    }),
  );
  const said = (at) =>
    spawnSync("bun", [AT, at], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" })
      .stdout;
  assert.match(
    said("2"),
    /^velocity: retroZoom, intensity 45, scene 1\.00-3\.00 \(a hit on its beat plays now\): src\/timeline\/timing\.json velocity\[0\]$/m,
  );
  // velocityAt: a hit lasts up to 0.25 s from its beat, nothing before the first beat or between hits
  assert.match(
    said("1.2"),
    /^velocity: retroZoom, .*\(no hit on this frame: it hits at its beats\)/m,
  );
});

test("a script line not voiced yet is the next one only when no voiced line comes before it", (t) => {
  const dir = film(t);
  makeAudio(voiceFileOf(dir), 20);
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 20, script_lines: [{ t: 13, until: 15, text: "LATER LINE" }] }),
  );
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({ lines: [{ s: 6, e: 7, text: "hi", words: [{ w: "hi", s: 6, e: 7 }] }] }),
  );
  const before = whatsAt(dir, 1);
  assert.equal(before.nextLine, 6);
  assert.equal(before.script, null);
  assert.equal(whatsAt(dir, 8).script?.text, "LATER LINE");
});

test("a note fixed and waiting on the creator says check, never done, and is still near its moment", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = (id, state, at) => ({
    id,
    t: 4,
    scene: 8.2,
    text: `the hand ${id}`,
    shot: 1,
    time: "",
    at,
    state,
    done: true,
  });
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    [note("n1", "check", "1"), note("n2", "done", "2")].map((n) => JSON.stringify(n)).join("\n"),
  );
  const r = spawnSync("bun", [AT, "#1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #1 \(n1, check\) "the hand n1"/);
  const near = whatsAt(dir, 4).notes;
  assert.deepEqual(
    near.map((n) => [n.id, n.state]),
    [["n1", "check"]],
  );
});

test("a sound the studio's choice turns off or swaps says so, as the mix plays it", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [{ name: "hum", from: 0, to: 20, gain: -6, fadeIn: 1, fadeOut: 1, try: ["drone"] }],
      sfx: [{ name: "door", at: 8, length: 1, gain: 0 }],
    }),
  );
  writeFileSync(
    join(dir, "choices.json"),
    JSON.stringify({ hum: { set: "drone", gain: 1 }, door: { set: "off" } }),
  );
  const r = spawnSync("bun", [AT, "4.1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}beds\[0\] hum .*plays drone in its place \(choices\.json\)/m);
  assert.match(r.stdout, /^ {2}sfx\[0\] door .*off \(choices\.json\): not in the mix/m);
});

test("a film naming no sound timeline says so, not that nothing plays in a file it never named", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { camTimeline: "src/timeline/cam.json" } }),
  );
  const r = spawnSync("bun", [AT, "4.1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^sound: package\.json "live-studio" names no soundTimeline/m);
});

test("key rows inside a list of objects are read, named by their index", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/steve.json"),
    JSON.stringify({
      props: [
        {
          id: "cup",
          keys: [
            { t: 7, x: 0 },
            { t: 9, x: 2 },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(
    whatsAt(dir, 4.1).keys.map((k) => k.path),
    ["props[0].keys"],
  );
});

test("a voiced line on a muted track is muted narration, not a script line not voiced yet", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [{ name: "voice", at: 0, length: 15, gain: 0, track: "v" }],
    }),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 20, script_lines: [{ t: 8, until: 9, text: "THE HAND" }] }),
  );
  const got = whatsAt(dir, 4.1);
  assert.equal(got.narrationMuted, "v");
  assert.equal(got.script, null);
});

test("a note id that starts with a digit is a note, not a malformed second", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = { id: "0abc", t: 4, scene: 8.2, text: "the hand", shot: 1, time: "", at: "1" };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const r = spawnSync("bun", [AT, "0abc"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^note #1 \(0abc, open\)/);
});

test("a transition plays only where the render plays it: a gap at its cut or a bad len plays none, an unknown fx is said", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  const shots = (tr) =>
    writeFileSync(
      join(dir, "src/timeline/shots.json"),
      JSON.stringify([
        { t: 0, name: "the room" },
        { t: 8, name: "his hand", transition: tr },
      ]),
    );
  shots({ fx: "dissolve", len: 1 });
  assert.deepEqual(
    whatsAt(dir, 4).cuts.map((c) => [c.fx, c.now, c.builtIn]),
    [["dissolve", true, true]],
  );
  shots({ fx: "my-wipe", len: 1 });
  assert.deepEqual(
    whatsAt(dir, 4).cuts.map((c) => [c.fx, c.builtIn]),
    [["my-wipe", false]],
  );
  shots({ fx: "dissolve", len: -1 });
  assert.deepEqual(whatsAt(dir, 4).cuts, []);
  // a gap at the cut (scene 8 is heard at 4 under the 2x Speed): the render draws no transition there
  shots({ fx: "dissolve", len: 1 });
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }], gaps: [{ from: 7.9, to: 8.1 }] }),
  );
  assert.deepEqual(whatsAt(dir, 3.9).cuts, []);
});

test("a note's moment past the film's end is still one JSON document under --json", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = { id: "gone", t: 30, scene: 30, text: "gone", shot: 1, time: "", at: "2026-11-01" };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const r = spawnSync("bun", [AT, "gone", "--json"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.note.id, "gone");
  assert.equal(got.pastEnd, true);
  assert.equal(got.length, 15);
});

test('a voice turned off ("voice": false, no narration clip) is not heard, as the mix leaves it out', (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [] }),
  );
  const said = () =>
    spawnSync("bun", [AT, "5"], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" })
      .stdout;
  assert.equal(whatsAt(dir, 5).voiceOff, true);
  assert.match(said(), /^narration: silent here/m);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({ lines: [{ s: 4, e: 6, text: "hi", words: [{ w: "hi", s: 4, e: 6 }] }] }),
  );
  assert.match(said(), /^narration: off, src\/timeline\/audio\.json "voice": false/m);
});

test("a black second names what blacks it out: a gap row of main[], a Freeze left blank, gaps[], or picture ended", (t) => {
  const dir = film(t);
  const main = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "g", kind: "gap", duration: 1 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 20 },
    ],
  };
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify(main));
  assert.equal(whatsAt(dir, 4.5).blackBy, "main[] (a gap row)");

  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 2, duration: 1, blank: true }] }),
  );
  assert.match(whatsAt(dir, 2.5).blackBy ?? "", /freezes\[\] \(a Freeze left blank/);

  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ gaps: [{ from: 2, to: 3 }] }),
  );
  const r = spawnSync("bun", [AT, "2.5"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout.split("\n")[0],
    /black here, a gap in src\/timeline\/timing\.json gaps\[\]/,
  );

  // Layer freeze past timingClock.duration should report picture ended, not gaps[]
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 10 }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      layerKinds: { text: { base: { freezes: [{ at: 4, duration: 4 }] }, changes: [] } },
    }),
  );
  assert.match(whatsAt(dir, 11).blackBy ?? "", /picture ended/);
});

test("a draft's cut is in --json too, and said to be the last render's when the film changed after it", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify([4]));
  const run = (...a) =>
    spawnSync("bun", [AT, ...a], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(run("4.1", "--json").stdout).cut, {
    index: 0,
    at: 4,
    stale: null,
    opensShot: 1,
  });
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(dir, "renders/cuts.json"), old, old);
  const r = run("4.1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^cut 0 at 4\.00 heard, into shot 1 \(renders\/cuts\.json is older than src\/[^ ]+: numbered as the last render cut it; bun run render clip writes it again\)/m,
  );
});

// a camera key with cut: true cuts inside a shot: the render counts it, so cut n is no longer shot n+1's start
test("a draft's cut names the shot it opens, and none for a camera key's cut inside a shot", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify([2, 4]));
  const cutLine = (s) =>
    spawnSync("bun", [AT, s], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" })
      .stdout.split("\n")
      .find((l) => l.startsWith("cut "));
  assert.match(cutLine("2.05"), /^cut 0 at 2\.00 heard: bun run sheet/);
  assert.match(cutLine("4.1"), /^cut 1 at 4\.00 heard, into shot 1: bun run sheet/);
});

test("a second said with an s (4.1s) is a second, as every other film command takes it", (t) => {
  const r = spawnSync("bun", [AT, "4.1s"], {
    env: { ...process.env, LIVE_PROJECT: film(t) },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^00:04\.100 heard/);
});

test("the draft's cut is the nearest one, and a cuts.json that is no list is no cut, never a stack trace", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "renders"));
  const run = () =>
    spawnSync("bun", [AT, "4.1", "--json"], {
      env: { ...process.env, LIVE_PROJECT: dir },
      encoding: "utf8",
    });
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify([3.85, 4.15]));
  assert.equal(JSON.parse(run().stdout).cut.index, 1);
  writeFileSync(join(dir, "renders/cuts.json"), "{}");
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).cut, null);
});

test("takes not laid on the film yet are said where no narration plays, so none is made again", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "voice/takes/01.mp3"), "");
  const r = spawnSync("bun", [AT, "4.1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.match(
    r.stdout,
    /^narration: silent here .*; voice\/takes has audio not on the film yet: bun run voice:assemble lays it/m,
  );
});

test("a film's own transition is not called unknown, and one far from this second is not near", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "a" },
      { t: 4, name: "b", transition: { fx: "myWipe", len: 0.5 } },
      { t: 12, name: "c", transition: { fx: "dissolve", len: 0.5 } },
    ]),
  );
  writeFileSync(join(dir, "src/scene.ts"), 'makeTransitions(r, f, [{ id: "myWipe", glsl: "" }]);');
  const cuts = whatsAt(dir, 4.5).cuts;
  assert.deepEqual(
    cuts.map((c) => [c.fx, c.own]),
    [["myWipe", true]],
  );
});

test("a note with no second, or a package.json that is no JSON, is said: never a stack trace", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  const note = { id: "n1", t: null, text: "the hand", shot: 1, time: "", at: "1" };
  writeFileSync(join(dir, "notes/notes.jsonl"), JSON.stringify(note));
  const run = (arg) =>
    spawnSync("bun", [AT, arg], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" });
  const r = run("#1");
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^note #1 \(n1\) has no second/);
  writeFileSync(join(dir, "package.json"), '{"live-studio": {');
  const p = run("4.1");
  assert.equal(p.status, 2, p.stderr);
  assert.match(p.stderr, /^package\.json .*bun run check/);
});

test("a second a hair under a minute is 01:00.000, never 00:60.000", (t) => {
  const dir = film(t);
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 70 }));
  const r = spawnSync("bun", [AT, "59.9999"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^01:00\.000 heard/);
});

test("a laid voice on a muted track has no takes waiting to be laid, and a newer take is still named", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [{ name: "voice", at: 0, length: 15, gain: 0, track: "v" }],
    }),
  );
  mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
  writeFileSync(join(dir, "assets/public/agent/full_voice.wav"), "");
  utimesSync(join(dir, "assets/public/agent/full_voice.wav"), 1000, 1000);
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "voice/takes/01.mp3"), "");
  writeFileSync(join(dir, "voice/takes/._02.mp3"), "");
  const got = whatsAt(dir, 4.1);
  assert.equal(got.narrationMuted, "v");
  assert.equal(got.unlaid, false);
  assert.deepEqual(got.unplaced, ["01"]);
});

test("an adjustment whose grade sets nothing is said to change nothing", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].adjustmentTimeline = "src/timeline/adjust.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [
        { id: "a", name: "Empty", from: 0, to: 20, track: 0, grade: {} },
        { id: "b", name: "Warm", from: 0, to: 20, track: 0, grade: { basic: { temp: 20 } } },
        {
          id: "c",
          name: "Off",
          from: 0,
          to: 20,
          track: 0,
          grade: { enabled: false, basic: { temp: 20 } },
        },
        { id: "d", name: "Zero", from: 0, to: 20, track: 0, grade: { basic: { temp: 0 } } },
        {
          id: "e",
          name: "LutZero",
          from: 0,
          to: 20,
          track: 0,
          grade: { lut: { enabled: false, amount: 50 } },
        },
      ],
    }),
  );
  const r = spawnSync("bun", [AT, "4.1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.match(
    r.stdout,
    /^looks .*items\[0\] Empty \(its grade sets nothing\), items\[1\] Warm, items\[2\] Off \(disabled\), items\[3\] Zero \(its grade sets nothing\), items\[4\] LutZero \(its grade sets nothing\)$/m,
  );
});

test("noteSecond with null t and valid shot, and negative note t, never crash or print bogus 00:00.000", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"));
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    [
      JSON.stringify({
        id: "badt",
        t: null,
        shot: 0,
        time: "",
        at: "1",
        context: { shot: { into: 2 } },
        text: "hi",
      }),
      JSON.stringify({ id: "negt", t: -2, shot: 9, time: "", at: "1", text: "neg" }),
    ].join("\n"),
  );
  const run = (arg) =>
    spawnSync("bun", [AT, arg], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" });
  const r = run("#1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^00:01\.000 heard/m);
  assert.doesNotMatch(r.stdout, /was written at 00:00\.000/);
  const neg = run("#2");
  assert.equal(neg.status, 2);
  assert.doesNotMatch(neg.stderr, /-1:-2/);
});

test("freeze inside a cut, short-shot nearby transition, sound_choices duration, and unvoiced script lines", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  conf["live-studio"].sfx = "sound/sfx";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));

  // Cut-out freeze must not report held
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ cuts: [{ from: 1, to: 4 }], freezes: [{ at: 2, duration: 2 }] }),
  );
  assert.equal(whatsAt(dir, 2.5).held, null);

  // Transition separated by a <1s intermediate shot is still within 1s
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "s0" },
      { t: 4, name: "s1" },
      { t: 4.5, name: "s2", transition: { fx: "dissolve", len: 0.4 } },
      { t: 8, name: "s3" },
    ]),
  );
  assert.deepEqual(
    whatsAt(dir, 3.7).cuts.map((c) => c.row),
    [2],
  );

  // sound_choices.json + picked sound file duration
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const mkWav = (name, dur) => {
    const f = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `sine=d=${dur}`, `sound/sfx/${name}.wav`],
      {
        cwd: dir,
      },
    );
    assert.equal(f.status, 0, String(f.stderr));
  };
  mkWav("orig", 0.5);
  mkWav("alt", 2.0);
  writeFileSync(join(dir, "sound_choices.json"), JSON.stringify({ orig: { set: "alt" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [
        { name: "voice", at: 0, length: 5, gain: 0, track: "v" },
        { name: "orig", try: ["alt"], at: 1, gain: 0 },
      ],
    }),
  );
  // At 2.5s, orig (0.5s) would have ended at 1.5s, but alt (2.0s) runs until 3.0s
  const at25 = whatsAt(dir, 2.5);
  assert.equal(at25.sounds[0]?.picked, "alt");
  assert.ok(Math.abs((at25.sounds[0]?.to ?? 0) - 3) < 0.05);

  // At 8s (outside muted clip 0..5), unvoiced script_lines (including without until at exact t) is visible
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 20, script_lines: [{ t: 8, text: "UNVOICED AT EIGHT" }] }),
  );
  const at8 = whatsAt(dir, 8);
  assert.equal(at8.narrationMuted, null);
  assert.equal(at8.script?.text, "UNVOICED AT EIGHT");
});

test("camera optics (mm, fstop, focus, handheld) and shot look + active trauma hits show up in --json and text", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      {
        t: 0,
        p: [0, 2, 6],
        l: [0, 1, 0],
        mm: 50,
        fstop: 2,
        focus: "Steve.head",
        handheld: "THE_CLOSEUP",
      },
      {
        t: 10,
        p: [0, 2, 4],
        l: [0, 1, 0],
        mm: 85,
        fstop: 1.4,
        focus: { target: "desk", offset: [0, 0.2, 0] },
      },
    ]),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      {
        t: 0,
        name: "intro",
        adjust: { look: "teal-amber" },
        hits: [{ t: 4.0, amount: 0.8, decay: 2 }],
      },
    ]),
  );
  const hitNow = whatsAt(dir, 2.05);
  assert.equal(hitNow.shot?.look, "teal-amber");
  assert.equal(hitNow.shot?.hits?.length, 1);
  assert.equal(hitNow.shot?.hits?.[0]?.row, 0);
  assert.ok(Math.abs((hitNow.shot?.hits?.[0]?.trauma ?? 0) - 0.6) < 0.01);
  assert.ok(
    Math.abs((hitNow.cam?.mm ?? 0) - 61) < 2,
    `interpolated 50->85mm near 4.1s, got ${hitNow.cam?.mm}`,
  );
  assert.ok((hitNow.cam?.fstop ?? 0) > 1.5 && (hitNow.cam?.fstop ?? 0) < 2.0);
  assert.match(String(hitNow.cam?.focus ?? ""), /Steve\.head -> desk \(0,0\.2,0\)/);
  assert.equal(hitNow.cam?.handheld, "THE_CLOSEUP");

  const r = spawnSync("bun", [AT, "2.05"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^  shot look: teal-amber \(src\/timeline\/shots\.json \[0\]\.adjust\.look\)$/m,
  );
  assert.match(
    r.stdout,
    /^  shot hits: \[0\] t=4\.00 amount=0\.8 trauma=0\.60 \(src\/timeline\/shots\.json \[0\]\.hits\)$/m,
  );
  assert.match(
    r.stdout,
    /^  camera optics: .*mm \(.*°\) · f\/.* · focus Steve\.head -> desk \(0,0\.2,0\) \(.*%\) · handheld THE_CLOSEUP$/m,
  );

  const decayed = whatsAt(dir, 2.25);
  assert.equal(decayed.shot?.hits?.length ?? 0, 0);

  // Overlapping hits in the same decay group report cumulative capped trauma matching film-kit/shake.
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      {
        t: 0,
        hits: [
          { t: 4.0, amount: 0.6 },
          { t: 4.1, amount: 0.7 },
        ],
      },
    ]),
  );
  const cumHit = whatsAt(dir, 2.1); // scene 4.2 s -> prev 0.5 + 0.7 capped at 1.0, decayed 0.1 s = 0.90
  assert.ok(Math.abs((cumHit.shot?.hits?.[1]?.trauma ?? 0) - 0.9) < 0.01);
});

test("whatsAt handles camera keys using anchor objects for p and l without throwing", (t) => {
  const dir = film(t);
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      {
        t: 0,
        p: { eye: [0, 0.34, 0.17] },
        l: { eye: [0, 0, 0] },
        mm: 50,
        fstop: 1.85,
      },
      {
        t: 4,
        p: [1, 2, 3],
        l: [0, 1, 0],
        mm: 50,
        fstop: 1.85,
      },
    ]),
  );
  const state = whatsAt(dir, 0.5);
  assert.ok(state.cam);
  assert.equal(state.cam.fstop, 1.9);
  const r = spawnSync("bun", [AT, "0.5", "--json"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.cam.fstop, 1.9);
  assert.equal(parsed.cam.mm, 50);
});

test("disabled shot adjust and disabled adjustment layer grade never report an active look, while enabled layer look shows (look: ...)", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  conf["live-studio"].adjustmentTimeline = "src/timeline/adjust.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      {
        t: 0,
        name: "room",
        size: "wide (WS)",
        adjust: { look: "teal-amber", enabled: false },
      },
    ]),
  );
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [
        {
          id: "a",
          name: "Muted",
          from: 0,
          to: 20,
          track: 0,
          grade: { look: "noir-slate", enabled: false },
        },
        {
          id: "f",
          name: "Fincher",
          from: 0,
          to: 20,
          track: 1,
          grade: { look: "teal-amber" },
        },
      ],
    }),
  );

  const got = whatsAt(dir, 1.0);
  assert.ok(got.shot);
  assert.equal(got.shot.look, undefined);
  assert.equal(got.looks.length, 2);
  assert.equal(got.looks[0]?.text, "Muted (disabled)");
  assert.equal(got.looks[1]?.text, "Fincher (look: teal-amber)");

  const r = spawnSync("bun", [AT, "1.0"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Muted \(disabled\)/);
  assert.match(r.stdout, /Fincher \(look: teal-amber\)/);
  assert.doesNotMatch(r.stdout, /shot look:|noir-slate/);
});

test('voice:false with unlaid voice/takes never suggests voice:assemble; shot.adjust without look shows in text; "off" narration clip is silenced', (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].shotsTimeline = "src/timeline/shots.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "voice/takes/01_line.wav"), "x");
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [] }),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([{ t: 0, name: "grade", adjust: { basic: { contrast: 15 } } }]),
  );

  const cellStyle = spawnSync("bun", [AT, "5"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(cellStyle.status, 0, cellStyle.stderr);
  assert.doesNotMatch(cellStyle.stdout, /voice:assemble/);
  assert.match(cellStyle.stdout, /shot adjust:/);

  writeFileSync(join(dir, "choices.json"), JSON.stringify({ voice_clip: { set: "off" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice_clip",
      tracks: [{ id: "v", mute: true }],
      beds: [],
      sfx: [{ name: "voice_clip", at: 0, length: 5, gain: 0, track: "v" }],
    }),
  );
  assert.equal(whatsAt(dir, 2).narrationMuted, null);
});

test("Round 15: swapped sfx ignores orig start, voiceOff clears json narration/nextLine, and cam evaluates before cam[0].t", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].sfx = "sound/sfx";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(join(dir, "src/timeline/timing.json"), "{}");

  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  for (const [name, dur] of [
    ["orig", 5],
    ["alt", 2],
  ]) {
    const f = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `sine=d=${dur}`, `sound/sfx/${name}.wav`],
      { cwd: dir },
    );
    assert.equal(f.status, 0, String(f.stderr));
  }
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ orig: { set: "alt" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [
        { name: "orig", at: 1, start: 4, gain: 0, try: ["alt"] },
        { name: "orig", at: 6, start: 4, gain: 0 },
      ],
    }),
  );
  // Row 0 swaps to alt (plays 1.0..3.0s because mix.py pops start); row 1 has no try[] so plays orig from start=4 (6.0..7.0s)
  const at2 = whatsAt(dir, 2);
  assert.equal(at2.sounds.length, 1);
  assert.equal(at2.sounds[0].picked, "alt");
  assert.ok(Math.abs(at2.sounds[0].to - 3) < 0.05);
  const at65 = whatsAt(dir, 6.5);
  assert.equal(at65.sounds.length, 1);
  assert.ok(Math.abs(at65.sounds[0].to - 7) < 0.05);

  // voice:false with voice_map.json present must leave json narration & nextLine null
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      lines: [{ s: 0.5, e: 2.5, text: "hello", words: [{ w: "hello", s: 0.5, e: 2.5 }] }],
    }),
  );
  const vOff = whatsAt(dir, 1);
  assert.equal(vOff.voiceOff, true);
  assert.equal(vOff.narration, null);
  assert.equal(vOff.nextLine, null);

  // cam[0].t > scene still evaluates cameraAt clamped to key 0
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 3, p: [0, 1, 5], l: [0, 1, 0], fov: 50 },
      { t: 10, p: [0, 1, 5], l: [0, 1, 0], fov: 50 },
    ]),
  );
  const r1 = spawnSync("bun", [AT, "1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /camera optics:/);
  assert.ok(whatsAt(dir, 1).cam !== null);
});

test("Round 16: swapped try[] and shared c.name respect timing speeds, and off choice silences audio.narration lines", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].sfx = "sound/sfx";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }] }),
  );
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  for (const [name, dur] of [
    ["orig", 5],
    ["alt", 2],
  ]) {
    const f = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `sine=d=${dur}`, `sound/sfx/${name}.wav`],
      { cwd: dir },
    );
    assert.equal(f.status, 0, String(f.stderr));
  }
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ orig: { set: "alt" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [
        { name: "orig", at: 2, start: 4, gain: 0, try: ["alt"] },
        { name: "orig", at: 6, start: 4, gain: 0 },
      ],
    }),
  );
  // Row 0 swaps to alt (2s from 0 -> 1.0s at 2x, playing 1.0..2.0s heard); row 1 plays orig from start=4 (1s -> 0.5s at 2x, playing 3.0..3.5s heard)
  const at15 = whatsAt(dir, 1.5);
  assert.equal(at15.sounds.length, 1);
  assert.equal(at15.sounds[0].picked, "alt");
  assert.ok(Math.abs(at15.sounds[0].to - 2) < 0.05, `expected to ~2, got ${at15.sounds[0].to}`);
  const at325 = whatsAt(dir, 3.25);
  assert.equal(at325.sounds.length, 1);
  assert.equal(at325.sounds[0].picked, null);
  assert.ok(
    Math.abs(at325.sounds[0].to - 3.5) < 0.05,
    `expected to ~3.5, got ${at325.sounds[0].to}`,
  );

  // choices.json "off" on audio.narration must silence narration, nextLine, and script
  makeAudio(join(dir, "sound/sfx/voice_clip.wav"), 5);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      lines: [
        {
          s: 0.5,
          e: 2.5,
          text: "hello world",
          words: [{ w: "hello", s: 0.5, e: 2.5 }],
        },
      ],
    }),
  );
  writeFileSync(join(dir, "choices.json"), "{}");
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "voice_clip",
      beds: [],
      sfx: [{ name: "voice_clip", at: 0, length: 5, gain: 0 }],
    }),
  );
  const onAt1 = whatsAt(dir, 1);
  assert.ok(onAt1.narration !== null, "expected active narration line before choices off");
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ voice_clip: { set: "off" } }));
  const offAt1 = whatsAt(dir, 1);
  assert.equal(offAt1.narration, null);
  assert.equal(offAt1.nextLine, null);
  assert.equal(offAt1.narrationOff, "choices.json");
  const cliOff = spawnSync("bun", [AT, "0"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(cliOff.status, 0, cliOff.stderr);
  assert.match(cliOff.stdout, /narration: off \(choices\.json/);
});

test("Round 17: disabled non-look adjustment prints (disabled) and openSound defaults to sound/sfx", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  // Intentionally omit live-studio.sfx like templates/film does; mix.py defaults to sound/sfx
  delete conf["live-studio"].sfx;
  conf["live-studio"].adjustmentTimeline = "src/timeline/adjust.json";
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [
        {
          id: "a",
          name: "DisabledExp",
          from: 0,
          to: 10,
          track: 0,
          grade: { enabled: false, basic: { exposure: 25 } },
        },
      ],
    }),
  );
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  for (const [name, dur] of [
    ["orig", 5],
    ["alt", 2],
  ]) {
    const f = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `sine=d=${dur}`, `sound/sfx/${name}.wav`],
      { cwd: dir },
    );
    assert.equal(f.status, 0, String(f.stderr));
  }
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ orig: { set: "alt" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [{ name: "orig", at: 1, gain: 0, try: ["alt"] }],
    }),
  );
  // at=1 with 2s alt under 2x speed plays 0.5..1.5s heard
  const res = whatsAt(dir, 1);
  assert.equal(res.sounds.length, 1);
  assert.equal(res.sounds[0].picked, "alt");
  assert.ok(Math.abs(res.sounds[0].to - 1.5) < 0.05, `expected to ~1.5, got ${res.sounds[0].to}`);
  const out = spawnSync("bun", [AT, "1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /DisabledExp \(disabled\)/);

  // Off sfx without length still resolves disk duration via audioInfo, never falsely claiming missing file
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ orig: { set: "off" } }));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({ beds: [], sfx: [{ name: "orig", at: 2, gain: 0 }] }),
  );
  // orig is 5s starting at 2 -> 2..7s on scene, at 2x speed -> 1.0..3.5s heard
  const offSfx = whatsAt(dir, 2);
  assert.equal(offSfx.sounds.length, 1);
  assert.equal(offSfx.sounds[0].picked, "off");
  assert.ok(
    Math.abs(offSfx.sounds[0].to - 3.5) < 0.05,
    `expected to ~3.5, got ${offSfx.sounds[0].to}`,
  );
  const cliOffSfx = spawnSync("bun", [AT, "2"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(cliOffSfx.status, 0, cliOffSfx.stderr);
  assert.doesNotMatch(cliOffSfx.stdout, /file is not on this machine/);
});

test("Round 19: at respects cam cut boundary, .mp3 soundSources & cut unknown-length sfx, hidden adjustments, and script_lines timing", (t) => {
  const dir = film(t);
  const conf = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  conf["live-studio"].adjustmentTimeline = "src/timeline/adjust.json";
  conf["live-studio"].soundSources = { hitmp3: "sound/hit.mp3" };
  writeFileSync(join(dir, "package.json"), JSON.stringify(conf));
  mkdirSync(join(dir, "sound"), { recursive: true });
  const ffMp3 = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=2", "sound/hit.mp3"],
    { cwd: dir },
  );
  assert.equal(ffMp3.status, 0, String(ffMp3.stderr));

  // 1) Camera cut:true stops forward interpolation span at [0]
  writeFileSync(
    join(dir, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 2, 5], l: [0, 0, 0], fov: 40 },
      { t: 5, p: [10, 2, 5], l: [0, 0, 0], fov: 20, cut: true },
      { t: 10, p: [10, 2, 0], l: [0, 0, 0], fov: 20 },
    ]),
  );
  // 2) Hidden adjustment item still active (grade-layers.ts only hides by track.hidden)
  writeFileSync(
    join(dir, "src/timeline/adjust.json"),
    JSON.stringify({
      items: [
        { id: "a1", name: "Warm", from: 0, to: 10, track: 0, hidden: true, grade: { warmth: 20 } },
      ],
    }),
  );
  // 3) .mp3 soundSources + unknown-length missing sfx inside cut + script_lines in cut vs active
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 10,
      script_lines: [
        { t: 6.5, text: "CUT LINE" },
        { t: 8.5, text: "NEXT LINE" },
      ],
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ cuts: [{ from: 6, to: 8 }] }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [],
      sfx: [
        { name: "hitmp3", at: 2, gain: 0 },
        { name: "missing_in_cut", at: 6.5, gain: 0 },
      ],
    }),
  );

  const at2 = whatsAt(dir, 2.5);
  assert.equal(at2.cam.before, 0);
  assert.equal(at2.cam.after, null);
  assert.equal(at2.sounds.length, 1);
  assert.equal(at2.sounds[0].name, "hitmp3");
  assert.ok(Math.abs(at2.sounds[0].to - 4) < 0.05, `expected to ~4, got ${at2.sounds[0].to}`);
  assert.equal(at2.looks.length, 1);
  assert.equal(at2.script?.text, "NEXT LINE");

  const cliCutSfx = whatsAt(dir, 6.2);
  assert.equal(cliCutSfx.sounds.length, 0);

  const out2 = spawnSync("bun", [AT, "2.5"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(out2.status, 0, out2.stderr);
  assert.doesNotMatch(out2.stdout, /-> \[1\]/);

  // 4) script_lines lookahead follows heard order across reordered main[]
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 10,
      script_lines: [{ t: 2, text: "REORDERED NEXT" }],
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      main: [
        { id: "c1", kind: "clip", sourceFrom: 5, sourceTo: 10 },
        { id: "c2", kind: "clip", sourceFrom: 0, sourceTo: 5 },
      ],
    }),
  );
  assert.equal(whatsAt(dir, 1).script?.text, "REORDERED NEXT");
  const reorderedCli = spawnSync("bun", [AT, "1"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(reorderedCli.status, 0, reorderedCli.stderr);
  assert.match(reorderedCli.stdout, /the next one/);
});

test("Round 20: at '#N' moves note onto visible freeze past blank padBefore", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "at-freeze-r20-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { timingTimeline: "src/timeline/timing.json" } }),
  );
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 10 }));
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 3, duration: 2, padBefore: 1.5 }] }),
  );
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    `${JSON.stringify({ id: "n1", t: 4, scene: 3, done: false, shot: 1, time: "", text: "on freeze", at: "2026-11-01T00:00:00Z" })}\n`,
  );
  const r = spawnSync("bun", [AT, "#1", "--json"], {
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.note.heard, 4.5);
  assert.equal(got.blank, false);
});

test("Round 21: whatsAt lists nearby open note when t is null and scene places it", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    `${JSON.stringify({ id: "nullt", t: null, scene: 8.2, done: false, shot: 1, time: "", text: "legacy null t", at: "2026-11-01T00:00:00Z" })}\n`,
  );
  const at4 = whatsAt(dir, 4.1);
  assert.deepEqual(
    at4.notes.map((n) => n.id),
    ["nullt"],
  );
});

test("Round 22: camera varying fov doesn't throw lmix, mix.py honors swapped sfx under speeds and off-narration ducking, and at keeps cam end across voice cues", (t) => {
  const MIX = resolve(dirname(AT), "sound/mix.py");
  // 1) Camera keyframes with different fov must interpolate cleanly (no ReferenceError: lmix is not defined)
  const dirCam = film(t);
  writeFileSync(
    join(dirCam, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 2, 5], l: [0, 1, 0], fov: 50 },
      { t: 10, p: [0, 2, 0], l: [0, 1, 0], fov: 30 },
    ]),
  );
  const gotCam = whatsAt(dirCam, 2.5);
  assert.ok(gotCam.cam && gotCam.cam.fov > 30 && gotCam.cam.fov < 50);

  // 2) mix.py vs at on try[]-swapped sfx under timing.json + "off" narration not ducking beds
  const dirMix = mkdtempSync(join(tmpdir(), "at-mix-r22-"));
  t.after(() => rmSync(dirMix, { recursive: true, force: true }));
  mkdirSync(join(dirMix, "src/timeline"), { recursive: true });
  mkdirSync(join(dirMix, "sound/sfx"), { recursive: true });
  writeFileSync(join(dirMix, "src/scene.ts"), "");
  writeFileSync(
    join(dirMix, "package.json"),
    JSON.stringify({
      name: "r22-at-mix",
      "live-studio": {
        sfx: "sound/sfx",
        soundVault: false,
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  writeFileSync(
    join(dirMix, "src/edit.json"),
    JSON.stringify({
      end: 6,
      voice: {
        edits: {},
        warp: [],
        lines: [
          [0, 2],
          [0, 2],
        ],
      },
      beats: {},
    }),
  );
  writeFileSync(
    join(dirMix, "src/timeline/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }] }),
  );
  for (const [name, dur] of [
    ["orig_short", 3],
    ["alt", 4],
    ["hum", 5],
    ["narr", 3],
  ]) {
    const ff = spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=f=440:d=${dur}`, `sound/sfx/${name}.wav`],
      { cwd: dirMix, encoding: "utf8" },
    );
    assert.equal(ff.status, 0, ff.stderr);
  }
  writeFileSync(
    join(dirMix, "choices.json"),
    JSON.stringify({ orig_short: { set: "alt" }, narr: { set: "off" } }),
  );
  writeFileSync(
    join(dirMix, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      narration: "narr",
      beds: [{ name: "hum", from: 0, to: 4, gain: 0, fadeIn: 0, fadeOut: 0, duck: 20 }],
      sfx: [
        { name: "orig_short", at: 2, start: 4, gain: 0, try: ["alt"] },
        { name: "narr", at: 0, gain: 0 },
      ],
    }),
  );
  const atSwapped = whatsAt(dirMix, 2.5);
  assert.equal(atSwapped.sounds.find((s) => s.name === "orig_short")?.picked, "alt");
  const mixRun = spawnSync("python", [MIX], { cwd: dirMix, encoding: "utf8", timeout: 60000 });
  assert.equal(mixRun.status, 0, mixRun.stdout + mixRun.stderr);
  // 2.0..2.8s has alt swapped onto orig_short (ffmpeg sine default RMS ~ -23 dB vs -91 dB when truncated/skipped)
  const volTail = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      "sound/mix_raw.wav",
      "-af",
      "atrim=2.0:2.8,volumedetect",
      "-f",
      "null",
      "-",
    ],
    { cwd: dirMix, encoding: "utf8" },
  );
  const mTail = /mean_volume:\s*([-\d.]+)\s*dB/.exec(volTail.stderr);
  assert.ok(mTail && Number(mTail[1]) > -40, volTail.stderr);
  // 0.2..1.2s has hum while narr is "off" -> hum stays unducked (~ -23 dB vs ~ -43 dB ducked 20 dB)
  const volDuck = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      "sound/mix_raw.wav",
      "-af",
      "atrim=0.2:1.2,volumedetect",
      "-f",
      "null",
      "-",
    ],
    { cwd: dirMix, encoding: "utf8" },
  );
  const mDuck = /mean_volume:\s*([-\d.]+)\s*dB/.exec(volDuck.stderr);
  assert.ok(mDuck && Number(mDuck[1]) > -30, volDuck.stderr);

  // 3) Omitted edit.end keeps cam timing scope across buildVoiceCues before nextScript()
  const dirScript = mkdtempSync(join(tmpdir(), "at-script-r22-"));
  t.after(() => rmSync(dirScript, { recursive: true, force: true }));
  mkdirSync(join(dirScript, "src/timeline"), { recursive: true });
  mkdirSync(join(dirScript, "assets/public/agent"), { recursive: true });
  writeFileSync(join(dirScript, "src/scene.ts"), "");
  writeFileSync(
    join(dirScript, "package.json"),
    JSON.stringify({
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  writeFileSync(
    join(dirScript, "src/edit.json"),
    JSON.stringify({
      voice: { edits: {}, warp: [], lines: [[2, 4]] },
      script_lines: [{ t: 14, text: "REORDERED EARLY SCRIPT" }],
    }),
  );
  writeFileSync(
    join(dirScript, "src/timeline/cam.json"),
    JSON.stringify([
      { t: 0, p: [0, 2, 5], l: [0, 1, 0] },
      { t: 20, p: [0, 2, 0], l: [0, 1, 0] },
    ]),
  );
  writeFileSync(
    join(dirScript, "src/timeline/timing.json"),
    JSON.stringify({
      main: [
        { id: "c1", kind: "clip", sourceFrom: 12, sourceTo: 20 },
        { id: "c2", kind: "clip", sourceFrom: 0, sourceTo: 12 },
      ],
    }),
  );
  writeFileSync(
    join(dirScript, "assets/public/agent/voice_map.json"),
    JSON.stringify({
      lines: [
        {
          id: "001",
          text: "Hello later",
          s: 2,
          e: 4,
          words: [{ w: "Hello", s: 2, e: 3 }],
        },
      ],
    }),
  );
  const gotScript = whatsAt(dirScript, 1.0);
  assert.equal(gotScript.script?.text, "REORDERED EARLY SCRIPT");
});

test("Round 23: at marks unlaid takes as silent until assemble, hides beds/sfx in freeze and gap, and enforces start/EOF/rate/try on sfx with explicit length", (t) => {
  // 1) voice/takes with .words.json but no full_voice.wav -> at reports silent + unlaid (mix.py has no voice), voice:cues warns on stderr
  const dirUnlaid = film(t);
  writeFileSync(
    join(dirUnlaid, "src/edit.json"),
    JSON.stringify({ end: 15, takes: [{ id: "01", at: 0, text: "Hello world" }] }),
  );
  mkdirSync(join(dirUnlaid, "voice/takes"), { recursive: true });
  writeFileSync(join(dirUnlaid, "voice/takes/01.mp3"), "fake");
  writeFileSync(
    join(dirUnlaid, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 2,
      words: [
        { w: "Hello", s: 0.1, e: 0.6 },
        { w: "world", s: 0.7, e: 1.5 },
      ],
    }),
  );
  const gotUnlaid = whatsAt(dirUnlaid, 0.4);
  assert.equal(gotUnlaid.narration, null);
  assert.equal(gotUnlaid.unlaid, true);
  const cliUnlaid = spawnSync("bun", [AT, "0.4"], {
    env: { ...process.env, LIVE_PROJECT: dirUnlaid },
    encoding: "utf8",
  });
  assert.equal(cliUnlaid.status, 0, cliUnlaid.stderr);
  assert.match(cliUnlaid.stdout, /narration: silent here.*voice:assemble/);

  const CUES = fileURLToPath(new URL("../voice/cues.ts", import.meta.url));
  const cuesCli = spawnSync("bun", [CUES], {
    env: { ...process.env, LIVE_PROJECT: dirUnlaid },
    encoding: "utf8",
  });
  assert.equal(cuesCli.status, 0, cuesCli.stderr);
  assert.match(cuesCli.stdout, /Hello world/);
  assert.match(cuesCli.stderr, /voice:assemble/);

  // 2) beds & sfx must not show during freeze or gap spans where mix.py/process.py emit silence
  const dirTiming = film(t);
  const confTiming = JSON.parse(readFileSync(join(dirTiming, "package.json"), "utf8"));
  confTiming["live-studio"].timingTimeline = "src/timeline/timing.json";
  writeFileSync(join(dirTiming, "package.json"), JSON.stringify(confTiming));
  writeFileSync(join(dirTiming, "src/edit.json"), JSON.stringify({ end: 12 }));
  writeFileSync(
    join(dirTiming, "src/timeline/timing.json"),
    JSON.stringify({
      freezes: [{ at: 2, duration: 2 }],
      gaps: [{ from: 6, to: 8 }],
    }),
  );
  // source 0..2 -> heard 0..2 (play); freeze @2 len 2 -> heard 2..4 (freeze); source 2..6 -> heard 4..8 (play); gap 6..8 -> heard 8..10 (blank gap); source 8..12 -> heard 10..14 (play)
  writeFileSync(
    join(dirTiming, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [{ name: "drone", from: 0, to: 10, gain: 0, fadeIn: 0, fadeOut: 0 }],
      sfx: [{ name: "tone", at: 0, length: 10, gain: 0 }],
    }),
  );
  assert.deepEqual(
    whatsAt(dirTiming, 1.0).sounds.map((s) => s.name),
    ["drone", "tone"],
  );
  assert.deepEqual(whatsAt(dirTiming, 3.0).sounds, []);
  assert.deepEqual(
    whatsAt(dirTiming, 5.0).sounds.map((s) => s.name),
    ["drone", "tone"],
  );
  assert.deepEqual(whatsAt(dirTiming, 9.0).sounds, []);
  assert.deepEqual(
    whatsAt(dirTiming, 10.5).sounds.map((s) => s.name),
    ["drone", "tone"],
  );

  // 3) sfx with explicit length: start >= seconds skipped, EOF + rate clamped, and try[] swap ignores orig start & clamps to replacement EOF
  const dirLen = film(t);
  writeFileSync(join(dirLen, "src/timeline/timing.json"), "{}");
  mkdirSync(join(dirLen, "sound/sfx"), { recursive: true });
  for (const [name, dur] of [
    ["beep_1s", 1],
    ["clip_15", 1.5],
    ["alt_08", 0.8],
  ]) {
    const ff = spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=f=440:d=${dur}`, `sound/sfx/${name}.wav`],
      { cwd: dirLen, encoding: "utf8" },
    );
    assert.equal(ff.status, 0, ff.stderr);
  }
  writeFileSync(join(dirLen, "choices.json"), JSON.stringify({ beep_1s: { set: "alt_08" } }));
  writeFileSync(
    join(dirLen, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [
        // unswapped start >= seconds with explicit length -> skipped
        { name: "beep_1s", at: 5, start: 5, length: 1, gain: 0 },
        // EOF clamped + rate 2x: avail = (1.5 - 0.5) / 2 = 0.5s (0..0.5, NOT 0..5)
        { name: "clip_15", at: 0, start: 0.5, rate: 2, length: 5, gain: 0 },
        // swapped to alt_08 (0.8s): drops orig start=5 and clamps to 0.8s (10..10.8)
        { name: "beep_1s", at: 10, start: 5, length: 2, gain: 0, try: ["alt_08"] },
      ],
    }),
  );
  assert.deepEqual(
    whatsAt(dirLen, 0.25).sounds.map((s) => s.name),
    ["clip_15"],
  );
  assert.deepEqual(whatsAt(dirLen, 1.0).sounds, []);
  assert.deepEqual(whatsAt(dirLen, 5.2).sounds, []);
  assert.deepEqual(
    whatsAt(dirLen, 10.4).sounds.map((s) => s.picked),
    ["alt_08"],
  );
  assert.deepEqual(whatsAt(dirLen, 11.2).sounds, []);
});

test("at and voice cues preserve declared reorder playback before capping at audio EOF", async (t) => {
  const { buildVoiceCues } = await import("../voice/cues.ts");
  const dir = film(t);
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const made = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.5", join(dir, "sound/sfx/tone.wav")],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(made.status, 0, made.stderr);
  const put = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value));
  put("src/edit.json", { end: 10 });
  put("src/timeline/timing.json", {
    main: [
      { id: "late", kind: "clip", sourceFrom: 5, sourceTo: 10 },
      { id: "early", kind: "clip", sourceFrom: 0, sourceTo: 5 },
    ],
    speeds: [{ from: 0, to: 10, rate: 2 }],
  });
  const audio = { voice: false, beds: [], sfx: [{ name: "tone", at: 4, length: 4, gain: 0 }] };
  put("src/timeline/audio.json", audio);
  const heard = whatsAt(dir, 4.8);
  assert.equal(heard.sounds.length, 1);
  assert.equal(heard.sounds[0].to, 5);
  assert.equal(whatsAt(dir, 5.1).sounds.length, 0);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  put("renders/live/voice_map.json", {
    lines: [{ text: "hello", s: 0.1, e: 0.4, words: [{ w: "hello", s: 0.1, e: 0.4 }] }],
  });
  put("src/timeline/audio.json", { ...audio, narration: "tone" });
  assert.deepEqual(
    buildVoiceCues(dir).lines.map((line) => [line.s, line.e]),
    [[4.6, 4.9]],
  );
  assert.equal(whatsAt(dir, 4.8).narration?.text, "hello");
});

test("at applies physical EOF after compiling repeated SFX playback", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const made = spawnSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(dir, "sound/sfx/tone.wav")],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(made.status, 0, made.stderr);
  const put = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value));
  put("src/edit.json", { end: 4 });
  put("src/timeline/audio.json", {
    voice: false,
    beds: [],
    sfx: [{ name: "tone", at: 0, length: 4, gain: 0 }],
  });
  for (const rate of [1, 2]) {
    put("src/timeline/timing.json", {
      main: [
        { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 2 },
        { id: "b", kind: "clip", sourceFrom: 0, sourceTo: 2 },
      ],
      speeds: [{ from: 0, to: 4, rate }],
    });
    for (const [at, active] of [
      [0.5, true],
      [1.5, false],
      [2.5, true],
      [3.5, false],
    ]) {
      const got = whatsAt(dir, at / rate);
      assert.equal(got.sounds.length, active ? 1 : 0, `${at / rate}s at ${rate}x`);
      if (active) assert.equal(got.sounds[0].to, 3 / rate);
    }
  }
});

test("at formats point focus specs and Auto rack endpoints cleanly", (t) => {
  const dir = film(t);
  const put = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value));
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  pkg["live-studio"].shotsTimeline = "src/timeline/shots.json";
  put("package.json", pkg);
  put("src/edit.json", { end: 6 });
  put("src/timeline/timing.json", {});
  put("src/timeline/cam.json", [{ t: 0, p: [0, 0, 10], l: [0, 0, 0], fov: 50 }]);
  put("src/timeline/shots.json", [
    {
      t: 0,
      optics: {
        focus: {
          a: { t: 0, value: null },
          b: { t: 2, value: { point: [1, 2.5, 3], label: "Wall" }, ease: "linear" },
          c: { t: 4, value: { point: [4, 5, 6] }, ease: "hold" },
        },
      },
    },
  ]);
  assert.equal(whatsAt(dir, 1).cam?.focus, "Auto -> Wall (1,2.5,3) (50%)");
  assert.equal(whatsAt(dir, 2).cam?.focus, "Wall (1,2.5,3)");
  assert.equal(whatsAt(dir, 4).cam?.focus, "point (4,5,6)");
});

test("--pixel --plane finds where a frame's pixel meets a world plane through the camera at that second", (t) => {
  const dir = film(t);
  const at = (...args) =>
    spawnSync("bun", [AT, "4.1", ...args], {
      env: { ...process.env, LIVE_PROJECT: dir },
      encoding: "utf8",
    });
  // keys without p or l sit at the origin and look down -z; the frame's middle runs straight along that axis
  const r = at("--pixel", "960,540", "--plane", "z=-5", "--json");
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.pixel, { at: [960, 540], plane: "z=-5", point: [0, 0, -5] });
  assert.deepEqual(got.cam.pose.p, [0, 0, 0]);
  // which way the picture's right and up run in the world, for "move it right" by eye
  assert.deepEqual(got.cam.screen, { right: [1, 0, 0], up: [0, 1, 0] });
  assert.match(at().stdout, /picture right is world \+x, up is world \+y/);
  assert.match(at("--pixel", "960,540", "--plane", "y=1").stdout, /never meets y=1/);
  for (const args of [
    ["--pixel", "960,540"],
    ["--plane", "z=-5"],
    ["--pixel", "a,b", "--plane", "z=-5"],
  ]) {
    const bad = at(...args);
    assert.equal(bad.status, 2, bad.stdout);
    assert.match(bad.stderr, /--pixel x,y and --plane y=0\.92 go together/);
  }
  const twice = at("--pixel", "960,540", "--plane", "z=-5", "--plane", "z=-6");
  assert.equal(twice.status, 2, twice.stdout);
  assert.match(twice.stderr, /go once each/);
});
