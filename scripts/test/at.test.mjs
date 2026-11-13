import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  put("src/timeline/steve.json", { moves: [{ t: 0 }, { t: 7 }, { t: 9 }] });
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

test("at refuses a second past the film's end and says how long it is", (t) => {
  const r = spawnSync("bun", [AT, "99"], {
    env: { ...process.env, LIVE_PROJECT: film(t) },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /15\.000 s long/);
});
