import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runMediaJob } from "../media/job.mjs";

test("media jobs retain failures and previous evidence in separate run folders", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "media-job-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const first = await runMediaJob({
    tool: "fixture",
    out,
    minutes: 1,
    command: [process.execPath, "-e", 'console.log("partial evidence"); process.exit(7)'],
  });
  assert.equal(first.status, "failed");
  assert.equal(first.exitCode, 7);
  assert.match(readFileSync(join(first.folder, "process.log"), "utf8"), /partial evidence/);
  const kept = readFileSync(join(first.folder, "job.json"), "utf8");
  const second = await runMediaJob({
    tool: "fixture",
    out,
    minutes: 1,
    command: [process.execPath, "-e", 'console.log("done")'],
  });
  assert.equal(second.status, "completed");
  assert.notEqual(first.folder, second.folder);
  assert.equal(readFileSync(join(first.folder, "job.json"), "utf8"), kept);
});

test("a media deadline records timeout and a missing executable records failure", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "media-stop-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const timed = await runMediaJob({
    tool: "fixture",
    out,
    minutes: 0.01,
    command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
  });
  assert.equal(timed.status, "timed_out");
  const failed = await runMediaJob({
    tool: "fixture",
    out,
    minutes: 1,
    command: [join(out, "missing-executable")],
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /ENOENT|not found/i);
  assert.equal(JSON.parse(readFileSync(join(failed.folder, "job.json"), "utf8")).status, "failed");
});
