// note.mjs done: the AI files what it fixed, through the studio when it is running so the two never write notes.jsonl at once
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { markDone, noteNudge, recordNoteReads, resolveNote, sendChange } from "../src/note-cli.mjs";
import { createNotes } from "../src/notes.mjs";

const note = (id, text, extra = {}) => ({ id, t: 10, time: "0:10.000", shot: 2, text, ...extra });
const film = (notes) => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "notes"));
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "notes/notes.jsonl"),
    notes.map((n) => JSON.stringify(n) + "\n").join(""),
  );
  return dir;
};
const readNotes = (dir) =>
  readFileSync(join(dir, "notes/notes.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const writePng = (dir, name = "after.png") => {
  writeFileSync(join(dir, name), PNG_1X1);
  return name;
};

test("done with no studio running writes the fix into the notes itself, waiting for the creator's check", async () => {
  const dir = film([note("a", "x"), note("b", "y")]);
  const pic = writePng(dir);
  await markDone(dir, "a", "moved the chair", { after: pic });
  const [a, b] = readNotes(dir);
  assert.equal(a.state, "check");
  assert.equal(a.fixes[0].what, "moved the chair");
  assert.equal(a.fixes[0].after, "notes/img/a_fix0.png");
  assert.deepEqual(readFileSync(join(dir, a.fixes[0].after)), PNG_1X1);
  assert.ok(!b.done);
});

test("a question goes on the note as one from the AI, and learned is refused until the creator asks to remember", async () => {
  const dir = film([note("a", "x"), note("b", "y", { remember: { scope: "film", at: "t" } })]);
  await sendChange(dir, "a", { fix: { what: "iron door or wooden?", ask: true } });
  assert.equal(readNotes(dir)[0].fixes[0].ask, true);
  await assert.rejects(sendChange(dir, "a", { learned: { what: "x" } }), /never asked to remember/);
  await sendChange(dir, "b", { learned: { what: "slams on the shut frame: src/scene.ts" } });
  assert.equal(readNotes(dir)[1].learned.scope, "film");
});

test("what the studio refuses comes back as its reason", async () => {
  const dir = film([note("a", "x")]);
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.statusCode = 409;
      res.end("nothing to approve: the AI has not answered this note");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(dir, "renders/live/studio.json"),
    JSON.stringify({ port: server.address().port }),
  );
  try {
    await assert.rejects(sendChange(dir, "a", { approve: true }), /nothing to approve/);
  } finally {
    server.close();
  }
});

