// src/notes.mjs: a note keeps every picture sent with it, a retry is not a second note, and × can be undone
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  noteFreeView,
  noteNumberMap,
  noteRangePill,
  noteSecond,
  noteShotTitle,
  pinShortLabel,
  resolveNoteMedia,
} from "../app/notes/note-card-meta.ts";
import { spanFade } from "../app/notes/pinfade.ts";
import { createApi } from "../src/api.mjs";
import { createNotes, watchNotesFile } from "../src/notes.mjs";
import { compileTiming } from "../src/timing.mjs";

const pic = (s) => `data:image/jpeg;base64,${Buffer.from(s).toString("base64")}`;
const sent = () => ({
  note: {
    id: "abc1",
    t: 20,
    time: "00:20.000",
    shot: 2,
    text: "two moments",
    done: true,
    fixes: [{ what: "forged" }],
    marks: [
      { kind: "pen", t: 20, pts: [[0.1, 0.1]] },
      { kind: "pen", t: 23, pts: [[0.2, 0.2]] },
    ],
  },
  img: pic("main"),
  crop: pic("crop"),
  strip: pic("strip"),
  frames: [
    { t: 20, img: pic("f20") },
    { t: 23, img: pic("f23") },
  ],
});

test("a note stays on its picture when a Speed edit after it moves that picture's heard second", () => {
  // written at 8.2 s with no Speed; then the first 10 scene seconds go 2x, so that picture is heard at 4.1
  const clock = compileTiming({ speeds: [{ from: 0, to: 10, rate: 2 }] }, 20);
  const voiceOnly = (s) => s;
  assert.ok(Math.abs(noteSecond({ t: 8.2, srcT: 8.2, scene: 8.2 }, voiceOnly, clock) - 4.1) < 1e-6);
  // one from before scene seconds were kept finds its shot by name (a shot added in front renumbered it) and its place there
  const shots = [
    { t: 0, name: "the room" },
    { t: 5, name: "a new insert" },
    { t: 8, name: "his hand" },
  ];
  const old = {
    t: 8.2,
    srcT: 8.2,
    shot: 1,
    shotName: "his hand",
    context: { shot: { into: 0.2 } },
  };
  assert.ok(Math.abs(noteSecond(old, voiceOnly, clock, shots) - 4.1) < 1e-6);
  // with no shot of that name left: its narration second, as before
  assert.equal(noteSecond({ ...old, shotName: "gone" }, voiceOnly, clock, shots), 8.2);
});

test("a note written during a held frame stays at its own second while that frame still holds there", () => {
  // scene second 0 held for the film's first 6 s (a Freeze): a note at 0 s, at 2 s, and one written before the hold existed
  const held = compileTiming({ freezes: [{ at: 0, duration: 6 }] }, 20),
    voiceOnly = (s) => s;
  assert.equal(noteSecond({ t: 0, srcT: 0, scene: 0 }, voiceOnly, held), 0);
  assert.equal(noteSecond({ t: 2, srcT: 2, scene: 0 }, voiceOnly, held), 2);
  // the hold moved away from where the note was written: the picture's first heard second, not the end of its hold
  const later = compileTiming(
    { speeds: [{ from: 0, to: 20, rate: 1 }], freezes: [{ at: 0, duration: 6 }] },
    20,
  );
  assert.equal(noteSecond({ t: 9, srcT: 9, scene: 0 }, voiceOnly, later), 0);
  // malformed t: null with shot context must not throw inside frameAt/sourceAt; non-finite srcT must not turn t into NaN
  assert.equal(
    noteSecond({ t: null, shot: 0, context: { shot: { into: 1.5 } } }, voiceOnly, held, [
      { t: 0, name: "a" },
    ]),
    7.5,
  );
  assert.equal(noteSecond({ t: 4, srcT: "oops" }, voiceOnly, held, []), 4);
});

