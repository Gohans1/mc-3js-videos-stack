// src/notes.mjs: a note keeps every picture sent with it, a retry is not a second note, and × can be undone
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  noteRangePill,
  noteSecond,
  noteShotTitle,
  pinShortLabel,
  resolveNoteMedia,
} from "../app/notes/note-card-meta.ts";
import { spanFade } from "../app/notes/pinfade.ts";
import { createNotes } from "../src/notes.mjs";
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

test("resolveNoteMedia serves persisted /api/note-img URLs for both open and done notes, falls back to unsent data URLs, and handles missing images", () => {
  const openSaved = {
    id: "mw9jknxt",
    done: false,
    img: "notes/img/mw9jknxt.jpg",
    crop: "notes/img/mw9jknxt_crop.jpg",
  };
  assert.deepEqual(resolveNoteMedia(openSaved, []), {
    thumb: "/api/note-img/mw9jknxt.jpg",
    crop: "/api/note-img/mw9jknxt_crop.jpg",
  });

  const doneSaved = { id: "mw3t3iip", done: true, img: "notes/img/mw3t3iip.jpg" };
  assert.deepEqual(resolveNoteMedia(doneSaved, []), {
    thumb: "/api/note-img/mw3t3iip.jpg",
    crop: null,
  });

  const unsentOnly = { id: "new123", done: false };
  const queue = [
    {
      note: unsentOnly,
      img: "data:image/jpeg;base64,/9j/main",
      crop: "data:image/jpeg;base64,/9j/crop",
    },
  ];
  assert.deepEqual(resolveNoteMedia(unsentOnly, queue), {
    thumb: "data:image/jpeg;base64,/9j/main",
    crop: "data:image/jpeg;base64,/9j/crop",
  });

  assert.deepEqual(resolveNoteMedia({ id: "bare1", done: false }, []), { thumb: null, crop: null });
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