test("a note named by the number bun run notes shows is the one written that many-th, done ones counted", () => {
  const dir = film([
    note("late", "x", { at: "2026-11-02" }),
    note("first", "y", { at: "2026-11-01", done: true }),
  ]);
  assert.equal(resolveNote(dir, "2"), "late");
  assert.equal(resolveNote(dir, "#1"), "first");
  assert.equal(resolveNote(dir, "late"), "late");
  assert.throws(
    () => resolveNote(dir, "3"),
    /no such note: 3 \(the ids and #numbers: bun run notes/,
  );
});

test("a note the creator deleted keeps its number, so the numbers read before it never move to another note", () => {
  const dir = film([note("b", "y", { at: "2026-11-02" }), note("c", "z", { at: "2026-11-03" })]);
  writeFileSync(
    join(dir, "notes/deleted.jsonl"),
    JSON.stringify(note("a", "x", { at: "2026-11-01" })) + "\n",
  );
  assert.equal(resolveNote(dir, "2"), "b");
  assert.equal(resolveNote(dir, "#3"), "c");
  assert.throws(() => resolveNote(dir, "1"), /note #1 \(a\) was deleted by the creator/);
  assert.throws(() => resolveNote(dir, "a"), /note #1 \(a\) was deleted by the creator/);
});

test("a line with an id but not a whole note is no note to answer", () => {
  const dir = film([note("a", "x"), { id: "bad", t: 3 }]);
  assert.throws(() => resolveNote(dir, "bad"), /no such note: bad/);
});

test("a studio too busy to answer in time is no stopped one: nothing goes into the file behind its back", async () => {
  const dir = film([note("a", "x")]);
  const server = createServer(() => {}); // takes the request, never answers: a studio deep in a build
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(dir, "renders/live/studio.json"),
    JSON.stringify({ port: server.address().port }),
  );
  try {
    await assert.rejects(
      markDone(dir, "a", "fixed", { noAfterReason: "Non-visual tweak" }),
      /studio did not answer in 3 s/,
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
  assert.equal(readNotes(dir)[0].state, undefined);
});

test("done goes through the running studio, and leaves the file to it", async () => {
  const dir = film([note("a", "x")]);
  const got = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      got.push({ url: req.url, body: JSON.parse(body) });
      res.end("ok");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(dir, "renders/live/studio.json"),
    JSON.stringify({ port: server.address().port }),
  );
  try {
    await markDone(dir, "a", "moved the chair", {
      noAfterReason: "Verified framing numerically",
    });
  } finally {
    server.close();
  }
  assert.equal(got.length, 1);
  assert.equal(got[0].url, "/api/notes/a");
  assert.equal(got[0].body.fix.what, "moved the chair");
  assert.ok(!readNotes(dir)[0].done);
});

test("a studio that has stopped since is passed over for the file", async () => {
  const dir = film([note("a", "x")]);
  writeFileSync(join(dir, "renders/live/studio.json"), JSON.stringify({ port: 1 }));
  await markDone(dir, "a", "fixed", { noAfterReason: "Verified headless timing" });
  assert.equal(readNotes(dir)[0].state, "check");
});

// bun run note itself, as the AI reads it
const NOTES = join(import.meta.dirname, "../notes.mjs");
const list = (dir, ...args) => spawnSync("bun", [NOTES, ...args], { cwd: dir, encoding: "utf8" });

test("JSON exposes filtered notes in order with stable numbers and recorded coordinates", () => {
  const dir = film([
    note("a", "first", { t: 4, time: "0:04.000", shot: 1, scene: 3 }),
    note("b", "checked", { shot: 1, state: "check", done: true }),
    note("c", "latest", { t: 6, time: "0:06.000", shot: 1, refs: ["notes/img/c.png"] }),
    note("d", "other shot", { shot: 2 }),
  ]);
  writeFileSync(join(dir, "notes/lessons-config.json"), "{");
  const selected = list(dir, "--json", "--shot", "1", "--sort", "newest", "--limit", "1");
  assert.equal(selected.status, 0, selected.stderr);
  const { notes, total } = JSON.parse(selected.stdout);
  assert.equal(total, 2);
  assert.deepEqual(
    notes.map(({ id, number, state, recordedTime, refs }) => ({
      id,
      number,
      state,
      recordedTime,
      refs,
    })),
    [{ id: "c", number: 3, state: "open", recordedTime: 6, refs: ["notes/img/c.png"] }],
  );

  const exact = list(dir, "#2", "--json");
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(JSON.parse(exact.stdout).notes[0].state, "check");
  const empty = list(dir, "--json", "--shot", "99");
  assert.deepEqual(JSON.parse(empty.stdout), { notes: [], total: 0 });
  const unknown = list(dir, "#99", "--json");
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, "");
});

const NOTE = join(import.meta.dirname, "../note.mjs");
const answer = (dir, ...args) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "");
  return spawnSync("bun", [NOTE, ...args], { cwd: dir, encoding: "utf8" });
};