test("a note keeps its frame, the pin's close-up, the seconds around it and one picture per drawn moment", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const notes = createNotes(dir);
    notes.add(sent(), { version: "v1" });
    const [n] = notes.read();
    assert.equal(n.img, "notes/img/abc1.jpg");
    assert.equal(n.crop, "notes/img/abc1_crop.jpg");
    assert.equal(n.strip, "notes/img/abc1_strip.jpg");
    assert.deepEqual(n.frames, [
      { t: 20, img: "notes/img/abc1_f0.jpg" },
      { t: 23, img: "notes/img/abc1_f1.jpg" },
    ]);
    for (const [file, words] of [
      ["abc1", "main"],
      ["abc1_crop", "crop"],
      ["abc1_strip", "strip"],
      ["abc1_f0", "f20"],
      ["abc1_f1", "f23"],
    ]) {
      assert.equal(readFileSync(join(dir, "notes/img", `${file}.jpg`), "utf8"), words);
      assert.equal(notes.picture(file).toString(), words);
    }
    assert.equal(n.marks.length, 2);
    assert.equal(n.version, "v1");
    assert.equal(n.done, undefined, "what was done to a note is the server's to say");
    assert.equal(n.fixes, undefined);

    notes.add(sent(), { version: "v1" });
    assert.equal(notes.read().length, 1, "a retry after a lost answer isn't a second note");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a note keeps the reference pictures the creator pasted, in the order pasted", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const notes = createNotes(dir);
    notes.add({ note: { id: "ref1", t: 3, text: "like this" }, refs: [pic("r0"), pic("r1")] }, {});
    const [n] = notes.read();
    assert.deepEqual(n.refs, ["notes/img/ref1_r0.jpg", "notes/img/ref1_r1.jpg"]);
    assert.equal(notes.picture("ref1_r1").toString(), "r1");
    notes.add({ note: { id: "bare", t: 4, text: "x", refs: ["../../etc/x"] } }, {});
    assert.equal(
      notes.read()[1].refs,
      undefined,
      "what a note's pictures are is the server's to say",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("× moves a note aside and undo brings it back with the words it had", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const notes = createNotes(dir);
    notes.add(sent(), {});
    notes.change("abc1", { remove: true });
    assert.equal(notes.read().length, 0);
    assert.ok(existsSync(join(dir, "notes/deleted.jsonl")));
    notes.change("abc1", { restore: true, text: "two moments, edited" });
    const [n] = notes.read();
    assert.equal(n.text, "two moments, edited");
    assert.equal(n.img, "notes/img/abc1.jpg");
    assert.equal(readFileSync(join(dir, "notes/deleted.jsonl"), "utf8"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveNoteMedia serves persisted /api/note-img URLs (the pasted pictures too) for both open and done notes, falls back to unsent data URLs, and handles missing images", () => {
  const openSaved = {
    id: "mw9jknxt",
    done: false,
    img: "notes/img/mw9jknxt.jpg",
    crop: "notes/img/mw9jknxt_crop.jpg",
  };
  assert.deepEqual(resolveNoteMedia(openSaved, []), {
    thumb: "/api/note-img/mw9jknxt.jpg",
    crop: "/api/note-img/mw9jknxt_crop.jpg",
    refs: [],
    after: null,
    noAfterReason: null,
    afterCam: null,
    afterTime: null,
  });

  const doneSaved = { id: "mw3t3iip", done: true, img: "notes/img/mw3t3iip.jpg" };
  assert.deepEqual(resolveNoteMedia(doneSaved, []), {
    thumb: "/api/note-img/mw3t3iip.jpg",
    crop: null,
    refs: [],
    after: null,
    noAfterReason: null,
    afterCam: null,
    afterTime: null,
  });

  const withAfter = {
    id: "fx1234",
    done: true,
    img: "notes/img/fx1234.jpg",
    fixes: [
      {
        at: 1000,
        what: "Moved bench",
        after: "notes/img/fx1234_fix0.png",
        t: 4.5,
        cam: { p: [1, 2, 3], l: [4, 5, 6], fov: 50 },
      },
    ],
  };
  assert.deepEqual(resolveNoteMedia(withAfter, []), {
    thumb: "/api/note-img/fx1234.jpg",
    crop: null,
    refs: [],
    after: "/api/note-img/fx1234_fix0.png",
    noAfterReason: null,
    afterCam: { p: [1, 2, 3], l: [4, 5, 6], fov: 50 },
    afterTime: 4.5,
  });

  const withReasonOnly = {
    id: "fx5678",
    done: true,
    fixes: [
      { at: 2000, what: "Audio gain fix", noAfterReason: "Audio-only change; frame unchanged" },
    ],
  };
  assert.deepEqual(resolveNoteMedia(withReasonOnly, []), {
    thumb: null,
    crop: null,
    refs: [],
    after: null,
    noAfterReason: "Audio-only change; frame unchanged",
    afterCam: null,
    afterTime: null,
  });

  const unsentOnly = { id: "new123", done: false };
  const queue = [
    {
      note: unsentOnly,
      img: "data:image/jpeg;base64,/9j/main",
      crop: "data:image/jpeg;base64,/9j/crop",
      refs: ["data:image/jpeg;base64,/9j/ref"],
    },
  ];
  assert.deepEqual(resolveNoteMedia(unsentOnly, queue), {
    thumb: "data:image/jpeg;base64,/9j/main",
    crop: "data:image/jpeg;base64,/9j/crop",
    refs: ["data:image/jpeg;base64,/9j/ref"],
    after: null,
    noAfterReason: null,
    afterCam: null,
    afterTime: null,
  });
  assert.deepEqual(
    resolveNoteMedia(
      { id: "sent1", refs: ["notes/img/sent1_r0.jpg", "notes/img/sent1_r1.jpg"] },
      [],
    ).refs,
    ["/api/note-img/sent1_r0.jpg", "/api/note-img/sent1_r1.jpg"],
  );

  assert.deepEqual(resolveNoteMedia({ id: "bare1", done: false }, []), {
    thumb: null,
    crop: null,
    refs: [],
    after: null,
    noAfterReason: null,
    afterCam: null,
    afterTime: null,
  });
});

test("note card metadata helpers format shot titles, strip file provenance from pin chips, and extract valid In-to-Out ranges", () => {
  assert.deepEqual(noteShotTitle(3, "side of the bed: up, and to the door"), {
    primary: "Shot 3",
    secondary: "side of the bed: up, and to the door",
    full: "Shot 3 · side of the bed: up, and to the door",
  });
  assert.deepEqual(noteShotTitle(21, "   "), {
    primary: "Shot 21",
    secondary: null,
    full: "Shot 21",
  });

  assert.equal(pinShortLabel("silverfish (src/silverfish.ts, game model)"), "silverfish");
  assert.equal(pinShortLabel("chair (pack/pick.py, choices.json)"), "chair");
  assert.equal(pinShortLabel("phòng"), "phòng");
  assert.equal(pinShortLabel("(unknown)"), "(unknown)");
  assert.equal(pinShortLabel(""), null);

  assert.deepEqual(noteRangePill({ range: [12.5, 16.2] }), [12.5, 16.2]);
  assert.equal(
    noteRangePill({ marks: [{ kind: "pen", t: 12.5, pts: [[0.1, 0.1]] }], range: [12.5, 16.2] }),
    null,
  );
  assert.equal(noteRangePill({ range: [16.2, 12.5] }), null);
});

test("spanFade holds 1 inside a drawn span, fades out over NOTE_FADE*rate after it, and returns 0 when distant", () => {
  assert.equal(spanFade(null, 5, 1), 0);
  assert.equal(spanFade([20, 23], 5, 1), 0);
  assert.equal(spanFade([20, 23], 19.96, 1), 1);
  assert.equal(spanFade([20, 23], 21.5, 1), 1);
  assert.ok(spanFade([20, 23], 24.5, 1) > 0 && spanFade([20, 23], 24.5, 1) < 1);
  assert.equal(spanFade([20, 23], 27, 1), 0);
});

test("noteNumberMap uses server numbers to preserve deleted gaps and falls back cleanly", () => {
  const notes = [{ id: "a" }, { id: "c" }];
  assert.deepEqual(noteNumberMap(notes, '{"a":1,"c":3}'), { a: 1, c: 3 });
  assert.deepEqual(noteNumberMap(notes, null), { a: 1, c: 2 });
  assert.deepEqual(noteNumberMap(notes, "not-json"), { a: 1, c: 2 });
});

test("notes HTTP endpoints immediately emit 'notes' SSE event and expose x-note-numbers without changing body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-api-"));
  try {
    const notes = createNotes(dir);
    let synced = 0;
    const sent = [];
    const app = createApi(
      {
        dir,
        PROJECT: dir,
        notes,
        stamp: async () => ({ version: "v1" }),
        syncNotes: () => {
          synced += 1;
        },
        openRead: () => {
          throw new Error("unused");
        },
        PUBLIC: dir,
        LITE: dir,
      },
      {
        page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
        events: new Set(),
        send: (kind) => sent.push(kind),
      },
    );

    const add1 = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "n1",
          t: 1,
          time: "00:01.000",
          shot: 0,
          text: "first",
          at: "2026-11-14T10:00:01.000Z",
        },
      }),
    });
    assert.equal(add1.status, 200);
    assert.deepEqual(sent, ["notes"]);
    assert.equal(synced, 1);

    await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "n2",
          t: 2,
          time: "00:02.000",
          shot: 0,
          text: "second",
          at: "2026-11-14T10:00:02.000Z",
        },
      }),
    });
    await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "n3",
          t: 3,
          time: "00:03.000",
          shot: 0,
          text: "third",
          at: "2026-11-14T10:00:03.000Z",
        },
      }),
    });
    notes.change("n2", { remove: true });

    sent.length = 0;
    const okFix = await app.request("/notes/n1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fix: { what: "fixed first" } }),
    });
    assert.equal(okFix.status, 200);
    assert.deepEqual(sent, ["notes"]);

    sent.length = 0;
    const badApprove = await app.request("/api/notes/missing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(badApprove.status, 409);
    assert.deepEqual(sent, []);

    const listRes = await app.request("/api/notes");
    assert.equal(listRes.status, 200);
    const body = await listRes.json();
    assert.deepEqual(
      body.map((x) => x.id),
      ["n1", "n3"],
    );
    assert.deepEqual(JSON.parse(listRes.headers.get("x-note-numbers") ?? "{}"), { n1: 1, n3: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("watchNotesFile detects atomic rename writes even before file exists and suppresses duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-watch-"));
  const file = join(dir, "notes", "notes.jsonl");
  mkdirSync(join(dir, "notes"), { recursive: true });
  let hits = 0;
  const w = watchNotesFile(
    file,
    () => {
      hits += 1;
    },
    { debounceMs: 25 },
  );
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, '{"id":"a","t":1,"text":"hi","shot":0,"time":"00:01.000"}\n');
    renameSync(tmp, file);
    for (let i = 0; i < 40 && hits < 1; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(hits, 1);

    // Identical content rewrite is ignored
    writeFileSync(tmp, '{"id":"a","t":1,"text":"hi","shot":0,"time":"00:01.000"}\n');
    renameSync(tmp, file);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(hits, 1);

    // Synced own write does not double-fire
    writeFileSync(tmp, '{"id":"b","t":2,"text":"two","shot":0,"time":"00:02.000"}\n');
    renameSync(tmp, file);
    w.sync();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(hits, 1);
  } finally {
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noteFreeView extracts free-camera pose from cam.world and falls back to cam.line fields", () => {
  assert.equal(
    noteFreeView({ freeCam: false, cam: { world: { p: [1, 2, 3], l: [4, 5, 6] } } }),
    null,
  );
  assert.equal(noteFreeView({ freeCam: true }), null);

  assert.deepEqual(
    noteFreeView({
      freeCam: true,
      cam: {
        shot: 0,
        line: "p: [1, 2, 3], l: [4, 5, 6], fov: 42.5, roll: -0.25, wave: 1.5",
        world: { p: [1, 2, 3], l: [4, 5, 6], fov: 42.5, roll: -0.25, wave: 1.5 },
      },
    }),
    { p: [1, 2, 3], l: [4, 5, 6], fov: 42.5, roll: -0.25, wave: 1.5 },
  );

  // Older notes only store p & l in world and keep fov/roll/wave in cam.line
  assert.deepEqual(
    noteFreeView({
      freeCam: true,
      cam: {
        shot: 0,
        line: "p: [V(0, 0, 0), V(0, 0, 0)], l: [V(1, 1, 1), V(1, 1, 1)], fov: 68, roll: 0.15, wave: 0.8",
        world: { p: [11.2, 4.5, 19.8], l: [14.1, 2.0, 12.6] },
      },
    }),
    { p: [11.2, 4.5, 19.8], l: [14.1, 2.0, 12.6], fov: 68, roll: 0.15, wave: 0.8 },
  );

  // Full Free Cam optics & shake (bob, fstop, focus, handheld) round-trip cleanly from cam.world,
  // and modern cam.world (with world.fov) does not misparse literal "roll:"/"wave:" inside focus labels in cam.line
  assert.deepEqual(
    noteFreeView({
      freeCam: true,
      cam: {
        shot: 0,
        line: 'p: [1, 2, 3], l: [4, 5, 6], fov: 40, focus: {"target":"roll: 1 wave: 2","offset":[0,0.25,0]}',
        world: {
          p: [1, 2, 3],
          l: [4, 5, 6],
          fov: 40,
          bob: 0.75,
          fstop: 2.825,
          focus: { target: "roll: 1 wave: 2", offset: [0, 0.25, 0] },
          handheld: { preset: "HANDYCAM_RUN", amount: 1.3 },
        },
      },
    }),
    {
      p: [1, 2, 3],
      l: [4, 5, 6],
      fov: 40,
      bob: 0.75,
      fstop: 2.825,
      focus: { target: "roll: 1 wave: 2", offset: [0, 0.25, 0] },
      handheld: { preset: "HANDYCAM_RUN", amount: 1.3 },
    },
  );
});

test("blank fix.what with afterData rejects cleanly without writing an orphaned file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-blank-fix-"));
  try {
    const notes = createNotes(dir);
    notes.add({
      note: {
        id: "abc1",
        t: 2,
        time: "00:02.000",
        shot: 0,
        text: "first",
        at: "2026-11-14T10:00:00.000Z",
      },
    });
    const r = notes.change("abc1", {
      fix: {
        what: "   ",
        afterData: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    assert.equal(r.ok, false);
    assert.equal(existsSync(join(dir, "notes/img/abc1_fix0.png")), false);

    const app = createApi(
      { notes, dir, PUBLIC: dir, syncNotes: () => {}, stamp: async () => 1 },
      { page: () => "", events: [], send: () => {} },
    );
    const res = await app.request("/api/notes/abc1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fix: {
          what: "   ",
          afterData: "data:image/png;base64,iVBORw0KGgo=",
        },
      }),
    });
    assert.equal(res.ok, false);
    assert.equal(existsSync(join(dir, "notes/img/abc1_fix0.png")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
