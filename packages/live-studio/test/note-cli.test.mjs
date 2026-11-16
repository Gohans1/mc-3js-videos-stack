// note.mjs done: the AI files what it fixed, through the studio when it is running so the two never write notes.jsonl at once
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { markDone, resolveNote, sendChange } from "../src/note-cli.mjs";

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
const NOTE = join(import.meta.dirname, "../note.mjs");
const answer = (dir, ...args) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "");
  return spawnSync("bun", [NOTE, ...args], { cwd: dir, encoding: "utf8" });
};

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
