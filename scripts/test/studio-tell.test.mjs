// scripts/studio_tell.py, the Python commands' twin of live-studio src/tell.mjs: what it sends, the studio takes
// (src/activity.mjs Activity), cut as tell.mjs cuts it
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Activity } from "../../packages/live-studio/src/activity.mjs";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("a Python command's long job reaches the studio as tell.mjs sends it: its pid, then how it went, cut to what the studio takes", async () => {
  const got = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const a = Activity.safeParse(JSON.parse(body));
      got.push(a.success ? a.data : a.error.issues);
      res.statusCode = a.success ? 200 : 400;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const film = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(film, "renders/live"), { recursive: true });
  writeFileSync(
    join(film, "renders/live/studio.json"),
    JSON.stringify({ port: server.address().port }),
  );
  const py = `
import sys
from studio_tell import job
end = job(sys.argv[1], "listen", "Listening to the mix", at=-0.001)
print(end("Heard the mix", level="warn", notes=[f"n{i}" for i in range(60)],
          marks=[{"at": -0.01, "to": 2, "say": "   "}, {"at": 3, "say": "BURIED " + "step " * 30}] * 15))`;
  try {
    const out = await new Promise((done) => {
      let text = "";
      const p = spawn("python", ["-c", py, film], { cwd: SCRIPTS });
      p.stdout.on("data", (d) => (text += d));
      p.on("close", () => done(text.trim()));
    });
    assert.equal(out, "True");
    const [start, end] = got;
    assert.deepEqual(
      [start.at, start.job.key, Number.isInteger(start.job.pid)],
      [0, "listen", true],
    );
    assert.deepEqual(end.job, { key: "listen", end: true });
    assert.deepEqual(
      [end.marks.length, end.marks[0], end.notes.length],
      [20, { at: 0, to: 2 }, 50],
    );
    assert.ok(end.marks[1].say.length <= 80);
  } finally {
    server.close();
  }
});