test("deleted notes can be listed and restored by ID without losing evidence or other archive lines", () => {
  const dir = film([note("b", "active", { at: "2026-11-02" })]);
  const archived = note("a", "old shot", {
    at: "2026-11-01",
    state: "done",
    img: "notes/img/a.jpg",
    fixes: [{ what: "Fixed", at: "2026-11-01" }],
  });
  const archive = join(dir, "notes/deleted.jsonl");
  const invalidUtf8 = Buffer.from(
    JSON.stringify(note("c", "corrupt\xff", { at: "2026-11-03" })) + "\n",
    "latin1",
  );
  const badShape = [
    note("d", null, { at: "2026-10-31" }),
    note("e", "bad fix", { at: "2026-11-04", fixes: [null] }),
  ];
  const badLines = Buffer.concat([
    Buffer.from("42\n"),
    invalidUtf8,
    Buffer.from(badShape.map((entry) => JSON.stringify(entry) + "\n").join("")),
  ]);
  const originalArchive = Buffer.concat([Buffer.from(JSON.stringify(archived) + "\n"), badLines]);
  writeFileSync(archive, originalArchive);
  const human = list(dir, "--deleted");
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /a .*old shot/);
  for (const id of ["c", "d", "e"]) assert.equal(answer(dir, "restore", id).status, 2);
  assert.deepEqual(readFileSync(archive), originalArchive);
  const listed = list(dir, "--deleted", "--json");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout).notes.map(({ id, number, state }) => ({ id, number, state })),
    [{ id: "a", number: 2, state: "done" }],
  );
  const restored = answer(dir, "restore", "a");
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(readNotes(dir)[1], archived);
  assert.deepEqual(readFileSync(archive), badLines);
  assert.equal(resolveNote(dir, "#2"), "a");
  assert.equal(resolveNote(dir, "#3"), "b");
  assert.equal(answer(dir, "restore", "a").status, 0);
  assert.equal(answer(dir, "restore", "#2").status, 2);
  assert.equal(readNotes(dir).length, 2);
  assert.equal(answer(dir, "restore", "missing").status, 2);
});

test("a deleted note with a numeric ID is selected by that ID before an ordinal", () => {
  const dir = film([]);
  const archived = [
    note("2", "the numeric ID", { at: "2026-11-01" }),
    note("other", "the second note", { at: "2026-11-02" }),
  ];
  writeFileSync(
    join(dir, "notes/deleted.jsonl"),
    archived.map((n) => JSON.stringify(n) + "\n").join(""),
  );
  const exact = list(dir, "--deleted", "--json", "2");
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(JSON.parse(exact.stdout).notes[0].id, "2");
  const ordinal = list(dir, "--deleted", "--json", "#2");
  assert.equal(ordinal.status, 0, ordinal.stderr);
  assert.equal(JSON.parse(ordinal.stdout).notes[0].id, "other");
  const restored = answer(dir, "restore", "2");
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(readNotes(dir), [archived[0]]);
});

test("a note with no saved shot or timecode can still be listed, undone and recovered by ID", () => {
  const dir = film([]);
  const notes = createNotes(dir);
  notes.add({ note: { id: "legacy", t: 3, text: "from the earlier API" } }, {});
  const [saved] = readNotes(dir);
  assert.equal(notes.change("legacy", { remove: true }).ok, true);
  assert.equal(notes.change("legacy", { restore: true }).ok, true);
  assert.deepEqual(readNotes(dir), [saved]);
  assert.equal(notes.change("legacy", { remove: true }).ok, true);
  const listed = list(dir, "--deleted", "--json");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout).notes.map(({ id, number }) => ({ id, number })),
    [{ id: "legacy", number: null }],
  );
  const restored = answer(dir, "restore", "legacy");
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(readNotes(dir), [saved]);
});

test("deleting after restore separates a new note from an unterminated archive line", () => {
  const a = note("a", "recover first");
  const b = note("b", "delete next");
  const dir = film([b]);
  const archive = join(dir, "notes/deleted.jsonl");
  const tail = '{"tail":';
  writeFileSync(archive, JSON.stringify(a) + "\n" + tail);
  const notes = createNotes(dir);
  assert.equal(notes.change("a", { restore: true }).ok, true);
  assert.equal(readFileSync(archive, "utf8"), tail);
  assert.equal(notes.change("b", { remove: true }).ok, true);
  assert.equal(notes.change("b", { restore: true }).ok, true);
  assert.deepEqual(readNotes(dir), [a, b]);
  assert.equal(readFileSync(archive, "utf8"), tail + "\n");
});

