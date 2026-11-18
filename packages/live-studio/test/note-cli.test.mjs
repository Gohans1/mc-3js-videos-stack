// note.mjs done: the AI files what it fixed, through the studio when it is running so the two never write notes.jsonl at once
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { markDone, resolveNote, sendChange } from "../src/note-cli.mjs";
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

test("done with no studio running writes the fix into the notes itself, waiting for the creator's check", async () => {
  const dir = film([note("a", "x"), note("b", "y")]);
  await markDone(dir, "a", "moved the chair");
  const [a, b] = readNotes(dir);
  assert.equal(a.state, "check");
  assert.equal(a.fixes[0].what, "moved the chair");
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
    await assert.rejects(markDone(dir, "a", "fixed"), /studio did not answer in 3 s/);
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
    await markDone(dir, "a", "moved the chair");
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
  await markDone(dir, "a", "fixed");
  assert.equal(readNotes(dir)[0].state, "check");
});

// bun run note itself, as the AI reads it
const NOTES = join(import.meta.dirname, "../notes.mjs");
const list = (dir, ...args) =>
  spawnSync("bun", [NOTES, ...args], { cwd: dir, encoding: "utf8" });

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
  assert.deepEqual(notes.map(({ id, number, state, recordedTime, refs }) =>
    ({ id, number, state, recordedTime, refs })), [
    { id: "c", number: 3, state: "open", recordedTime: 6, refs: ["notes/img/c.png"] },
  ]);

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
  const invalidUtf8 = Buffer.from(JSON.stringify(note("c", "corrupt\xff", { at: "2026-11-03" })) + "\n", "latin1");
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
  assert.deepEqual(JSON.parse(listed.stdout).notes.map(({ id, number, state }) =>
    ({ id, number, state })), [{ id: "a", number: 2, state: "done" }]);
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
  writeFileSync(join(dir, "notes/deleted.jsonl"), archived.map((n) => JSON.stringify(n) + "\n").join(""));
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
  assert.deepEqual(JSON.parse(listed.stdout).notes.map(({ id, number }) => ({ id, number })), [
    { id: "legacy", number: null },
  ]);
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
  writeFileSync(join(dir, "renders/live/studio.json"), JSON.stringify({ port: server.address().port }));
  try {
    assert.equal(await sendChange(dir, "a", { restore: true }), "studio");
  } finally {
    server.closeAllConnections();
    server.close();
  }
  assert.deepEqual(got, [{ url: "/api/notes/a", body: { restore: true } }]);
  assert.deepEqual(readNotes(dir).map((row) => row.id), ["b"]);
  assert.equal(readFileSync(archive, "utf8"), archived);
});

test("an answer names the note it went on by number and words, so a wrong number shows, and ends on what to do next", () => {
  const dir = film([note("a", "the door is too fast", { at: "2026-11-01" })]);
  const r = answer(dir, "done", "1", "slowed the door");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^#1 a "the door is too fast": waits for the creator's check/m);
  assert.match(r.stdout.trim().split("\n").at(-1), /^next: bun run notes/);
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
  const r = answer(dir, "done", "a", "and the hinge");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /a 2nd answer: the creator has not checked your last one yet/);
});

test("done on a note that isn't there says so", async () => {
  const dir = film([note("a", "x")]);
  await assert.rejects(markDone(dir, "zz", "fixed"), /no such note: zz/);
});
