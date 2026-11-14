import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("a note's moment lists the other open notes near it, not itself", (t) => {
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
  assert.match(r.stdout, /open notes heard within 3 s: other at/);
  assert.doesNotMatch(r.stdout, /self at/);
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
  assert.match(r.stdout, /^note #1 \(hand\)/m);
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
