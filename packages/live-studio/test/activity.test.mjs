import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Activity, createActivity } from "../src/activity.mjs";
import { startJob, tell } from "../src/tell.mjs";

const film = (port) => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  if (port !== undefined)
    writeFileSync(join(dir, "renders/live/studio.json"), JSON.stringify({ port }));
  return dir;
};

test("a command's line reaches the running studio", async () => {
  const got = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push([req.method, req.url, JSON.parse(body)]);
      res.end("ok");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const ok = await tell(film(server.address().port), { say: "Reading note #3", notes: ["ab1"] });
    assert.equal(ok, true);
    assert.deepEqual(got, [["POST", "/api/activity", { say: "Reading note #3", notes: ["ab1"] }]]);
  } finally {
    server.close();
  }
});

test("no studio running, or one gone since, and the command goes on at once", async () => {
  assert.equal(await tell(film(), { say: "x" }), false);
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const t0 = Date.now();
  assert.equal(await tell(film(port), { say: "x" }), false);
  assert.ok(Date.now() - t0 < 1500);
});

test("a studio busy rebuilding the code still takes the line; one that never answers holds a command up two seconds at most", async () => {
  const server = createServer((_, res) => setTimeout(() => res.end("ok"), 1400));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.equal(await tell(film(server.address().port), { say: "Rendering clip" }), true);
    server.removeAllListeners("request");
    const t0 = Date.now();
    assert.equal(await tell(film(server.address().port), { say: "x" }), false);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("each line goes to the open pages with its number and time, and only the latest are kept for a page opened later", () => {
  const sent = [];
  const activity = createActivity((event, data) => sent.push([event, JSON.parse(data)]), {
    keep: 2,
  });
  activity.add({ say: "one" });
  activity.add({ say: "two", at: 35.5 });
  activity.add({ say: "three", lessons: ["camera.md"] });
  assert.deepEqual(
    sent.map(([e, a]) => [e, a.id, a.say]),
    [
      ["activity", 1, "one"],
      ["activity", 2, "two"],
      ["activity", 3, "three"],
    ],
  );
  assert.equal(typeof sent[0][1].when, "number");
  assert.deepEqual(
    activity.state().lines.map((a) => a.say),
    ["two", "three"],
  );
});

test("a render killed before its end line is over once its process is gone; till then a page opened sees it running", async () => {
  const sent = [];
  const activity = createActivity((_, data) => sent.push(JSON.parse(data)), { every: 20 });
  const render = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  try {
    activity.add({
      say: "Rendering clip 40-44 s",
      at: 40,
      to: 44,
      job: { key: "render clip", pid: render.pid },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(
      activity.state().running.map((a) => a.say),
      ["Rendering clip 40-44 s"],
    );
  } finally {
    render.kill();
  }
  await new Promise((r) => render.once("exit", r));
  for (let i = 0; i < 100 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent.at(-1).job, { key: "render clip", end: true });
  assert.deepEqual(activity.state().running, []);
});

test("a line says something, in a few words, about notes, lessons and seconds of the film", () => {
  assert.equal(Activity.safeParse({ say: "Rendering 40-44 s", at: 40, to: 44 }).success, true);
  assert.equal(Activity.safeParse({ say: "  " }).success, false);
  assert.equal(Activity.safeParse({ say: "x".repeat(201) }).success, false);
  assert.equal(Activity.safeParse({ say: "x", notes: ["../etc"] }).success, false);
  assert.equal(Activity.safeParse({ say: "x", at: -1 }).success, false);
});

const studio = async () => {
  const got = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const a = Activity.safeParse(JSON.parse(body));
      got.push(a.success && a.data);
      res.statusCode = a.success ? 200 : 400;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { dir: film(server.address().port), got, close: () => server.close() };
};

test("a long line is cut to what the studio takes, never refused", async () => {
  const s = await studio();
  try {
    assert.equal(await tell(s.dir, { say: `Fixed note #3: ${"a\n".repeat(300)}` }), true);
    assert.equal(s.got[0].say.length, 200);
    assert.ok(s.got[0].say.endsWith("…") && !s.got[0].say.includes("\n"));
  } finally {
    s.close();
  }
});

test("what a check found is lit at its seconds: too many findings, or too wordy, are cut, never refused", async () => {
  const s = await studio();
  try {
    const marks = Array.from({ length: 30 }, (_, i) => ({
      at: i,
      say: `BURIED ${"step ".repeat(30)}`,
    }));
    assert.equal(
      await tell(s.dir, { say: "Heard the mix: 30 to look at", level: "warn", marks }),
      true,
    );
    assert.equal(s.got[0].marks.length, 20);
    assert.ok(s.got[0].marks.every((m) => m.say.length <= 80));
    const notes = Array.from({ length: 60 }, (_, i) => `n${i}`),
      lessons = Array.from({ length: 25 }, (_, i) => `l${i}.md`);
    assert.equal(
      await tell(s.dir, { say: "Reading the open notes", notes, lessons, at: -0.001 }),
      true,
    );
    assert.deepEqual([s.got[1].notes.length, s.got[1].lessons.length, s.got[1].at], [50, 20, 0]);
  } finally {
    s.close();
  }
});

test("a long command shows busy from its start, which names its process, to its end, which says how it went", async () => {
  const s = await studio();
  try {
    const end = await startJob(s.dir, "render clip", {
      say: "Rendering clip 40-44 s",
      at: 40,
      to: 44,
    });
    await end({ say: "Rendered clip in 12 s", level: "ok" });
    assert.deepEqual(
      s.got.map((a) => [a.say, a.job, a.level]),
      [
        ["Rendering clip 40-44 s", { key: "render clip", pid: process.pid }, undefined],
        ["Rendered clip in 12 s", { key: "render clip", end: true }, "ok"],
      ],
    );
  } finally {
    s.close();
  }
});