test("a restore retry removes the stale archive entry without overwriting a newer active note", () => {
  const latest = note("a", "edited after restoring");
  const dir = film([latest]);
  const archive = join(dir, "notes/deleted.jsonl");
  const other = JSON.stringify(note("b", "still deleted")) + "\n";
  writeFileSync(archive, JSON.stringify(note("a", "old text")) + "\n" + other);
  const restored = answer(dir, "restore", "a");
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(readNotes(dir), [latest]);
  assert.equal(readFileSync(archive, "utf8"), other);
});

test("a restore sends the existing Studio operation when the server owns the note files", async () => {
  const dir = film([note("b", "active", { at: "2026-11-02" })]);
  const archive = join(dir, "notes/deleted.jsonl");
  const archived = JSON.stringify(note("a", "deleted", { at: "2026-11-01" })) + "\n";
  writeFileSync(archive, archived);
  const got = [];
  const server = createServer(async (req, res) => {
    const body = await new Response(req).json();
    got.push({ url: req.url, body });
    res.end("ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(dir, "renders/live/studio.json"),
    JSON.stringify({ port: server.address().port }),
  );
  try {
    assert.equal(await sendChange(dir, "a", { restore: true }), "studio");
  } finally {
    server.closeAllConnections();
    server.close();
  }
  assert.deepEqual(got, [{ url: "/api/notes/a", body: { restore: true } }]);
  assert.deepEqual(
    readNotes(dir).map((row) => row.id),
    ["b"],
  );
  assert.equal(readFileSync(archive, "utf8"), archived);
});

test("an answer names the note it went on by number and words, so a wrong number shows, and ends on what to do next", () => {
  const dir = film([note("a", "the door is too fast", { at: "2026-11-01" })]);
  const pic = writePng(dir);
  const r = answer(dir, "done", "1", "slowed the door", "--after", pic);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^#1 a "the door is too fast": waits for the creator's check/m);
  assert.match(r.stdout.trim().split("\n").at(-1), /^next: bun run notes/);
});

test("done enforces --after <image> or --no-after <reason>, stores custom cam/t, and rejects missing or conflicting proof", async () => {
  const dir = film([
    note("a", "moved bench", { at: "2026-11-01" }),
    note("b", "louder step", { at: "2026-11-02" }),
  ]);
  const pic = writePng(dir, "moved.png");

  // Neither --after nor --no-after -> exit 2 with actionable guidance mentioning custom camera framing
  const missing = answer(dir, "done", "1", "moved bench right");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--after.*--no-after/);
  assert.match(missing.stderr, /--inspect .*--cam/);

  // Both --after and --no-after -> exit 2
  const both = answer(
    dir,
    "done",
    "1",
    "moved bench right",
    "--after",
    pic,
    "--no-after",
    "not needed",
  );
  assert.equal(both.status, 2);
  assert.match(both.stderr, /not both/);

  // Invalid / missing file or blank --no-after -> exit 2
  const badFile = answer(dir, "done", "1", "moved bench right", "--after", "missing.png");
  assert.equal(badFile.status, 2);
  assert.match(badFile.stderr, /not found/);
  writeFileSync(join(dir, "not-img.txt"), "hello");
  const badMime = answer(dir, "done", "1", "moved bench right", "--after", "not-img.txt");
  assert.equal(badMime.status, 2);
  assert.match(badMime.stderr, /PNG, JPEG, or WebP/);
  const blankReason = answer(dir, "done", "2", "boosted", "--no-after", "   ");
  assert.equal(blankReason.status, 2);

  assert.equal(
    answer(dir, "done", "1", "fixed", "--after", pic, "--cam", "1,2,3,4,5,6,50,").status,
    2,
  );
  assert.equal(answer(dir, "ask", "1", "hold longer?", "--no-after", "unused").status, 2);

  // Valid --after + custom --cam & --t succeeds without --no-after
  const okAfter = answer(
    dir,
    "done",
    "1",
    "moved bench right",
    "--after",
    pic,
    "--cam",
    "2.5,3,8,0.5,1,0,45",
    "--t",
    "0:12.500",
  );
  assert.equal(okAfter.status, 0, okAfter.stderr);
  const [savedA] = readNotes(dir);
  assert.equal(savedA.fixes[0].after, "notes/img/a_fix0.png");
  assert.equal(savedA.fixes[0].t, 12.5);
  assert.deepEqual(savedA.fixes[0].cam, { p: [2.5, 3, 8], l: [0.5, 1, 0], fov: 45 });
  const detailA = list(dir, "a", "--done");
  assert.equal(detailA.status, 0, detailA.stderr);
  assert.match(detailA.stdout, /after picture: .*a_fix0\.png/);
  assert.match(detailA.stdout, /after view: at 12\.5s p=\[2\.5, 3, 8\] l=\[0\.5, 1, 0\] fov=45/);

  // Valid --no-after succeeds cleanly
  const okReason = answer(
    dir,
    "done",
    "2",
    "boosted foley",
    "--no-after",
    "Audio-only gain change",
  );
  assert.equal(okReason.status, 0, okReason.stderr);
  const [, savedB] = readNotes(dir);
  assert.equal(savedB.fixes[0].noAfterReason, "Audio-only gain change");
  assert.equal(savedB.fixes[0].after, undefined);
  const detailB = list(dir, "b", "--done");
  assert.match(detailB.stdout, /no after picture reason: Audio-only gain change/);
});

test("a second answer before the creator checked the first says so", () => {
  const dir = film([
    note("a", "x", {
      at: "2026-11-01",
      state: "check",
      done: true,
      fixes: [{ what: "y", at: "t" }],
    }),
  ]);
  const r = answer(dir, "done", "a", "and the hinge", "--no-after", "Verified hinge timing");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /a 2nd answer: the creator has not checked your last one yet/);
});

