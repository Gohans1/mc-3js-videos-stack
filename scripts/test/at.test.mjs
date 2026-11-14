import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { whatsAt } from "../at.ts";

const AT = resolve(dirname(fileURLToPath(import.meta.url)), "../at.ts");

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
  assert.equal(got.sounds[0]?.muted, true);
  assert.equal(whatsAt(dir, 5).blank, false);
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
  // a film with no voice lines is silent, not a voice turned off
  assert.match(said(), /^narration: silent here/m);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({ lines: [{ s: 4, e: 6, text: "hi", words: [{ w: "hi", s: 4, e: 6 }] }] }),
  );
  assert.match(said(), /^narration: off, src\/timeline\/audio\.json "voice": false/m);
});

test("a black second names what blacks it out: a gap row of main[], a Freeze left blank, or gaps[]", (t) => {
  const dir = film(t);
  const said = (timing, at) => {
    writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify(timing));
    const r = spawnSync("bun", [AT, String(at)], {
      env: { ...process.env, LIVE_PROJECT: dir },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split("\n")[0];
  };
  const main = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "g", kind: "gap", duration: 1 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 20 },
    ],
  };
  assert.match(said(main, 4.5), /black here, src\/timeline\/timing\.json main\[\] \(a gap row\)/);
  assert.match(
    said({ freezes: [{ at: 2, duration: 1, blank: true }] }, 2.5),
    /black here, src\/timeline\/timing\.json freezes\[\] \(a Freeze left blank/,
  );
  assert.match(
    said({ gaps: [{ from: 2, to: 3 }] }, 2.5),
    /black here, a gap in src\/timeline\/timing\.json gaps\[\]/,
  );
});

test("a draft's cut is in --json too, and said to be the last render's when the film changed after it", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify([4]));
  const run = (...a) =>
    spawnSync("bun", [AT, ...a], { env: { ...process.env, LIVE_PROJECT: dir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(run("4.1", "--json").stdout).cut, { index: 0, at: 4, stale: null });
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(dir, "renders/cuts.json"), old, old);
  const r = run("4.1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^cut 0 at 4\.00 heard, into shot 1 \(renders\/cuts\.json is older than src\/[^ ]+: numbered as the last render cut it; bun run render clip writes it again\)/m,
  );
});

test("a second said with an s (4.1s) is a second, as every other film command takes it", (t) => {
  const r = spawnSync("bun", [AT, "4.1s"], {
    env: { ...process.env, LIVE_PROJECT: film(t) },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^00:04\.100 heard/);
});

test("the draft's cut is the nearest one, and a cuts.json that is no list is said, never a stack trace", (t) => {
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