test("done on a note that isn't there says so", async () => {
  const dir = film([note("a", "x")]);
  await assert.rejects(
    markDone(dir, "zz", "fixed", { noAfterReason: "Non-existent note test" }),
    /no such note: zz/,
  );
});

test("done and ask report newly created notes since reading that note, sorted closest in film time first, and stay silent when none arrived", () => {
  const mkNote = (id, t, text, at) => ({
    id,
    t,
    time: `00:${String(t).padStart(2, "0")}.000`,
    frame: Math.round(t * 24),
    shot: t >= 20 ? 1 : 0,
    shotName: t >= 20 ? "second" : "first",
    text,
    at,
    done: false,
  });

  // 1. No new notes between notes show and done -> silent (no extra section)
  const silentDir = film([mkNote("a", 10, "base note", "2026-11-01T10:00:00Z")]);
  const readSilent = list(silentDir, "a");
  assert.equal(readSilent.status, 0, readSilent.stderr);
  const doneSilent = answer(silentDir, "done", "a", "fixed cleanly", "--no-after", "Audio tweak");
  assert.equal(doneSilent.status, 0, doneSilent.stderr);
  assert.equal(doneSilent.stdout.includes("new note"), false);

  // 2. Creator adds notes at t=45, t=10.5, and t=9.8 while AI works on note a (t=10) and note b (t=30)
  const dir = film([
    mkNote("a", 10, "fix hero glow", "2026-11-01T10:00:00Z"),
    mkNote("b", 30, "tune pan speed", "2026-11-01T10:01:00Z"),
  ]);
  const readBoth = list(dir, "a", "b");
  assert.equal(readBoth.status, 0, readBoth.stderr);

  const file = join(dir, "notes/notes.jsonl");
  const extra = [
    mkNote("far45", 45, "far end note", "2026-11-01T10:02:00Z"),
    mkNote("near105", 10.5, "follow-up right after a", "2026-11-01T10:03:00Z"),
    mkNote("near98", 9.8, "tight frame note before a", "2026-11-01T10:04:00Z"),
  ];
  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}${extra.map((n) => JSON.stringify(n)).join("\n")}\n`,
  );

  const doneA = answer(dir, "done", "a", "fixed glow", "--no-after", "Shader parameter tweak");
  assert.equal(doneA.status, 0, doneA.stderr);
  assert.match(
    doneA.stdout,
    /new notes added while you worked on #1 \(closest to 00:10\.000 first/,
  );
  const idx98 = doneA.stdout.indexOf("near98");
  const idx105 = doneA.stdout.indexOf("near105");
  const idx45 = doneA.stdout.indexOf("far45");
  assert.ok(idx98 > 0 && idx98 < idx105 && idx105 < idx45, doneA.stdout);

  // b kept its own baseline: marking ask on b sorts closest to t=30 first (far45 at 15s, near105 at 19.5s, near98 at 20.2s)
  const askB = answer(dir, "ask", "b", "should pan hold longer?");
  assert.equal(askB.status, 0, askB.stderr);
  assert.match(askB.stdout, /new notes added while you worked on #2/);
  const bIdx45 = askB.stdout.indexOf("far45");
  const bIdx105 = askB.stdout.indexOf("near105");
  const bIdx98 = askB.stdout.indexOf("near98");
  assert.ok(bIdx45 > 0 && bIdx45 < bIdx105 && bIdx105 < bIdx98, askB.stdout);

  // Consuming via ask advances b's baseline instead of clearing it back to older lastList, so a second ask stays silent
  const repeatAskB = answer(dir, "ask", "b", "follow-up check?");
  assert.equal(repeatAskB.status, 0, repeatAskB.stderr);
  assert.equal(repeatAskB.stdout.includes("new note"), false, repeatAskB.stdout);
});

test("done --cam accepts 135mm prime fov (8.6) and +/-pi roll while rejecting out-of-range fov/roll", () => {
  const dir = film([note("a", "x")]);
  const pic = writePng(dir);

  const prime = answer(
    dir,
    "done",
    "1",
    "tight 135mm shot",
    "--after",
    pic,
    "--cam",
    "1,2,3,4,5,6,8.6,1.5",
  );
  assert.equal(prime.status, 0, prime.stderr);
  const [saved] = readNotes(dir);
  assert.deepEqual(saved.fixes[0].cam, { p: [1, 2, 3], l: [4, 5, 6], fov: 8.6, roll: 1.5 });

  assert.equal(
    answer(dir, "done", "1", "too narrow", "--after", pic, "--cam", "1,2,3,4,5,6,0.05,0").status,
    2,
  );
  assert.equal(
    answer(dir, "done", "1", "too wide", "--after", pic, "--cam", "1,2,3,4,5,6,180,0").status,
    2,
  );
  assert.equal(
    answer(dir, "done", "1", "over-rolled", "--after", pic, "--cam", "1,2,3,4,5,6,50,3.2").status,
    2,
  );
});

// their last line stays a next: line, the one an AI acts on
test("render, check and at end on the creator's open notes, and how many came since the AI last listed them", () => {
  const dir = film([note("a", "x"), note("b", "y", { state: "check", done: true })]);
  assert.equal(
    noteNudge(dir),
    "next: bun run notes first: the creator has 1 open note, 1 new since your last bun run notes",
  );
  recordNoteReads(dir, [], createNotes(dir).read());
  assert.equal(noteNudge(dir), "next: bun run notes first: the creator has 1 open note");
  createNotes(dir).add({ note: note("c", "z") });
  assert.equal(
    noteNudge(dir),
    "next: bun run notes first: the creator has 2 open notes, 1 new since your last bun run notes",
  );
  assert.equal(noteNudge(film([note("b", "y", { state: "done", done: true })])), "");
});
